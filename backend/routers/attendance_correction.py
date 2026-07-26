"""
routers/attendance_corrections.py
Attendance correction requests and approvals.
"""

from datetime import date, datetime, time
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from database import get_db
from models import User, Attendance, AttendanceCorrection, Holiday
from schemas import (
    CorrectionOut, CorrectionCreate, CorrectionDecision
)
from auth import get_current_user, require_roles
from utils.attendance_status import determine_attendance_status_for_date
from utils.logger import log_activity

router = APIRouter()


# ------------------------------------------------------------
# GET all corrections (Admin)
# ------------------------------------------------------------

@router.get("/", response_model=List[CorrectionOut])
def get_all_corrections(
    status: Optional[str] = Query(None, regex="^(Pending|Approved|Rejected)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin gets all correction requests."""
    query = db.query(AttendanceCorrection)
    if status:
        query = query.filter(AttendanceCorrection.status == status)
    return query.order_by(AttendanceCorrection.created_at.desc()).all()


# ------------------------------------------------------------
# POST - Request correction
# ------------------------------------------------------------

@router.post("/", response_model=CorrectionOut)
def request_correction(
    payload: CorrectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Employee requests an attendance correction."""
    # Determine target user (admin can request for others)
    target_user_id = payload.user_id if hasattr(payload, 'user_id') and payload.user_id else current_user.id
    
    if current_user.role not in ["admin", "superadmin"] and target_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only request corrections for yourself")
    
    target_user = db.query(User).filter(User.id == target_user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if correction already exists for this attendance
    existing = db.query(AttendanceCorrection).filter(
        AttendanceCorrection.attendance_id == payload.attendance_id,
        AttendanceCorrection.status == "Pending"
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail="A pending correction request already exists for this attendance record"
        )
    
    # Get the attendance record
    attendance = db.query(Attendance).filter(Attendance.id == payload.attendance_id).first()
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    
    # Parse time string to datetime if provided
    new_check_in = None
    new_check_out = None
    
    # Handle new_check_in - accept string time like "18:30" or datetime
    if hasattr(payload, 'new_check_in') and payload.new_check_in:
        if isinstance(payload.new_check_in, str) and ":" in payload.new_check_in:
            time_parts = payload.new_check_in.split(":")
            if len(time_parts) == 2:
                try:
                    hour = int(time_parts[0])
                    minute = int(time_parts[1])
                    new_check_in = datetime.combine(attendance.attendance_date, time(hour, minute))
                except (ValueError, TypeError):
                    new_check_in = None
        else:
            new_check_in = payload.new_check_in
    
    # Handle new_check_out - accept string time like "18:30" or datetime
    if hasattr(payload, 'new_check_out') and payload.new_check_out:
        if isinstance(payload.new_check_out, str) and ":" in payload.new_check_out:
            time_parts = payload.new_check_out.split(":")
            if len(time_parts) == 2:
                try:
                    hour = int(time_parts[0])
                    minute = int(time_parts[1])
                    new_check_out = datetime.combine(attendance.attendance_date, time(hour, minute))
                except (ValueError, TypeError):
                    new_check_out = None
        else:
            new_check_out = payload.new_check_out
    
    # Create the correction record
    correction = AttendanceCorrection(
        attendance_id=payload.attendance_id,
        requested_by=target_user_id,
        reason=payload.reason,
        old_check_in=attendance.check_in,
        new_check_in=new_check_in,
        old_check_out=attendance.check_out,
        new_check_out=new_check_out,
        status="Pending"
    )
    db.add(correction)
    db.commit()
    db.refresh(correction)
    
    log_activity(db, current_user.id, 
                 f"Requested attendance correction for {target_user.name} (Attendance #{payload.attendance_id})")
    
    return correction


# ------------------------------------------------------------
# GET - My corrections
# ------------------------------------------------------------

@router.get("/me", response_model=List[CorrectionOut])
def get_my_corrections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's correction requests."""
    return db.query(AttendanceCorrection).filter(
        AttendanceCorrection.requested_by == current_user.id
    ).order_by(AttendanceCorrection.created_at.desc()).all()


# ------------------------------------------------------------
# GET - Pending corrections (Admin)
# ------------------------------------------------------------

@router.get("/pending", response_model=List[CorrectionOut])
def get_pending_corrections(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin gets all pending correction requests."""
    return db.query(AttendanceCorrection).filter(
        AttendanceCorrection.status == "Pending"
    ).order_by(AttendanceCorrection.created_at.desc()).all()


# ------------------------------------------------------------
# GET - User corrections (Admin)
# ------------------------------------------------------------

@router.get("/user/{user_id}", response_model=List[CorrectionOut])
def get_user_corrections(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin gets corrections for a specific user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return db.query(AttendanceCorrection).filter(
        AttendanceCorrection.requested_by == user_id
    ).order_by(AttendanceCorrection.created_at.desc()).all()


# ------------------------------------------------------------
# PUT - Decide correction (Admin)
# ------------------------------------------------------------

@router.put("/{correction_id}/decide", response_model=CorrectionOut)
def decide_correction(
    correction_id: int,
    payload: CorrectionDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin"))
):
    """Admin approves or rejects a correction request."""
    correction = db.query(AttendanceCorrection).filter(
        AttendanceCorrection.id == correction_id
    ).first()
    
    if not correction:
        raise HTTPException(status_code=404, detail="Correction request not found")
    
    if correction.status != "Pending":
        raise HTTPException(
            status_code=400,
            detail=f"Request already {correction.status}"
        )
    
    correction.status = payload.status
    
    # If approved, update attendance record
    if payload.status == "Approved":
        attendance = db.query(Attendance).filter(
            Attendance.id == correction.attendance_id
        ).first()
        
        if attendance:
            # Update check-in if provided
            if correction.new_check_in:
                attendance.check_in = correction.new_check_in
            
            # Update check-out if provided
            if correction.new_check_out:
                attendance.check_out = correction.new_check_out
            
            # Recalculate status based on new times
            if attendance.check_in:
                # Check if it's a holiday first
                holiday = db.query(Holiday).filter(Holiday.holiday_date == attendance.attendance_date).first()
                if holiday:
                    attendance.status = "Holiday"
                else:
                    attendance.status = determine_attendance_status_for_date(
                        db, 
                        attendance.user_id, 
                        attendance.attendance_date
                    )
            else:
                attendance.status = "Absent"
            
            db.commit()
            db.refresh(attendance)
    
    db.commit()
    db.refresh(correction)
    
    log_activity(db, current_user.id, 
                 f"{payload.status} correction #{correction_id}")
    
    return correction