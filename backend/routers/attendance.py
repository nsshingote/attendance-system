"""
routers/attendance.py
Check-in / check-out (restricted to approved office IPs for ALL users),
attendance history, calendar view, monthly summaries, and half-day marking.
Late check-ins (after 10:30 AM) and early check-outs (before 6:30 PM) 
require a reason.
"""

from datetime import date, datetime, time
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from auth import get_current_user, require_roles, require_admin
from database import get_db
from models import Attendance, OfficeIP, User, ActivityLog, Holiday, HalfDayRequest as HalfDayRequestModel, LeaveRequest, DailyReportData, DailyReport
from schemas import AttendanceOut, AttendanceManualUpdate, HalfDayCreate, HalfDayDecision, HalfDayOut, CheckInRequest, CheckOutRequest
from utils.attendance_status import calculate_status, calculate_half_day, is_weekly_off
from utils.calender import build_month_calendar
from utils.date_helpers import iso_with_offset

router = APIRouter()

# Half-day slot boundaries
HALF_DAY_SLOTS = {
    "morning": (time(10, 0), time(14, 30)),      # 10:00 AM - 2:30 PM
    "afternoon": (time(14, 30), time(18, 30)),   # 2:30 PM - 6:30 PM
}

# Fixed cutoffs that require a reason to be supplied
LATE_CHECKIN_REASON_CUTOFF = time(10, 30)
EARLY_CHECKOUT_REASON_CUTOFF = time(18, 30)


def _get_client_ip(request: Request, override: Optional[str] = None) -> str:
    if override:
        return override
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _validate_office_ip(ip_address: str, db: Session) -> bool:
    print(f"🔵 ========================================")
    print(f"🔵 VALIDATING IP: {ip_address}")
    
    office_ips = db.query(OfficeIP).filter(OfficeIP.status == "active").all()
    print(f"🔵 Active office IPs in DB: {[ip.ip_address for ip in office_ips]}")
    
    if not office_ips:
        print("⚠️ No office IPs configured — allowing all")
        return True
    
    approved = db.query(OfficeIP).filter(
        OfficeIP.ip_address == ip_address,
        OfficeIP.status == "active"
    ).first()
    
    print(f"🔵 IP approved: {approved is not None}")
    print(f"🔵 ========================================")
    return approved is not None


def _has_report_for_date(db: Session, user_id: int, target_date: date) -> bool:
    """Check if a user has submitted a report for a specific date."""
    data_report = db.query(DailyReportData).filter(
        DailyReportData.user_id == user_id,
        DailyReportData.attendance_date == target_date
    ).first()
    if data_report:
        return True

    legacy_report = db.query(DailyReport).filter(
        DailyReport.user_id == user_id,
        DailyReport.attendance_date == target_date,
        DailyReport.status == "submitted"
    ).first()
    return legacy_report is not None


