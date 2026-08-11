"""
utils/attendance_status.py
Helper functions for determining attendance status.
"""

from datetime import date, datetime, time
from sqlalchemy.orm import Session
from models import Attendance, CompanySettings, Holiday, WFHRequest, WorkingSunday


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


def determine_attendance_status_for_date(db: Session, user_id: int, target_date: date) -> str:
    """
    Determine attendance status for a user on a specific date.
    Returns: 'Present', 'Late', 'Half Day', 'Absent', 'Holiday', 'WFH', or 'On Leave'
    """
    # A manual admin override is the final status, including on a date that
    # also has WFH, holiday, or leave workflow data.
    attendance = db.query(Attendance).filter(
        Attendance.user_id == user_id,
        Attendance.attendance_date == target_date
    ).first()
    if attendance and getattr(attendance, "manual_override", False):
        return attendance.status

    # Check if approved WFH exists for this date
    wfh = db.query(WFHRequest).filter(
        WFHRequest.user_id == user_id,
        WFHRequest.attendance_date == target_date,
        WFHRequest.status == "Approved",
    ).first()
    if wfh:
        return "WFH"

    is_assigned_working_day = db.query(WorkingSunday).filter(
        WorkingSunday.user_id == user_id,
        WorkingSunday.work_date == target_date,
    ).first() is not None

    # A holiday remains a holiday unless this employee was explicitly assigned
    # to work that date.
    holiday = db.query(Holiday).filter(Holiday.holiday_date == target_date).first()
    if holiday and not is_assigned_working_day:
        return "Holiday"

    if attendance and attendance.status == "On Leave":
        return "On Leave"

    if not attendance or not attendance.check_in:
        # If it's a weekly off and the user is not explicitly marked as working, return Weekly Off
        if is_weekly_off(target_date, db):
            # check working sunday override
            if target_date.weekday() == 6:
                ws = db.query(WorkingSunday).filter(WorkingSunday.user_id == user_id, WorkingSunday.work_date == target_date).first()
                if not ws:
                    return "Weekly Off"
            else:
                return "Weekly Off"
        return "Absent"
    
    # Get company settings
    settings = db.query(CompanySettings).first()
    start_time_str = settings.office_start_time if settings else "10:00"
    grace_minutes = settings.late_grace_minutes if settings else 15
    
    try:
        start_hour, start_min = map(int, start_time_str.split(":"))
    except:
        start_hour, start_min = 10, 0
    
    check_in_time = attendance.check_in
    check_out_time = attendance.check_out
    
    # If no check-out, status depends only on check-in
    if not check_out_time:
        check_in_min = check_in_time.hour * 60 + check_in_time.minute
        start_total_min = start_hour * 60 + start_min
        grace_total_min = start_total_min + grace_minutes
        
        if check_in_min <= grace_total_min:
            return "Present"
        else:
            return "Late"
    
    # Calculate working hours
    working_hours = (check_out_time - check_in_time).total_seconds() / 3600

    # Check if it's a half day based only on worked hours.
    if working_hours < 4.5:
        return "Half Day"

    check_in_min = check_in_time.hour * 60 + check_in_time.minute
    start_total_min = start_hour * 60 + start_min
    grace_total_min = start_total_min + grace_minutes

    if check_in_min <= grace_total_min:
        return "Present"
    else:
        return "Late"


def calculate_working_hours(check_in: datetime, check_out: datetime) -> float:
    """Calculate hours worked between check-in and check-out."""
    if not check_in or not check_out:
        return 0.0
    delta = check_out - check_in
    return round(delta.total_seconds() / 3600, 2)


def calculate_status(check_in_time: datetime, db: Session) -> str:
    """Calculate attendance status based on check-in time."""
    settings = db.query(CompanySettings).first()
    start_time_str = settings.office_start_time if settings else "10:00"
    grace_minutes = settings.late_grace_minutes if settings else 15
    
    try:
        start_hour, start_min = map(int, start_time_str.split(":"))
    except:
        start_hour, start_min = 10, 0
    
    check_in_min = check_in_time.hour * 60 + check_in_time.minute
    start_total_min = start_hour * 60 + start_min
    grace_total_min = start_total_min + grace_minutes
    
    if check_in_min <= grace_total_min:
        return "Present"
    else:
        return "Late"


def calculate_half_day(check_in: datetime, check_out: datetime, db: Session) -> bool:
    """Check if a day is a half day based on check-in/out times."""
    if not check_in or not check_out:
        return False
    hours = calculate_working_hours(check_in, check_out)
    return hours < 4.5


def update_summary_counts(summary: dict, status: str) -> None:
    """Update monthly summary counters from a final attendance status."""
    if status in {"Present", "Late"}:
        summary["Present"] += 1
        if status == "Late":
            summary["Late"] += 1
    elif status == "Half Day":
        summary["Half Day"] += 1
        summary["Present"] += 1
    elif status == "WFH":
        summary["WFH"] += 1
        summary["Present"] += 1
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
