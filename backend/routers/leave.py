

"""
routers/leave.py
Leave requests, approvals, balances, and encashment.
"""



from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, func, extract
from typing import Optional, List

from database import get_db
from models import (
    User, CompanySettings, LeaveRequest, LeaveType, LeaveEncashmentRequest,
    NotificationEmail, Attendance, LeaveRequestAllocation, ActivityLog
)
from schemas import (
    LeaveRequestOut, LeaveRequestCreate, LeaveDecision,
    LeaveBalanceResponse, LeaveEncashmentCreate, LeaveEncashmentOut,
    LeaveEncashmentDecision, LeaveCategoryOverride, LeaveAllocationOverride
)
from auth import get_current_user, has_permission, require_roles, require_admin_permission, effective_role_key
from team_scope import require_team_member_access
from services.notifications import create_notification, get_approver_user_ids
from services.recycle_bin import archive_object
from utils.leave_calculator import (
    get_remaining_leave,
    paid_leave_available_this_month,
    get_carried_leave_balance,
    has_approved_or_pending_paid_leave_this_month,
    has_other_approved_or_pending_paid_leave_this_month,
    allocate_leave_days,
    summarize_allocations,
    compute_request_category_from_allocations,
    refresh_leave_accrual,
    get_leave_year_quota,
    get_used_balance_days_this_year,
    get_encashed_days_this_year,
    calculate_total_days,
    LEAVE_TRACKING_START_DATE,
    _get_date_range,
    _get_chargeable_leave_dates,
)
from utils.logger import log_activity
from utils.attendance_status import (
    applicable_holiday,
    determine_attendance_status_for_date,
)

router = APIRouter()


def _is_sandwich_date_in_request(
    db: Session,
    user_id: int,
    target_date: date,
    from_date: date,
    to_date: date,
) -> bool:
    settings = db.query(CompanySettings).first()
    if (
        not settings
        or not settings.sandwich_method_enabled
        or not settings.weekly_off_day
        or target_date.strftime("%A").casefold() != settings.weekly_off_day.casefold()
    ):
        return False
    previous_date = target_date - timedelta(days=1)
    next_date = target_date + timedelta(days=1)
    return (
        previous_date >= from_date
        and next_date <= to_date
        and not applicable_holiday(db, user_id, target_date)
        and not applicable_holiday(db, user_id, previous_date)
        and not applicable_holiday(db, user_id, next_date)
    )


# ------------------------------------------------------------
# Helper function: Mark leave in attendance
# ------------------------------------------------------------
def mark_leave_in_attendance(
    db: Session,
    user_id: int,
    from_date: date,
    to_date: date,
    leave_dates: set[date] | None = None,
):
    """Mark only chargeable approved leave dates as 'On Leave'."""
    current_date = from_date
    while current_date <= to_date:
        if leave_dates is not None and current_date not in leave_dates:
            current_date += timedelta(days=1)
            continue
        # Check if attendance already exists for this date
        existing = db.query(Attendance).filter(
            Attendance.user_id == user_id,
            Attendance.attendance_date == current_date
        ).first()
        
        if existing:
            if not existing.manual_override:
                # Update status only; retain check-in/check-out and location data.
                existing.status = "On Leave"
        else:
            # Create new attendance record
            new_attendance = Attendance(
                user_id=user_id,
                attendance_date=current_date,
                status="On Leave",
                ip_address=None,
                reason="Leave"
            )
            db.add(new_attendance)
        
        current_date += timedelta(days=1)