@router.post("/check-in", response_model=AttendanceOut)
def check_in(
    request: Request,
    payload: Optional[CheckInRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    # keep tz-aware datetime
    today = ist_now.date()
    print(f"[CHECK-IN] user={getattr(current_user,'id',None)} ist_now={ist_now.isoformat()}")
    ip_address = _get_client_ip(request, payload.ip_address if payload else None)
    
    # Validate office IP - applies to ALL users (including admins)
    if not _validate_office_ip(ip_address, db):
        raise HTTPException(
            status_code=403,
            detail=f"Attendance cannot be marked from this network ({ip_address}). Please connect to an approved office network."
        )

    existing = (
        db.query(Attendance)
        .filter(Attendance.user_id == current_user.id, Attendance.attendance_date == today)
        .first()
    )
    if existing and existing.check_in:
        raise HTTPException(status_code=400, detail="You have already checked in today")

    reason = payload.reason if payload else None

    # Require reason for late check-in (after 10:30 AM IST)
    if ist_now.time() > LATE_CHECKIN_REASON_CUTOFF and not reason:
        raise HTTPException(
            status_code=400,
            detail="REASON_REQUIRED: Please provide a reason for checking in after 10:30 AM.",
        )

    # Check if it's a weekly off
    if is_weekly_off(today, db):
        status_value = "Present"
    elif db.query(Holiday).filter(Holiday.holiday_date == today).first():
        status_value = "Holiday"
    else:
        status_value = calculate_status(ist_now, db)

    if existing:
        existing.check_in = ist_now
        existing.ip_address = ip_address
        existing.status = status_value
        existing.reason = reason
        record = existing
    else:
        record = Attendance(
            user_id=current_user.id,
            attendance_date=today,
            check_in=ist_now,
            ip_address=ip_address,
            status=status_value,
            reason=reason,
        )
        db.add(record)

    # Log activity
    db.add(ActivityLog(user_id=current_user.id, activity=f"Checked in from {ip_address}"))
    db.commit()
    db.refresh(record)
    print(f"[CHECK-IN-STORED] id={record.id} user={record.user_id} check_in={record.check_in!r} check_out={record.check_out!r} reason={record.reason!r}")

    return {
        "id": record.id,
        "user_id": record.user_id,
        "attendance_date": record.attendance_date.isoformat(),
        "check_in": iso_with_offset(record.check_in),
        "check_out": iso_with_offset(record.check_out),
        "status": record.status,
        "ip_address": record.ip_address,
        "reason": record.reason,
        "created_at": iso_with_offset(record.created_at),
        "has_report": _has_report_for_date(db, record.user_id, record.attendance_date),
    }


@router.get("/debug-time")
def debug_time():
    """Return server UTC and Asia/Kolkata times for debugging."""
    now_utc = datetime.utcnow()
    ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    return {
        "server_utc": now_utc.isoformat(),
        "ist": ist.isoformat(),
        "ist_naive": ist.replace(tzinfo=None).isoformat()
    }


@router.get("/debug-latest")
def debug_latest_attendance(limit: int = 20, db: Session = Depends(get_db)):
    """Return the latest attendance rows with raw stored values for debugging."""
    records = db.query(Attendance).order_by(Attendance.id.desc()).limit(limit).all()
    out = []
    for r in records:
        out.append({
            "id": r.id,
            "user_id": r.user_id,
            "attendance_date": r.attendance_date.isoformat(),
            "check_in_raw": str(r.check_in),
            "check_out_raw": str(r.check_out),
            "check_in_iso": iso_with_offset(r.check_in),
            "check_out_iso": iso_with_offset(r.check_out),
            "created_at_raw": str(r.created_at),
            "created_at_iso": iso_with_offset(r.created_at),
            "reason": r.reason,
        })
    return out


@router.post("/normalize-naive")
def normalize_naive_datetimes(db: Session = Depends(get_db)):
    """One-time utility: convert naive check_in/check_out datetimes to tz-aware Asia/Kolkata datetimes."""
    updated = 0
    records = db.query(Attendance).all()
    for r in records:
        changed = False
        if r.check_in and r.check_in.tzinfo is None:
            r.check_in = r.check_in.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
            changed = True
        if r.check_out and r.check_out.tzinfo is None:
            r.check_out = r.check_out.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
            changed = True
        if changed:
            updated += 1
            db.add(r)
    db.commit()
    return {"updated_rows": updated}


@router.post("/test-checkin")
def test_checkin(user_id: int, reason: Optional[str] = None, db: Session = Depends(get_db)):
    """Temporary test endpoint: create a check-in for given user_id using server IST time."""
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    today = ist_now.date()

    existing = db.query(Attendance).filter(Attendance.user_id == user_id, Attendance.attendance_date == today).first()
    status_value = calculate_status(ist_now, db)
    if existing:
        existing.check_in = ist_now
        existing.status = status_value
        existing.reason = reason
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return {"created": False, "record": {
            "id": existing.id,
            "user_id": existing.user_id,
            "check_in": iso_with_offset(existing.check_in),
            "created_at": iso_with_offset(existing.created_at),
            "reason": existing.reason
        }}

    record = Attendance(
        user_id=user_id,
        attendance_date=today,
        check_in=ist_now,
        status=status_value,
        reason=reason,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"created": True, "record": {
        "id": record.id,
        "user_id": record.user_id,
        "check_in": iso_with_offset(record.check_in),
        "created_at": iso_with_offset(record.created_at),
        "reason": record.reason
    }}


@router.post("/test-set-reason")
def test_set_reason(user_id: int, reason: str, db: Session = Depends(get_db)):
    """Temporary: set today's attendance reason for a user (test only)."""
    today = date.today()
    rec = db.query(Attendance).filter(Attendance.user_id == user_id, Attendance.attendance_date == today).first()
    if not rec:
        return {"error": "no record for today"}
    rec.reason = reason
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {"id": rec.id, "user_id": rec.user_id, "check_in": iso_with_offset(rec.check_in), "reason": rec.reason}


@router.post("/check-out", response_model=AttendanceOut)
def check_out(
    request: Request,
    payload: Optional[CheckOutRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    today = ist_now.date()
    print(f"[CHECK-OUT] user={getattr(current_user,'id',None)} ist_now={ist_now.isoformat()}")
    ip_address = _get_client_ip(request, payload.ip_address if payload else None)
    
    # Validate office IP - applies to ALL users (including admins)
    if not _validate_office_ip(ip_address, db):
        raise HTTPException(
            status_code=403,
            detail=f"Attendance cannot be marked from this network ({ip_address}). Please connect to an approved office network."
        )

    record = (
        db.query(Attendance)
        .filter(Attendance.user_id == current_user.id, Attendance.attendance_date == today)
        .first()
    )
    if not record or not record.check_in:
        raise HTTPException(status_code=400, detail="You must check in before checking out")
    if record.check_out:
        raise HTTPException(status_code=400, detail="You have already checked out today")

    reason = payload.reason if payload else None

    # Require reason for early check-out (before 6:30 PM IST)
    if ist_now.time() < EARLY_CHECKOUT_REASON_CUTOFF and not reason:
        raise HTTPException(
            status_code=400,
            detail="REASON_REQUIRED: Please provide a reason for checking out before 6:30 PM.",
        )

    # =============================================
    # REPORT VALIDATION BEFORE CHECKOUT
    # =============================================
    # SuperAdmin is exempt from writing reports
    if current_user.role != "superadmin":
        # Use the attendance record date rather than server local today
        attendance_date = record.attendance_date
        has_report = _has_report_for_date(db, current_user.id, attendance_date)
        if not has_report:
            raise HTTPException(
                status_code=400,
                detail="REPORT_REQUIRED: Please submit your daily report before checking out."
            )
    # =============================================

    record.check_out = ist_now
    if reason:
        record.reason = f"{record.reason}; {reason}" if record.reason else reason

        # ✅ FIXED: Only mark Half Day if worked less than 4 hours
    if record.check_in and record.check_out:
        check_in_val = record.check_in
        check_out_val = record.check_out
        if check_in_val.tzinfo is None:
            check_in_val = check_in_val.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
        if check_out_val.tzinfo is None:
            check_out_val = check_out_val.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
        hours_worked = (check_out_val - check_in_val).total_seconds() / 3600
        if hours_worked < 4 and record.status != "Holiday":
            record.status = "Half Day"
    

    db.add(ActivityLog(user_id=current_user.id, activity=f"Checked out from {ip_address}"))
    db.commit()
    db.refresh(record)
    print(f"[CHECK-OUT-STORED] id={record.id} user={record.user_id} check_in={record.check_in!r} check_out={record.check_out!r} reason={record.reason!r}")

    return {
        "id": record.id,
        "user_id": record.user_id,
        "attendance_date": record.attendance_date.isoformat(),
        "check_in": iso_with_offset(record.check_in),
        "check_out": iso_with_offset(record.check_out),
        "status": record.status,
        "ip_address": record.ip_address,
        "reason": record.reason,
        "created_at": iso_with_offset(record.created_at),
        "has_report": _has_report_for_date(db, record.user_id, record.attendance_date),
    }


@router.get("/me", response_model=List[AttendanceOut])
def my_attendance(
    month: Optional[int] = None,
    year: Optional[int] = None,
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Attendance).filter(Attendance.user_id == current_user.id)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            Attendance.attendance_date >= start_date,
            Attendance.attendance_date < end_date
        )
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        query = query.filter(Attendance.attendance_date == target_date)

    results = []
    for attendance in query.order_by(Attendance.attendance_date.desc()).all():
        results.append({
            "id": attendance.id,
            "user_id": attendance.user_id,
            "attendance_date": attendance.attendance_date.isoformat(),
            "check_in": iso_with_offset(attendance.check_in),
            "check_out": iso_with_offset(attendance.check_out),
            "status": attendance.status,
            "ip_address": attendance.ip_address,
            "reason": attendance.reason,
            "created_at": iso_with_offset(attendance.created_at),
            "has_report": _has_report_for_date(db, attendance.user_id, attendance.attendance_date),
        })
    return results


@router.get("/user/{user_id}", response_model=List[AttendanceOut])
def user_attendance(
    user_id: int,
    month: Optional[int] = None,
    year: Optional[int] = None,
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin gets attendance for a specific user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    query = db.query(Attendance).filter(Attendance.user_id == user_id)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            Attendance.attendance_date >= start_date,
            Attendance.attendance_date < end_date
        )
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        query = query.filter(Attendance.attendance_date == target_date)

    results = []
    for attendance in query.order_by(Attendance.attendance_date.desc()).all():
        results.append({
            "id": attendance.id,
            "user_id": attendance.user_id,
            "attendance_date": attendance.attendance_date.isoformat(),
            "check_in": iso_with_offset(attendance.check_in),
            "check_out": iso_with_offset(attendance.check_out),
            "status": attendance.status,
            "ip_address": attendance.ip_address,
            "reason": attendance.reason,
            "created_at": iso_with_offset(attendance.created_at),
            "has_report": _has_report_for_date(db, attendance.user_id, attendance.attendance_date),
        })
    return results


# ============================================================
# ALL EMPLOYEES ATTENDANCE - ADMIN ONLY
# ============================================================
@router.get("/all")
def get_all_attendance(
    year: int,
    month: int,
    date_value: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Get attendance for all employees (admin only)"""
    query = db.query(
        Attendance,
        User.name,
        User.department
    ).join(User, Attendance.user_id == User.id).filter(
        func.extract('year', Attendance.attendance_date) == year,
        func.extract('month', Attendance.attendance_date) == month
    )
    
    if date_value is not None:
        query = query.filter(Attendance.attendance_date == date_value)
    
    query = query.order_by(User.name, Attendance.attendance_date)
    
    results = query.all()
    
    # Format the response with user details
    formatted_results = []
    for attendance, user_name, department in results:
        report_data_exists = db.query(DailyReportData).filter(
            DailyReportData.user_id == attendance.user_id,
            DailyReportData.attendance_date == attendance.attendance_date
        ).first() is not None
        legacy_report_exists = db.query(DailyReport).filter(
            DailyReport.user_id == attendance.user_id,
            DailyReport.attendance_date == attendance.attendance_date,
            DailyReport.status == "submitted"
        ).first() is not None
        has_report = report_data_exists or legacy_report_exists

        formatted_results.append({
            "id": attendance.id,
            "user_id": attendance.user_id,
            "user_name": user_name,
            "department": department,
            "attendance_date": attendance.attendance_date.isoformat(),
            "check_in": iso_with_offset(attendance.check_in),
            "check_out": iso_with_offset(attendance.check_out),
            "status": attendance.status,
            "ip_address": attendance.ip_address,
            "reason": attendance.reason,
            "has_report": has_report,
        })
    
    return formatted_results


# ============================================================
# CALENDAR
# ============================================================
@router.get("/calendar")
def attendance_calendar(
    year: int,
    month: int,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merges the day-type calendar (holidays/weekly-offs) with a user's attendance records."""
    target_user_id = user_id if (user_id and current_user.role in ("admin", "superadmin")) else current_user.id
    
    # Verify user exists
    user = db.query(User).filter(User.id == target_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    calendar_days = build_month_calendar(db, year, month)
    
    # Get attendance records for the month
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1)
    else:
        end_date = date(year, month + 1, 1)
    
    records = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == target_user_id,
            Attendance.attendance_date >= start_date,
            Attendance.attendance_date < end_date,
        )
        .all()
    )
    
    # Create a map of date -> attendance record using same date format
    records_by_date = {}
    for r in records:
        date_key = r.attendance_date.isoformat()
        records_by_date[date_key] = r

    for day in calendar_days:
        record = records_by_date.get(day["date"])
        if record:
            day["status"] = record.status
            day["check_in"] = iso_with_offset(record.check_in)
            day["check_out"] = iso_with_offset(record.check_out)
        else:
            # No attendance record for this day
            if day["day_type"] == "holiday":
                day["status"] = "Holiday"
            elif day["day_type"] == "weekly_off":
                day["status"] = "Weekly Off"
            else:
                day["status"] = "Absent"
            day["check_in"] = None
            day["check_out"] = None

    return calendar_days


@router.get("/summary/{user_id}")
def monthly_summary(
    user_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "user" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1)
    else:
        end_date = date(year, month + 1, 1)

    records = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user_id,
            Attendance.attendance_date >= start_date,
            Attendance.attendance_date < end_date,
        )
        .all()
    )

    # Summary counts
    summary = {"Present": 0, "Half Day": 0, "Holiday": 0}
    
    # Calculate total working hours
    total_hours = 0.0
    
    for r in records:
        # Count Present (including Late)
        if r.status == "Present" or r.status == "Late":
            summary["Present"] += 1
        elif r.status == "Half Day":
            summary["Half Day"] += 1
        elif r.status == "Holiday":
            summary["Holiday"] += 1
        
        # Calculate working hours
        if r.check_in and r.check_out:
            hours = (r.check_out - r.check_in).total_seconds() / 3600
            total_hours += hours

    # Count leave days in this month (all approved leaves)
    leave_days = (
        db.query(func.coalesce(func.sum(LeaveRequest.total_days), 0))
        .filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status == "Approved",
            LeaveRequest.from_date <= end_date,
            LeaveRequest.to_date >= start_date,
        )
        .scalar()
    )
    
    summary["Leave"] = int(leave_days or 0)
    summary["Total Hours"] = round(total_hours, 2)

    return summary


