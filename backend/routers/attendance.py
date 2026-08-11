"""
routers/attendance.py
Check-in / check-out (restricted to approved office IPs for ALL users),
attendance history, calendar view, monthly summaries, and half-day marking.
Late check-ins (after 10:30 AM) and early check-outs (before 6:30 PM) 
require a reason.
"""

from datetime import date, datetime, time, timedelta
from typing import List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_

from auth import get_current_user, require_roles, require_admin
from database import get_db
from models import (
    Attendance,
    OfficeIP,
    User,
    ActivityLog,
    Holiday,
    HalfDayRequest as HalfDayRequestModel,
    LeaveRequest,
    LeaveRequestAllocation,
    DailyReportData,
    DailyReport,
    WFHRequest as WFHRequestModel,
    WorkingSunday,
)
from schemas import (
    AttendanceOut,
    AttendanceManualUpdate,
    HalfDayCreate,
    HalfDayDecision,
    HalfDayOut,
    CheckInRequest,
    CheckOutRequest,
    WFHCreate,
    WFHDecision,
    WFHOut,
    WorkingSundayCreate,
    WorkingSundayOut,
)
from utils.attendance_status import (
    calculate_status,
    calculate_half_day,
    is_weekly_off,
    determine_attendance_status_for_date,
    update_summary_counts,
)
from utils.email_service import send_wfh_decision_notification
from utils.calender import build_month_calendar
from utils.date_helpers import iso_with_offset
from utils.leave_calculator import (
    LEAVE_TRACKING_START_DATE,
    accrue_monthly_leave,
    has_approved_or_pending_paid_leave_this_month,
)

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
    """Return True if the client IP is configured as an active office IP."""
    office_ips = db.query(OfficeIP).filter(OfficeIP.status == "active").all()
    if not office_ips:
        # Never disable network validation globally just because an office IP
        # is missing or has been deactivated. Approved WFH is the only
        # per-user exception and is checked separately in check-in/out.
        return False

    approved = db.query(OfficeIP).filter(
        OfficeIP.ip_address == ip_address,
        OfficeIP.status == "active"
    ).first()
    return approved is not None


def _has_approved_wfh(db: Session, user_id: int, target_date: date) -> bool:
    """Check if user has an approved WFH request for the given date."""
    wfh = db.query(WFHRequestModel).filter(
        WFHRequestModel.user_id == user_id,
        WFHRequestModel.attendance_date == target_date,
        WFHRequestModel.status == "Approved",
    ).first()
    return wfh is not None


def _has_pending_wfh(db: Session, user_id: int, target_date: date) -> bool:
    """Check if user has a pending WFH request for the given date."""
    wfh = db.query(WFHRequestModel).filter(
        WFHRequestModel.user_id == user_id,
        WFHRequestModel.attendance_date == target_date,
        WFHRequestModel.status == "Pending",
    ).first()
    return wfh is not None


def _has_attendance_record(db: Session, user_id: int, target_date: date) -> bool:
    """Check whether attendance has already been marked for the given date."""
    existing = db.query(Attendance).filter(
        Attendance.user_id == user_id,
        Attendance.attendance_date == target_date,
        or_(Attendance.check_in.isnot(None), Attendance.check_out.isnot(None)),
    ).first()
    return existing is not None


def _is_working_sunday(db: Session, user_id: int, target_date: date) -> bool:
    """Return True if the user is marked as working for this Sunday date."""
    if target_date.weekday() != 6:
        return False
    entry = db.query(WorkingSunday).filter(WorkingSunday.user_id == user_id, WorkingSunday.work_date == target_date).first()
    return entry is not None


def _format_attendance_status(record: Attendance, db: Session) -> str:
    # If admin manually overrode, respect stored status
    if getattr(record, "manual_override", False):
        return record.status
    # WFH takes precedence otherwise
    if _has_approved_wfh(db, record.user_id, record.attendance_date):
        return "WFH"
    return record.status


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


def _load_report_dates_for_user(db: Session, user_id: int, dates: set[date]) -> set[date]:
    if not dates:
        return set()

    report_dates = set(
        r[0]
        for r in db.query(DailyReportData.attendance_date)
        .filter(
            DailyReportData.user_id == user_id,
            DailyReportData.attendance_date.in_(dates)
        )
        .all()
    )
    legacy_dates = set(
        r[0]
        for r in db.query(DailyReport.attendance_date)
        .filter(
            DailyReport.user_id == user_id,
            DailyReport.attendance_date.in_(dates),
            DailyReport.status == "submitted"
        )
        .all()
    )
    return report_dates.union(legacy_dates)


def _load_approved_wfh_dates_for_user(db: Session, user_id: int, dates: set[date]) -> set[date]:
    if not dates:
        return set()

    return set(
        r[0]
        for r in db.query(WFHRequestModel.attendance_date)
        .filter(
            WFHRequestModel.user_id == user_id,
            WFHRequestModel.attendance_date.in_(dates),
            WFHRequestModel.status == "Approved",
        )
        .all()
    )


def _format_attendance_status_with_cache(record: Attendance, approved_wfh_keys: Set[Tuple[int, date]]) -> str:
    if getattr(record, "manual_override", False):
        return record.status
    if (record.user_id, record.attendance_date) in approved_wfh_keys:
        return "WFH"
    return record.status