def _apply_sandwich_rule_on_request(db: Session, leave_request: LeaveRequest, target_user: User):
    """Add a configured weekly-off allocation only between adjacent leave dates."""
    settings = db.query(CompanySettings).first()
    if not settings or not settings.sandwich_method_enabled or not settings.weekly_off_day:
        leave_request.total_days = len(leave_request.allocations)
        return

    user_id = leave_request.user_id
    weekly_off_name = settings.weekly_off_day.casefold()
    active_requests = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status.in_(["Pending", "Approved"]),
        )
        .all()
    )
    current_dates = {
        allocation.allocation_date for allocation in leave_request.allocations
        if not allocation.is_sandwich
    }
    existing_allocation_dates = {
        allocation.allocation_date
        for allocation in leave_request.allocations
    } | {
        allocation.allocation_date
        for request in active_requests
        if request.id != leave_request.id
        for allocation in request.allocations
    }
    other_dates = {
        allocation.allocation_date
        for request in active_requests
        if request.id != leave_request.id
        for allocation in request.allocations
        if not allocation.is_sandwich
    }
    already_allocated = current_dates | other_dates

    candidates = set()
    for leave_date in current_dates:
        for candidate in (leave_date - timedelta(days=1), leave_date + timedelta(days=1)):
            if (
                candidate.strftime("%A").casefold() == weekly_off_name
                and candidate not in existing_allocation_dates
                and not applicable_holiday(db, user_id, candidate)
            ):
                previous_date = candidate - timedelta(days=1)
                next_date = candidate + timedelta(days=1)
                if (
                    previous_date in already_allocated
                    and next_date in already_allocated
                    and not applicable_holiday(db, user_id, previous_date)
                    and not applicable_holiday(db, user_id, next_date)
                ):
                    candidates.add(candidate)

    if not candidates:
        leave_request.total_days = len(leave_request.allocations)
        return

    # Determine carried balance available before applying additions
    carried_balance = get_carried_leave_balance(db, target_user)

    # Determine paid months already used by ANY request for the user (Approved/Pending)
    used_paid_months = set(
        (alloc.allocation_date.year, alloc.allocation_date.month)
        for lr in active_requests
        for alloc in lr.allocations
        if alloc.leave_category == "Paid"
    )

    # Also include paid months already present on this request
    used_paid_months.update(
        (alloc.allocation_date.year, alloc.allocation_date.month)
        for alloc in leave_request.allocations
        if alloc.leave_category == "Paid"
    )

    for s in sorted(candidates):
        month_key = (s.year, s.month)
        # Check if paid slot is available (no other approved/pending Paid in that month)
        paid_ok = False
        if month_key not in used_paid_months and not has_other_approved_or_pending_paid_leave_this_month(db, user_id, s, exclude_leave_id=leave_request.id):
            paid_ok = True

        if paid_ok:
            category = "Paid"
            used_paid_months.add(month_key)
        elif carried_balance > 0:
            category = "Carried"
            carried_balance -= 1
        else:
            category = "Unpaid"

        # Attribute the one-day gap to this request, preserving the old endpoint
        # behavior while basing eligibility on actual adjacent allocations.
        leave_request.allocations.append(
            LeaveRequestAllocation(
                allocation_date=s,
                leave_category=category,
                is_sandwich=True,
            )
        )
        if s < leave_request.from_date:
            leave_request.from_date = s
        if s > leave_request.to_date:
            leave_request.to_date = s
        already_allocated.add(s)

    leave_request.allocations.sort(key=lambda a: a.allocation_date)
    leave_request.total_days = len(leave_request.allocations)
    leave_request.leave_category = compute_request_category_from_allocations(
        [(allocation.allocation_date, allocation.leave_category) for allocation in leave_request.allocations]
    )


def _reconcile_sandwich_allocations_for_user(db: Session, user_id: int) -> None:
    settings = db.query(CompanySettings).first()
    active_requests = db.query(LeaveRequest).filter(
        LeaveRequest.user_id == user_id,
        LeaveRequest.status.in_(["Pending", "Approved"]),
    ).with_for_update().all()
    active_allocations = [
        allocation
        for request in active_requests
        for allocation in request.allocations
        if not allocation.is_sandwich
    ]
    active_dates = {allocation.allocation_date for allocation in active_allocations}
    active_dates = {
        target_date
        for target_date in active_dates
        if not applicable_holiday(db, user_id, target_date)
    }

    removed_dates = set()
    for request in active_requests:
        request_changed = False
        for allocation in list(request.allocations):
            if not allocation.is_sandwich:
                continue
            previous_date = allocation.allocation_date - timedelta(days=1)
            next_date = allocation.allocation_date + timedelta(days=1)
            if (
                settings is not None
                and settings.sandwich_method_enabled
                and settings.weekly_off_day
                and allocation.allocation_date.strftime("%A").casefold()
                == settings.weekly_off_day.casefold()
                and previous_date in active_dates
                and next_date in active_dates
                and not applicable_holiday(db, user_id, allocation.allocation_date)
            ):
                continue
            if request.status == "Approved" and allocation.leave_category == "Carried":
                target_user = db.query(User).filter(User.id == user_id).with_for_update().first()
                if target_user:
                    target_user.carried_leave = (target_user.carried_leave or 0) + 1
            removed_dates.add(allocation.allocation_date)
            request.allocations.remove(allocation)
            request_changed = True

        if request_changed:
            request.total_days = len(request.allocations)
            request.leave_category = compute_request_category_from_allocations(
                [
                    (row.allocation_date, row.leave_category)
                    for row in request.allocations
                ]
            )

    db.flush()
    for target_date in removed_dates:
        attendance = db.query(Attendance).filter(
            Attendance.user_id == user_id,
            Attendance.attendance_date == target_date,
        ).first()
        if not attendance or attendance.manual_override or attendance.status != "On Leave":
            continue
        status = determine_attendance_status_for_date(db, user_id, target_date)
        attendance.status = (
            "Absent" if status in {"On Leave", "Weekly Off", "Not Started"} else status
        )


def _restore_attendance_after_leave_removal(
    db: Session,
    user_id: int,
    removed_dates: set[date],
) -> None:
    for target_date in removed_dates:
        attendance = db.query(Attendance).filter(
            Attendance.user_id == user_id,
            Attendance.attendance_date == target_date,
        ).first()
        if not attendance or attendance.manual_override:
            continue
        status = determine_attendance_status_for_date(db, user_id, target_date)
        if status == "On Leave":
            continue
        # Weekly Off is a computed attendance status, not a persisted enum value.
        attendance.status = "Absent" if status in {"Weekly Off", "Not Started"} else status