# ============================================================
# ADMIN MANUAL UPDATE
# ============================================================
@router.put("/{attendance_id}", response_model=AttendanceOut)
def manual_update(
    attendance_id: int,
    payload: AttendanceManualUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin manual override of an attendance record."""
    record = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(record, field, value)
    record.updated_by = current_user.id

    db.add(ActivityLog(user_id=current_user.id, activity=f"Manually updated attendance #{attendance_id}"))
    db.commit()
    db.refresh(record)
    return record


# ============================================================
# HALF DAY - INTERNAL HELPER
# ============================================================
def _apply_half_day(
    db: Session, user_id: int, attendance_date, slot: str, reason: Optional[str], marked_by: Optional[int] = None
) -> Attendance:
    if slot not in HALF_DAY_SLOTS:
        raise HTTPException(status_code=400, detail="Slot must be 'morning' or 'afternoon'")

    start_time, end_time = HALF_DAY_SLOTS[slot]
    # create tz-aware datetimes in Asia/Kolkata
    check_in = datetime.combine(attendance_date, start_time).replace(tzinfo=ZoneInfo("Asia/Kolkata"))
    check_out = datetime.combine(attendance_date, end_time).replace(tzinfo=ZoneInfo("Asia/Kolkata"))

    record = (
        db.query(Attendance)
        .filter(Attendance.user_id == user_id, Attendance.attendance_date == attendance_date)
        .first()
    )

    if record:
        record.check_in = check_in
        record.check_out = check_out
        record.status = "Half Day"
        record.reason = reason
        if marked_by:
            record.updated_by = marked_by
    else:
        record = Attendance(
            user_id=user_id,
            attendance_date=attendance_date,
            check_in=check_in,
            check_out=check_out,
            status="Half Day",
            reason=reason,
            updated_by=marked_by,
        )
        db.add(record)

    db.commit()
    db.refresh(record)
    return record


# ============================================================
# HALF DAY - EMPLOYEE REQUEST
# ============================================================
@router.post("/half-day", response_model=HalfDayOut, status_code=201)
def request_half_day(
    payload: HalfDayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Employee requests a half day — creates a Pending request."""
    if payload.slot not in HALF_DAY_SLOTS:
        raise HTTPException(status_code=400, detail="Slot must be 'morning' or 'afternoon'")

    existing_pending = (
        db.query(HalfDayRequestModel)
        .filter(
            HalfDayRequestModel.user_id == current_user.id,
            HalfDayRequestModel.attendance_date == payload.attendance_date,
            HalfDayRequestModel.status == "Pending",
        )
        .first()
    )
    if existing_pending:
        raise HTTPException(status_code=400, detail="You already have a pending half day request for that date.")

    half_day_request = HalfDayRequestModel(
        user_id=current_user.id,
        attendance_date=payload.attendance_date,
        slot=payload.slot,
        reason=payload.reason,
        status="Pending",
    )
    db.add(half_day_request)
    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity=f"Requested half day ({payload.slot}) for {payload.attendance_date}",
        )
    )
    db.commit()
    db.refresh(half_day_request)
    return half_day_request