def _load_report_keys_for_users(db: Session, user_ids: Set[int], dates: Set[date]) -> Set[Tuple[int, date]]:
    if not user_ids or not dates:
        return set()

    report_keys = set(
        db.query(DailyReportData.user_id, DailyReportData.attendance_date)
        .filter(
            DailyReportData.user_id.in_(user_ids),
            DailyReportData.attendance_date.in_(dates)
        )
        .distinct()
        .all()
    )
    legacy_keys = set(
        db.query(DailyReport.user_id, DailyReport.attendance_date)
        .filter(
            DailyReport.user_id.in_(user_ids),
            DailyReport.attendance_date.in_(dates),
            DailyReport.status == "submitted"
        )
        .distinct()
        .all()
    )
    return report_keys.union(legacy_keys)


def _load_approved_wfh_keys_for_users(db: Session, user_ids: Set[int], dates: Set[date]) -> Set[Tuple[int, date]]:
    if not user_ids or not dates:
        return set()

    return set(
        db.query(WFHRequestModel.user_id, WFHRequestModel.attendance_date)
        .filter(
            WFHRequestModel.user_id.in_(user_ids),
            WFHRequestModel.attendance_date.in_(dates),
            WFHRequestModel.status == "Approved",
        )
        .distinct()
        .all()
    )


def _load_working_sunday_keys_for_users(db: Session, user_ids: Set[int], dates: Set[date]) -> Set[Tuple[int, date]]:
    if not user_ids or not dates:
        return set()

    return set(
        db.query(WorkingSunday.user_id, WorkingSunday.work_date)
        .filter(
            WorkingSunday.user_id.in_(user_ids),
            WorkingSunday.work_date.in_(dates),
        )
        .distinct()
        .all()
    )


def _load_holiday_dates(db: Session, dates: Set[date]) -> Set[date]:
    if not dates:
        return set()

    return set(
        r[0]
        for r in db.query(Holiday.holiday_date)
        .filter(Holiday.holiday_date.in_(dates))
        .all()
    )


def _load_approved_leave_keys_for_users(db: Session, user_ids: Set[int], start_date: date, end_date: date) -> Set[Tuple[int, date]]:
    if not user_ids:
        return set()

    approved_leave_keys = set()
    leaves = db.query(LeaveRequest).filter(
        LeaveRequest.user_id.in_(user_ids),
        LeaveRequest.status == "Approved",
        LeaveRequest.from_date <= end_date,
        LeaveRequest.to_date >= start_date,
    ).all()

    for leave in leaves:
        leave_start = max(leave.from_date, start_date)
        leave_end = min(leave.to_date, end_date)
        current = leave_start
        while current <= leave_end:
            approved_leave_keys.add((leave.user_id, current))
            current += timedelta(days=1)

    return approved_leave_keys


def _load_manual_override_leave_categories(db: Session, attendance_ids: Set[int]) -> dict[int, str]:
    if not attendance_ids:
        return {}
    return {
        leave.manual_override_attendance_id: leave.leave_category
        for leave in db.query(LeaveRequest).filter(
            LeaveRequest.manual_override_attendance_id.in_(attendance_ids)
        ).all()
    }


def _get_active_user_ids(db: Session) -> Set[int]:
    return {
        user_id
        for (user_id,) in db.query(User.id)
        .filter(User.status == "active")
        .all()
    }


def _get_date_range(start_date: date, end_date: date) -> list[date]:
    dates = []
    current_date = start_date
    while current_date <= end_date:
        dates.append(current_date)
        current_date += timedelta(days=1)
    return dates


def _get_month_date_range(year: int, month: int) -> Tuple[date, date]:
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)
    return start_date, end_date


def _mark_absent_records_for_date_range(
    db: Session,
    start_date: date,
    end_date: date,
    user_ids: Optional[Set[int]] = None,
):
    if start_date > end_date:
        return

    if user_ids is None:
        user_ids = _get_active_user_ids(db)

    if not user_ids:
        return

    today = date.today()
    all_dates = [d for d in _get_date_range(start_date, end_date) if d < today]
    if not all_dates:
        return

    holiday_dates = _load_holiday_dates(db, set(all_dates))
    approved_wfh_keys = _load_approved_wfh_keys_for_users(db, user_ids, set(all_dates))
    approved_leave_keys = _load_approved_leave_keys_for_users(db, user_ids, all_dates[0], all_dates[-1])

    existing_attendance = db.query(Attendance.user_id, Attendance.attendance_date).filter(
        Attendance.user_id.in_(user_ids),
        Attendance.attendance_date.in_(all_dates),
    ).all()
    existing_pairs = {(user_id, attendance_date) for user_id, attendance_date in existing_attendance}

    # Older deployments may contain duplicate synthetic Absent rows. Keep a
    # real check-in/out record when present, otherwise retain one record only.
    duplicate_groups = db.query(
        Attendance.user_id, Attendance.attendance_date, func.count(Attendance.id)
    ).filter(
        Attendance.user_id.in_(user_ids), Attendance.attendance_date.in_(all_dates)
    ).group_by(Attendance.user_id, Attendance.attendance_date).having(func.count(Attendance.id) > 1).all()
    for duplicate_user_id, duplicate_date, _ in duplicate_groups:
        rows = db.query(Attendance).filter(
            Attendance.user_id == duplicate_user_id, Attendance.attendance_date == duplicate_date
        ).order_by(Attendance.check_in.is_(None), Attendance.id.desc()).all()
        for duplicate in rows[1:]:
            if duplicate.status == "Absent" and duplicate.check_in is None and duplicate.check_out is None:
                db.delete(duplicate)
    if duplicate_groups:
        db.commit()

    new_records = []
    for user_id in user_ids:
        for target_date in all_dates:
            if (user_id, target_date) in existing_pairs:
                continue
            if target_date in holiday_dates:
                continue
            if (user_id, target_date) in approved_wfh_keys:
                continue
            if (user_id, target_date) in approved_leave_keys:
                continue
            if target_date.weekday() == 6 and not _is_working_sunday(db, user_id, target_date):
                continue
            if target_date.weekday() != 6 and is_weekly_off(target_date, db):
                continue

            new_records.append(
                Attendance(
                    user_id=user_id,
                    attendance_date=target_date,
                    status="Absent",
                )
            )

    if new_records:
        db.add_all(new_records)
        db.commit()