# ------------------------------------------------------------
# GET / - Get all leave requests (Admin)
# ------------------------------------------------------------
@router.get("/", response_model=List[LeaveRequestOut])
def get_all_leave_requests_root(
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected|Cancelled)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.all_view"))
):
    """Admin gets all leave requests with optional month filter."""
    query = db.query(LeaveRequest)
    if status:
        query = query.filter(LeaveRequest.status == status)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            LeaveRequest.from_date >= start_date,
            LeaveRequest.from_date < end_date
        )
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        query = query.filter(
            LeaveRequest.from_date <= target_date,
            LeaveRequest.to_date >= target_date
        )
    return query.order_by(LeaveRequest.created_at.desc()).all()

# ------------------------------------------------------------
# GET /encashment-requests - Get encashment requests (Admin)
# ------------------------------------------------------------
@router.get("/encashment-requests", response_model=List[LeaveEncashmentOut])
def get_encashment_requests_root(
    status_filter: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected|Cancelled)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.all_view"))
):
    """Admin gets all encashment requests."""
    query = db.query(LeaveEncashmentRequest).options(joinedload(LeaveEncashmentRequest.user))
    if status_filter:
        query = query.filter(LeaveEncashmentRequest.status == status_filter)
    else:
        query = query.filter(LeaveEncashmentRequest.status == "Pending")
    return query.order_by(LeaveEncashmentRequest.requested_at.desc()).all()



# ------------------------------------------------------------
# Apply for Leave
# ------------------------------------------------------------

