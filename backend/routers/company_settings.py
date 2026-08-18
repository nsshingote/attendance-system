"""
routers/company_settings.py
Office start/end time, late-grace period, and weekly-off-day configuration.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import CompanySettings, User, ActivityLog
from schemas import CompanySettingsUpdate, CompanySettingsOut

router = APIRouter()

DEFAULT_COMPANY_NAME = "PropCheckup"
DEFAULT_COMPANY_ADDRESS = "Office No. 62, Xth Central Mall, 2nd Floor, Above Kotak Bank, Mahavir Nagar, Kandivali West, Mumbai - 400067"


def _settings_default_payload():
    return {
        "office_start_time": "10:00:00",
        "office_end_time": "18:30:00",
        "late_grace_minutes": 20,
        "weekly_off_day": "Sunday",
        "company_name": DEFAULT_COMPANY_NAME,
        "company_address": DEFAULT_COMPANY_ADDRESS,
    }


def _company_settings_columns(db: Session):
    try:
        inspector = inspect(db.bind)
        return {column["name"] for column in inspector.get_columns("company_settings")}
    except Exception:
        return set()


def _read_company_settings_row(db: Session):
    columns = _company_settings_columns(db)
    select_columns = [
        "id",
        "office_start_time",
        "office_end_time",
        "late_grace_minutes",
        "weekly_off_day",
    ]
    if "company_name" in columns:
        select_columns.append("company_name")
    if "company_address" in columns:
        select_columns.append("company_address")

    raw_row = db.execute(
        text(f"SELECT {', '.join(select_columns)} FROM company_settings ORDER BY id DESC LIMIT 1")
    ).mappings().first()

    if not raw_row:
        defaults = _settings_default_payload()
        return {
            "id": None,
            **defaults,
        }

    payload = {
        "id": raw_row["id"],
        "office_start_time": raw_row.get("office_start_time") or "10:00:00",
        "office_end_time": raw_row.get("office_end_time") or "18:30:00",
        "late_grace_minutes": raw_row.get("late_grace_minutes") or 20,
        "weekly_off_day": raw_row.get("weekly_off_day") or "Sunday",
        "company_name": raw_row.get("company_name") or DEFAULT_COMPANY_NAME,
        "company_address": raw_row.get("company_address") or DEFAULT_COMPANY_ADDRESS,
    }
    return payload


def _upsert_company_settings_row(db: Session, payload: dict):
    columns = _company_settings_columns(db)
    normalized = {
        "office_start_time": payload.get("office_start_time") or "10:00:00",
        "office_end_time": payload.get("office_end_time") or "18:30:00",
        "late_grace_minutes": payload.get("late_grace_minutes") or 20,
        "weekly_off_day": payload.get("weekly_off_day") or "Sunday",
    }
    if "company_name" in columns:
        normalized["company_name"] = payload.get("company_name") or DEFAULT_COMPANY_NAME
    if "company_address" in columns:
        normalized["company_address"] = payload.get("company_address") or DEFAULT_COMPANY_ADDRESS

    existing = db.execute(text("SELECT id FROM company_settings ORDER BY id DESC LIMIT 1")).scalar()
    if existing is None:
        insert_columns = list(normalized.keys())
        placeholders = ", ".join(f":{field}" for field in insert_columns)
        db.execute(text(f"INSERT INTO company_settings ({', '.join(insert_columns)}) VALUES ({placeholders})"), normalized)
        db.commit()
        return _read_company_settings_row(db)

    set_values = ", ".join(f"{field} = :{field}" for field in normalized)
    db.execute(text(f"UPDATE company_settings SET {set_values} WHERE id = :id"), {"id": existing, **normalized})
    db.commit()
    return _read_company_settings_row(db)


@router.get("/branding")
def get_company_branding(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return the existing company details needed on employee-facing documents."""
    settings = _read_company_settings_row(db)
    return {
        "company_name": settings["company_name"],
        "company_address": settings["company_address"],
        "logo_url": "/logo.jpg",
    }


@router.get("/", response_model=CompanySettingsOut)
def get_settings(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    settings = _read_company_settings_row(db)
    if settings.get("id") is None:
        settings = _upsert_company_settings_row(
            db,
            _settings_default_payload(),
        )
    return settings


@router.put("/", response_model=CompanySettingsOut)
def update_settings(
    payload: CompanySettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = _read_company_settings_row(db)
    next_payload = {**existing}
    for field, value in payload.model_dump(exclude_none=True).items():
        if value is not None:
            next_payload[field] = value

    updated = _upsert_company_settings_row(db, next_payload)
    db.add(ActivityLog(user_id=current_user.id, activity="Updated company settings"))
    db.commit()
    return updated
