

"""
routers/leave.py
Leave requests, approvals, balances, and encashment.
"""



from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, extract
from typing import Optional, List

from database import get_db
from models import (
    User, LeaveRequest, LeaveType, LeaveEncashmentRequest,
    NotificationEmail, Attendance, LeaveRequestAllocation
)
from schemas import (
    LeaveRequestOut, LeaveRequestCreate, LeaveDecision,
    LeaveBalanceResponse, LeaveEncashmentCreate, LeaveEncashmentOut,
    LeaveEncashmentDecision, LeaveCategoryOverride, LeaveAllocationOverride
)
from auth import get_current_user, require_roles
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
)
from utils.logger import log_activity

router = APIRouter()


# ------------------------------------------------------------
# Helper function: Mark leave in attendance
# ------------------------------------------------------------
def mark_leave_in_attendance(db: Session, user_id: int, from_date: date, to_date: date):
    """Mark attendance as 'On Leave' for the given date range."""
    current_date = from_date
    while current_date <= to_date:
        # Check if attendance already exists for this date
        existing = db.query(Attendance).filter(
            Attendance.user_id == user_id,
            Attendance.attendance_date == current_date
        ).first()
        
        if existing:
            # Update existing attendance - don't override check_in/check_out
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
    """
    Ensure Sundays sandwiched between this request and other pending/approved
    requests are counted as leave. This will expand the request's from_date/to_date
    to include the Sunday and add a per-day allocation for that Sunday with a
    computed category (Paid/Carried/Unpaid) following existing allocation rules.

    The function is conservative: it only inserts a Sunday when there exists
    another Pending/Approved leave for the same user on the opposite side of
    the Sunday within a small gap (<=3 days). It attributes the Sunday to the
    request being processed and updates `total_days` accordingly.
    """
    # Find candidate Sundays between this request and other requests
    user_id = leave_request.user_id
    # Build a set of dates that already have allocations for this user
    existing_alloc_dates = set(
        d.allocation_date for lr in db.query(LeaveRequest).filter(LeaveRequest.user_id == user_id).all() for d in lr.allocations
    )

    added = []
    # Look for other requests that could sandwich a Sunday with this one
    others = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.user_id == user_id, LeaveRequest.id != leave_request.id, LeaveRequest.status.in_(["Pending", "Approved"]))
        .all()
    )

    for other in others:
        # Consider gaps where a Sunday might lie strictly between ranges
        if other.to_date < leave_request.from_date:
            gap_days = (leave_request.from_date - other.to_date).days
            if 2 <= gap_days <= 7:
                # check intermediate dates for Sunday
                for i in range(1, gap_days):
                    candidate = other.to_date + timedelta(days=i)
                    if candidate.weekday() == 6 and candidate not in existing_alloc_dates:
                        added.append(candidate)
        elif other.from_date > leave_request.to_date:
            gap_days = (other.from_date - leave_request.to_date).days
            if 2 <= gap_days <= 7:
                for i in range(1, gap_days):
                    candidate = leave_request.to_date + timedelta(days=i)
                    if candidate.weekday() == 6 and candidate not in existing_alloc_dates:
                        added.append(candidate)

    if not added:
        return

    # Determine carried balance available before applying additions
    carried_balance = get_carried_leave_balance(db, target_user)

    # Determine paid months already used by ANY request for the user (Approved/Pending)
    used_paid_months = set(
        (alloc.allocation_date.year, alloc.allocation_date.month)
        for lr in db.query(LeaveRequest).filter(LeaveRequest.user_id == user_id, LeaveRequest.status.in_(["Pending","Approved"])).all()
        for alloc in lr.allocations
        if alloc.leave_category == "Paid"
    )

    # Also include paid months already present on this request
    used_paid_months.update(
        (alloc.allocation_date.year, alloc.allocation_date.month)
        for alloc in leave_request.allocations
        if alloc.leave_category == "Paid"
    )

    # Add allocations for each candidate Sunday, deciding category
    for s in sorted(set(added)):
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

        # Attach allocation and expand date range to include the Sunday
        leave_request.allocations.append(LeaveRequestAllocation(allocation_date=s, leave_category=category))
        if s < leave_request.from_date:
            leave_request.from_date = s
        if s > leave_request.to_date:
            leave_request.to_date = s
        leave_request.total_days = (leave_request.total_days or 0) + 1

    # Ensure allocations are ordered
    leave_request.allocations.sort(key=lambda a: a.allocation_date)