@router.post("/", response_model=LeaveRequestOut)
def apply_leave(
    payload: LeaveRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Apply for leave.
    - Employees apply for themselves → Pending (needs admin approval)
    - Admins apply for others → Auto-approved immediately
    - Past-dated leave is now accepted through the same flow.
    """
    # Determine target user
    target_user_id = payload.user_id if payload.user_id else current_user.id
    
    # Self-submission remains available; acting for another employee requires approval permission.
    if target_user_id != current_user.id and not has_permission(current_user, "leave.approve", db):
        raise HTTPException(status_code=403, detail="You do not have permission to apply leave for another employee")
    if effective_role_key(current_user) == "team_leader" and target_user_id != current_user.id:
        require_team_member_access(db, current_user, target_user_id, "leave.approve")
    
    # Get target user
    target_user = db.query(User).filter(
        User.id == target_user_id,
        User.status == "active"
    ).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")
    
    # Validate dates
    if payload.from_date > payload.to_date:
        raise HTTPException(status_code=400, detail="From date must be before or equal to To date")

    # Past-date leave requests are now accepted through the normal leave workflow.

    # Calculate total days
    # The leave category is now auto-allocated for employees.
    # Manual category selection is ignored at submission time.

    # Check if leave type exists (if provided)
    if payload.leave_type_id:
        leave_type = db.query(LeaveType).filter(LeaveType.id == payload.leave_type_id).first()
        if not leave_type:
            raise HTTPException(status_code=404, detail="Leave type not found")
    
    # --- Validation based on category ---
    
    # Apply auto-allocation rules on request submission.
    allocations = allocate_leave_days(
        db,
        target_user,
        payload.from_date,
        payload.to_date,
        submission_date=date.today(),
    )
    allocation_summary = summarize_allocations(allocations)
    request_category = compute_request_category_from_allocations(allocations)
    total_days = len(allocations)
    
    # Check for overlapping leave requests
    overlapping = db.query(LeaveRequest).filter(
        LeaveRequest.user_id == target_user_id,
        LeaveRequest.status.in_(["Pending", "Approved"]),
        and_(
            LeaveRequest.from_date <= payload.to_date,
            LeaveRequest.to_date >= payload.from_date
        )
    ).first()
    
    if overlapping:
        raise HTTPException(
            status_code=400,
            detail=f"Overlapping leave request already exists (ID: {overlapping.id})"
        )
    
    # Auto-approve when an admin applies leave on behalf of another employee.
    auto_approve = has_permission(current_user, "leave.approve", db) and target_user_id != current_user.id
    approved_by = current_user.id if auto_approve else None
    approved_at = datetime.now() if auto_approve else None
    status = "Approved" if auto_approve else "Pending"

    leave_request = LeaveRequest(
        user_id=target_user_id,
        leave_type_id=payload.leave_type_id,
        from_date=payload.from_date,
        to_date=payload.to_date,
        total_days=total_days,
        reason=payload.reason,
        leave_category=request_category,
        status=status,
        approved_by=approved_by,
        approved_at=approved_at,
    )
    leave_request.allocations = [
        LeaveRequestAllocation(
            allocation_date=allocation_date,
            leave_category=leave_category,
            is_sandwich=_is_sandwich_date_in_request(
                db,
                target_user_id,
                allocation_date,
                payload.from_date,
                payload.to_date,
            ),
        )
        for allocation_date, leave_category in allocations
    ]
    db.add(leave_request)

    if auto_approve:
        _apply_sandwich_rule_on_request(db, leave_request, target_user)
        allocations = [
            (allocation.allocation_date, allocation.leave_category)
            for allocation in leave_request.allocations
        ]
        leave_request.total_days = len(allocations)
        leave_request.leave_category = compute_request_category_from_allocations(allocations)

        carried_days = sum(1 for _, category in allocations if category == "Carried")
        if carried_days > 0:
            carried_balance = get_carried_leave_balance(db, target_user)
            if carried_balance < carried_days:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Insufficient carried leave balance. Available: {carried_balance}, "
                        f"required: {carried_days}"
                    )
                )
            target_user.carried_leave -= carried_days

        # Use the leave_request's from/to (which may have been expanded by the
        # sandwich rule) so any inserted Sundays are also marked in attendance.
        mark_leave_in_attendance(
            db,
            target_user_id,
            leave_request.from_date,
            leave_request.to_date,
            {allocation_date for allocation_date, _ in allocations},
        )

    if leave_request.status == "Pending":
        for approver_id in get_approver_user_ids(
            db,
            employee_id=target_user_id,
            permission_key="leave.approve",
            actor_user_id=current_user.id,
        ):
            create_notification(
                db,
                recipient_user_id=approver_id,
                actor_user_id=current_user.id,
                notification_type="leave.submitted",
                title="New leave request",
                message=f"{target_user.name} submitted leave from {leave_request.from_date} to {leave_request.to_date}.",
                route="/leave",
                entity_type="leave_request",
                entity_id=leave_request.id,
            )
    elif target_user.id != current_user.id:
        create_notification(
            db,
            recipient_user_id=target_user.id,
            actor_user_id=current_user.id,
            notification_type="leave.approved",
            title="Leave request approved",
            message=f"Your leave from {leave_request.from_date} to {leave_request.to_date} was approved.",
            route="/leave",
            entity_type="leave_request",
            entity_id=leave_request.id,
        )

    db.commit()
    db.refresh(leave_request)
    
    # Log activity
    log_activity(
        db,
        current_user.id,
        f"Applied for leave for {target_user.name} "
        f"({payload.from_date} to {payload.to_date}) - {leave_request.status}"
    )
    
    # Handle notification emails
    if payload.notify_email_ids:
        emails = db.query(NotificationEmail).filter(
            NotificationEmail.id.in_(payload.notify_email_ids),
            NotificationEmail.is_active == 1
        ).all()
        if emails:
            email_list = [e.email for e in emails]
            leave_request.notify_emails = ", ".join(email_list)
            db.commit()
            db.refresh(leave_request)
    
    return leave_request


@router.delete("/{leave_id}", response_model=dict)
def delete_pending_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    leave_request = db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    if not leave_request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if leave_request.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own leave request")
    if leave_request.status != "Pending":
        raise HTTPException(status_code=400, detail="Only pending leave requests can be deleted")
    # A manual attendance override may point to this request through a
    # cascading foreign key. Deleting the request must not delete attendance.
    leave_request.manual_override_attendance_id = None
    # Allocations are internal children of the leave request; only the
    # user-selected leave request belongs in the Recycle Bin.
    archive_object(
        db,
        leave_request,
        deleted_by=current_user.id,
        extra_values={
            "__allocations": [
                {
                    "allocation_date": allocation.allocation_date.isoformat(),
                    "leave_category": allocation.leave_category,
                }
                for allocation in leave_request.allocations
            ]
        },
    )
    db.info["skip_recycle"] = True
    db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted pending leave request #{leave_id}"))
    db.delete(leave_request)
    db.flush()
    _reconcile_sandwich_allocations_for_user(db, current_user.id)
    db.commit()
    db.info.pop("skip_recycle", None)
    return {"message": "Leave request deleted"}


@router.put("/{leave_id}/cancel", response_model=LeaveRequestOut)
def cancel_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel an approved leave request while retaining it for audit history."""
    if not has_permission(current_user, "leave.cancel", db):
        raise HTTPException(status_code=403, detail="You do not have permission to cancel leave")
    leave_request = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.id == leave_id)
        .with_for_update()
        .first()
    )
    if not leave_request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if leave_request.status != "Approved":
        raise HTTPException(status_code=400, detail="Only approved leave requests can be cancelled")

    target_user = db.query(User).filter(User.id == leave_request.user_id).with_for_update().first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")
    require_team_member_access(db, current_user, target_user.id, "leave.approve")

    carried_days = sum(1 for allocation in leave_request.allocations if allocation.leave_category == "Carried")
    if not leave_request.allocations and leave_request.leave_category == "Carried":
        carried_days = leave_request.total_days or 0
    target_user.carried_leave = (target_user.carried_leave or 0) + carried_days

    attendance_dates = {
        allocation.allocation_date for allocation in leave_request.allocations
    } or set(_get_date_range(leave_request.from_date, leave_request.to_date))
    attendance_rows = db.query(Attendance).filter(
        Attendance.user_id == target_user.id,
        Attendance.attendance_date.in_(attendance_dates),
        Attendance.status == "On Leave",
    ).all()
    for attendance in attendance_rows:
        overlapping_approved = db.query(LeaveRequest.id).filter(
            LeaveRequest.user_id == target_user.id,
            LeaveRequest.id != leave_request.id,
            LeaveRequest.status == "Approved",
            LeaveRequest.from_date <= attendance.attendance_date,
            LeaveRequest.to_date >= attendance.attendance_date,
        ).first()
        if overlapping_approved:
            continue
        attendance.status = "Present"
        if attendance.reason == "Leave":
            attendance.reason = None

    leave_request.status = "Cancelled"
    db.flush()
    _reconcile_sandwich_allocations_for_user(db, target_user.id)
    db.commit()
    refresh_leave_accrual(db, target_user)
    db.commit()
    db.refresh(leave_request)

    if target_user.id != current_user.id:
        create_notification(
            db,
            recipient_user_id=target_user.id,
            actor_user_id=current_user.id,
            notification_type="leave.cancelled",
            title="Leave request cancelled",
            message=f"Your leave from {leave_request.from_date} to {leave_request.to_date} was cancelled.",
            route="/leave",
            entity_type="leave_request",
            entity_id=leave_request.id,
        )
    log_activity(
        db,
        current_user.id,
        f"Cancelled leave request #{leave_id} for {target_user.name}",
    )
    db.commit()
    return leave_request


