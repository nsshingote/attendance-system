"""
routers/attendance_corrections.py
Attendance correction requests and approvals.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from database import get_db
from models import User, Attendance, AttendanceCorrection, ActivityLog, WorkingSunday
from schemas import (
    CorrectionOut, CorrectionCreate, CorrectionDecision, CorrectionCancellation,
    LegacyCorrection149Cancellation,
)
from auth import get_current_user, has_permission, require_roles, require_admin_permission, effective_role_key
from team_scope import require_team_member_access, require_team_permission, get_team_member_ids
from utils.attendance_status import applicable_holiday, determine_attendance_status_for_date, is_weekly_off
from utils.logger import log_activity
from services.notifications import create_notification, get_approver_user_ids

router = APIRouter()


def _attendance_state(attendance: Attendance) -> dict:
    state = {}
    for column in Attendance.__table__.columns:
        field = column.name
        value = getattr(attendance, field)
        if isinstance(value, (datetime, date)):
            value = value.isoformat()
        elif isinstance(value, Decimal):
            value = str(value)
        state[field] = value
    return state


def _state_value(field: str, value):
    if field in {"check_in", "check_out", "manual_override_at"} and value is not None:
        return datetime.fromisoformat(value)
    return value


# ------------------------------------------------------------
# GET all corrections (Admin)
# ------------------------------------------------------------

@router.get("/", response_model=List[CorrectionOut])
def get_all_corrections(
    status: Optional[str] = Query(None, pattern="^(Pending|Approved|Rejected|Cancelled)$"),
    date_value: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin gets all correction requests."""
    query = db.query(AttendanceCorrection).options(joinedload(AttendanceCorrection.requester))
    if effective_role_key(current_user) == "team_leader":
        if not has_permission(current_user, "corrections.all_view", db):
            require_team_permission(db, current_user, "corrections.team_view")
            team_ids = [current_user.id, *get_team_member_ids(db, current_user)]
            query = query.filter(AttendanceCorrection.requested_by.in_(team_ids))
    elif not has_permission(current_user, "corrections.all_view", db):
        raise HTTPException(status_code=403, detail="You do not have permission to view these requests")
    if status:
        query = query.filter(AttendanceCorrection.status == status)
    if date_value is not None:
        query = query.filter(AttendanceCorrection.created_at >= datetime.combine(date_value, time.min))
        query = query.filter(AttendanceCorrection.created_at < datetime.combine(date_value + timedelta(days=1), time.min))
    return query.order_by(AttendanceCorrection.created_at.desc()).all()


# ------------------------------------------------------------
# POST - Request correction
# ------------------------------------------------------------

