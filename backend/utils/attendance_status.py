"""
utils/attendance_status.py
Helper functions for determining attendance status.
"""

import json
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from models import Attendance, ChangedLog, CompanySettings, Holiday, LeaveRequest, TeamMember, User, WFHRequest, WorkingSunday


IST = ZoneInfo("Asia/Kolkata")


def holiday_applies_to_user(db: Session, holiday: Holiday, user_id: int) -> bool:
    if holiday.applies_to == "all_users":
        return True
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    if holiday.applies_to == "office":
        return (user.attendance_mode or "office").lower() == "office"
    if holiday.applies_to == "onsite":
        return (user.attendance_mode or "office").lower() == "onsite"
    if holiday.applies_to == "specific_users":
        return user_id in json.loads(holiday.target_user_ids_json or "[]")
    if holiday.applies_to == "specific_teams":
        team_ids = json.loads(holiday.target_team_ids_json or "[]")
        return db.query(TeamMember.id).filter(
            TeamMember.employee_id == user_id,
            TeamMember.team_id.in_(team_ids),
        ).first() is not None
    return False


def applicable_holiday(db: Session, user_id: int, target_date: date) -> Holiday | None:
    return next(
        (holiday for holiday in db.query(Holiday).filter(Holiday.holiday_date == target_date).all()
         if holiday_applies_to_user(db, holiday, user_id)),
        None,
    )


def get_default_office_times(db: Session):
    """Get office start and end times from settings, with defaults."""
    settings = db.query(CompanySettings).first()
    if settings:
        return settings.office_start_time, settings.office_end_time, settings.late_grace_minutes
    return "10:00", "18:30", 15


def get_company_settings(db: Session):
    """Get company settings from database."""
    return db.query(CompanySettings).first()


def get_today_attendance_status(db: Session, user_id: int, target_date: date) -> str:
    """Return the attendance status for a user on a specific date."""
    return determine_attendance_status_for_date(db, user_id, target_date)


def load_grace_change_history(db: Session) -> list[ChangedLog]:
    """Return grace-period changes in chronological order for reuse per request/batch."""
    return (
        db.query(ChangedLog)
        .filter(
            ChangedLog.category == "settings",
            ChangedLog.item_name == "Late Grace Minutes",
        )
        .order_by(ChangedLog.created_at.asc(), ChangedLog.id.asc())
        .all()
    )