# ------------------------------------------------------------
# Get My Leave Requests
# ------------------------------------------------------------

@router.get("/me", response_model=List[LeaveRequestOut])
def get_my_leave_requests(
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected|Cancelled)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's leave requests with optional month filter."""
    query = db.query(LeaveRequest).filter(LeaveRequest.user_id == current_user.id)
    if status:
        query = query.filter(LeaveRequest.status == status)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            LeaveRequest.from_date >= start_date,
            LeaveRequest.from_date < end_date
        )
    return query.order_by(LeaveRequest.created_at.desc()).all()


# ------------------------------------------------------------
# Get User Leave Requests (Admin)
# ------------------------------------------------------------

@router.get("/user/{user_id}", response_model=List[LeaveRequestOut])
def get_user_leave_requests(
    user_id: int,
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected|Cancelled)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin gets leave requests for a specific user with optional month filter."""
    if current_user.id != user_id:
        require_team_member_access(db, current_user, user_id, "leave.team_view")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    query = db.query(LeaveRequest).filter(LeaveRequest.user_id == user_id)
    if status:
        query = query.filter(LeaveRequest.status == status)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            LeaveRequest.from_date >= start_date,
            LeaveRequest.from_date < end_date
        )
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        query = query.filter(
            LeaveRequest.from_date <= target_date,
            LeaveRequest.to_date >= target_date
        )
    return query.order_by(LeaveRequest.created_at.desc()).all()

# ------------------------------------------------------------
# Get All Pending Leave Requests (Admin)
# ------------------------------------------------------------

@router.get("/pending", response_model=List[LeaveRequestOut])
def get_pending_leave_requests(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.all_view"))
):
    """Admin gets all pending leave requests with optional month filter."""
    query = db.query(LeaveRequest).filter(LeaveRequest.status == "Pending")
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            LeaveRequest.from_date >= start_date,
            LeaveRequest.from_date < end_date
        )
    return query.order_by(LeaveRequest.created_at.desc()).all()


# ------------------------------------------------------------
# Get All Leave Requests (Admin)
# ------------------------------------------------------------

@router.get("/all", response_model=List[LeaveRequestOut])
def get_all_leave_requests(
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected|Cancelled)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.all_view"))
):
    """Admin gets all leave requests with optional month filter."""
    query = db.query(LeaveRequest)
    if status:
        query = query.filter(LeaveRequest.status == status)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            LeaveRequest.from_date >= start_date,
            LeaveRequest.from_date < end_date
        )
    return query.order_by(LeaveRequest.created_at.desc()).all()


# ------------------------------------------------------------
# Approve / Reject Leave (Admin)
# ------------------------------------------------------------

@router.put("/{leave_id}/decide", response_model=LeaveRequestOut)
def decide_leave(
    leave_id: int,
    payload: LeaveDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin approves or rejects a leave request."""
    if payload.status not in ("Approved", "Rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'Approved' or 'Rejected'")

    leave_request = db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).with_for_update().first()
    
    if not leave_request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    if leave_request.status != "Pending":
        raise HTTPException(
            status_code=400,
            detail=f"Request already {leave_request.status}"
        )
    
    target_user = db.query(User).filter(User.id == leave_request.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")
    require_team_member_access(db, current_user, target_user.id, "leave.approve")

    leave_request.status = payload.status
    leave_request.approved_by = current_user.id
    leave_request.approved_at = datetime.now()
    
    if payload.status == "Approved":
        # Recalculate automatic allocations at approval time. A pending
        # request may have been created while the monthly Paid slot was used,
        # then another request may be deleted or rejected before approval.
        if leave_request.leave_category in {"Privilege", "Emergency", "Sick"}:
            allocations = [
                (day, leave_request.leave_category)
                for day in _get_chargeable_leave_dates(
                    db,
                    target_user.id,
                    leave_request.from_date,
                    leave_request.to_date,
                )
            ]
        else:
            allocations = allocate_leave_days(
                db,
                target_user,
                leave_request.from_date,
                leave_request.to_date,
                submission_date=(
                    leave_request.created_at.date()
                    if leave_request.created_at
                    else date.today()
                ),
                exclude_leave_id=leave_request.id,
            )
        # Pending requests can already have allocation rows. Remove them and
        # flush before inserting the approval-time allocation set so the
        # unique (leave_request_id, allocation_date) constraint is not hit.
        for existing_allocation in list(leave_request.allocations):
            db.delete(existing_allocation)
        db.flush()
        leave_request.allocations = [
            LeaveRequestAllocation(
                allocation_date=allocation_date,
                leave_category=leave_category,
                is_sandwich=_is_sandwich_date_in_request(
                    db,
                    target_user.id,
                    allocation_date,
                    leave_request.from_date,
                    leave_request.to_date,
                ),
            )
            for allocation_date, leave_category in allocations
        ]
        leave_request.leave_category = compute_request_category_from_allocations(allocations)

        # Apply sandwich rule before validating/deducting balances so any
        # inserted configured weekly-off allocations are considered.
        _apply_sandwich_rule_on_request(db, leave_request, target_user)
        leave_request.total_days = len(leave_request.allocations)

        if leave_request.allocations:
            # A pending request may have been allocated as Paid when it was
            # submitted, but another request can consume that month's paid
            # slot before an approver reviews it. Reconcile stale allocations
            # instead of making approval fail.
            available_carried_balance = get_carried_leave_balance(db, target_user)
            remaining_carried_balance = available_carried_balance
            for alloc in leave_request.allocations:
                if alloc.leave_category != "Paid":
                    continue
                if not has_other_approved_or_pending_paid_leave_this_month(
                    db,
                    target_user.id,
                    alloc.allocation_date,
                    exclude_leave_id=leave_request.id,
                ):
                    continue
                if remaining_carried_balance > 0:
                    alloc.leave_category = "Carried"
                    remaining_carried_balance -= 1
                else:
                    alloc.leave_category = "Unpaid"
            leave_request.leave_category = compute_request_category_from_allocations(
                [(alloc.allocation_date, alloc.leave_category) for alloc in leave_request.allocations]
            )

            paid_days = sum(1 for alloc in leave_request.allocations if alloc.leave_category == "Paid")
            carried_days = sum(1 for alloc in leave_request.allocations if alloc.leave_category == "Carried")
            if paid_days > 0:
                # Ensure all paid allocations are valid within the month.
                for alloc in leave_request.allocations:
                    if alloc.leave_category != "Paid":
                        continue
                    if has_other_approved_or_pending_paid_leave_this_month(
                        db,
                        target_user.id,
                        alloc.allocation_date,
                        exclude_leave_id=leave_request.id,
                    ):
                        raise HTTPException(
                            status_code=409,
                            detail="This leave request has a conflicting paid-leave allocation. Please refresh and try again.",
                        )
            if carried_days > 0:
                if available_carried_balance < carried_days:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient carried leave balance. Available: {available_carried_balance}, Required: {carried_days}"
                    )
                target_user.carried_leave -= carried_days
            # Refresh leave accrual to ensure balances remain consistent after approval.
            db.commit()
            refresh_leave_accrual(db, target_user)

        # Mark attendance as "On Leave" for the approved leave days
        mark_leave_in_attendance(
            db,
            leave_request.user_id,
            leave_request.from_date,
            leave_request.to_date,
            {allocation.allocation_date for allocation in leave_request.allocations},
        )

    if target_user.id != current_user.id:
        create_notification(
            db,
            recipient_user_id=target_user.id,
            actor_user_id=current_user.id,
            notification_type=f"leave.{payload.status.lower()}",
            title=f"Leave request {payload.status.lower()}",
            message=f"Your leave from {leave_request.from_date} to {leave_request.to_date} was {payload.status.lower()}.",
            route="/leave",
            entity_type="leave_request",
            entity_id=leave_request.id,
        )
    db.commit()
    db.refresh(leave_request)
    
    log_activity(
        db,
        current_user.id,
        f"{payload.status} leave request #{leave_id} for {target_user.name}"
    )
    
    return leave_request


