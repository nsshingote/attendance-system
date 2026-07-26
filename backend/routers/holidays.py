"""
routers/holidays.py
Holiday management. Holidays are managed by Admin/SuperAdmin and are
automatically reflected in attendance (see utils/attendance_status.py
and the check-in flow in routers/attendance.py).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import Holiday, User, ActivityLog
from schemas import HolidayCreate, HolidayOut

router = APIRouter()


@router.get("/", response_model=List[HolidayOut])
def list_holidays(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Holiday)
    if year:
        query = query.filter(Holiday.holiday_date.between(f"{year}-01-01", f"{year}-12-31"))
    return query.order_by(Holiday.holiday_date).all()


@router.post("/", response_model=HolidayOut, status_code=201)
def add_holiday(
    payload: HolidayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(Holiday).filter(Holiday.holiday_date == payload.holiday_date).first():
        raise HTTPException(status_code=400, detail="A holiday is already defined for this date")

    holiday = Holiday(
        holiday_date=payload.holiday_date,
        holiday_name=payload.holiday_name,
        created_by=current_user.id,
    )
    db.add(holiday)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Added holiday '{payload.holiday_name}'"))
    db.commit()
    db.refresh(holiday)
    return holiday


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