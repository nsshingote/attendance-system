"""
routers/holidays.py
Holiday management. Holidays are managed by Admin/SuperAdmin and are
automatically reflected in attendance (see utils/attendance_status.py
and the check-in flow in routers/attendance.py).
"""

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import Holiday, User, ActivityLog, Team
from schemas import HolidayCreate, HolidayOut

router = APIRouter()

VALID_APPLIES_TO = {"all_users", "specific_users", "office", "onsite", "specific_teams"}


def _holiday_out(holiday: Holiday) -> dict:
    return {
        "id": holiday.id,
        "holiday_date": holiday.holiday_date,
        "holiday_name": holiday.holiday_name,
        "applies_to": holiday.applies_to,
        "user_ids": json.loads(holiday.target_user_ids_json or "[]"),
        "team_ids": json.loads(holiday.target_team_ids_json or "[]"),
        "created_by": holiday.created_by,
        "created_at": holiday.created_at,
    }


@router.get("", response_model=List[HolidayOut])
@router.get("/", response_model=List[HolidayOut])
def list_holidays(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Holiday)
    if year:
        query = query.filter(Holiday.holiday_date.between(f"{year}-01-01", f"{year}-12-31"))
    return [_holiday_out(holiday) for holiday in query.order_by(Holiday.holiday_date).all()]


@router.post("/", response_model=HolidayOut, status_code=201)
def add_holiday(
    payload: HolidayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if payload.applies_to not in VALID_APPLIES_TO:
        raise HTTPException(status_code=422, detail="Invalid holiday audience")
    if payload.applies_to == "specific_users" and not payload.user_ids:
        raise HTTPException(status_code=422, detail="Select at least one user")
    if payload.applies_to == "specific_teams" and not payload.team_ids:
        raise HTTPException(status_code=422, detail="Select at least one team")
    if payload.user_ids and db.query(User.id).filter(User.id.in_(payload.user_ids)).count() != len(set(payload.user_ids)):
        raise HTTPException(status_code=422, detail="One or more users were not found")
    if payload.team_ids and db.query(Team.id).filter(Team.id.in_(payload.team_ids)).count() != len(set(payload.team_ids)):
        raise HTTPException(status_code=422, detail="One or more teams were not found")

    holiday = Holiday(
        holiday_date=payload.holiday_date,
        holiday_name=payload.holiday_name,
        applies_to=payload.applies_to,
        target_user_ids_json=json.dumps(sorted(set(payload.user_ids))) if payload.user_ids else None,
        target_team_ids_json=json.dumps(sorted(set(payload.team_ids))) if payload.team_ids else None,
        created_by=current_user.id,
    )
    db.add(holiday)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Added holiday '{payload.holiday_name}'"))
    db.commit()
    db.refresh(holiday)
    return _holiday_out(holiday)


@router.delete("/{holiday_id}")
def delete_holiday(
    holiday_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    holiday = db.query(Holiday).filter(Holiday.id == holiday_id).first()
    if not holiday:
        raise HTTPException(status_code=404, detail="Holiday not found")

    db.delete(holiday)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted holiday '{holiday.holiday_name}'"))
    db.commit()

    return {"message": f"Holiday '{holiday.holiday_name}' deleted"}