# ------------------------------------------------------------
# Get Leave Balance
# ------------------------------------------------------------

@router.get("/balance/{user_id}", response_model=LeaveBalanceResponse)
def get_leave_balance(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get leave balance for a user."""
    if effective_role_key(current_user) == "team_leader" and user_id != current_user.id:
        require_team_member_access(db, current_user, user_id, "leave.team_view")
    elif user_id != current_user.id and not has_permission(current_user, "leave.all_view", db):
        raise HTTPException(status_code=403, detail="Not authorized to view this user's balance")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    paid_available = 1 if paid_leave_available_this_month(db, user) else 0
    carried = get_carried_leave_balance(db, user)
    remaining = get_remaining_leave(db, user)
    
    return LeaveBalanceResponse(
        user_id=user_id,
        user_name=user.name,
        paid_leave_available_this_month=paid_available,
        carried_leave=carried,
        leave_encashed=user.leave_encashed or 0,
        total_leave_balance=remaining
    )


# ------------------------------------------------------------
# Leave Encashment
# ------------------------------------------------------------

@router.post("/encash", response_model=LeaveEncashmentOut)
def request_encashment(
    payload: LeaveEncashmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Employee requests leave encashment."""
    target_user_id = payload.user_id if hasattr(payload, 'user_id') and payload.user_id else current_user.id
    
    if effective_role_key(current_user) not in ["admin", "superadmin"] and target_user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You can only request encashment for yourself"
        )
    
    target_user = db.query(User).filter(
        User.id == target_user_id,
        User.status == "active"
    ).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    carried_balance = get_carried_leave_balance(db, target_user)
    if carried_balance < payload.days:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient carried leave balance. Available: {carried_balance}, Requested: {payload.days}"
        )
    
    existing = db.query(LeaveEncashmentRequest).filter(
        LeaveEncashmentRequest.user_id == target_user_id,
        LeaveEncashmentRequest.status == "Pending"
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail="You already have a pending encashment request"
        )
    
    encashment = LeaveEncashmentRequest(
        user_id=target_user_id,
        days=payload.days,
        status="Pending"
    )
    db.add(encashment)
    db.commit()
    db.refresh(encashment)
    
    log_activity(
        db,
        current_user.id,
        f"Requested encashment of {payload.days} day(s) for {target_user.name}"
    )
    
    return encashment


