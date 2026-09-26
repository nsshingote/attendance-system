"""
routers/holidays.py
Holiday management. Holidays are managed by Admin/SuperAdmin and are
automatically reflected in attendance (see utils/attendance_status.py
and the check-in flow in routers/attendance.py).
"""

import json
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, has_permission, require_admin_permission, effective_role_key
from database import get_db
from models import (
    Attendance,
    CompanySettings,
    Holiday,
    LeaveRequest,
    LeaveRequestAllocation,
    LeaveHolidayAllocationHistory,
    User,
    ActivityLog,
    Team,
)
from schemas import HolidayCreate, HolidayOut
from utils.attendance_status import determine_attendance_status_for_date, holiday_applies_to_user
from utils.leave_calculator import (
    _get_chargeable_leave_dates,
    compute_request_category_from_allocations,
    has_other_approved_or_pending_paid_leave_this_month,
)

router = APIRouter()

VALID_APPLIES_TO = {"all_users", "specific_users", "office", "onsite", "specific_teams"}


def _holiday_out(db: Session, holiday: Holiday) -> dict:
    user_ids = json.loads(holiday.target_user_ids_json or "[]")
    team_ids = json.loads(holiday.target_team_ids_json or "[]")
    users_by_id = {
        user.id: user.name
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}
    teams_by_id = {
        team.id: team.name
        for team in db.query(Team).filter(Team.id.in_(team_ids)).all()
    } if team_ids else {}
    return {
        "id": holiday.id,
        "holiday_date": holiday.holiday_date,
        "holiday_name": holiday.holiday_name,
        "applies_to": holiday.applies_to,
        "user_ids": user_ids,
        "team_ids": team_ids,
        "user_names": [users_by_id[user_id] for user_id in user_ids if user_id in users_by_id],
        "team_names": [teams_by_id[team_id] for team_id in team_ids if team_id in teams_by_id],
        "created_by": holiday.created_by,
        "created_at": holiday.created_at,
    }


def _sync_holiday_removed_leave(db: Session, holiday: Holiday) -> None:
    requests = db.query(LeaveRequest).filter(
        LeaveRequest.status == "Approved",
        LeaveRequest.user_id.is_not(None),
        LeaveRequest.from_date <= holiday.holiday_date,
        LeaveRequest.to_date >= holiday.holiday_date,
    ).with_for_update().all()

    changed_user_ids = set()
    for leave_request in requests:
        if not holiday_applies_to_user(db, holiday, leave_request.user_id):
            continue
        allocation = next(
            (
                row
                for row in leave_request.allocations
                if row.allocation_date == holiday.holiday_date
            ),
            None,
        )
        if allocation is None:
            continue
        history = db.query(LeaveHolidayAllocationHistory).filter(
            LeaveHolidayAllocationHistory.leave_request_id == leave_request.id,
            LeaveHolidayAllocationHistory.allocation_date == holiday.holiday_date,
        ).with_for_update().first()
        if history is None:
            history = LeaveHolidayAllocationHistory(
                leave_request_id=leave_request.id,
                allocation_date=holiday.holiday_date,
                leave_category=allocation.leave_category,
                is_sandwich=allocation.is_sandwich,
                is_restored=False,
                carried_balance_refunded=allocation.leave_category == "Carried",
            )
            db.add(history)
        else:
            history.leave_category = allocation.leave_category
            history.is_sandwich = allocation.is_sandwich
            history.is_restored = False
            history.carried_balance_refunded = allocation.leave_category == "Carried"
        if allocation.leave_category == "Carried":
            target_user = db.query(User).filter(
                User.id == leave_request.user_id
            ).with_for_update().first()
            if target_user is None:
                raise HTTPException(status_code=409, detail="Leave owner no longer exists")
            target_user.carried_leave = (target_user.carried_leave or 0) + 1
        leave_request.allocations.remove(allocation)
        leave_request.total_days = len(leave_request.allocations)
        leave_request.leave_category = compute_request_category_from_allocations(
            [
                (row.allocation_date, row.leave_category)
                for row in leave_request.allocations
            ]
        )
        changed_user_ids.add(leave_request.user_id)

    db.flush()
    if changed_user_ids:
        from routers.leave import _reconcile_sandwich_allocations_for_user

        for user_id in changed_user_ids:
            _reconcile_sandwich_allocations_for_user(db, user_id)

    for user_id in changed_user_ids:
        attendance = db.query(Attendance).filter(
            Attendance.user_id == user_id,
            Attendance.attendance_date == holiday.holiday_date,
        ).first()
        if attendance and not attendance.manual_override and attendance.status == "On Leave":
            attendance.status = determine_attendance_status_for_date(
                db, user_id, holiday.holiday_date
            )