@router.get("/half-day-requests/me", response_model=List[HalfDayOut])
def my_half_day_requests(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's half day requests with optional month filter."""
    query = db.query(HalfDayRequestModel).filter(HalfDayRequestModel.user_id == current_user.id)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            HalfDayRequestModel.attendance_date >= start_date,
            HalfDayRequestModel.attendance_date < end_date
        )
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        query = query.filter(HalfDayRequestModel.attendance_date == target_date)
    return query.order_by(HalfDayRequestModel.requested_at.desc()).all()


@router.get("/half-day-requests", response_model=List[HalfDayOut])
def all_half_day_requests(
    status_filter: Optional[str] = None,
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin gets all half day requests with optional month filter."""
    query = db.query(HalfDayRequestModel)
    if status_filter:
        query = query.filter(HalfDayRequestModel.status == status_filter)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            HalfDayRequestModel.attendance_date >= start_date,
            HalfDayRequestModel.attendance_date < end_date
        )
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        query = query.filter(HalfDayRequestModel.attendance_date == target_date)
    return query.order_by(HalfDayRequestModel.requested_at.desc()).all()


@router.get("/half-day-requests/user/{user_id}", response_model=List[HalfDayOut])
def get_user_half_day_requests(
    user_id: int,
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    date_value: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin gets half day requests for a specific user with month filter."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    query = db.query(HalfDayRequestModel).filter(HalfDayRequestModel.user_id == user_id)
    if month and year:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            HalfDayRequestModel.attendance_date >= start_date,
            HalfDayRequestModel.attendance_date < end_date
        )
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        query = query.filter(HalfDayRequestModel.attendance_date == target_date)
    return query.order_by(HalfDayRequestModel.requested_at.desc()).all()


@router.put("/half-day-requests/{request_id}", response_model=HalfDayOut)
def decide_half_day(
    request_id: int,
    payload: HalfDayDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin approves or rejects a half day request."""
    if payload.status not in ("Approved", "Rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'Approved' or 'Rejected'")

    half_day_request = db.query(HalfDayRequestModel).filter(HalfDayRequestModel.id == request_id).first()
    if not half_day_request:
        raise HTTPException(status_code=404, detail="Half day request not found")
    if half_day_request.status != "Pending":
        raise HTTPException(status_code=400, detail="This request has already been processed")

    if payload.status == "Approved":
        _apply_half_day(
            db,
            half_day_request.user_id,
            half_day_request.attendance_date,
            half_day_request.slot,
            half_day_request.reason,
            marked_by=current_user.id,
        )

    half_day_request.status = payload.status
    half_day_request.approved_by = current_user.id
    half_day_request.approved_at = datetime.now()
    db.commit()
    db.refresh(half_day_request)

    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity=f"{payload.status} half day request #{half_day_request.id}",
        )
    )
    db.commit()

    return half_day_request


