

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
    NotificationEmail, Attendance
)
from schemas import (
    LeaveRequestOut, LeaveRequestCreate, LeaveDecision,
    LeaveBalanceResponse, LeaveEncashmentCreate, LeaveEncashmentOut,
    LeaveEncashmentDecision, LeaveCategoryOverride
)
from auth import get_current_user, require_roles
from utils.leave_calculator import (
    get_remaining_leave,
    paid_leave_available_this_month,
    get_carried_leave_balance,
    has_approved_or_pending_paid_leave_this_month,
    get_leave_year_quota,
    get_used_balance_days_this_year,
    get_encashed_days_this_year,
    calculate_total_days,
    LEAVE_TRACKING_START_DATE
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
    
    # Validate leave category
    requested_category = payload.leave_category or "Unpaid"
    
    # Check if leave type exists (if provided)
    if payload.leave_type_id:
        leave_type = db.query(LeaveType).filter(LeaveType.id == payload.leave_type_id).first()
        if not leave_type:
            raise HTTPException(status_code=404, detail="Leave type not found")
    
    # --- Validation based on category ---
    
    if payload.leave_category == "Paid":
        if not paid_leave_available_this_month(db, target_user, payload.from_date):
            raise HTTPException(
                status_code=400,
                detail="No paid leave available for that month"
            )
    
    elif payload.leave_category == "Carried":
        # ✅ FIXED: Use the accrual-aware helper
        carried_balance = get_carried_leave_balance(db, target_user)
        if carried_balance < total_days:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient carried leave balance. Available: {carried_balance}, Requested: {total_days}"
            )
    
    elif payload.leave_category == "Privilege":
        if current_user.role not in ["superadmin", "admin"]:
            raise HTTPException(
                status_code=403,
                detail="Only admins can apply for privilege leave"
            )
    
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
    
    # Create leave request
    leave_request = LeaveRequest(
        user_id=target_user_id,
        leave_type_id=payload.leave_type_id,
        from_date=payload.from_date,
        to_date=payload.to_date,
        total_days=total_days,
        reason=payload.reason,
        leave_category=requested_category,
        status="Pending",
        approved_by=None,
        approved_at=None,
    )
    db.add(leave_request)

    # If admin applied and auto-approved, deduct from balance immediately
    if False:
        # ✅ FIXED: Use the accrual-aware helper
        carried_balance = get_carried_leave_balance(db, target_user)
        if carried_balance < total_days:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient carried leave balance. Available: {carried_balance}"
            )
        target_user.carried_leave -= total_days
    
    # If admin applied and auto-approved, mark attendance as "On Leave"
    if False:
        mark_leave_in_attendance(db, target_user_id, payload.from_date, payload.to_date)
    
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

    if payload.status == "Approved":
        if payload.leave_category:
            if payload.leave_category not in ("Paid", "Unpaid", "Carried", "Privilege"):
                raise HTTPException(status_code=400, detail="Choose a valid leave category when approving")
            leave_request.leave_category = payload.leave_category
    
    leave_request.status = payload.status
    leave_request.approved_by = current_user.id
    leave_request.approved_at = datetime.now()
    
    if payload.status == "Approved":
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
            # Carried leave is a separate pool and still needs explicit decrement.
            carried_balance = get_carried_leave_balance(db, target_user)
            if carried_balance < total_days:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient carried leave balance. Available: {carried_balance}"
                )
            target_user.carried_leave -= total_days
        elif leave_request.leave_category == "Privilege":
            # Privilege leave does not consume paid/carried balance.
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
    """Admin changes a leave request's category."""
    leave_request = db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    
    if not leave_request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    # ✅ CRITICAL FIX: Only allow changes on Pending requests
    if leave_request.status != "Pending":
        raise HTTPException(
            status_code=400, 
            detail="Cannot change category of an approved or rejected request. Please void the request and submit a new one."
        )
    
    valid_categories = ["Paid", "Carried", "Unpaid", "Emergency", "Sick", "Privilege"]
    if payload.leave_category not in valid_categories:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {', '.join(valid_categories)}"
        )
    
    old_category = leave_request.leave_category
    leave_request.leave_category = payload.leave_category
    
    db.commit()
    db.refresh(leave_request)
    
    log_activity(
        db,
        current_user.id,
        f"Changed leave #{leave_id} category from '{old_category}' to '{payload.leave_category}'"
    )
    
    return leave_request







