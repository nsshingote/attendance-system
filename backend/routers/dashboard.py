"""
routers/dashboard.py
Dashboard endpoints for admin and employee views.
"""

from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract
from typing import List, Optional

from database import get_db
from models import (
    User, Attendance, LeaveRequest, AttendanceCorrection, Holiday,
    DailyReportData, DailyReport, DeviceRequest
)
from schemas import (
    AdminDashboardStats,
    EmployeeDashboardStats,
    TodayAttendanceOut
)
from auth import get_current_user, require_roles
from utils.attendance_status import get_today_attendance_status, determine_attendance_status_for_date
from utils.logger import log_activity
from utils.date_helpers import iso_with_offset

router = APIRouter()


def _has_report_for_date(db: Session, user_id: int, target_date: date) -> bool:
    """Return whether the user has any saved report data for the given date."""
    data_report = (
        db.query(DailyReportData)
        .filter(
            DailyReportData.user_id == user_id,
            DailyReportData.attendance_date == target_date,
        )
        .first()
    )
    if data_report:
        return True

    legacy_report = (
        db.query(DailyReport)
        .filter(
            DailyReport.user_id == user_id,
            DailyReport.attendance_date == target_date,
            DailyReport.status == "submitted",
        )
        .first()
    )
    return legacy_report is not None


def _format_report_display(has_report: bool) -> str:
    """Return a simple display value for the attendance table."""
    return "Submitted" if has_report else "Not Submitted"


@router.get("/me", response_model=EmployeeDashboardStats)
def get_employee_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Employee dashboard stats with check-in/out status."""
    today = date.today()
    
    # Today's attendance
    today_attendance = db.query(Attendance).filter(
        Attendance.user_id == current_user.id,
        Attendance.attendance_date == today
    ).first()
    
    # Today's status
    status = get_today_attendance_status(db, current_user.id, today)
    
    # Pending leave requests
    pending_leave = db.query(LeaveRequest).filter(
        LeaveRequest.user_id == current_user.id,
        LeaveRequest.status == "Pending"
    ).count()
    
    # Pending corrections
    pending_corrections = db.query(AttendanceCorrection).filter(
        AttendanceCorrection.requested_by == current_user.id,
        AttendanceCorrection.status == "Pending"
    ).count()
    
    return EmployeeDashboardStats(
        user_id=current_user.id,
        user_name=current_user.name,
        today_status=status,
        check_in=iso_with_offset(today_attendance.check_in) if today_attendance and today_attendance.check_in else None,
        check_out=iso_with_offset(today_attendance.check_out) if today_attendance and today_attendance.check_out else None,
        pending_leave_requests=pending_leave,
        pending_corrections=pending_corrections
    )


@router.get("/admin", response_model=AdminDashboardStats)
def get_admin_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin dashboard stats with today's attendance table including report info."""
    today = date.today()
    start_of_month = date(today.year, today.month, 1)
    
    # Calculate end of month
    if today.month == 12:
        end_of_month = date(today.year + 1, 1, 1)
    else:
        end_of_month = date(today.year, today.month + 1, 1)
    
    # 1. Get all active employees
    employees = db.query(User).filter(User.status == "active").all()
    total_employees = len(employees)
    
    # 2. Today's attendance breakdown
    today_status_map = {
        emp.id: determine_attendance_status_for_date(db, emp.id, today)
        for emp in employees
    }
    present_count = sum(1 for status in today_status_map.values() if status in ["Present", "Late", "Half Day", "WFH"])
    half_day_count = sum(1 for status in today_status_map.values() if status == "Half Day")
    late_count = sum(1 for status in today_status_map.values() if status == "Late")
    wfh_count = sum(1 for status in today_status_map.values() if status == "WFH")

    # Check if today is a holiday
    is_holiday = db.query(Holiday).filter(Holiday.holiday_date == today).first() is not None

    absent_count = sum(
        1 for status in today_status_map.values()
        if status == "Absent"
    )
    
    # 3. Pending approvals
    pending_leave = db.query(LeaveRequest).filter(
        LeaveRequest.status == "Pending"
    ).count()
    
    pending_corrections = db.query(AttendanceCorrection).filter(
        AttendanceCorrection.status == "Pending"
    ).count()
    
    # 4. Pending device requests
    pending_device_requests = db.query(DeviceRequest).filter(
        DeviceRequest.status == "Pending"
    ).count()
    
    # 5. Monthly leave usage
    monthly_leave = db.query(LeaveRequest).filter(
        LeaveRequest.created_at >= start_of_month,
        LeaveRequest.status == "Approved"
    ).count()
    
    # 6. Get total holidays for the current month
    monthly_holidays = db.query(Holiday).filter(
        Holiday.holiday_date >= start_of_month,
        Holiday.holiday_date < end_of_month
    ).count()
    
    # 7. Today's attendance records and table with reports
    today_attendance = (
        db.query(Attendance)
        .filter(Attendance.attendance_date == today)
        .all()
    )

    today_records = []
    for emp in employees:
        att = next((a for a in today_attendance if a.user_id == emp.id), None)
        
        # Check if user has submitted a report for today
        has_report = _has_report_for_date(db, emp.id, today)
        report_display = _format_report_display(has_report)
        
        # Determine status
        status = determine_attendance_status_for_date(db, emp.id, today)
        
        today_records.append(
            TodayAttendanceOut(
                user_id=emp.id,
                user_name=emp.name,
                department=emp.department,
                check_in=iso_with_offset(att.check_in) if att and att.check_in else None,
                check_out=iso_with_offset(att.check_out) if att and att.check_out else None,
                status=status,
                reason=att.reason if att else None,
                report=report_display
            )
        )
    
    return AdminDashboardStats(
        total_employees=total_employees,
        present_today=present_count,
        absent_today=absent_count,
        half_day_today=half_day_count,
        late_today=late_count,
        wfh_today=wfh_count,
        holiday_today=monthly_holidays,
        pending_leave_requests=pending_leave,
        pending_corrections=pending_corrections,
        pending_device_requests=pending_device_requests,
        monthly_leave_used=monthly_leave,
        today_attendance=today_records
    )