from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date

import models
import schemas
from database import get_db
from auth import get_current_user
from utils.attendance_status import determine_attendance_status_for_date


router = APIRouter(
    prefix="/admin",
    tags=["Admin"]
)


@router.get(
    "/dashboard",
    response_model=schemas.DashboardResponse
)
def dashboard(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    # Role check
    if current_user.role not in ["admin", "superadmin"]:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )


    today = date.today()


    total_employees = (
        db.query(models.User)
        .filter(
            models.User.status == "active"
        )
        .count()
    )


    present_today = (
        db.query(models.Attendance)
        .filter(
            models.Attendance.attendance_date == today
        )
        .count()
    )


    absent_today = (
        total_employees - present_today
    )


    pending_leaves = (
        db.query(models.LeaveRequest)
        .filter(
            models.LeaveRequest.status == "Pending"
        )
        .count()
    )


    return {
        "total_employees": total_employees,
        "present_today": present_today,
        "absent_today": absent_today,
        "pending_leaves": pending_leaves
    }

# ==========================
# Attendance Report
# ==========================
@router.get(
    "/attendance-report",
    response_model=list[schemas.AttendanceReportResponse]
)
def attendance_report(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    if current_user.role not in ["admin", "superadmin"]:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )


    records = (
        db.query(
            models.Attendance,
            models.User.name
        )
        .join(
            models.User,
            models.Attendance.user_id == models.User.id
        )
        .all()
    )


    response = []

    for attendance, employee_name in records:

        response.append(
            {
                "employee_name": employee_name,
                "attendance_date": attendance.attendance_date,
                "check_in": (
                    attendance.check_in.strftime("%H:%M:%S")
                    if attendance.check_in
                    else None
                ),
                "check_out": (
                    attendance.check_out.strftime("%H:%M:%S")
                    if attendance.check_out
                    else None
                ),
                "status": determine_attendance_status_for_date(db, attendance.user_id, attendance.attendance_date)
            }
        )


    return response

# ==========================
# Attendance Filter Report
# ==========================
@router.get("/attendance-filter")
def attendance_filter(
    employee_id: int = None,
    attendance_date: date = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    # Role check
    if current_user.role not in ["admin", "superadmin"]:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )


    query = (
        db.query(
            models.Attendance,
            models.User.name
        )
        .join(
            models.User,
            models.Attendance.user_id == models.User.id
        )
    )


    # Filter employee
    if employee_id:
        query = query.filter(
            models.Attendance.user_id == employee_id
        )


    # Filter date
    if attendance_date:
        query = query.filter(
            models.Attendance.attendance_date == attendance_date
        )


    records = query.all()


    response = []


    for attendance, employee_name in records:

        response.append(
            {
                "employee_name": employee_name,
                "attendance_date": attendance.attendance_date,
                "check_in": (
                    attendance.check_in.strftime("%H:%M:%S")
                    if attendance.check_in
                    else None
                ),
                "check_out": (
                    attendance.check_out.strftime("%H:%M:%S")
                    if attendance.check_out
                    else None
                ),
                "status": determine_attendance_status_for_date(db, attendance.user_id, attendance.attendance_date)
            }
        )


    return response