def determine_attendance_status_for_date(
    db: Session,
    user_id: int,
    target_date: date,
    *,
    grace_history: list[ChangedLog] | None = None,
) -> str:
    """
    Determine attendance status for a user on a specific date.
    Returns: 'Present', 'Late', 'Half Day', 'Absent', 'Holiday', 'WFH', or 'On Leave'
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user and user.date_of_joining and target_date < user.date_of_joining:
        return "Not Started"

    # A manual admin override is the final status, including on a date that
    # also has WFH, holiday, or leave workflow data.
    # Historical data may contain more than one row for a date.  A manual
    # override is authoritative even when an older automatic row also exists.
    attendance = db.query(Attendance).filter(
        Attendance.user_id == user_id,
        Attendance.attendance_date == target_date
    ).order_by(Attendance.manual_override.desc(), Attendance.id.desc()).first()
    if attendance and getattr(attendance, "manual_override", False):
        status = attendance.status
        if status == "Extra Working Day":
            return "Extra Working Day"
        if holiday := applicable_holiday(db, user_id, target_date):
            is_assigned_working_day = db.query(WorkingSunday).filter(
                WorkingSunday.user_id == user_id,
                WorkingSunday.work_date == target_date,
                WorkingSunday.removed_at.is_(None),
            ).first() is not None
            if is_assigned_working_day and status in {"Present", "Late", "Half Day"}:
                return "Extra Working Day"
        return status

    is_assigned_working_day = db.query(WorkingSunday).filter(
        WorkingSunday.user_id == user_id,
        WorkingSunday.work_date == target_date,
        WorkingSunday.removed_at.is_(None),
    ).first() is not None

    holiday = applicable_holiday(db, user_id, target_date)
    # An approved WFH request permits remote attendance, but does not by
    # itself prove that the employee worked. Only classify the day as WFH
    # after attendance activity has been recorded.
    wfh = db.query(WFHRequest).filter(
        WFHRequest.user_id == user_id,
        WFHRequest.attendance_date == target_date,
        WFHRequest.status == "Approved",
    ).first()
    if wfh and attendance and (attendance.check_in or attendance.check_out):
        return "Extra Working Day" if holiday and is_assigned_working_day else "WFH"

    # A holiday remains a holiday unless this employee was explicitly assigned
    # to work that date.
    if holiday and not is_assigned_working_day:
        return "Holiday"

    if attendance and getattr(attendance, "manual_override", False):
        status = attendance.status
        if holiday and is_assigned_working_day and status in {"Present", "Late", "Half Day"}:
            return "Extra Working Day"
        return status

    if attendance and attendance.status == "On Leave":
        approved_leaves = db.query(LeaveRequest).filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status == "Approved",
            LeaveRequest.from_date <= target_date,
            LeaveRequest.to_date >= target_date,
        ).all()
        for approved_leave in approved_leaves:
            if (
                not approved_leave.allocations
                and (approved_leave.total_days or 0) > 0
            ) or any(
                allocation.allocation_date == target_date
                and not allocation.is_cancelled
                for allocation in approved_leave.allocations
            ):
                return "On Leave"

    if user and (getattr(user, "attendance_mode", None) or "office").lower() == "onsite" and attendance and attendance.check_in:
        return "Extra Working Day" if holiday and is_assigned_working_day else "Present"

    if not attendance or not attendance.check_in:
        # If it's a weekly off and the user is not explicitly marked as working, return Weekly Off
        if is_weekly_off(target_date, db):
            # check working sunday override
            if target_date.weekday() == 6:
                ws = db.query(WorkingSunday).filter(
                    WorkingSunday.user_id == user_id,
                    WorkingSunday.work_date == target_date,
                    WorkingSunday.removed_at.is_(None),
                ).first()
                if not ws:
                    return "Weekly Off"
            else:
                return "Weekly Off"
        approved_leaves = db.query(LeaveRequest).filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status == "Approved",
            LeaveRequest.from_date <= target_date,
            LeaveRequest.to_date >= target_date,
        ).all()
        for approved_leave in approved_leaves:
            if approved_leave.allocations:
                if any(
                    allocation.allocation_date == target_date
                    and not allocation.is_cancelled
                    for allocation in approved_leave.allocations
                ):
                    return "On Leave"
            elif (approved_leave.total_days or 0) > 0:
                return "On Leave"
        return "Absent"
    
    check_in_time = attendance.check_in
    check_out_time = attendance.check_out
    if check_out_time:
        working_hours = (check_out_time - check_in_time).total_seconds() / 3600
        if working_hours < 4.5:
            return "Extra Working Day" if holiday and is_assigned_working_day else "Half Day"

    settings = db.query(CompanySettings).first()
    current_grace_minutes = settings.late_grace_minutes if settings else 30
    grace_minutes = _effective_grace_minutes_for_check_in(
        db,
        check_in_time,
        current_grace_minutes,
        grace_history=grace_history,
    )
    cutoff_minutes = get_late_cutoff_minutes(settings, grace_minutes)

    status = "Present" if not is_late(check_in_time, cutoff_minutes) else "Late"
    return "Extra Working Day" if holiday and is_assigned_working_day and status in {"Present", "Late"} else status


def calculate_working_hours(check_in: datetime, check_out: datetime) -> float:
    """Calculate hours worked between check-in and check-out."""
    if not check_in or not check_out:
        return 0.0
    delta = check_out - check_in
    return round(delta.total_seconds() / 3600, 2)


def _effective_grace_minutes_for_check_in(
    db: Session,
    check_in_time: datetime,
    current_grace_minutes: int,
    *,
    grace_history: list[ChangedLog] | None = None,
) -> int:
    """Resolve the grace period from setting-change history at check-in time."""
    check_in_instant = check_in_time
    if check_in_instant.tzinfo is None:
        # Attendance DATETIME values are interpreted as IST wall time; changed-log
        # TIMESTAMP values are interpreted as UTC by the changed-log API.
        check_in_instant = check_in_instant.replace(tzinfo=IST)
    check_in_utc = check_in_instant.astimezone(timezone.utc).replace(tzinfo=None)

    if grace_history is None:
        grace_history = load_grace_change_history(db)

    prior_changes = [
        change for change in grace_history
        if change.created_at is not None and change.created_at <= check_in_utc
    ]
    if prior_changes:
        value = prior_changes[-1].new_value
    else:
        if not grace_history:
            return current_grace_minutes
        value = grace_history[0].old_value

    try:
        grace_minutes = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid late-grace setting history value: {value!r}") from error
    if grace_minutes < 0:
        raise ValueError(f"Invalid negative late-grace setting history value: {value!r}")
    return grace_minutes


def get_late_cutoff_minutes(
    settings: CompanySettings | None,
    grace_minutes: int | None = None,
) -> int:
    """Return the configured grace cutoff as minutes after midnight."""
    office_start_time = settings.office_start_time if settings else time(10, 0)
    if grace_minutes is None:
        grace_minutes = settings.late_grace_minutes if settings else 30
    return office_start_time.hour * 60 + office_start_time.minute + grace_minutes


def is_late(check_in_time: datetime, cutoff_minutes: int) -> bool:
    """Treat the entire cutoff minute as within the grace period."""
    check_in_minutes = check_in_time.hour * 60 + check_in_time.minute
    return check_in_minutes > cutoff_minutes


def calculate_status(
    check_in_time: datetime,
    db: Session,
    *,
    grace_history: list[ChangedLog] | None = None,
) -> str:
    """Calculate attendance status based on check-in time."""
    settings = db.query(CompanySettings).first()
    if settings is not None and grace_history is not None:
        resolved_grace = _effective_grace_minutes_for_check_in(
            db,
            check_in_time,
            settings.late_grace_minutes,
            grace_history=grace_history,
        )
        cutoff_minutes = get_late_cutoff_minutes(settings, resolved_grace)
    else:
        cutoff_minutes = get_late_cutoff_minutes(settings)
    return "Late" if is_late(check_in_time, cutoff_minutes) else "Present"


def calculate_half_day(check_in: datetime, check_out: datetime, db: Session) -> bool:
    """Check if a day is a half day based on check-in/out times."""
    if not check_in or not check_out:
        return False
    hours = calculate_working_hours(check_in, check_out)
    return hours < 4.5


def update_summary_counts(summary: dict, status: str) -> None:
    """Update monthly summary counters from a final attendance status.
    
    Counting rules:
    - Late = Present + Late (both counters)
    - WFH = Present + WFH (both counters)
    - Extra Working Day = Present + Extra Working Day
    - Half Day = Present + Half Day (already correct)
    - On Leave = Leave + Absent (only for non-overridden leaves)
    - Present = Present only
    - Absent = Absent only
    """
    if status == "Present":
        summary["Present"] += 1
    elif status == "Late":
        summary["Late"] += 1
        summary["Present"] += 1
    elif status == "Half Day":
        summary["Half Day"] += 1
        summary["Present"] += 1
    elif status == "WFH":
        summary["WFH"] += 1
        summary["Present"] += 1
    elif status == "Extra Working Day":
        summary["Present"] += 1
        summary["Extra Working Day"] += 1
    elif status == "On Leave":
        summary["Leave"] += 1
        summary["Absent"] += 1
    elif status == "Absent":
        summary["Absent"] += 1


def is_weekly_off(target_date: date, db: Session) -> bool:
    """
    Check if a date is a weekly off day based on company settings.
    """
    settings = db.query(CompanySettings).first()
    if not settings or not settings.weekly_off_day:
        return False
    
    day_name = target_date.strftime("%A")
    return day_name.lower() == settings.weekly_off_day.lower()