@router.get("/encash/pending", response_model=List[LeaveEncashmentOut])
def get_pending_encashment_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.approve"))
):
    """Admin gets all pending encashment requests."""
    return db.query(LeaveEncashmentRequest).filter(
        LeaveEncashmentRequest.status == "Pending"
    ).order_by(LeaveEncashmentRequest.requested_at.desc()).all()


@router.get("/encash/user/{user_id}", response_model=List[LeaveEncashmentOut])
def get_user_encashment_requests(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.approve"))
):
    """Admin gets encashment requests for a specific user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return db.query(LeaveEncashmentRequest).filter(
        LeaveEncashmentRequest.user_id == user_id
    ).order_by(LeaveEncashmentRequest.requested_at.desc()).all()


# ------------------------------------------------------------
# GET /encashment-requests/me - Get my encashment requests
# ------------------------------------------------------------
@router.get("/encashment-requests/me", response_model=List[LeaveEncashmentOut])
def get_my_encashment_requests(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's encashment requests with optional month filter."""
    query = db.query(LeaveEncashmentRequest).filter(
        LeaveEncashmentRequest.user_id == current_user.id
    )
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            LeaveEncashmentRequest.requested_at >= start_date,
            LeaveEncashmentRequest.requested_at < end_date
        )
    return query.order_by(LeaveEncashmentRequest.requested_at.desc()).all()


@router.put("/encash/{request_id}/decide", response_model=LeaveEncashmentOut)
def decide_encashment(
    request_id: int,
    payload: LeaveEncashmentDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.approve"))
):
    """Admin approves or rejects an encashment request."""
    # ✅ FIXED: Added .with_for_update() to prevent double-spending race condition
    encashment = db.query(LeaveEncashmentRequest).filter(
        LeaveEncashmentRequest.id == request_id
    ).with_for_update().first()
    
    if not encashment:
        raise HTTPException(status_code=404, detail="Encashment request not found")
    
    if encashment.status != "Pending":
        raise HTTPException(
            status_code=400,
            detail=f"Request already {encashment.status}"
        )
    
    target_user = db.query(User).filter(User.id == encashment.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    encashment.status = payload.status
    encashment.approved_by = current_user.id
    encashment.approved_at = datetime.now()
    
    if payload.status == "Approved":
        carried_balance = get_carried_leave_balance(db, target_user)
        if carried_balance < encashment.days:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient carried leave balance. Available: {carried_balance}"
            )
        target_user.carried_leave -= encashment.days
        target_user.leave_encashed = (target_user.leave_encashed or 0) + encashment.days
    
    db.commit()
    db.refresh(encashment)
    
    log_activity(
        db,
        current_user.id,
        f"{payload.status} encashment request #{request_id} for {target_user.name}"
    )
    
    return encashment


# ------------------------------------------------------------
# Admin: Change Leave Category
# ------------------------------------------------------------

@router.put("/{leave_id}/category", response_model=LeaveRequestOut)
def override_leave_category(
    leave_id: int,
    payload: LeaveCategoryOverride,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.approve"))
):
    """Admin changes a leave request's category summary."""
    leave_request = db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    
    if not leave_request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    valid_categories = ["Paid", "Carried", "Unpaid", "Emergency", "Sick", "Privilege"]
    if payload.leave_category not in valid_categories:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {', '.join(valid_categories)}"
        )

    old_category = leave_request.leave_category
    leave_request.leave_category = payload.leave_category

    if leave_request.status == "Approved":
        db.commit()
        refresh_leave_accrual(db, db.query(User).filter(User.id == leave_request.user_id).first())

    db.commit()
    db.refresh(leave_request)
    
    log_activity(
        db,
        current_user.id,
        f"Changed leave #{leave_id} category from '{old_category}' to '{payload.leave_category}'"
    )
    
    return leave_request