def _determine_attendance_status_for_record(
    db: Session,
    record: Attendance,
    approved_wfh_keys: Set[Tuple[int, date]],
    holiday_dates: Set[date],
) -> str:
    if getattr(record, "manual_override", False):
        return record.status
    if (record.user_id, record.attendance_date) in approved_wfh_keys:
        return "WFH"
    if record.attendance_date in holiday_dates:
        return "Holiday"
    if record.status == "On Leave":
        return "On Leave"
    if not record.check_in:
        return "Absent"
    if not record.check_out:
        return calculate_status(record.check_in, db)
    if calculate_half_day(record.check_in, record.check_out, db):
        return "Half Day"
    return calculate_status(record.check_in, db)


@router.post("/check-in", response_model=AttendanceOut)
def check_in(
    request: Request,
    payload: Optional[CheckInRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    today = ist_now.date()

    if _has_pending_wfh(db, current_user.id, today):
        raise HTTPException(
            status_code=400,
            detail="You have a pending WFH request for today. Please wait for approval before checking in."
        )

    ip_address = _get_client_ip(request, payload.ip_address if payload else None)

    # Skip office IP check if user has approved WFH or is marked working on this Sunday
    if not (_has_approved_wfh(db, current_user.id, today) or _is_working_sunday(db, current_user.id, today)):
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
        if not getattr(existing, "manual_override", False):
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

    return {
        "id": record.id,
        "user_id": record.user_id,
        "attendance_date": record.attendance_date.isoformat(),
        "check_in": iso_with_offset(record.check_in),
        "check_out": iso_with_offset(record.check_out),
        "status": determine_attendance_status_for_date(db, record.user_id, record.attendance_date),
        "ip_address": record.ip_address,
        "reason": record.reason,
        "created_at": iso_with_offset(record.created_at),
        "has_report": _has_report_for_date(db, record.user_id, record.attendance_date),
        "is_working_sunday": _is_working_sunday(db, record.user_id, record.attendance_date),
    }


@router.post("/check-out", response_model=AttendanceOut)
def check_out(
    request: Request,
    payload: Optional[CheckOutRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    today = ist_now.date()

    if _has_pending_wfh(db, current_user.id, today):
        raise HTTPException(
            status_code=400,
            detail="You have a pending WFH request for today. Please wait for approval before checking out."
        )

    ip_address = _get_client_ip(request, payload.ip_address if payload else None)

    # Skip office IP check if user has approved WFH or is marked working on this Sunday
    if not (_has_approved_wfh(db, current_user.id, today) or _is_working_sunday(db, current_user.id, today)):
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
    if record.check_in and record.check_out and not getattr(record, "manual_override", False):
        check_in_val = record.check_in
        check_out_val = record.check_out
        if check_in_val.tzinfo is None:
            check_in_val = check_in_val.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
        if check_out_val.tzinfo is None:
            check_out_val = check_out_val.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
        hours_worked = (check_out_val - check_in_val).total_seconds() / 3600
        if hours_worked < 4.5 and record.status not in ("Holiday", "Half Day"):
            record.status = "Half Day"

    db.add(ActivityLog(user_id=current_user.id, activity=f"Checked out from {ip_address}"))
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "user_id": record.user_id,
        "attendance_date": record.attendance_date.isoformat(),
        "check_in": iso_with_offset(record.check_in),
        "check_out": iso_with_offset(record.check_out),
        "status": _format_attendance_status(record, db),
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
    target_start = None
    target_end = None

    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        target_start = target_end = target_date
        query = query.filter(Attendance.attendance_date == target_date)
    elif month and year:
        target_start, target_end = _get_month_date_range(year, month)
        query = query.filter(
            Attendance.attendance_date >= target_start,
            Attendance.attendance_date <= target_end,
        )

    if target_start is not None and target_end is not None:
        _mark_absent_records_for_date_range(db, target_start, target_end, {current_user.id})

    records = query.order_by(Attendance.attendance_date.desc()).all()
    attendance_dates = {attendance.attendance_date for attendance in records}
    approved_wfh_keys = _load_approved_wfh_keys_for_users(db, {current_user.id}, attendance_dates)
    holiday_dates = _load_holiday_dates(db, attendance_dates)
    report_keys = _load_report_keys_for_users(db, {current_user.id}, attendance_dates)
    working_sunday_keys = _load_working_sunday_keys_for_users(db, {current_user.id}, attendance_dates)
    manual_leave_categories = _load_manual_override_leave_categories(db, {attendance.id for attendance in records})

    results = []
    for attendance in records:
        results.append({
            "id": attendance.id,
            "user_id": attendance.user_id,
            "attendance_date": attendance.attendance_date.isoformat(),
            "check_in": iso_with_offset(attendance.check_in),
            "check_out": iso_with_offset(attendance.check_out),
            "status": _determine_attendance_status_for_record(db, attendance, approved_wfh_keys, holiday_dates),
            "leave_category": manual_leave_categories.get(attendance.id),
            "ip_address": attendance.ip_address,
            "reason": attendance.reason,
            "created_at": iso_with_offset(attendance.created_at),
            "has_report": (attendance.user_id, attendance.attendance_date) in report_keys,
            "is_working_sunday": (attendance.user_id, attendance.attendance_date) in working_sunday_keys,
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
    target_start = None
    target_end = None

    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        target_start = target_end = target_date
        query = query.filter(Attendance.attendance_date == target_date)
    elif month and year:
        target_start, target_end = _get_month_date_range(year, month)
        query = query.filter(
            Attendance.attendance_date >= target_start,
            Attendance.attendance_date <= target_end,
        )

    if target_start is not None and target_end is not None:
        _mark_absent_records_for_date_range(db, target_start, target_end, {user_id})

    records = query.order_by(Attendance.attendance_date.desc()).all()
    attendance_dates = {attendance.attendance_date for attendance in records}
    approved_wfh_keys = _load_approved_wfh_keys_for_users(db, {user_id}, attendance_dates)
    holiday_dates = _load_holiday_dates(db, attendance_dates)
    report_keys = _load_report_keys_for_users(db, {user_id}, attendance_dates)
    working_sunday_keys = _load_working_sunday_keys_for_users(db, {user_id}, attendance_dates)
    manual_leave_categories = _load_manual_override_leave_categories(db, {attendance.id for attendance in records})

    results = []
    for attendance in records:
        results.append({
            "id": attendance.id,
            "user_id": attendance.user_id,
            "attendance_date": attendance.attendance_date.isoformat(),
            "check_in": iso_with_offset(attendance.check_in),
            "check_out": iso_with_offset(attendance.check_out),
            "status": _determine_attendance_status_for_record(db, attendance, approved_wfh_keys, holiday_dates),
            "leave_category": manual_leave_categories.get(attendance.id),
            "ip_address": attendance.ip_address,
            "reason": attendance.reason,
            "created_at": iso_with_offset(attendance.created_at),
            "has_report": (attendance.user_id, attendance.attendance_date) in report_keys,
            "is_working_sunday": (attendance.user_id, attendance.attendance_date) in working_sunday_keys,
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
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    employee_ids: Optional[List[int]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Get attendance for all employees (admin only)"""
    query = db.query(
        Attendance,
        User.name,
        User.department
    ).join(User, Attendance.user_id == User.id)

    target_start = None
    target_end = None
    if from_date is not None and to_date is not None:
        if from_date > to_date:
            raise HTTPException(status_code=400, detail="from_date cannot be after to_date")
        query = query.filter(
            Attendance.attendance_date >= from_date,
            Attendance.attendance_date <= to_date,
        )
        target_start, target_end = from_date, to_date
    elif date_value is not None:
        query = query.filter(Attendance.attendance_date == date_value)
        target_start = target_end = date_value
    else:
        query = query.filter(
            func.extract('year', Attendance.attendance_date) == year,
            func.extract('month', Attendance.attendance_date) == month
        )
        target_start, target_end = _get_month_date_range(year, month)

    if employee_ids:
        query = query.filter(Attendance.user_id.in_(employee_ids))

    if target_start is not None and target_end is not None:
        _mark_absent_records_for_date_range(
            db,
            target_start,
            target_end,
            set(employee_ids) if employee_ids else None,
        )

    query = query.order_by(Attendance.attendance_date, User.name)
    
    results = query.all()
    user_ids = {attendance.user_id for attendance, _, _ in results}
    attendance_dates = {attendance.attendance_date for attendance, _, _ in results}
    report_keys = _load_report_keys_for_users(db, user_ids, attendance_dates)
    approved_wfh_keys = _load_approved_wfh_keys_for_users(db, user_ids, attendance_dates)
    holiday_dates = _load_holiday_dates(db, attendance_dates)

    working_sunday_keys = _load_working_sunday_keys_for_users(db, user_ids, attendance_dates)
    manual_leave_categories = _load_manual_override_leave_categories(
        db, {attendance.id for attendance, _, _ in results}
    )

    # Format the response with user details
    formatted_results = []
    for attendance, user_name, department in results:
        has_report = (attendance.user_id, attendance.attendance_date) in report_keys

        formatted_results.append({
            "id": attendance.id,
            "user_id": attendance.user_id,
            "user_name": user_name,
            "department": department,
            "attendance_date": attendance.attendance_date.isoformat(),
            "check_in": iso_with_offset(attendance.check_in),
            "check_out": iso_with_offset(attendance.check_out),
            "status": _determine_attendance_status_for_record(db, attendance, approved_wfh_keys, holiday_dates),
            "leave_category": manual_leave_categories.get(attendance.id),
            "ip_address": attendance.ip_address,
            "reason": attendance.reason,
            "has_report": has_report,
            "is_working_sunday": (attendance.user_id, attendance.attendance_date) in working_sunday_keys,
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
    employee_ids: Optional[List[int]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merges the day-type calendar (holidays/weekly-offs) with attendance records.

    Admin users may request a specific user calendar by user_id, or an aggregated
    all-employees calendar by passing user_id=-1.
    """
    is_admin_user = current_user.role in ("admin", "superadmin")
    aggregated_all = (user_id == -1 or bool(employee_ids)) and is_admin_user
    target_user_id = None

    if aggregated_all:
        target_user_id = None
    else:
        target_user_id = user_id if (user_id and is_admin_user) else current_user.id

    if target_user_id is not None:
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

    records_query = db.query(Attendance).filter(
        Attendance.attendance_date >= start_date,
        Attendance.attendance_date < end_date,
    )

    if not aggregated_all:
        records_query = records_query.filter(Attendance.user_id == target_user_id)
    elif employee_ids:
        records_query = records_query.filter(Attendance.user_id.in_(employee_ids))

    records = records_query.all()
    manual_leave_categories = _load_manual_override_leave_categories(db, {record.id for record in records})

    # Create a map of date -> attendance records for the calendar.
    records_by_date = {}
    for r in records:
        date_key = r.attendance_date.isoformat()
        if date_key in records_by_date:
            records_by_date[date_key].append(r)
        else:
            records_by_date[date_key] = [r]

    for day in calendar_days:
        date_key = day["date"]
        day_records = records_by_date.get(date_key, [])

        if day_records:
            if aggregated_all:
                any_present = any(r.check_in or r.check_out for r in day_records)
                day["status"] = "Present" if any_present else "Absent"
                day["check_in"] = None
                day["check_out"] = None
            else:
                record = day_records[0]
                day["status"] = determine_attendance_status_for_date(db, record.user_id, record.attendance_date)
                day["leave_category"] = manual_leave_categories.get(record.id)
                day["is_manual_override"] = bool(record.manual_override)
                day["check_in"] = iso_with_offset(record.check_in)
                day["check_out"] = iso_with_offset(record.check_out)
        else:
            if day["day_type"] == "holiday":
                day["status"] = "Holiday"
            elif day["day_type"] == "weekly_off":
                day["status"] = "Weekly Off"
            else:
                day["status"] = "Absent"
            day["check_in"] = None
            day["check_out"] = None
            day["leave_category"] = None
            day["is_manual_override"] = False

    return calendar_days


def _add_monthly_summary_counts(summary: dict, status: str, attendance_record) -> None:
    """Update monthly attendance summary counts for a single attendance record."""
    if status == "Holiday":
        summary["Holiday"] += 1
        return
    update_summary_counts(summary, status)


@router.get("/summary/{user_id}")
def monthly_summary(
    user_id: int,
    year: Optional[int] = Query(None, ge=2020),
    month: Optional[int] = Query(None, ge=1, le=12),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "user" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if from_date and to_date:
        if from_date > to_date:
            raise HTTPException(status_code=400, detail="from_date cannot be after to_date")
        start_date = from_date
        end_date = to_date + timedelta(days=1)
    else:
        if year is None or month is None:
            raise HTTPException(
                status_code=400,
                detail="year and month are required unless from_date and to_date are provided",
            )
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)

    _mark_absent_records_for_date_range(db, start_date, end_date - timedelta(days=1), {user_id})

    records = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user_id,
            Attendance.attendance_date >= start_date,
            Attendance.attendance_date < end_date,
        )
        .all()
    )

    approved_wfh_dates = {
        wfh.attendance_date
        for wfh in db.query(WFHRequestModel)
        .filter(
            WFHRequestModel.user_id == user_id,
            WFHRequestModel.attendance_date >= start_date,
            WFHRequestModel.attendance_date < end_date,
            WFHRequestModel.status == "Approved",
        )
        .all()
    }

    approved_leave_dates = set()
    approved_unpaid_leave_dates = set()
    for leave in db.query(LeaveRequest).filter(
        LeaveRequest.user_id == user_id,
        LeaveRequest.status == "Approved",
        LeaveRequest.from_date <= end_date,
        LeaveRequest.to_date >= start_date,
    ).all():
        leave_start = max(leave.from_date, start_date)
        leave_end = min(leave.to_date, end_date - timedelta(days=1))
        current_date = leave_start
        while current_date <= leave_end:
            approved_leave_dates.add(current_date)
            if leave.leave_category == "Unpaid":
                approved_unpaid_leave_dates.add(current_date)
            current_date += timedelta(days=1)

    # Summary counts
    summary = {"Present": 0, "Half Day": 0, "Holiday": 0, "Absent": 0, "WFH": 0, "Leave": 0}

    # Calculate total working hours
    total_hours = 0.0

    processed_dates = set()
    for r in records:
        status = determine_attendance_status_for_date(db, user_id, r.attendance_date)
        processed_dates.add(r.attendance_date)
        _add_monthly_summary_counts(summary, status, r)

        # Calculate working hours
        if r.check_in and r.check_out:
            hours = (r.check_out - r.check_in).total_seconds() / 3600
            total_hours += hours

    for wfh_date in approved_wfh_dates - processed_dates:
        summary["WFH"] += 1

    for leave_date in approved_leave_dates - processed_dates:
        if leave_date in approved_wfh_dates:
            continue
        summary["Leave"] += 1
        summary["Absent"] += 1

    summary["Total Hours"] = round(total_hours, 2)

    return summary


# ============================================================
# ADMIN MANUAL UPDATE
# ============================================================
MANUAL_LEAVE_CATEGORIES = {"Paid", "Privilege", "Carried", "Unpaid"}


def _sync_manual_override_leave(
    db: Session,
    record: Attendance,
    leave_category: Optional[str],
    current_user: User,
) -> None:
    """Create, update, or remove the leave record owned by an attendance override."""
    if record.id is None:
        db.flush()
    manual_leave = db.query(LeaveRequest).filter(
        LeaveRequest.manual_override_attendance_id == record.id
    ).first()

    if record.status != "On Leave":
        if manual_leave:
            if manual_leave.leave_category == "Carried":
                user = db.query(User).filter(User.id == record.user_id).with_for_update().first()
                user.carried_leave = (user.carried_leave or 0) + 1
            elif manual_leave.leave_category == "Privilege":
                user = db.query(User).filter(User.id == record.user_id).with_for_update().first()
                user.annual_leave = (user.annual_leave or 0) + 1
            db.delete(manual_leave)
        return

    if leave_category not in MANUAL_LEAVE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail="A valid leave category is required when status is On Leave.",
        )

    user = db.query(User).filter(User.id == record.user_id).with_for_update().first()
    old_category = manual_leave.leave_category if manual_leave else None
    if (
        leave_category == "Paid"
        and old_category != "Paid"
        and (
            record.attendance_date < LEAVE_TRACKING_START_DATE
            or has_approved_or_pending_paid_leave_this_month(db, record.user_id, record.attendance_date)
        )
    ):
        raise HTTPException(status_code=400, detail="No Paid leave balance is available for this override.")

    old_carried_days = 1 if old_category == "Carried" else 0
    new_carried_days = 1 if leave_category == "Carried" else 0
    available_carried = (user.carried_leave or 0) + old_carried_days
    if new_carried_days > available_carried:
        raise HTTPException(status_code=400, detail="Insufficient carried leave balance for this override.")
    user.carried_leave = (user.carried_leave or 0) + old_carried_days - new_carried_days

    old_privilege_days = 1 if old_category == "Privilege" else 0
    new_privilege_days = 1 if leave_category == "Privilege" else 0
    available_privilege = (user.annual_leave or 0) + old_privilege_days
    if new_privilege_days > available_privilege:
        raise HTTPException(status_code=400, detail="Insufficient privilege leave balance for this override.")
    user.annual_leave = (user.annual_leave or 0) + old_privilege_days - new_privilege_days

    if manual_leave:
        for allocation in list(manual_leave.allocations):
            db.delete(allocation)
        db.flush()
        manual_leave.leave_category = leave_category
        manual_leave.approved_by = current_user.id
        manual_leave.approved_at = datetime.now(ZoneInfo("Asia/Kolkata"))
        manual_leave.allocations = [
            LeaveRequestAllocation(allocation_date=record.attendance_date, leave_category=leave_category)
        ]
        return

    manual_leave = LeaveRequest(
        user_id=record.user_id,
        from_date=record.attendance_date,
        to_date=record.attendance_date,
        total_days=1,
        reason="Manual attendance override",
        status="Approved",
        leave_category=leave_category,
        approved_by=current_user.id,
        approved_at=datetime.now(ZoneInfo("Asia/Kolkata")),
        manual_override_attendance_id=record.id,
    )
    manual_leave.allocations = [
        LeaveRequestAllocation(allocation_date=record.attendance_date, leave_category=leave_category)
    ]
    db.add(manual_leave)


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
    leave_category = update_data.pop("leave_category", None)
    if update_data.get("status") == "On Leave":
        target_user = db.query(User).filter(User.id == record.user_id).first()
        accrue_monthly_leave(db, target_user)
    for field, value in update_data.items():
        setattr(record, field, value)
    # If admin provided a status, mark this as a manual override so automatic calc won't replace it
    if "status" in update_data:
        record.manual_override = True
        record.manual_override_by = current_user.id
        record.manual_override_at = datetime.now(ZoneInfo("Asia/Kolkata"))
        _sync_manual_override_leave(db, record, leave_category, current_user)
    record.updated_by = current_user.id

    db.add(ActivityLog(user_id=current_user.id, activity=f"Manually updated attendance #{attendance_id}"))
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "user_id": record.user_id,
        "attendance_date": record.attendance_date.isoformat(),
        "check_in": iso_with_offset(record.check_in),
        "check_out": iso_with_offset(record.check_out),
        "status": _format_attendance_status(record, db),
        "leave_category": _load_manual_override_leave_categories(db, {record.id}).get(record.id),
        "ip_address": record.ip_address,
        "reason": record.reason,
        "created_at": iso_with_offset(record.created_at),
        "has_report": _has_report_for_date(db, record.user_id, record.attendance_date),
        "is_working_sunday": _is_working_sunday(db, record.user_id, record.attendance_date),
    }



@router.put("/user/{user_id}/date/{date_value}", response_model=AttendanceOut)
def manual_update_by_user_date(
    user_id: int,
    date_value: str,
    payload: AttendanceManualUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin manual override by user and date. Creates attendance record if missing."""
    try:
        target_date = date.fromisoformat(date_value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    record = db.query(Attendance).filter(Attendance.user_id == user_id, Attendance.attendance_date == target_date).first()
    update_data = payload.model_dump(exclude_unset=True)
    leave_category = update_data.pop("leave_category", None)
    if update_data.get("status") == "On Leave":
        accrue_monthly_leave(db, user)
    if record:
        for field, value in update_data.items():
            setattr(record, field, value)
    else:
        record = Attendance(
            user_id=user_id,
            attendance_date=target_date,
            check_in=update_data.get("check_in"),
            check_out=update_data.get("check_out"),
            status=update_data.get("status") or "Absent",
        )
        db.add(record)

    if "status" in update_data:
        record.manual_override = True
        record.manual_override_by = current_user.id
        record.manual_override_at = datetime.now(ZoneInfo("Asia/Kolkata"))
        _sync_manual_override_leave(db, record, leave_category, current_user)

    record.updated_by = current_user.id
    db.add(ActivityLog(user_id=current_user.id, activity=f"Manually updated attendance for user #{user_id} on {target_date}"))
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "user_id": record.user_id,
        "attendance_date": record.attendance_date.isoformat(),
        "check_in": iso_with_offset(record.check_in),
        "check_out": iso_with_offset(record.check_out),
        "status": _format_attendance_status(record, db),
        "leave_category": _load_manual_override_leave_categories(db, {record.id}).get(record.id),
        "ip_address": record.ip_address,
        "reason": record.reason,
        "created_at": iso_with_offset(record.created_at),
        "has_report": _has_report_for_date(db, record.user_id, record.attendance_date),
        "is_working_sunday": _is_working_sunday(db, record.user_id, record.attendance_date),
    }


# ============================================================
# HALF DAY - INTERNAL HELPER
# ============================================================
def _apply_half_day(
    db: Session, user_id: int, attendance_date, slot: str, reason: Optional[str], marked_by: Optional[int] = None
) -> Attendance:
    if slot not in HALF_DAY_SLOTS:
        raise HTTPException(status_code=400, detail="Slot must be 'morning' or 'afternoon'")

    if _has_approved_wfh(db, user_id, attendance_date):
        raise HTTPException(status_code=400, detail="Cannot apply a half day on a date with an approved WFH request.")

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

    if _has_approved_wfh(db, current_user.id, payload.attendance_date):
        raise HTTPException(status_code=400, detail="Cannot request a half day on a date with an approved WFH request.")

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
    query = db.query(HalfDayRequestModel).options(joinedload(HalfDayRequestModel.user))
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
    
    query = db.query(HalfDayRequestModel).options(joinedload(HalfDayRequestModel.user)).filter(HalfDayRequestModel.user_id == user_id)
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
        if _has_approved_wfh(db, half_day_request.user_id, half_day_request.attendance_date):
            raise HTTPException(
                status_code=400,
                detail="Cannot approve a half day request on a date with an approved WFH request."
            )
        if _has_pending_wfh(db, half_day_request.user_id, half_day_request.attendance_date):
            raise HTTPException(
                status_code=400,
                detail="Cannot approve a half day request while a WFH request is pending for the same date."
            )

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
    half_day_request.approved_at = datetime.now(ZoneInfo("Asia/Kolkata"))
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

    if _has_approved_wfh(db, user_id, payload.attendance_date):
        raise HTTPException(status_code=400, detail="Cannot request a half day on a date with an approved WFH request.")

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

    if db.query(WFHRequestModel).filter(
        WFHRequestModel.user_id == user_id,
        WFHRequestModel.attendance_date == payload.attendance_date,
        WFHRequestModel.status.in_(["Pending", "Approved"]),
    ).first():
        raise HTTPException(status_code=400, detail="Cannot request a half day on a date with an existing WFH request.")

    # Create request with AUTO-APPROVED status
    half_day_request = HalfDayRequestModel(
        user_id=user_id,
        attendance_date=payload.attendance_date, 
        slot=payload.slot,
        reason=payload.reason,
        status="Approved",
        approved_by=current_user.id,
        approved_at=datetime.now(ZoneInfo("Asia/Kolkata")),
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


@router.post("/working-sunday", response_model=dict, status_code=201)
def mark_working_sunday(
    payload: WorkingSundayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Mark a specific user's Sunday as a working day. Payload: {"user_id": int, "work_date": "YYYY-MM-DD"} """
    user_id = payload.user_id
    work_date = payload.work_date
    if work_date.weekday() != 6:
        raise HTTPException(status_code=400, detail="work_date must be a Sunday")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.query(WorkingSunday).filter(WorkingSunday.user_id == user_id, WorkingSunday.work_date == work_date).first()
    if existing:
        return {"message": "Already marked"}

    entry = WorkingSunday(user_id=user_id, work_date=work_date, marked_by=current_user.id)
    db.add(entry)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Marked working Sunday for user #{user_id} on {work_date}"))
    db.commit()
    return {"message": "Marked as working Sunday"}


@router.delete("/working-sunday", response_model=dict)
def unmark_working_sunday(
    user_id: int = Query(...),
    work_date: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    try:
        work_date_parsed = date.fromisoformat(work_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    entry = db.query(WorkingSunday).filter(WorkingSunday.user_id == user_id, WorkingSunday.work_date == work_date_parsed).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Working Sunday not found")
    db.delete(entry)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Unmarked working Sunday for user #{user_id} on {work_date_parsed}"))
    db.commit()
    return {"message": "Unmarked"}

# ============================================================
# WORK FROM HOME (WFH) - EMPLOYEE REQUEST
# ============================================================
@router.post("/wfh", response_model=WFHOut, status_code=201)
def request_wfh(
    payload: WFHCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Employee requests WFH for a specific date — creates a Pending request.

    Remote attendance is allowed from any network only after admin approval
    for the requested date.
    """
    ist_today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    if payload.attendance_date < ist_today:
        raise HTTPException(status_code=400, detail="Cannot request WFH for a past date.")

    if _has_attendance_record(db, current_user.id, payload.attendance_date):
        raise HTTPException(status_code=400, detail="Cannot request WFH for a date on which attendance is already marked.")

    existing_pending = (
        db.query(WFHRequestModel)
        .filter(
            WFHRequestModel.user_id == current_user.id,
            WFHRequestModel.attendance_date == payload.attendance_date,
            WFHRequestModel.status == "Pending",
        )
        .first()
    )
    if existing_pending:
        raise HTTPException(status_code=400, detail="You already have a pending WFH request for that date.")

    existing_approved = (
        db.query(WFHRequestModel)
        .filter(
            WFHRequestModel.user_id == current_user.id,
            WFHRequestModel.attendance_date == payload.attendance_date,
            WFHRequestModel.status == "Approved",
        )
        .first()
    )
    if existing_approved:
        raise HTTPException(status_code=400, detail="You already have an approved WFH request for that date.")

    wfh_request = WFHRequestModel(
        user_id=current_user.id,
        attendance_date=payload.attendance_date,
        reason=payload.reason,
        status="Pending",
    )
    db.add(wfh_request)
    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity=f"Requested WFH for {payload.attendance_date}",
        )
    )
    db.commit()
    db.refresh(wfh_request)
    return wfh_request


@router.get("/wfh/me", response_model=List[WFHOut])
def my_wfh_requests(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's WFH requests, optional month filter."""
    query = db.query(WFHRequestModel).filter(WFHRequestModel.user_id == current_user.id)
    if month and year:
        start_date = date(year, month, 1)
        end_date = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        query = query.filter(
            WFHRequestModel.attendance_date >= start_date,
            WFHRequestModel.attendance_date < end_date,
        )
    return query.order_by(WFHRequestModel.requested_at.desc()).all()


@router.get("/wfh", response_model=List[WFHOut])
def all_wfh_requests(
    status_filter: Optional[str] = None,
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin gets all WFH requests, optional status/month filter."""
    query = db.query(WFHRequestModel).options(joinedload(WFHRequestModel.user))
    if status_filter:
        query = query.filter(WFHRequestModel.status == status_filter)
    if month and year:
        start_date = date(year, month, 1)
        end_date = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        query = query.filter(
            WFHRequestModel.attendance_date >= start_date,
            WFHRequestModel.attendance_date < end_date,
        )
    return query.order_by(WFHRequestModel.requested_at.desc()).all()


@router.get("/wfh/user/{user_id}", response_model=List[WFHOut])
def get_user_wfh_requests(
    user_id: int,
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin gets WFH requests for a specific user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(WFHRequestModel).options(joinedload(WFHRequestModel.user)).filter(WFHRequestModel.user_id == user_id)
    if month and year:
        start_date = date(year, month, 1)
        end_date = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        query = query.filter(
            WFHRequestModel.attendance_date >= start_date,
            WFHRequestModel.attendance_date < end_date,
        )
    return query.order_by(WFHRequestModel.requested_at.desc()).all()


@router.put("/wfh/{request_id}", response_model=WFHOut)
def decide_wfh(
    request_id: int,
    payload: WFHDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """Admin approves or rejects a WFH request."""
    if payload.status not in ("Approved", "Rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'Approved' or 'Rejected'")

    wfh_request = db.query(WFHRequestModel).filter(WFHRequestModel.id == request_id).first()
    if not wfh_request:
        raise HTTPException(status_code=404, detail="WFH request not found")
    if wfh_request.status != "Pending":
        raise HTTPException(status_code=400, detail="This request has already been processed")

    ist_today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    if wfh_request.attendance_date < ist_today:
        raise HTTPException(status_code=400, detail="Cannot approve or reject WFH requests for past dates.")

    if _has_attendance_record(db, wfh_request.user_id, wfh_request.attendance_date):
        raise HTTPException(status_code=400, detail="Cannot approve WFH when attendance is already recorded for that date.")

    if db.query(HalfDayRequestModel).filter(
        HalfDayRequestModel.user_id == wfh_request.user_id,
        HalfDayRequestModel.attendance_date == wfh_request.attendance_date,
        HalfDayRequestModel.status.in_(["Pending", "Approved"]),
    ).first():
        raise HTTPException(
            status_code=400,
            detail="Cannot approve WFH when a half day request exists for the same date."
        )

    wfh_request.status = payload.status
    wfh_request.approved_by = current_user.id
    wfh_request.approved_at = datetime.now(ZoneInfo("Asia/Kolkata"))
    db.commit()
    db.refresh(wfh_request)

    employee = db.query(User).filter(User.id == wfh_request.user_id).first()
    if employee and employee.email:
        send_wfh_decision_notification(
            employee.email,
            employee.name,
            payload.status,
            wfh_request.attendance_date,
            wfh_request.reason,
        )

    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity=f"{payload.status} WFH request #{wfh_request.id}",
        )
    )
    db.commit()

    return wfh_request


@router.post("/wfh/{user_id}", response_model=WFHOut, status_code=201)
def admin_request_wfh_for_user(
    user_id: int,
    payload: WFHCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
):
    """
    Admin/SuperAdmin requests WFH on behalf of an employee.
    Creates a request with AUTO-APPROVED status (same pattern as half day).
    """
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    ist_today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    if payload.attendance_date < ist_today:
        raise HTTPException(status_code=400, detail="Cannot create WFH for a past date.")

    existing = (
        db.query(WFHRequestModel)
        .filter(
            WFHRequestModel.user_id == user_id,
            WFHRequestModel.attendance_date == payload.attendance_date,
            WFHRequestModel.status.in_(["Pending", "Approved"]),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This user already has a WFH request for that date.")

    if db.query(HalfDayRequestModel).filter(
        HalfDayRequestModel.user_id == user_id,
        HalfDayRequestModel.attendance_date == payload.attendance_date,
        HalfDayRequestModel.status.in_(["Pending", "Approved"]),
    ).first():
        raise HTTPException(status_code=400, detail="Cannot create WFH for a date with an existing half day request.")

    wfh_request = WFHRequestModel(
        user_id=user_id,
        attendance_date=payload.attendance_date,
        reason=payload.reason,
        status="Approved",
        approved_by=current_user.id,
        approved_at=datetime.now(ZoneInfo("Asia/Kolkata")),
    )
    db.add(wfh_request)

    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity=f"Auto-approved WFH for {target_user.name} on {payload.attendance_date}",
        )
    )
    db.commit()
    db.refresh(wfh_request)

    return wfh_request