@router.post("/half-day/{user_id}", response_model=HalfDayOut, status_code=201)
def admin_request_half_day_for_user(
    user_id: int,
    payload: HalfDayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """
    Admin/SuperAdmin requests a half day on behalf of an employee.
    Creates a request with AUTO-APPROVED status.
    """
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if payload.slot not in HALF_DAY_SLOTS:
        raise HTTPException(status_code=400, detail="Slot must be 'morning' or 'afternoon'")

    # Check for existing request
    existing = (
        db.query(HalfDayRequestModel)
        .filter(
            HalfDayRequestModel.user_id == user_id,
            HalfDayRequestModel.attendance_date == payload.attendance_date,
            HalfDayRequestModel.status.in_(["Pending", "Approved"]),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This user already has a half day request for that date.")

    # Create request with AUTO-APPROVED status
    half_day_request = HalfDayRequestModel(
        user_id=user_id,
        attendance_date=payload.attendance_date, 
        slot=payload.slot,
        reason=payload.reason,
        status="Approved",
        approved_by=current_user.id,
        approved_at=datetime.now(),
    )
    db.add(half_day_request)
    
    # Mark attendance immediately
    _apply_half_day(
        db,
        user_id,
        payload.attendance_date,
        payload.slot,
        payload.reason,
        marked_by=current_user.id,
    )
    
    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity=f"Auto-approved half day ({payload.slot}) for {target_user.name} on {payload.attendance_date}",
        )
    )
    db.commit()
    db.refresh(half_day_request)
    
    return half_day_request
