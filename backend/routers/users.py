"""
routers/users.py
User management. Admin/SuperAdmin can view all users and create/update
Employee & Admin accounts. Only SuperAdmin can create/manage Admin accounts.
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_current_user, hash_password, require_admin, require_superadmin
from database import get_db
from models import (
    User, ActivityLog, Department, UserDepartment, DynamicReportType, EmployeeProfileEditRequest,
    DynamicReportSubtype, DynamicReportField, ReportDefaultRow
)
from schemas import UserCreate, UserUpdate, UserOut, UserDepartmentCreate, UserDepartmentOut, PersonalProfileUpdate, ProfileEditRequestCreate, ProfileEditRequestDecision
from fastapi import File, Form, UploadFile
from fastapi.responses import FileResponse

router = APIRouter()
PROFILE_UPLOAD_DIR = Path("backend/uploads/profile_images")
PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ADDRESS_FIELDS = {"address_line_1", "address_line_2", "city", "state", "pincode", "country"}
EMERGENCY_FIELDS = {"emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"}


def _find_department_by_name(db: Session, department_name: Optional[str]) -> Optional[Department]:
    if not department_name:
        return None
    normalized = department_name.strip().lower()
    return db.query(Department).filter(func.lower(Department.name) == normalized, Department.is_active == 1).first()


@router.get("/", response_model=List[UserOut])
def list_users(
    search: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = db.query(User)
    if search:
        like = f"%{search}%"
        query = query.filter((User.name.like(like)) | (User.email.like(like)) | (User.mobile.like(like)))

    if department:
        # Accept either numeric department ID or an existing Department name.
        dept_ids: list[int] = []
        if department.isdigit():
            dept_ids.append(int(department))
        else:
            department_obj = _find_department_by_name(db, department)
            if department_obj:
                dept_ids.append(department_obj.id)
            else:
                # No matching department name -> return empty result set
                return []

        query = query.join(UserDepartment, User.id == UserDepartment.user_id).filter(
            UserDepartment.department_id.in_(dept_ids)
        ).distinct()

    if status_filter:
        query = query.filter(User.status == status_filter)
    return query.order_by(User.name).all()


@router.get("/me", response_model=UserOut)
def get_my_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me/profile", response_model=UserOut)
def update_my_profile(
    payload: PersonalProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    update_data = payload.model_dump(exclude_unset=True)
    supplied_address = set(update_data) & ADDRESS_FIELDS
    supplied_emergency = set(update_data) & EMERGENCY_FIELDS
    if supplied_address and any(getattr(current_user, field) for field in ADDRESS_FIELDS):
        raise HTTPException(status_code=403, detail="Address is locked. Request an edit approval instead.")
    if supplied_emergency and any(getattr(current_user, field) for field in EMERGENCY_FIELDS):
        raise HTTPException(status_code=403, detail="Emergency contact is locked. Request an edit approval instead.")
    for field, value in update_data.items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


def _profile_request_dict(item: EmployeeProfileEditRequest):
    return {"id": item.id, "employee_id": item.employee_id, "employee_name": item.employee.name if item.employee else None,
            "section": item.section, "requested_data": json.loads(item.requested_data), "status": item.status,
            "approved_by": item.approved_by, "approver_name": item.approver.name if item.approver else None,
            "decided_at": item.decided_at, "created_at": item.created_at}


@router.get("/me/profile-edit-requests")
def my_profile_edit_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_profile_request_dict(item) for item in db.query(EmployeeProfileEditRequest).filter(
        EmployeeProfileEditRequest.employee_id == current_user.id).order_by(EmployeeProfileEditRequest.created_at.desc()).all()]


@router.post("/me/profile-edit-requests", status_code=201)
def create_profile_edit_request(payload: ProfileEditRequestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    allowed = ADDRESS_FIELDS if payload.section == "address" else EMERGENCY_FIELDS
    if not payload.requested_data or set(payload.requested_data) - allowed:
        raise HTTPException(status_code=422, detail="Requested data does not match the selected profile section")
    if db.query(EmployeeProfileEditRequest).filter(EmployeeProfileEditRequest.employee_id == current_user.id,
        EmployeeProfileEditRequest.section == payload.section, EmployeeProfileEditRequest.status == "Pending").first():
        raise HTTPException(status_code=409, detail="An edit request for this section is already pending")
    item = EmployeeProfileEditRequest(employee_id=current_user.id, section=payload.section,
        requested_data=json.dumps({key: (value or "").strip() for key, value in payload.requested_data.items()}))
    db.add(item)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Requested approval to edit {payload.section.replace('_', ' ')}"))
    db.commit(); db.refresh(item)
    return _profile_request_dict(item)


@router.get("/profile-edit-requests")
def list_profile_edit_requests(status: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    query = db.query(EmployeeProfileEditRequest)
    if status:
        query = query.filter(EmployeeProfileEditRequest.status == status)
    return [_profile_request_dict(item) for item in query.order_by(EmployeeProfileEditRequest.created_at.desc()).all()]


@router.post("/profile-edit-requests/{request_id}/decision")
def decide_profile_edit_request(request_id: int, payload: ProfileEditRequestDecision, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    item = db.query(EmployeeProfileEditRequest).filter(EmployeeProfileEditRequest.id == request_id).first()
    if not item: raise HTTPException(status_code=404, detail="Profile edit request not found")
    if item.status != "Pending": raise HTTPException(status_code=409, detail="This request has already been decided")
    item.status, item.approved_by, item.decided_at = payload.status, current_user.id, datetime.utcnow()
    if payload.status == "Approved":
        for field, value in json.loads(item.requested_data).items(): setattr(item.employee, field, value)
    db.add(ActivityLog(user_id=current_user.id, activity=f"{payload.status} {item.section.replace('_', ' ')} edit request for {item.employee.name}"))
    db.commit(); db.refresh(item)
    return _profile_request_dict(item)


def _profile_photo_path(user_id: int) -> Optional[Path]:
    return next(iter(PROFILE_UPLOAD_DIR.glob(f"{user_id}.*")), None)


@router.post("/me/profile-photo")
async def upload_profile_photo(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}: raise HTTPException(status_code=400, detail="Upload a JPG, PNG, or WEBP image")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024: raise HTTPException(status_code=400, detail="Profile image must be 5 MB or smaller")
    previous = _profile_photo_path(current_user.id)
    if previous: previous.unlink(missing_ok=True)
    path = PROFILE_UPLOAD_DIR / f"{current_user.id}{extension}"
    path.write_bytes(data)
    return {"message": "Profile image updated"}


@router.get("/me/profile-photo")
def get_profile_photo(current_user: User = Depends(get_current_user)):
    path = _profile_photo_path(current_user.id)
    if not path: raise HTTPException(status_code=404, detail="Profile image not found")
    return FileResponse(path)


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Employees may only view their own profile; Admin/SuperAdmin can view any.
    if current_user.role == "user" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this user")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if payload.role == "admin" and current_user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only Super Admin can create Admin accounts")
    if payload.role == "superadmin":
        raise HTTPException(status_code=403, detail="Super Admin accounts cannot be created via this endpoint")

    if db.query(User).filter(User.mobile == payload.mobile).first():
        raise HTTPException(status_code=400, detail="Mobile number already registered")
    if payload.email and db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = User(
        name=payload.name,
        mobile=payload.mobile,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        department=payload.department,
        designation=payload.designation,
        place_of_posting=payload.place_of_posting,
        date_of_joining=payload.date_of_joining,
        status=payload.status,
        annual_leave=payload.annual_leave,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    department_obj = _find_department_by_name(db, payload.department)
    if department_obj:
        assignment = UserDepartment(
            user_id=new_user.id,
            department_id=department_obj.id,
            is_primary=1,
        )
        db.add(assignment)
        new_user.department = department_obj.name
        db.commit()
        db.refresh(new_user)

    db.add(ActivityLog(user_id=current_user.id, activity=f"Created user '{new_user.name}'"))
    db.commit()

    return new_user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "superadmin" and current_user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Not authorized to modify a Super Admin account")
    if payload.role == "admin" and current_user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only Super Admin can promote users to Admin")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)

    if payload.department is not None:
        department_obj = _find_department_by_name(db, payload.department)
        assignments = db.query(UserDepartment).filter(UserDepartment.user_id == user_id).all()

        if department_obj:
            matching_assignment = db.query(UserDepartment).filter(
                UserDepartment.user_id == user_id,
                UserDepartment.department_id == department_obj.id,
            ).first()

            if matching_assignment:
                db.query(UserDepartment).filter(UserDepartment.user_id == user_id).update({"is_primary": 0})
                matching_assignment.is_primary = 1
                user.department = department_obj.name
                db.commit()
                db.refresh(user)
            else:
                if assignments:
                    db.query(UserDepartment).filter(UserDepartment.user_id == user_id).update({"is_primary": 0})
                assignment = UserDepartment(
                    user_id=user.id,
                    department_id=department_obj.id,
                    is_primary=1,
                )
                db.add(assignment)
                user.department = department_obj.name
                db.commit()
                db.refresh(user)
        elif assignments:
            primary_assignment = db.query(UserDepartment).filter(
                UserDepartment.user_id == user_id,
                UserDepartment.is_primary == 1
            ).first()
            if primary_assignment:
                department_obj = db.query(Department).filter(Department.id == primary_assignment.department_id).first()
                if department_obj:
                    user.department = department_obj.name
                    db.commit()
                    db.refresh(user)

    db.add(ActivityLog(user_id=current_user.id, activity=f"Updated user '{user.name}'"))
    db.commit()

    return user


@router.delete("/{user_id}")
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.status = "inactive"
    db.commit()

    db.add(ActivityLog(user_id=current_user.id, activity=f"Deactivated user '{user.name}'"))
    db.commit()

    return {"message": f"User '{user.name}' has been deactivated"}


@router.post("/{user_id}/reset-device")
def reset_user_device(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Clears a user's registered device so they can register a new one on next login."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.device_token = None
    user.device_name = None
    user.browser_name = None
    user.device_registered_at = None
    db.commit()

    db.add(ActivityLog(user_id=current_user.id, activity=f"Reset device for user '{user.name}'"))
    db.commit()

    return {"message": "Device reset. The user can register a new device on next login."}  


@router.get("/{user_id}/departments", response_model=List[UserDepartmentOut])
def list_user_departments(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    assignments = db.query(UserDepartment).filter(UserDepartment.user_id == user_id).all()
    return assignments


@router.post("/{user_id}/departments", response_model=UserDepartmentOut, status_code=201)
def assign_user_department(
    user_id: int,
    payload: UserDepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    department = db.query(Department).filter(Department.id == payload.department_id, Department.is_active == 1).first()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    existing = db.query(UserDepartment).filter(
        UserDepartment.user_id == user_id,
        UserDepartment.department_id == payload.department_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already assigned to this department")

    user_assignments = db.query(UserDepartment).filter(UserDepartment.user_id == user_id).all()
    if payload.is_primary or not user_assignments:
        db.query(UserDepartment).filter(UserDepartment.user_id == user_id).update({"is_primary": 0})
        is_primary = 1
    else:
        is_primary = 0

    assignment = UserDepartment(
        user_id=user_id,
        department_id=payload.department_id,
        is_primary=is_primary,
    )
    db.add(assignment)

    if is_primary:
        user.department = department.name

    db.commit()
    db.refresh(assignment)

    db.add(ActivityLog(user_id=current_user.id, activity=f"Assigned department '{department.name}' to user '{user.name}'"))
    db.commit()

    return assignment


@router.put("/{user_id}/departments/primary", response_model=UserDepartmentOut)
def set_primary_department(
    user_id: int,
    payload: UserDepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    assignment = db.query(UserDepartment).filter(
        UserDepartment.user_id == user_id,
        UserDepartment.department_id == payload.department_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Department assignment not found for this user")

    db.query(UserDepartment).filter(UserDepartment.user_id == user_id).update({"is_primary": 0})
    assignment.is_primary = 1

    user = db.query(User).filter(User.id == user_id).first()
    department = db.query(Department).filter(Department.id == payload.department_id).first()
    if user and department:
        user.department = department.name

    db.commit()
    db.refresh(assignment)

    db.add(ActivityLog(user_id=current_user.id, activity=f"Set primary department '{department.name}' for user '{user.name}'"))
    db.commit()

    return assignment


@router.delete("/{user_id}/departments/{assignment_id}")
def remove_user_department(
    user_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    assignment = db.query(UserDepartment).filter(
        UserDepartment.id == assignment_id,
        UserDepartment.user_id == user_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Department assignment not found")

    remaining_count = db.query(UserDepartment).filter(UserDepartment.user_id == user_id).count()
    if remaining_count <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove the user's last department")

    is_primary_removed = bool(assignment.is_primary)
    db.delete(assignment)
    db.commit()

    remaining = db.query(UserDepartment).filter(UserDepartment.user_id == user_id).all()
    if not any(a.is_primary == 1 for a in remaining):
        remaining[0].is_primary = 1
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            department = db.query(Department).filter(Department.id == remaining[0].department_id).first()
            if department:
                user.department = department.name
        db.commit()

    return {"message": "Department assignment removed successfully"}


@router.delete("/{user_id}/permanent")
def permanently_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    """Disabled: user records are retained for audit/history."""
    raise HTTPException(status_code=410, detail="Permanent user deletion is disabled. Mark the user inactive instead.")

    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "superadmin":
        raise HTTPException(
            status_code=403,
            detail="Super Admin cannot be deleted"
        )

    if user.id == current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You cannot delete your own account"
        )

    deleted_name = user.name
    try:
        # These objects may be referenced by other users' departments/reports.
        # Preserve that shared data by transferring ownership to the deleting
        # superadmin before the user's cascading rows are removed.
        for model in (Department, DynamicReportType, DynamicReportSubtype, DynamicReportField, ReportDefaultRow):
            db.query(model).filter(model.created_by == user.id).update(
                {model.created_by: current_user.id}, synchronize_session=False
            )

        db.add(ActivityLog(user_id=current_user.id, activity=f"Permanently deleted user '{deleted_name}'"))
        db.delete(user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="User cannot be deleted because related data is still protected by a database constraint")

    return {"message": f"User '{deleted_name}' permanently deleted"}
