"""
routers/reports.py
Attendance table/calendar reports, employee-wise summaries (now including
Paid/LWP/Privilege leave and carry-forward/encashment status), leave
summary, CSV export, and Daily Reports for admins.
"""

import csv
import io
from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import require_admin, get_current_user
from database import get_db
from models import (
    Attendance, User, LeaveRequest, LeaveEncashmentRequest,
    DailyReport, ReportDepartment, ReportType, ReportSubtype
)
from utils.leave_calculator import get_used_paid_leave_days, get_remaining_leave, accrue_monthly_leave

router = APIRouter()


# ============================================================
# HELPER FUNCTIONS FOR REPORT FORMATTING
# ============================================================

def _format_single_report(report: DailyReport, db: Session) -> str:
    """
    Format a single report for display.
    """
    if not report:
        return ""
    
    # Get department name
    dept = db.query(ReportDepartment).filter(ReportDepartment.id == report.department_id).first()
    dept_name = dept.name if dept else "Unknown"
    
    # HR and IT - plain description
    if dept_name in ["HR", "IT"]:
        return f"{dept_name}: {report.description or 'No description'}"
    
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
    if report.quantity is not None and report.quantity != 0:
        details.append(f"Qty: {report.quantity}")
    if report.duration and report.duration.strip():
        details.append(f"Duration: {report.duration}")
    
    if details:
        result += f" ({', '.join(details)})"
    
    return result


def get_all_reports_for_date(db: Session, user_id: int, target_date: date) -> str:
    """
    Get all reports for a specific user and date, formatted for display.
    """
    reports = db.query(DailyReport).filter(
        DailyReport.user_id == user_id,
        DailyReport.attendance_date == target_date,
        DailyReport.status == "submitted"
    ).all()
    
    if not reports:
        return "Not Submitted"
    
    # Format each report and join with newline
    formatted_reports = []
    for report in reports:
        formatted = _format_single_report(report, db)
        if formatted:
            formatted_reports.append(formatted)
    
    if not formatted_reports:
        return "Not Submitted"
    
    return "\n".join(formatted_reports)


# ============================================================
# ATTENDANCE REPORTS
# ============================================================