@router.put("/{leave_id}/allocations", response_model=LeaveRequestOut)
def override_leave_allocations(
    leave_id: int,
    payload: LeaveAllocationOverride,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("leave.approve"))
):
    """Admin edits the per-day allocation for a leave request."""
    # Lock the leave request and user rows to avoid concurrent modifications.
    leave_request = (
        db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).with_for_update().first()
    )
    if not leave_request:
        raise HTTPException(status_code=404, detail="Leave request not found")

    target_user = (
        db.query(User).filter(User.id == leave_request.user_id).with_for_update().first()
    )
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")

    allowed_categories = {"Paid", "Carried", "Unpaid", "Privilege", "Emergency", "Sick"}
    allocation_map = {}
    for alloc in payload.allocations:
        if alloc.leave_category not in allowed_categories:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid leave category in allocations. "
                    f"Allowed values: {', '.join(sorted(allowed_categories))}"
                ),
            )
        if alloc.allocation_date in allocation_map:
            raise HTTPException(status_code=400, detail="Duplicate allocation dates are not allowed.")
        allocation_map[alloc.allocation_date] = alloc.leave_category

    expected_dates = set(
        _get_chargeable_leave_dates(
            db,
            target_user.id,
            leave_request.from_date,
            leave_request.to_date,
        )
    )
    expected_dates.update(
        allocation.allocation_date
        for allocation in leave_request.allocations
        if allocation.is_sandwich
        and not applicable_holiday(
            db,
            target_user.id,
            allocation.allocation_date,
        )
    )
    if set(allocation_map) != expected_dates:
        raise HTTPException(
            status_code=400,
            detail="Allocations must contain exactly the chargeable dates in the leave range."
        )

    # Compute old/new carried and paid month usage
    old_allocation_dates = {
        alloc.allocation_date for alloc in leave_request.allocations
    }
    old_sandwich_dates = {
        alloc.allocation_date
        for alloc in leave_request.allocations
        if alloc.is_sandwich
    }
    old_carried_days = sum(1 for alloc in leave_request.allocations if alloc.leave_category == "Carried")
    new_carried_days = sum(1 for category in allocation_map.values() if category == "Carried")

    old_paid_months = {
        (alloc.allocation_date.year, alloc.allocation_date.month)
        for alloc in leave_request.allocations
        if alloc.leave_category == "Paid"
    }
    new_paid_months = {
        (d.year, d.month) for d, c in allocation_map.items() if c == "Paid"
    }
    paid_dates_by_month: dict[tuple[int, int], int] = {}
    for allocation_date, category in allocation_map.items():
        if category == "Paid":
            month_key = (allocation_date.year, allocation_date.month)
            paid_dates_by_month[month_key] = paid_dates_by_month.get(month_key, 0) + 1
    if any(count > 1 for count in paid_dates_by_month.values()):
        raise HTTPException(
            status_code=400,
            detail="Only one Paid leave allocation is allowed per calendar month.",
        )

    # Lock any other leave requests in the affected months to avoid races
    months_to_check = old_paid_months.union(new_paid_months)
    for year_month in months_to_check:
        y, m = year_month
        # This will lock matching leave rows (if any) so concurrent approval/override cannot
        # simultaneously claim the same Paid month.
        db.query(LeaveRequest).join(LeaveRequest.allocations).filter(
            LeaveRequest.user_id == target_user.id,
            LeaveRequestAllocation.leave_category == "Paid",
            extract("year", LeaveRequestAllocation.allocation_date) == y,
            extract("month", LeaveRequestAllocation.allocation_date) == m,
            LeaveRequest.id != leave_request.id,
        ).with_for_update().all()

    # Validate Paid-month constraints for new paid months (exclude this request itself)
    for (y, m) in new_paid_months:
        allocation_date = next(d for d in allocation_map if (d.year, d.month) == (y, m) and allocation_map[d] == "Paid")
        if (y, m) in old_paid_months:
            continue
        if has_other_approved_or_pending_paid_leave_this_month(
            db,
            target_user.id,
            allocation_date,
            exclude_leave_id=leave_request.id,
        ):
            raise HTTPException(
                status_code=400,
                detail="A Paid leave day already exists for that month on another request."
            )

    # If approved, validate and adjust carried balance atomically (refund old, apply new)
    if leave_request.status == "Approved":
        available_carried = get_carried_leave_balance(db, target_user) + old_carried_days
        if new_carried_days > available_carried:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient carried leave balance for override. "
                    f"Available after refund: {available_carried}, requested: {new_carried_days}"
                ),
            )
        # Refund old carried days then deduct new carried days
        target_user.carried_leave = (target_user.carried_leave or 0) + old_carried_days - new_carried_days

    # Replace allocations (preserve ordering)
    # Delete existing allocation rows first and flush so the DB sees the
    # deletes before we INSERT new rows. This avoids UNIQUE constraint
    # failures when allocation_date values overlap with existing rows.
    for old_alloc in list(leave_request.allocations):
        db.delete(old_alloc)
    db.flush()

    leave_request.allocations = [
        LeaveRequestAllocation(
            allocation_date=d,
            leave_category=c,
            is_sandwich=d in old_sandwich_dates,
        )
        for d, c in sorted(allocation_map.items())
    ]
    leave_request.total_days = len(leave_request.allocations)
    leave_request.leave_category = compute_request_category_from_allocations(
        [(d, c) for d, c in sorted(allocation_map.items())]
    )

    # If leave is already approved, ensure attendance reflects current approved days
    if leave_request.status == "Approved":
        db.flush()
        final_dates = set(allocation_map)
        mark_leave_in_attendance(
            db,
            leave_request.user_id,
            leave_request.from_date,
            leave_request.to_date,
            final_dates,
        )
        _restore_attendance_after_leave_removal(
            db,
            leave_request.user_id,
            old_allocation_dates - final_dates,
        )

    db.commit()
    # Refresh accruals now that carried balances may have changed
    if leave_request.status == "Approved":
        refresh_leave_accrual(db, target_user)
    db.refresh(leave_request)

    log_activity(db, current_user.id, f"Overrode allocations for leave #{leave_id}")
    return leave_request
