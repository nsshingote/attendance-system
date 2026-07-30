
"""
routers/reports.py
Attendance table/calendar reports, employee-wise summaries (now including
Paid/LWP/Privilege leave and carry-forward/encashment status), leave
summary, CSV export, and Daily Reports for admins.
"""

import csv
import io
from datetime import date, datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from auth import require_admin, get_current_user, require_roles
from database import get_db
from models import (
    Attendance, User, LeaveRequest, LeaveEncashmentRequest,
    DailyReport, ReportDepartment, ReportType, ReportSubtype,
    Department, DynamicReportType, DynamicReportSubtype, DynamicReportField,
    ReportDefaultRow, UserDailyRow, DailyReportData, ActivityLog
)
from utils.leave_calculator import get_used_paid_leave_days, get_remaining_leave, accrue_monthly_leave
from utils.logger import log_activity
from utils.date_helpers import iso_with_offset

# ============================================================
# SCHEMAS IMPORT - ADD THIS
# ============================================================
from schemas import (
    ReportCreate, ReportOut, ReportWithUserOut, ReportStatusResponse,
    DepartmentCreate, DepartmentOut,
    DynamicReportTypeCreate, DynamicReportTypeOut,
    DynamicReportSubtypeCreate, DynamicReportSubtypeOut,
    DynamicReportFieldCreate, DynamicReportFieldOut,
    ReportDefaultRowCreate, ReportDefaultRowOut,
    UserDailyRowCreate, UserDailyRowOut,
    DailyReportDataCreate, DailyReportDataOut,
    ReportStructureResponse, UserDailyReportResponse
)

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
    # ✅ FIXED: Check DailyReportData table instead of DailyReport
    reports = db.query(DailyReportData).filter(
        DailyReportData.user_id == user_id,
        DailyReportData.attendance_date == target_date
    ).all()
    
    if not reports:
        return "Not Submitted"
    
    # Format each report
    formatted_reports = []
    for report in reports:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.department in ["HR", "IT"]:
            formatted_reports.append(report.description or "No description")
        else:
            subtype = db.query(DynamicReportSubtype).filter(DynamicReportSubtype.id == report.subtype_id).first()
            report_type = db.query(DynamicReportType).filter(DynamicReportType.id == subtype.type_id).first() if subtype else None
            
            parts = []
            if report_type and subtype:
                parts.append(f"{report_type.name} → {subtype.name}")
            elif subtype:
                parts.append(subtype.name)
            
            details = []
            if report.quantity is not None:
                details.append(f"Qty: {report.quantity}")
            if report.duration:
                details.append(f"Duration: {report.duration}")
            if details:
                parts.append(f"({', '.join(details)})")
            
            formatted_reports.append(" | ".join(parts) if parts else "No details")
    
    if not formatted_reports:
        return "Not Submitted"
    
    return "\n".join(formatted_reports)


def _normalize_department_name(value: Optional[str]) -> str:
    """Normalize department names for comparison."""
    return "".join(ch for ch in (value or "").lower() if ch.isalnum())