@router.get("/attendance")
def attendance_report(
    year: int,
    month: int,
    department: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = db.query(Attendance).join(User).filter(
        Attendance.attendance_date.between(date(year, month, 1), date(year, month, 28))
    )
    if department:
        query = query.filter(User.department == department)

    records = query.all()
    result = []
    for r in records:
        # Get all reports for this date
        report_display = get_all_reports_for_date(db, r.user_id, r.attendance_date)
        result.append({
            "user_id": r.user_id,
            "user_name": r.user.name,
            "department": r.user.department,
            "date": r.attendance_date.isoformat(),
            "check_in": r.check_in.isoformat() if r.check_in else None,
            "check_out": r.check_out.isoformat() if r.check_out else None,
            "status": r.status,
            "reason": r.reason,
            "report": report_display,
        })
    
    return result


@router.get("/attendance/export")
def export_attendance_csv(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    records = (
        db.query(Attendance)
        .join(User)
        .filter(Attendance.attendance_date.between(date(year, month, 1), date(year, month, 28)))
        .all()
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Employee", "Department", "Date", "Check In", "Check Out", "Total Hours", "Status", "Report"])
    for r in records:
        total_hours = ""
        if r.check_in and r.check_out:
            minutes = int((r.check_out - r.check_in).total_seconds() // 60)
            total_hours = f"{minutes // 60}h {minutes % 60}m"
        
        # Get all reports for this date
        report_display = get_all_reports_for_date(db, r.user_id, r.attendance_date)

        writer.writerow(
            [
                r.user.name,
                r.user.department,
                r.attendance_date.isoformat(),
                r.check_in.isoformat() if r.check_in else "",
                r.check_out.isoformat() if r.check_out else "",
                total_hours,
                r.status,
                report_display.replace("\n", " | "),
            ]
        )
    buffer.seek(0)

    filename = f"attendance_report_{year}_{month:02d}.csv"
    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ============================================================
# EMPLOYEE SUMMARY
# ============================================================

@router.get("/employee-summary")
def employee_wise_summary(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    One row per active employee, covering the given month:
    attendance counts, Paid/LWP(Unpaid)/Privilege leave days taken, their
    current Carry Forward balance, and whether they have any pending or
    approved Encashment request on record.
    """
    users = db.query(User).filter(User.status == "active").all()
    results = []

    for user in users:
        accrue_monthly_leave(db, user)

        records = (
            db.query(Attendance)
            .filter(
                Attendance.user_id == user.id,
                Attendance.attendance_date.between(date(year, month, 1), date(year, month, 28)),
            )
            .all()
        )
        summary = {"Present": 0, "Late": 0, "Half Day": 0, "Absent": 0}
        for r in records:
            if r.status == "Holiday":
                continue
            summary[r.status] = summary.get(r.status, 0) + 1

        leave_requests_this_month = (
            db.query(LeaveRequest)
            .filter(
                LeaveRequest.user_id == user.id,
                LeaveRequest.status == "Approved",
                LeaveRequest.from_date <= date(year, month, 28),
                LeaveRequest.to_date >= date(year, month, 1),
            )
            .all()
        )
        paid_leave_days = sum(
            (lr.total_days or 0) for lr in leave_requests_this_month if lr.leave_category == "Paid"
        )
        carried_leave_used_days = sum(
            (lr.total_days or 0) for lr in leave_requests_this_month if lr.leave_category == "Carried"
        )
        lwp_days = sum(
            (lr.total_days or 0) for lr in leave_requests_this_month if lr.leave_category == "Unpaid"
        )
        privilege_leave_days = sum(
            (lr.total_days or 0) for lr in leave_requests_this_month if lr.leave_category == "Privilege"
        )

        used_paid_this_month = paid_leave_days > 0
        has_encashment_on_record = (
            db.query(LeaveEncashmentRequest)
            .filter(
                LeaveEncashmentRequest.user_id == user.id,
                LeaveEncashmentRequest.status.in_(["Pending", "Approved"]),
            )
            .first()
            is not None
        )

        results.append(
            {
                "user_id": user.id,
                "name": user.name,
                "department": user.department,
                **summary,
                "Paid Leave": paid_leave_days,
                "Carried Leave Used": carried_leave_used_days,
                "LWP": lwp_days,
                "Privilege Leave": privilege_leave_days,
                "Carry Forward Balance": user.carried_leave or 0,
                "Used Paid Leave This Month": used_paid_this_month,
                "Encashed": 1 if has_encashment_on_record else 0,
            }
        )

    return results


# ============================================================
# LEAVE SUMMARY
# ============================================================

@router.get("/leave-summary")
def leave_summary(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    users = db.query(User).filter(User.status == "active").all()
    results = []
    for user in users:
        accrue_monthly_leave(db, user)
        used = get_used_paid_leave_days(db, user.id)
        remaining = get_remaining_leave(db, user)
        results.append(
            {
                "user_id": user.id,
                "name": user.name,
                "department": user.department,
                "carried_leave": user.carried_leave or 0,
                "used_leave": used,
                "leave_encashed": user.leave_encashed or 0,
                "remaining_leave": remaining,
            }
        )
    return results


# ============================================================
# DAILY REPORTS - GET REPORTS FOR A USER
# ============================================================

@router.get("/user/{user_id}")
def get_user_reports(
    user_id: int,
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get reports for a specific user for a given month."""
    if current_user.role not in ["admin", "superadmin"] and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1)
    else:
        end_date = date(year, month + 1, 1)
    
    # Get all attendance records for the user
    attendance_records = db.query(Attendance).filter(
        Attendance.user_id == user_id,
        Attendance.attendance_date >= start_date,
        Attendance.attendance_date < end_date
    ).all()
    
    result = []
    for att in attendance_records:
        report_display = get_all_reports_for_date(db, user_id, att.attendance_date)
        result.append({
            "attendance_date": att.attendance_date.isoformat(),
            "report_display": report_display
        })
    
    return result


# ============================================================
# DAILY REPORTS - GET ALL REPORTS (Admin)
# ============================================================

@router.get("/all")
def get_all_reports(
    year: Optional[int] = Query(None, ge=2020, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    user_id: Optional[int] = Query(None),
    department_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Admin gets all reports with optional filters."""
    query = db.query(DailyReport).filter(DailyReport.status == "submitted")
    
    if year and month:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            DailyReport.attendance_date >= start_date,
            DailyReport.attendance_date < end_date
        )
    
    if user_id:
        query = query.filter(DailyReport.user_id == user_id)
    
    if department_id:
        query = query.filter(DailyReport.department_id == department_id)
    
    reports = query.order_by(DailyReport.attendance_date.desc()).all()
    
    # Group reports by user and date to avoid duplicates
    grouped = {}
    for report in reports:
        key = (report.user_id, report.attendance_date)
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(report)
    
    result = []
    for (user_id, attendance_date), report_list in grouped.items():
        user = db.query(User).filter(User.id == user_id).first()
        
        # Get all reports for this date
        report_display = get_all_reports_for_date(db, user_id, attendance_date)
        
        # Get the first report's department info
        first_report = report_list[0]
        
        result.append({
            "id": first_report.id,
            "user_id": user_id,
            "user_name": user.name if user else "Unknown",
            "user_department": user.department if user else "Unknown",
            "attendance_date": attendance_date.isoformat(),
            "department_id": first_report.department_id,
            "type_id": first_report.type_id,
            "subtype_id": first_report.subtype_id,
            "quantity": first_report.quantity,
            "duration": first_report.duration,
            "description": first_report.description,
            "status": first_report.status,
            "report_display": report_display,
            "created_at": first_report.created_at.isoformat() if first_report.created_at else None,
        })
    
    return result


# ============================================================
# DAILY REPORTS - GET REPORT HIERARCHY
# ============================================================

@router.get("/hierarchy")
def get_report_hierarchy(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get the complete report hierarchy (departments → types → subtypes) for the frontend form."""
    departments = db.query(ReportDepartment).order_by(ReportDepartment.name).all()
    
    result = []
    for dept in departments:
        dept_data = {
            "id": dept.id,
            "name": dept.name,
            "is_plain": dept.name in ["HR", "IT"],
            "types": []
        }
        
        if dept.name not in ["HR", "IT"]:
            types = db.query(ReportType).filter(
                ReportType.department_id == dept.id
            ).order_by(ReportType.sort_order).all()
            
            for t in types:
                subtypes = db.query(ReportSubtype).filter(
                    ReportSubtype.type_id == t.id
                ).order_by(ReportSubtype.sort_order).all()
                
                dept_data["types"].append({
                    "id": t.id,
                    "name": t.name,
                    "subtypes": [
                        {
                            "id": s.id,
                            "name": s.name,
                            "has_quantity": s.has_quantity,
                            "has_duration": s.has_duration,
                        }
                        for s in subtypes
                    ]
                })
        
        result.append(dept_data)
    
    return result


# ============================================================
# DAILY REPORTS - SUBMIT REPORT
# ============================================================

@router.post("/submit", status_code=201)
def submit_report(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Submit a daily report."""
    user_id = payload.get("user_id") if current_user.role in ["admin", "superadmin"] else current_user.id
    
    if current_user.role not in ["admin", "superadmin"]:
        user_id = current_user.id
    
    attendance_date = payload.get("attendance_date")
    department_id = payload.get("department_id")
    type_id = payload.get("type_id")
    subtype_id = payload.get("subtype_id")
    quantity = payload.get("quantity")
    duration = payload.get("duration")
    description = payload.get("description")
    
    if not attendance_date or not department_id:
        raise HTTPException(status_code=400, detail="Missing required fields")
    
    # Create new report
    report = DailyReport(
        user_id=user_id,
        attendance_date=attendance_date,
        department_id=department_id,
        type_id=type_id if type_id else None,
        subtype_id=subtype_id if subtype_id else None,
        quantity=quantity if quantity is not None else None,
        duration=duration if duration else None,
        description=description if description else None,
        status="submitted"
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    
    return {"message": "Report submitted successfully", "report_id": report.id}