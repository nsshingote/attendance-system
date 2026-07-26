"""
routers/company_settings.py
Office start/end time, late-grace period, and weekly-off-day configuration.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from models import CompanySettings, User, ActivityLog
from schemas import CompanySettingsUpdate, CompanySettingsOut

router = APIRouter()


@router.get("/", response_model=CompanySettingsOut)
def get_settings(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    settings_row = db.query(CompanySettings).order_by(CompanySettings.id.desc()).first()
    if not settings_row:
        settings_row = CompanySettings(
            office_start_time="10:00:00",
            office_end_time="18:30:00",
            late_grace_minutes=20,
            weekly_off_day="Sunday",
        )
        db.add(settings_row)
        db.commit()
        db.refresh(settings_row)
    return settings_row


@router.put("/", response_model=CompanySettingsOut)
def update_settings(
    payload: CompanySettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    settings_row = db.query(CompanySettings).order_by(CompanySettings.id.desc()).first()
    if not settings_row:
        settings_row = CompanySettings(**payload.model_dump())
        db.add(settings_row)
    else:
        for field, value in payload.model_dump().items():
            setattr(settings_row, field, value)

    db.add(ActivityLog(user_id=current_user.id, activity="Updated company settings"))
    db.commit()
    db.refresh(settings_row)
    return settings_row