def _get_user_department_id(db: Session, user_id: int) -> int:
    """Get department ID for a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    normalized_user_dept = _normalize_department_name(user.department)
    if not normalized_user_dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Check if user has dynamic department mapping
    departments = db.query(Department).filter(Department.is_active == 1).all()
    for dept in departments:
        normalized_dept_name = _normalize_department_name(dept.name)
        if normalized_dept_name == normalized_user_dept:
            return dept.id
        if normalized_user_dept and normalized_dept_name and (
            normalized_user_dept in normalized_dept_name or normalized_dept_name in normalized_user_dept
        ):
            return dept.id

    # Fallback to report_departments
    report_departments = db.query(ReportDepartment).all()
    for report_dept in report_departments:
        normalized_dept_name = _normalize_department_name(report_dept.name)
        if normalized_dept_name == normalized_user_dept:
            return report_dept.id
        if normalized_user_dept and normalized_dept_name and (
            normalized_user_dept in normalized_dept_name or normalized_dept_name in normalized_user_dept
        ):
            return report_dept.id

    raise HTTPException(status_code=404, detail="Department not found")


def _get_default_rows(db: Session, department_id: int) -> List[int]:
    """Get default subtype IDs for a department.

    If no default rows were configured, fall back to all active subtypes for the
    department so newly added report structure entries appear automatically.
    """
    default_rows = db.query(ReportDefaultRow).filter(
        ReportDefaultRow.department_id == department_id,
        ReportDefaultRow.is_default == 1
    ).all()
    if default_rows:
        return [row.subtype_id for row in default_rows]

    dept_types = db.query(DynamicReportType).filter(
        DynamicReportType.department_id == department_id,
        DynamicReportType.is_active == 1
    ).all()
    if not dept_types:
        return []

    type_ids = [t.id for t in dept_types]
    subtypes = db.query(DynamicReportSubtype).filter(
        DynamicReportSubtype.type_id.in_(type_ids),
        DynamicReportSubtype.is_active == 1
    ).all()
    return [subtype.id for subtype in subtypes]


def _get_user_rows_for_date(db: Session, user_id: int, target_date: date) -> List[UserDailyRow]:
    """Get user's custom rows for a specific date."""
    return db.query(UserDailyRow).filter(
        UserDailyRow.user_id == user_id,
        UserDailyRow.attendance_date == target_date
    ).all()


def _get_report_data_for_date(db: Session, user_id: int, target_date: date, subtype_id: Optional[int] = None) -> List[DailyReportData]:
    """Get report data for a specific user and date."""
    query = db.query(DailyReportData).filter(
        DailyReportData.user_id == user_id,
        DailyReportData.attendance_date == target_date
    )
    if subtype_id:
        query = query.filter(DailyReportData.subtype_id == subtype_id)
    return query.all()


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
    # Compute start (first day) and end (first day of next month) to cover entire month
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1)
    else:
        end_date = date(year, month + 1, 1)

    query = db.query(Attendance).join(User).filter(
        Attendance.attendance_date >= start_date,
        Attendance.attendance_date < end_date,
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
            "check_in": iso_with_offset(r.check_in),
            "check_out": iso_with_offset(r.check_out),
            "status": r.status,
            "reason": r.reason,
            "report": report_display,
            "has_report": report_display != "Not Submitted",
        })
    
    return result