def _restore_approved_leave_for_deleted_holiday(db: Session, holiday: Holiday) -> None:
    from routers.leave import _apply_sandwich_rule_on_request, mark_leave_in_attendance

    requests = db.query(LeaveRequest).filter(
        LeaveRequest.status == "Approved",
        LeaveRequest.user_id.is_not(None),
        LeaveRequest.from_date <= holiday.holiday_date,
        LeaveRequest.to_date >= holiday.holiday_date,
    ).with_for_update().all()

    for leave_request in requests:
        if not holiday_applies_to_user(db, holiday, leave_request.user_id):
            continue
        if any(
            allocation.allocation_date == holiday.holiday_date
            for allocation in leave_request.allocations
        ):
            continue

        history = db.query(LeaveHolidayAllocationHistory).filter(
            LeaveHolidayAllocationHistory.leave_request_id == leave_request.id,
            LeaveHolidayAllocationHistory.allocation_date == holiday.holiday_date,
        ).with_for_update().first()

        settings = db.query(CompanySettings).first()
        if (
            settings
            and settings.sandwich_method_enabled
            and settings.weekly_off_day
            and holiday.holiday_date.strftime("%A").casefold()
            == settings.weekly_off_day.casefold()
        ):
            existing_dates = {allocation.allocation_date for allocation in leave_request.allocations}
            _apply_sandwich_rule_on_request(
                db,
                leave_request,
                leave_request.user,
            )
            new_allocations = [
                allocation
                for allocation in leave_request.allocations
                if allocation.allocation_date not in existing_dates
            ]
            if any(
                allocation.allocation_date == holiday.holiday_date
                for allocation in new_allocations
            ):
                restored_allocation = next(
                    allocation
                    for allocation in new_allocations
                    if allocation.allocation_date == holiday.holiday_date
                )
            else:
                restored_allocation = None
        else:
            restored_allocation = None

        if restored_allocation is None and holiday.holiday_date not in _get_chargeable_leave_dates(
            db,
            leave_request.user_id,
            leave_request.from_date,
            leave_request.to_date,
        ):
            attendance = db.query(Attendance).filter(
                Attendance.user_id == leave_request.user_id,
                Attendance.attendance_date == holiday.holiday_date,
            ).first()
            if attendance and not attendance.manual_override:
                status = determine_attendance_status_for_date(
                    db,
                    leave_request.user_id,
                    holiday.holiday_date,
                )
                if status != "On Leave":
                    attendance.status = (
                        "Absent" if status in {"Weekly Off", "Not Started"} else status
                    )
            continue

        target_user = db.query(User).filter(
            User.id == leave_request.user_id
        ).with_for_update().first()
        if target_user is None:
            raise HTTPException(status_code=409, detail="Leave owner no longer exists")

        if history:
            category = history.leave_category
        elif restored_allocation is not None:
            category = restored_allocation.leave_category
        else:
            category = leave_request.leave_category
            if category not in {"Privilege", "Emergency", "Sick"}:
                month_key = (holiday.holiday_date.year, holiday.holiday_date.month)
                request_has_paid_month = any(
                    row.leave_category == "Paid"
                    and (row.allocation_date.year, row.allocation_date.month) == month_key
                    for row in leave_request.allocations
                )
                submission_date = (
                    leave_request.created_at.date()
                    if leave_request.created_at
                    else date.today()
                )
                paid_eligible = (leave_request.from_date - submission_date).days >= 4
                other_paid_month = has_other_approved_or_pending_paid_leave_this_month(
                    db,
                    leave_request.user_id,
                    holiday.holiday_date,
                    exclude_leave_id=leave_request.id,
                )
                if paid_eligible and not request_has_paid_month and not other_paid_month:
                    category = "Paid"
                elif (target_user.carried_leave or 0) > 0:
                    category = "Carried"
                else:
                    category = "Unpaid"

        if category == "Carried":
            if (target_user.carried_leave or 0) < 1:
                raise HTTPException(
                    status_code=409,
                    detail="Insufficient carried balance to restore the holiday allocation.",
                )
            target_user.carried_leave -= 1
        elif category == "Paid":
            month_key = (holiday.holiday_date.year, holiday.holiday_date.month)
            has_paid_month = any(
                row.leave_category == "Paid"
                and (row.allocation_date.year, row.allocation_date.month) == month_key
                for row in leave_request.allocations
                if row.allocation_date != holiday.holiday_date
            ) or has_other_approved_or_pending_paid_leave_this_month(
                db,
                leave_request.user_id,
                holiday.holiday_date,
                exclude_leave_id=leave_request.id,
            )
            if has_paid_month:
                category = "Unpaid"

        if restored_allocation is not None:
            restored_allocation.leave_category = category
            restored_allocation.is_sandwich = bool(
                history.is_sandwich if history else True
            )
        else:
            restored_allocation = LeaveRequestAllocation(
                allocation_date=holiday.holiday_date,
                leave_category=category,
                is_sandwich=bool(history.is_sandwich) if history else False,
            )
            leave_request.allocations.append(restored_allocation)
        leave_request.allocations.sort(key=lambda row: row.allocation_date)
        leave_request.total_days = len(leave_request.allocations)
        leave_request.leave_category = compute_request_category_from_allocations(
            [
                (row.allocation_date, row.leave_category)
                for row in leave_request.allocations
            ]
        )
        if history:
            history.is_restored = True

        attendance = db.query(Attendance).filter(
            Attendance.user_id == leave_request.user_id,
            Attendance.attendance_date == holiday.holiday_date,
        ).first()
        if attendance is None:
            db.add(
                Attendance(
                    user_id=leave_request.user_id,
                    attendance_date=holiday.holiday_date,
                    status="On Leave",
                    reason="Leave",
                )
            )
        elif not attendance.manual_override:
            attendance.status = "On Leave"