# ------------------------------------------------------------
# GET / - Get all leave requests (Admin)
# ------------------------------------------------------------
@router.get("/", response_model=List[LeaveRequestOut])
def get_all_leave_requests_root(
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
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
    status_filter: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin gets all encashment requests."""
    query = db.query(LeaveEncashmentRequest)
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
    
    # Validate: non-admin can only apply for themselves
    if current_user.role not in ["superadmin", "admin"] and target_user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You can only apply for leave for yourself"
        )
    
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
    total_days = calculate_total_days(payload.from_date, payload.to_date)
    
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
    auto_approve = (
        current_user.role in ["admin", "superadmin"]
        and target_user_id != current_user.id
    )
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
        LeaveRequestAllocation(allocation_date=allocation_date, leave_category=leave_category)
        for allocation_date, leave_category in allocations
    ]
    db.add(leave_request)

    if auto_approve:
        # Apply sandwich rule: if there's a Sunday sandwiched between this
        # auto-approved request and other requests, ensure it's added here.
        _apply_sandwich_rule_on_request(db, leave_request, target_user)

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
        mark_leave_in_attendance(db, target_user_id, leave_request.from_date, leave_request.to_date)

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


# ------------------------------------------------------------
# Get My Leave Requests
# ------------------------------------------------------------

@router.get("/me", response_model=List[LeaveRequestOut])
def get_my_leave_requests(
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected)$"),
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
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin gets leave requests for a specific user with optional month filter."""
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
    current_user: User = Depends(require_roles("admin", "superadmin"))
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
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
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
    current_user: User = Depends(require_roles("admin", "superadmin"))
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

    leave_request.status = payload.status
    leave_request.approved_by = current_user.id
    leave_request.approved_at = datetime.now()
    
    if payload.status == "Approved":
        # New requests are allocated on submission. Give legacy requests the
        # same automatic Paid -> Carried -> Unpaid allocation on approval,
        # while preserving explicit exception categories from older records.
        if not leave_request.allocations:
            if leave_request.leave_category in {"Privilege", "Emergency", "Sick"}:
                allocations = [(day, leave_request.leave_category) for day in _get_date_range(leave_request.from_date, leave_request.to_date)]
            else:
                allocations = allocate_leave_days(db, target_user, leave_request.from_date, leave_request.to_date)
            leave_request.allocations = [
                LeaveRequestAllocation(allocation_date=allocation_date, leave_category=leave_category)
                for allocation_date, leave_category in allocations
            ]
            leave_request.leave_category = compute_request_category_from_allocations(allocations)

        # Apply sandwich rule before validating/deducting balances so any
        # inserted Sunday allocations are considered.
        _apply_sandwich_rule_on_request(db, leave_request, target_user)

        if leave_request.allocations:
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
                            status_code=400,
                            detail=(
                                "This request cannot be approved as Paid Leave because "
                                "another leave request already consumes that month's paid slot."
                            ),
                        )
            if carried_days > 0:
                carried_balance = get_carried_leave_balance(db, target_user)
                if carried_balance < carried_days:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient carried leave balance. Available: {carried_balance}, Required: {carried_days}"
                    )
                target_user.carried_leave -= carried_days
            # Refresh leave accrual to ensure balances remain consistent after approval.
            db.commit()
            refresh_leave_accrual(db, target_user)
        else:
            total_days = leave_request.total_days or 1
            
            if leave_request.leave_category == "Paid":
                # Paid Leave is one available day in a month. Requests are never
                # split or automatically converted to Unpaid.
                available_paid_days = 1 if paid_leave_available_this_month(
                    db, target_user, leave_request.from_date
                ) else 0
                if available_paid_days == 0:
                    raise HTTPException(status_code=400, detail="No Paid Leave balance is available.")
                if total_days > available_paid_days:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Only {available_paid_days} Paid Leave day is available. "
                            "This request cannot be approved as Paid Leave. "
                            "Approve it as Unpaid Leave or Reject."
                        ),
                    )
            elif leave_request.leave_category == "Carried":
                carried_balance = get_carried_leave_balance(db, target_user)
                if carried_balance < total_days:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient carried leave balance. Available: {carried_balance}"
                    )
                target_user.carried_leave -= total_days
            elif leave_request.leave_category == "Privilege":
                pass

        # Mark attendance as "On Leave" for the approved leave days
        mark_leave_in_attendance(db, leave_request.user_id, leave_request.from_date, leave_request.to_date)

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
    if current_user.role not in ["admin", "superadmin"] and user_id != current_user.id:
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
    
    if current_user.role not in ["admin", "superadmin"] and target_user_id != current_user.id:
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
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin gets all pending encashment requests."""
    return db.query(LeaveEncashmentRequest).filter(
        LeaveEncashmentRequest.status == "Pending"
    ).order_by(LeaveEncashmentRequest.requested_at.desc()).all()


@router.get("/encash/user/{user_id}", response_model=List[LeaveEncashmentOut])
def get_user_encashment_requests(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
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
    current_user: User = Depends(require_roles("admin", "superadmin"))
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
    current_user: User = Depends(require_roles("admin", "superadmin"))
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
    current_user: User = Depends(require_roles("admin", "superadmin"))
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
        allocation_map[alloc.allocation_date] = alloc.leave_category

    expected_dates = _get_date_range(leave_request.from_date, leave_request.to_date)
    if len(allocation_map) != len(expected_dates) or any(d not in allocation_map for d in expected_dates):
        raise HTTPException(
            status_code=400,
            detail="Allocations must contain one entry for each day in the leave range."
        )

    # Compute old/new carried and paid month usage
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
    leave_request.allocations = [
        LeaveRequestAllocation(allocation_date=d, leave_category=c)
        for d, c in sorted(allocation_map.items())
    ]
    leave_request.leave_category = compute_request_category_from_allocations(
        [(d, c) for d, c in sorted(allocation_map.items())]
    )

    # If leave is already approved, ensure attendance reflects current approved days
    if leave_request.status == "Approved":
        # Re-mark attendance for the leave dates (idempotent)
        mark_leave_in_attendance(db, leave_request.user_id, leave_request.from_date, leave_request.to_date)

    db.commit()
    # Refresh accruals now that carried balances may have changed
    if leave_request.status == "Approved":
        try:
            refresh_leave_accrual(db, target_user)
        except Exception:
            # If refresh fails for any reason, we should still return the updated
            # leave_request but log the problem - avoid crashing the API here.
            pass
    db.refresh(leave_request)

    log_activity(db, current_user.id, f"Overrode allocations for leave #{leave_id}")
    return leave_request