@router.get("/attendance-debug")
def attendance_report_debug(
    db: Session = Depends(get_db),
):
    """Development helper: return today's attendance without auth.
    ONLY enabled when environment variable ALLOW_DEBUG_ATTENDANCE=1.
    """
    import os
    if os.getenv("ALLOW_DEBUG_ATTENDANCE", "0") != "1":
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not Found")

    today = date.today()
    records = (
        db.query(Attendance).join(User).filter(Attendance.attendance_date == today).all()
    )
    result = []
    for r in records:
        result.append({
            "user_id": r.user_id,
            "user_name": r.user.name,
            "department": r.user.department,
            "date": r.attendance_date.isoformat(),
            "check_in": iso_with_offset(r.check_in),
            "check_out": iso_with_offset(r.check_out),
            "status": r.status,
            "reason": r.reason,
            "report": ("Submitted" if r.user and False else "Not Submitted"),
            "has_report": False,
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
                iso_with_offset(r.check_in) if r.check_in else "",
                iso_with_offset(r.check_out) if r.check_out else "",
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
@router.get("/all")
def get_all_reports(
    year: Optional[int] = Query(None, ge=2020, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    user_id: Optional[int] = Query(None),
    department_id: Optional[int] = Query(None),
    date_value: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Admin gets all reports from daily_report_data table."""
    
    # Join once up front so every selected filter is applied to the same result
    # set.  In particular, do not silently ignore an unknown department ID.
    query = db.query(DailyReportData).join(User, DailyReportData.user_id == User.id)
    
    if year and month:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)
        query = query.filter(
            DailyReportData.attendance_date >= start_date,
            DailyReportData.attendance_date < end_date
        )
    
    if user_id is not None:
        query = query.filter(DailyReportData.user_id == user_id)

    if department_id is not None:
        department = db.query(Department).filter(Department.id == department_id).first()
        if not department:
            raise HTTPException(status_code=404, detail="Department not found")
        query = query.filter(
            func.lower(func.trim(User.department)) == func.lower(func.trim(department.name))
        )

    if date_value is not None:
        query = query.filter(DailyReportData.attendance_date == date_value)
    
    reports = query.order_by(DailyReportData.attendance_date.desc()).all()
    
    result = []
    for report in reports:
        user = db.query(User).filter(User.id == report.user_id).first()
        subtype = db.query(DynamicReportSubtype).filter(DynamicReportSubtype.id == report.subtype_id).first()
        report_type = db.query(DynamicReportType).filter(DynamicReportType.id == subtype.type_id).first() if subtype else None
        
        # Build report_display for the frontend
        report_display = ""
        
        if user and user.department in ["HR", "IT"]:
            # HR/IT - show description
            report_display = report.description if report.description else "—"
        else:
            # B2B/B2C - show type, subtype, quantity, duration
            parts = []
            if report_type and subtype:
                parts.append(f"{report_type.name} → {subtype.name}")
            elif subtype:
                parts.append(subtype.name)
            
            details = []
            if report.quantity is not None:
                details.append(f"Qty: {report.quantity}")
            if report.duration:
                details.append(f"Duration: {report.duration}")
            if details:
                parts.append(f"({', '.join(details)})")
            
            report_display = " | ".join(parts) if parts else "—"
        
        result.append({
            "id": report.id,
            "user_id": report.user_id,
            "user_name": user.name if user else "Unknown",
            "user_department": user.department if user else "Unknown",
            "attendance_date": report.attendance_date.isoformat(),
            "type_name": report_type.name if report_type else None,
            "subtype_name": subtype.name if subtype else None,
            "quantity": report.quantity,
            "duration": report.duration,
            "description": report.description,
            "report_display": report_display,
            "status": "submitted",
            "submitted_at": iso_with_offset(report.submitted_at) if report.submitted_at else None,
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


# ============================================================
# DYNAMIC REPORT SYSTEM - NEW ENDPOINTS
# ============================================================

# ---------- Report Structure ----------
@router.get("/structure")
def get_report_structure(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get complete report structure: departments, types, subtypes, fields, default rows."""
    departments = db.query(Department).filter(Department.is_active == 1).order_by(Department.name).all()
    
    types = db.query(DynamicReportType).filter(DynamicReportType.is_active == 1).all()
    subtypes = db.query(DynamicReportSubtype).filter(DynamicReportSubtype.is_active == 1).all()
    fields = db.query(DynamicReportField).filter(DynamicReportField.is_active == 1).order_by(DynamicReportField.sort_order).all()
    default_rows = db.query(ReportDefaultRow).filter(ReportDefaultRow.is_default == 1).all()
    
    return {
        "departments": departments,
        "types": types,
        "subtypes": subtypes,
        "fields": fields,
        "default_rows": default_rows
    }


# ---------- User Daily Report ----------
@router.get("/user-report")
def get_user_daily_report(
    date: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get user's daily report with default and custom rows."""
    user_id = current_user.id
    
    # Get user's department
    dept_id = _get_user_department_id(db, user_id)
    
    # Get default rows for department
    default_subtype_ids = _get_default_rows(db, dept_id)
    
    # Get user's custom rows for this date
    user_rows = db.query(UserDailyRow).filter(
        UserDailyRow.user_id == user_id,
        UserDailyRow.attendance_date == date
    ).all()
    
    custom_rows = []
    for row in user_rows:
        custom_rows.append({
            "id": row.id,
            "user_id": row.user_id,
            "attendance_date": row.attendance_date.isoformat(),
            "subtype_id": row.subtype_id,
            "is_custom": row.is_custom
        })
    
    # Get all report data for this date
    report_data = _get_report_data_for_date(db, user_id, date)
    
    # Get all subtypes for this department
    all_subtypes = db.query(DynamicReportSubtype).filter(
        DynamicReportSubtype.is_active == 1
    ).all()
    
    return {
        "date": date.isoformat(),
        "department_id": dept_id,
        "default_subtype_ids": default_subtype_ids,
        "custom_subtype_ids": [row.subtype_id for row in user_rows],
        "custom_rows": custom_rows,
        "report_data": report_data,
        "all_subtypes": all_subtypes
    }


# ---------- User Add Custom Row ----------
@router.post("/user-row")
def add_user_row(
    payload: UserDailyRowCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add a custom row for a specific date."""
    # Check if row already exists
    existing = db.query(UserDailyRow).filter(
        UserDailyRow.user_id == current_user.id,
        UserDailyRow.attendance_date == payload.attendance_date,
        UserDailyRow.subtype_id == payload.subtype_id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Row already exists for this date")
    
    new_row = UserDailyRow(
        user_id=current_user.id,
        attendance_date=payload.attendance_date,
        subtype_id=payload.subtype_id,
        is_custom=True
    )
    db.add(new_row)
    db.commit()
    db.refresh(new_row)
    
    log_activity(db, current_user.id, f"Added custom row for {payload.attendance_date}")
    
    return {"message": "Row added successfully", "row_id": new_row.id}


# ---------- User Remove Custom Row ----------
@router.delete("/user-row/{row_id}")
def remove_user_row(
    row_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Remove a custom row for a specific date."""
    row = db.query(UserDailyRow).filter(
        UserDailyRow.id == row_id,
        UserDailyRow.user_id == current_user.id
    ).first()
    
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    
    db.delete(row)
    db.commit()
    
    log_activity(db, current_user.id, f"Removed custom row {row_id}")
    
    return {"message": "Row removed successfully"}


# ---------- Save Report Data ----------
@router.post("/report-data")
def save_report_data(
    payload: DailyReportDataCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Save or update report data for a specific date and subtype."""
    
    # Build query based on whether subtype_id is provided
    query = db.query(DailyReportData).filter(
        DailyReportData.user_id == current_user.id,
        DailyReportData.attendance_date == payload.attendance_date
    )
    
    # Only filter by subtype_id if it's not None
    if payload.subtype_id is not None:
        query = query.filter(DailyReportData.subtype_id == payload.subtype_id)
    else:
        query = query.filter(DailyReportData.subtype_id.is_(None))
    
    existing = query.first()
    
    if existing:
        # Update existing
        existing.quantity = payload.quantity
        existing.duration = payload.duration
        existing.description = payload.description
        existing.custom_fields = payload.custom_fields
        existing.updated_at = datetime.now()
        db.commit()
        db.refresh(existing)
        return {"message": "Report data updated successfully", "data_id": existing.id}
    else:
        # Create new
        new_data = DailyReportData(
            user_id=current_user.id,
            attendance_date=payload.attendance_date,
            subtype_id=payload.subtype_id,
            quantity=payload.quantity,
            duration=payload.duration,
            description=payload.description,
            custom_fields=payload.custom_fields,
            submitted_at=datetime.now()
        )
        db.add(new_data)
        db.commit()
        db.refresh(new_data)
        return {"message": "Report data saved successfully", "data_id": new_data.id}

# ---------- User Report History ----------
@router.get("/history")
def get_report_history(
    days: int = Query(7, ge=1, le=30),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get user's report history for the last N days (default 7)."""
    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    
    reports = db.query(DailyReportData).filter(
        DailyReportData.user_id == current_user.id,
        DailyReportData.attendance_date >= start_date,
        DailyReportData.attendance_date <= end_date
    ).order_by(DailyReportData.attendance_date.desc()).all()
    
    result = []
    for report in reports:
        result.append({
            "id": report.id,
            "user_id": report.user_id,
            "attendance_date": report.attendance_date.isoformat(),
            "subtype_id": report.subtype_id,
            "quantity": report.quantity,
            "duration": report.duration,
            "description": report.description,
            "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
        })
    
    return result

# ---------- Admin: Add Department ----------
@router.post("/admin/departments", response_model=DepartmentOut)
def add_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin adds a new department."""
    existing = db.query(Department).filter(Department.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Department already exists")
    
    new_dept = Department(
        name=payload.name,
        is_active=1,
        created_by=current_user.id
    )
    db.add(new_dept)
    db.commit()
    db.refresh(new_dept)
    
    log_activity(db, current_user.id, f"Added department: {payload.name}")
    
    return new_dept


# ---------- Admin: Add Type ----------
@router.post("/admin/types", response_model=DynamicReportTypeOut)
def add_report_type(
    payload: DynamicReportTypeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin adds a new report type."""
    new_type = DynamicReportType(
        department_id=payload.department_id,
        name=payload.name,
        sort_order=payload.sort_order,
        is_active=1,
        created_by=current_user.id
    )
    db.add(new_type)
    db.commit()
    db.refresh(new_type)
    
    log_activity(db, current_user.id, f"Added report type: {payload.name}")
    
    return new_type


# ---------- Admin: Add Subtype ----------
@router.post("/admin/subtypes", response_model=DynamicReportSubtypeOut)
def add_report_subtype(
    payload: DynamicReportSubtypeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin adds a new report subtype."""
    new_subtype = DynamicReportSubtype(
        type_id=payload.type_id,
        name=payload.name,
        has_quantity=payload.has_quantity,
        has_duration=payload.has_duration,
        has_description=payload.has_description,
        sort_order=payload.sort_order,
        is_active=1,
        created_by=current_user.id
    )
    db.add(new_subtype)
    db.commit()
    db.refresh(new_subtype)
    
    log_activity(db, current_user.id, f"Added report subtype: {payload.name}")
    
    return new_subtype


# ---------- Admin: Add Field ----------
@router.post("/admin/fields", response_model=DynamicReportFieldOut)
def add_report_field(
    payload: DynamicReportFieldCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin adds a new report field."""
    new_field = DynamicReportField(
        name=payload.name,
        field_type=payload.field_type,
        is_default=1 if payload.is_default else 0,
        show_in_report=1 if payload.show_in_report else 0,
        is_required=1 if payload.is_required else 0,
        sort_order=payload.sort_order,
        is_active=1,
        created_by=current_user.id
    )
    db.add(new_field)
    db.commit()
    db.refresh(new_field)
    
    log_activity(db, current_user.id, f"Added report field: {payload.name}")
    
    return new_field


# ---------- Admin: Set Default Rows ----------
@router.post("/admin/default-rows")
def set_default_rows(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin sets default rows for a department."""
    department_id = payload.get("department_id")
    subtype_ids = payload.get("subtype_ids", [])
    
    if not department_id:
        raise HTTPException(status_code=400, detail="department_id required")
    
    # Remove existing default rows for this department
    db.query(ReportDefaultRow).filter(
        ReportDefaultRow.department_id == department_id
    ).delete()
    
    # Add new default rows
    for subtype_id in subtype_ids:
        new_row = ReportDefaultRow(
            department_id=department_id,
            subtype_id=subtype_id,
            is_default=1,
            created_by=current_user.id
        )
        db.add(new_row)
    
    db.commit()
    
    log_activity(db, current_user.id, f"Updated default rows for department {department_id}")
    
    return {"message": "Default rows updated successfully"}


# ---------- Get All Departments ----------
@router.get("/departments", response_model=List[DepartmentOut])
def get_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all active departments."""
    return db.query(Department).filter(Department.is_active == 1).order_by(Department.name).all()


# ---------- Get Types for Department ----------
@router.get("/types")
def get_types(
    department_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get types for a department."""
    query = db.query(DynamicReportType).filter(DynamicReportType.is_active == 1)
    if department_id:
        query = query.filter(DynamicReportType.department_id == department_id)
    return query.order_by(DynamicReportType.sort_order).all()


# ---------- Get Subtypes for Type ----------
@router.get("/subtypes")
def get_subtypes(
    type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get subtypes for a type."""
    query = db.query(DynamicReportSubtype).filter(DynamicReportSubtype.is_active == 1)
    if type_id:
        query = query.filter(DynamicReportSubtype.type_id == type_id)
    return query.order_by(DynamicReportSubtype.sort_order).all()


# ---------- Get All Fields ----------
@router.get("/fields", response_model=List[DynamicReportFieldOut])
def get_fields(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all active report fields."""
    return db.query(DynamicReportField).filter(
        DynamicReportField.is_active == 1
    ).order_by(DynamicReportField.sort_order).all()


# ---------- Get Default Rows for Department ----------
@router.get("/default-rows")
def get_default_rows(
    department_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get default rows for a department."""
    default_rows = db.query(ReportDefaultRow).filter(
        ReportDefaultRow.department_id == department_id,
        ReportDefaultRow.is_default == 1
    ).all()
    return default_rows