@router.post("/", response_model=CorrectionOut)
def request_correction(
    payload: CorrectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Employee requests an attendance correction."""
    # Determine target user (admin can request for others)
    target_user_id = payload.user_id if hasattr(payload, 'user_id') and payload.user_id else current_user.id
    
    if not has_permission(current_user, "corrections.all_view", db) and target_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only request corrections for yourself")
    
    target_user = db.query(User).filter(User.id == target_user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if correction already exists for this attendance
    existing = db.query(AttendanceCorrection).filter(
        AttendanceCorrection.attendance_id == payload.attendance_id,
        AttendanceCorrection.status == "Pending"
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail="A pending correction request already exists for this attendance record"
        )
    
    # Get the attendance record
    attendance = db.query(Attendance).filter(Attendance.id == payload.attendance_id).first()
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    if (
        effective_role_key(current_user) == "team_leader"
        and (target_user_id != current_user.id or attendance.user_id != current_user.id)
    ):
        raise HTTPException(
            status_code=403,
            detail="Team Leaders can only request corrections for their own attendance",
        )
    if attendance.user_id != target_user_id:
        raise HTTPException(status_code=400, detail="Attendance record does not belong to the correction requester")
    
    # Parse time string to datetime if provided
    new_check_in = None
    new_check_out = None
    
    # Handle new_check_in - accept string time like "18:30" or datetime
    if hasattr(payload, 'new_check_in') and payload.new_check_in:
        if isinstance(payload.new_check_in, str) and ":" in payload.new_check_in:
            time_parts = payload.new_check_in.split(":")
            if len(time_parts) == 2:
                try:
                    hour = int(time_parts[0])
                    minute = int(time_parts[1])
                    new_check_in = datetime.combine(attendance.attendance_date, time(hour, minute))
                except (ValueError, TypeError):
                    new_check_in = None
        else:
            new_check_in = payload.new_check_in
    
    # Handle new_check_out - accept string time like "18:30" or datetime
    if hasattr(payload, 'new_check_out') and payload.new_check_out:
        if isinstance(payload.new_check_out, str) and ":" in payload.new_check_out:
            time_parts = payload.new_check_out.split(":")
            if len(time_parts) == 2:
                try:
                    hour = int(time_parts[0])
                    minute = int(time_parts[1])
                    new_check_out = datetime.combine(attendance.attendance_date, time(hour, minute))
                except (ValueError, TypeError):
                    new_check_out = None
        else:
            new_check_out = payload.new_check_out
    
    # Create the correction record
    correction = AttendanceCorrection(
        attendance_id=payload.attendance_id,
        requested_by=target_user_id,
        reason=payload.reason,
        old_check_in=attendance.check_in,
        new_check_in=new_check_in,
        old_check_out=attendance.check_out,
        new_check_out=new_check_out,
        status="Pending"
    )
    correction.requester = target_user
    db.add(correction)
    for approver_id in get_approver_user_ids(
        db,
        employee_id=target_user_id,
        permission_key="corrections.approve",
        actor_user_id=current_user.id,
    ):
        create_notification(
            db,
            recipient_user_id=approver_id,
            actor_user_id=current_user.id,
            notification_type="attendance_correction.submitted",
            title="New attendance correction request",
            message=f"{target_user.name} submitted an attendance correction request.",
            route="/corrections",
            entity_type="attendance_correction",
            entity_id=correction.id,
        )
    db.commit()
    db.refresh(correction)
    
    log_activity(db, current_user.id, 
                 f"Requested attendance correction for {target_user.name} (Attendance #{payload.attendance_id})")
    
    return correction


# ------------------------------------------------------------
# GET - My corrections
# ------------------------------------------------------------

@router.get("/me", response_model=List[CorrectionOut])
def get_my_corrections(
    date_value: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's correction requests."""
    query = (
        db.query(AttendanceCorrection)
        .options(joinedload(AttendanceCorrection.requester))
        .filter(AttendanceCorrection.requested_by == current_user.id)
    )
    if date_value is not None:
        query = query.filter(AttendanceCorrection.created_at >= datetime.combine(date_value, time.min))
        query = query.filter(AttendanceCorrection.created_at < datetime.combine(date_value + timedelta(days=1), time.min))
    return query.order_by(AttendanceCorrection.created_at.desc()).all()


# ------------------------------------------------------------
# GET - Pending corrections (Admin)
# ------------------------------------------------------------

@router.get("/pending", response_model=List[CorrectionOut])
def get_pending_corrections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return pending corrections within the caller's authorized scope."""
    query = db.query(AttendanceCorrection).options(joinedload(AttendanceCorrection.requester))
    if effective_role_key(current_user) == "team_leader":
        if not has_permission(current_user, "corrections.approve", db):
            raise HTTPException(status_code=403, detail="You do not have permission to perform this action")
        if not has_permission(current_user, "corrections.all_view", db):
            team_ids = [current_user.id, *get_team_member_ids(db, current_user)]
            query = query.filter(AttendanceCorrection.requested_by.in_(team_ids))
    elif not has_permission(current_user, "corrections.approve", db):
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action")
    return query.filter(AttendanceCorrection.status == "Pending").order_by(AttendanceCorrection.created_at.desc()).all()


@router.get("/reviewable", response_model=List[CorrectionOut])
def get_reviewable_corrections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return pending and approved requests the caller may review or cancel."""
    if effective_role_key(current_user) != "superadmin" and not has_permission(
        current_user, "corrections.approve", db
    ):
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action")

    query = db.query(AttendanceCorrection).options(joinedload(AttendanceCorrection.requester))
    if effective_role_key(current_user) == "team_leader" and not has_permission(
        current_user, "corrections.all_view", db
    ):
        team_ids = [current_user.id, *get_team_member_ids(db, current_user)]
        query = query.filter(AttendanceCorrection.requested_by.in_(team_ids))
    return query.filter(
        AttendanceCorrection.status.in_(("Pending", "Approved"))
    ).order_by(AttendanceCorrection.created_at.desc()).all()


# ------------------------------------------------------------
# GET - User corrections (Admin)
# ------------------------------------------------------------

@router.get("/user/{user_id}", response_model=List[CorrectionOut])
def get_user_corrections(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin gets corrections for a specific user."""
    require_team_member_access(db, current_user, user_id, "corrections.team_view")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return (
        db.query(AttendanceCorrection)
        .options(joinedload(AttendanceCorrection.requester))
        .filter(AttendanceCorrection.requested_by == user_id)
        .order_by(AttendanceCorrection.created_at.desc())
        .all()
    )


# ------------------------------------------------------------
# PUT - Decide correction (Admin)
# ------------------------------------------------------------

@router.put("/{correction_id}/decide", response_model=CorrectionOut)
def decide_correction(
    correction_id: int,
    payload: CorrectionDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin approves or rejects a correction request."""
    correction = (
        db.query(AttendanceCorrection)
        .filter(AttendanceCorrection.id == correction_id)
        .with_for_update()
        .first()
    )
    
    if not correction:
        raise HTTPException(status_code=404, detail="Correction request not found")
    require_team_member_access(db, current_user, correction.requested_by, "corrections.approve")
    
    if correction.status != "Pending":
        raise HTTPException(
            status_code=400,
            detail=f"Request already {correction.status}"
        )
    
    if payload.status == "Approved":
        attendance = db.query(Attendance).filter(
            Attendance.id == correction.attendance_id
        ).with_for_update().first()
        if not attendance:
            raise HTTPException(status_code=404, detail="Attendance record not found")
        if attendance.user_id != correction.requested_by:
            raise HTTPException(status_code=409, detail="Attendance record does not belong to the correction requester")

        correction.approval_before_state = _attendance_state(attendance)
        if correction.new_check_in:
            attendance.check_in = correction.new_check_in
        if correction.new_check_out:
            attendance.check_out = correction.new_check_out
        if attendance.check_in:
            holiday = applicable_holiday(db, attendance.user_id, attendance.attendance_date)
            if holiday:
                attendance.status = "Holiday"
            else:
                attendance.status = determine_attendance_status_for_date(
                    db, attendance.user_id, attendance.attendance_date
                )
        else:
            attendance.status = "Absent"
        correction.approval_after_state = _attendance_state(attendance)
        correction.approved_by = current_user.id
        correction.approved_at = datetime.now(ZoneInfo("Asia/Kolkata"))

    correction.status = payload.status
    
    if correction.requested_by != current_user.id:
        create_notification(
            db,
            recipient_user_id=correction.requested_by,
            actor_user_id=current_user.id,
            notification_type=f"attendance_correction.{payload.status.lower()}",
            title=f"Attendance correction {payload.status.lower()}",
            message=f"Your attendance correction request was {payload.status.lower()}.",
            route="/corrections",
            entity_type="attendance_correction",
            entity_id=correction.id,
        )
    db.commit()
    db.refresh(correction)
    
    log_activity(db, current_user.id, 
                 f"{payload.status} correction #{correction_id}")
    
    return correction


@router.post("/{correction_id}/cancel", response_model=CorrectionOut)
def cancel_approved_correction(
    correction_id: int,
    payload: CorrectionCancellation,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel an approved correction if its attendance row has not since changed."""
    correction = db.query(AttendanceCorrection).filter(
        AttendanceCorrection.id == correction_id
    ).with_for_update().first()
    if not correction:
        raise HTTPException(status_code=404, detail="Correction request not found")
    require_team_member_access(db, current_user, correction.requested_by, "corrections.approve")
    if correction.status != "Approved":
        raise HTTPException(status_code=400, detail="Only approved corrections can be cancelled")
    required_snapshot_fields = {column.name for column in Attendance.__table__.columns}
    before_state = correction.approval_before_state
    after_state = correction.approval_after_state
    if (
        not isinstance(before_state, dict)
        or not isinstance(after_state, dict)
        or not required_snapshot_fields.issubset(before_state)
        or not required_snapshot_fields.issubset(after_state)
    ):
        raise HTTPException(
            status_code=409,
            detail="This correction has missing or malformed approval-time snapshots and cannot be safely cancelled",
        )

    attendance = db.query(Attendance).filter(
        Attendance.id == correction.attendance_id
    ).with_for_update().first()
    if not attendance or attendance.user_id != correction.requested_by:
        raise HTTPException(status_code=409, detail="The attendance record is missing or no longer belongs to the requester")

    current_state = _attendance_state(attendance)
    if current_state != after_state:
        raise HTTPException(
            status_code=409,
            detail="Attendance changed after this correction was approved; rollback was not applied",
        )

    try:
        restored_values = {}
        approved_values = {}
        valid_statuses = set(Attendance.__table__.columns["status"].type.enums)
        for field in ("check_in", "check_out", "status"):
            before_value = before_state[field]
            after_value = after_state[field]
            if field == "status":
                if (
                    (before_value is not None and (
                        not isinstance(before_value, str)
                        or before_value not in valid_statuses
                    ))
                    or not isinstance(after_value, str)
                    or after_value not in valid_statuses
                ):
                    raise ValueError("Invalid attendance status in snapshot")
            elif (
                before_value is not None and not isinstance(before_value, str)
            ) or (
                after_value is not None and not isinstance(after_value, str)
            ):
                raise ValueError("Invalid timestamp in snapshot")
            restored_values[field] = _state_value(field, before_value)
            approved_values[field] = _state_value(field, after_value)
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(
            status_code=409,
            detail="This correction has malformed approval-time values and cannot be safely cancelled",
        ) from error
    try:
        for field in ("check_in", "check_out", "status"):
            if restored_values[field] != approved_values[field]:
                setattr(attendance, field, restored_values[field])

        correction.status = "Cancelled"
        correction.cancelled_by = current_user.id
        correction.cancelled_at = datetime.now(ZoneInfo("Asia/Kolkata"))
        correction.cancellation_reason = payload.reason
        db.add(ActivityLog(
            user_id=current_user.id,
            activity=f"Cancelled approved correction #{correction_id}",
        ))
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Correction cancellation failed; attendance, correction, and audit changes were rolled back",
        ) from error

    db.refresh(correction)
    return correction


@router.post("/149/cancel-legacy", response_model=CorrectionOut)
def cancel_legacy_correction_149(
    payload: LegacyCorrection149Cancellation,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Explicit, one-record recovery for correction 149, whose snapshots are unavailable."""
    if effective_role_key(current_user) not in {"admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="Only Admin or Super Admin can perform this recovery")
    if payload.attendance_date != date(2026, 10, 11):
        raise HTTPException(status_code=409, detail="Correction 149 is not for the confirmed attendance date")

    try:
        correction = (
            db.query(AttendanceCorrection)
            .filter(AttendanceCorrection.id == 149)
            .with_for_update()
            .first()
        )
        if (
            not correction
            or correction.attendance_id != 1424
            or correction.requested_by != 23
            or correction.status != "Approved"
        ):
            raise HTTPException(
                status_code=409,
                detail="Correction 149 no longer matches the approved legacy recovery preconditions",
            )
        if (
            correction.approval_before_state is not None
            or correction.approval_after_state is not None
        ):
            raise HTTPException(
                status_code=409,
                detail="Correction 149 now has snapshots; use normal snapshot-based cancellation",
            )

        attendance = (
            db.query(Attendance)
            .filter(Attendance.id == 1424)
            .with_for_update()
            .first()
        )
        if (
            not attendance
            or attendance.user_id != 23
            or attendance.attendance_date != payload.attendance_date
        ):
            raise HTTPException(status_code=409, detail="Attendance 1424 no longer matches the confirmed user and date")

        if (
            attendance.check_in != payload.expected_check_in
            or attendance.check_out != payload.expected_check_out
            or attendance.status != payload.expected_status
        ):
            raise HTTPException(
                status_code=409,
                detail="Attendance 1424 changed or does not match the values you confirmed",
            )
        if (
            correction.old_check_in != datetime(2026, 10, 11, 12, 43, 57)
            or correction.old_check_out is not None
        ):
            raise HTTPException(
                status_code=409,
                detail="Correction 149 no longer has the confirmed request-time values",
            )
        if (
            not is_weekly_off(payload.attendance_date, db)
            or applicable_holiday(db, 23, payload.attendance_date)
            or db.query(WorkingSunday.id).filter(
                WorkingSunday.user_id == 23,
                WorkingSunday.work_date == payload.attendance_date,
            ).first()
            or attendance.manual_override
        ):
            raise HTTPException(
                status_code=409,
                detail="Attendance 1424 is not currently eligible for calendar-derived Weekly Off restoration",
            )

        attendance.check_in = None
        attendance.check_out = None
        attendance.status = "Absent"
        correction.status = "Cancelled"
        correction.cancelled_by = current_user.id
        correction.cancelled_at = datetime.now(ZoneInfo("Asia/Kolkata"))
        correction.cancellation_reason = payload.reason
        db.add(ActivityLog(
            user_id=current_user.id,
            activity="Performed administrator-confirmed no-attendance weekly-off recovery for correction #149",
        ))
        db.flush()
        if determine_attendance_status_for_date(db, 23, payload.attendance_date) != "Weekly Off":
            raise HTTPException(
                status_code=409,
                detail="The existing attendance resolver would not display Weekly Off after this recovery",
            )
        db.commit()
        return correction
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Legacy correction recovery failed; attendance and correction changes were rolled back",
        ) from error