@router.get("", response_model=List[HolidayOut])
@router.get("/", response_model=List[HolidayOut])
def list_holidays(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not has_permission(current_user, "holidays.view", db):
        raise HTTPException(status_code=403, detail="You do not have permission to view holidays")
    query = db.query(Holiday)
    if year:
        query = query.filter(Holiday.holiday_date.between(f"{year}-01-01", f"{year}-12-31"))
    return [_holiday_out(db, holiday) for holiday in query.order_by(Holiday.holiday_date).all()]


@router.post("/", response_model=HolidayOut, status_code=201)
def add_holiday(
    payload: HolidayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("holidays.manage")),
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
    db.flush()
    _sync_holiday_removed_leave(db, holiday)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Added holiday '{payload.holiday_name}'"))
    db.commit()
    db.refresh(holiday)
    return _holiday_out(db, holiday)


@router.delete("/{holiday_id}")
def delete_holiday(
    holiday_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("holidays.manage")),
):
    holiday = db.query(Holiday).filter(Holiday.id == holiday_id).first()
    if not holiday:
        raise HTTPException(status_code=404, detail="Holiday not found")

    db.delete(holiday)
    db.flush()
    _restore_approved_leave_for_deleted_holiday(db, holiday)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted holiday '{holiday.holiday_name}'"))
    db.commit()

    return {"message": f"Holiday '{holiday.holiday_name}' deleted"}
