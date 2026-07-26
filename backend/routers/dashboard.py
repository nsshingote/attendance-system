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
    DailyReport, ReportDepartment, ReportType, ReportSubtype, DeviceRequest
)
from schemas import (
    AdminDashboardStats,
    EmployeeDashboardStats,
    TodayAttendanceOut
)
from auth import get_current_user, require_roles
from utils.attendance_status import get_today_attendance_status, determine_attendance_status_for_date
from utils.logger import log_activity

router = APIRouter()


def _get_report_for_date(db: Session, user_id: int, target_date: date) -> Optional[DailyReport]:
    """Get the report for a specific user and date."""
    return db.query(DailyReport).filter(
        DailyReport.user_id == user_id,
        DailyReport.attendance_date == target_date,
        DailyReport.status == "submitted"
    ).first()


def _format_report_display(report: Optional[DailyReport], db: Session) -> str:
    """
    Format the report for display in the attendance table.
    Returns formatted string based on department type.
    """
    if not report:
        return "❌ Not Submitted"
    
    # Get department name
    dept = db.query(ReportDepartment).filter(ReportDepartment.id == report.department_id).first()
    dept_name = dept.name if dept else "Unknown"
    
    # HR and IT - plain description
    if dept_name in ["HR", "IT"]:
        return f"{dept_name}\n{report.description or 'No description'}"
    
    # B2B and B2C - hierarchy with quantity/duration
    type_name = ""
    subtype_name = ""
    
    if report.type_id:
        report_type = db.query(ReportType).filter(ReportType.id == report.type_id).first()
        if report_type:
            type_name = report_type.name
    
    if report.subtype_id:
        report_subtype = db.query(ReportSubtype).filter(ReportSubtype.id == report.subtype_id).first()
        if report_subtype:
            subtype_name = report_subtype.name
    
    result = dept_name
    if type_name:
        result += f" → {type_name}"
    if subtype_name:
        result += f" → {subtype_name}"
    
    details = []
    if report.quantity is not None:
        details.append(f"Qty: {report.quantity}")
    if report.duration is not None:
        details.append(f"Duration: {report.duration}hrs")
    
    if details:
        result += f"\n{', '.join(details)}"
    
    return result


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
        check_in=today_attendance.check_in if today_attendance else None,
        check_out=today_attendance.check_out if today_attendance else None,
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
    today_attendance = db.query(Attendance).filter(
        Attendance.attendance_date == today
    ).all()
    
    present_count = sum(1 for a in today_attendance if a.status == "Present")
    half_day_count = sum(1 for a in today_attendance if a.status == "Half Day")
    late_count = sum(1 for a in today_attendance if a.status == "Late")
    
    # Check if today is a holiday
    is_holiday = db.query(Holiday).filter(Holiday.holiday_date == today).first() is not None
    
    # Count employees who have checked in
    checked_in_ids = {a.user_id for a in today_attendance if a.status in ["Present", "Half Day", "Late"]}
    absent_count = total_employees - len(checked_in_ids) - (total_employees if is_holiday else 0)
    
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
    
    # 7. Today's attendance table with reports
    today_records = []
    for emp in employees:
        att = next((a for a in today_attendance if a.user_id == emp.id), None)
        
        # Check if user has submitted a report for today
        report = _get_report_for_date(db, emp.id, today)
        report_display = _format_report_display(report, db)
        
        # Determine status
        status = att.status if att else ("Holiday" if is_holiday else "Absent")
        
        today_records.append(
            TodayAttendanceOut(
                user_id=emp.id,
                user_name=emp.name,
                department=emp.department,
                check_in=att.check_in if att else None,
                check_out=att.check_out if att else None,
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
        holiday_today=monthly_holidays,
        pending_leave_requests=pending_leave,
        pending_corrections=pending_corrections,
        pending_device_requests=pending_device_requests,
        monthly_leave_used=monthly_leave,
        today_attendance=today_records
    )