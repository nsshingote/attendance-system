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

from auth import get_current_user, has_permission, hash_password, require_admin, require_admin_permission, require_superadmin, is_superadmin, effective_role_key
from team_scope import require_team_member_access, require_team_permission, get_team_member_ids
from config import settings
from database import get_db
from models import (
    User, ActivityLog, ChangedLog, Department, UserDepartment, DynamicReportType, EmployeeProfileEditRequest, PersonalDocumentChangeRequest, Role,
    DynamicReportSubtype, DynamicReportField, ReportDefaultRow
)
from schemas import UserCreate, UserUpdate, UserOut, UserDepartmentCreate, UserDepartmentOut, EmployeeSelectorOut, PersonalProfileUpdate, ProfileEditRequestCreate, ProfileEditRequestDecision
from fastapi import File, Form, UploadFile
from fastapi.responses import FileResponse
from services.notifications import create_notification, get_admin_user_ids
from routers.changed_logs import record_changed_log

router = APIRouter()
PROFILE_UPLOAD_DIR = Path(settings.UPLOAD_DIR) / "profile_images"
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
    current_user: User = Depends(get_current_user),
):
    role_key = effective_role_key(current_user)
    if role_key not in ("admin", "superadmin", "team_leader") and not has_permission(current_user, "employees.all_view", db):
        raise HTTPException(status_code=403, detail="You do not have permission to view users")
    if role_key == "admin" and not has_permission(current_user, "employees.all_view", db):
        raise HTTPException(status_code=403, detail="You do not have permission to view all users")
    team_member_ids = require_team_permission(db, current_user, "employees.team_view") if role_key == "team_leader" else []
    query = db.query(User)
    if role_key == "team_leader":
        query = query.filter(User.id.in_(team_member_ids))
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


@router.get("/employee-selector", response_model=List[EmployeeSelectorOut])
def list_document_employee_selector(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    role_key = effective_role_key(current_user)
    can_view_documents = (
        has_permission(current_user, "employee_documents.letters.view", db)
        or has_permission(current_user, "employee_documents.salary_slips.view", db)
    )
    if not can_view_documents:
        raise HTTPException(status_code=403, detail="You do not have permission to select document employees")
    if role_key == "team_leader":
        employee_ids = require_team_permission(db, current_user, "employees.team_view")
        query = db.query(User).filter(User.id.in_(employee_ids))
    else:
        query = db.query(User)
    return query.filter(User.status == "active").order_by(User.name).all()


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
    if "email" in update_data and update_data["email"]:
        duplicate_email = db.query(User).filter(
            User.email == update_data["email"],
            User.id != current_user.id,
        ).first()
        if duplicate_email:
            raise HTTPException(status_code=409, detail="That email address is already in use")
    if "mobile" in update_data and update_data["mobile"]:
        duplicate_mobile = db.query(User).filter(
            User.mobile == update_data["mobile"],
            User.id != current_user.id,
        ).first()
        if duplicate_mobile:
            raise HTTPException(status_code=409, detail="That mobile number is already in use")
    supplied_emergency = set(update_data) & EMERGENCY_FIELDS
    if supplied_emergency and any(getattr(current_user, field) for field in EMERGENCY_FIELDS):
        raise HTTPException(status_code=403, detail="Emergency contact is locked. Request an edit approval instead.")
    for field, value in update_data.items():
        old_value = getattr(current_user, field)
        if str(old_value or "") != str(value or ""):
            record_changed_log(db, current_user.id, current_user.id, "profile",
                               field.replace("_", " ").title(), old_value, value)
        setattr(current_user, field, value)
    changed_fields = ", ".join(sorted(update_data)) or "no fields"
    db.add(ActivityLog(
        user_id=current_user.id,
        activity=f"Updated own profile ({changed_fields})",
    ))
    db.commit()
    db.refresh(current_user)
    return current_user


def _profile_request_dict(item: EmployeeProfileEditRequest):
    return {"id": item.id, "employee_id": item.employee_id, "employee_name": item.employee.name if item.employee else None,
            "section": item.section, "requested_data": json.loads(item.requested_data), "status": item.status,
            "request_source": "profile", "approved_by": item.approved_by, "approver_name": item.approver.name if item.approver else None,
            "decided_at": item.decided_at, "created_at": item.created_at}


def _document_request_dict(item: PersonalDocumentChangeRequest):
    return {
        "id": item.id,
        "employee_id": item.employee_id,
        "employee_name": item.employee.name if item.employee else None,
        "section": "Document Replace" if item.request_type == "replace" else "Document Delete",
        "requested_data": {"document_name": item.document.title if item.document else f"Document #{item.document_id}"},
        "status": item.status,
        "request_source": "personal_document",
        "request_type": item.request_type,
        "document_id": item.document_id,
        "approved_by": item.decided_by,
        "approver_name": item.decider.name if item.decider else None,
        "decided_at": item.decided_at,
        "created_at": item.created_at,
    }


@router.get("/me/profile-edit-requests")
def my_profile_edit_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_profile_request_dict(item) for item in db.query(EmployeeProfileEditRequest).filter(
        EmployeeProfileEditRequest.employee_id == current_user.id).order_by(EmployeeProfileEditRequest.created_at.desc()).all()]


@router.post("/me/profile-edit-requests", status_code=201)
def create_profile_edit_request(payload: ProfileEditRequestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    allowed = ADDRESS_FIELDS if payload.section == "address" else EMERGENCY_FIELDS
    if not payload.requested_data or set(payload.requested_data) - allowed:
        raise HTTPException(status_code=422, detail="Requested data does not match the selected profile section")
    pending_requests = db.query(EmployeeProfileEditRequest).filter(
        EmployeeProfileEditRequest.employee_id == current_user.id,
        EmployeeProfileEditRequest.section == payload.section,
        EmployeeProfileEditRequest.status == "Pending",
    ).all()
    if pending_requests:
        raise HTTPException(status_code=409, detail="An edit request for this section is already pending")
    item = EmployeeProfileEditRequest(employee_id=current_user.id, section=payload.section,
        requested_data=json.dumps({key: (value or "").strip() for key, value in payload.requested_data.items()}))
    db.add(item)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Requested approval to edit {payload.section.replace('_', ' ')}"))
    for admin_id in get_admin_user_ids(
        db,
        actor_user_id=current_user.id,
        permission_key="requests.manage",
    ):
        create_notification(
            db,
            recipient_user_id=admin_id,
            actor_user_id=current_user.id,
            notification_type="profile_edit.submitted",
            title="New profile correction request",
            message=f"{current_user.name} submitted a {payload.section.replace('_', ' ')} profile correction request.",
            route="/requests",
            entity_type="profile_edit_request",
            entity_id=item.id,
        )
    db.commit(); db.refresh(item)
    return _profile_request_dict(item)


@router.get("/profile-edit-requests")
def list_profile_edit_requests(status: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    profile_query = db.query(EmployeeProfileEditRequest)
    document_query = db.query(PersonalDocumentChangeRequest)
    if effective_role_key(current_user) == "team_leader":
        team_ids = [current_user.id, *require_team_permission(db, current_user, "employees.team_view")]
        profile_query = profile_query.filter(EmployeeProfileEditRequest.employee_id.in_(team_ids))
        document_query = document_query.filter(PersonalDocumentChangeRequest.employee_id.in_(team_ids))
    elif not has_permission(current_user, "requests.view", db):
        raise HTTPException(status_code=403, detail="You do not have permission to view these requests")
    if status:
        profile_query = profile_query.filter(EmployeeProfileEditRequest.status == status)
        document_query = document_query.filter(PersonalDocumentChangeRequest.status == status)
    requests = [_profile_request_dict(item) for item in profile_query.all()]
    requests.extend(_document_request_dict(item) for item in document_query.all())
    return sorted(requests, key=lambda item: item.get("created_at") or datetime.min, reverse=True)


@router.post("/profile-edit-requests/{request_id}/decision")
def decide_profile_edit_request(request_id: int, payload: ProfileEditRequestDecision, db: Session = Depends(get_db), current_user: User = Depends(require_admin_permission("requests.manage"))):
    item = db.query(EmployeeProfileEditRequest).filter(EmployeeProfileEditRequest.id == request_id).first()
    if not item: raise HTTPException(status_code=404, detail="Profile edit request not found")
    if item.status != "Pending": raise HTTPException(status_code=409, detail="This request has already been decided")
    item.status, item.approved_by, item.decided_at = payload.status, current_user.id, datetime.utcnow()
    if payload.status == "Approved":
        for field, value in json.loads(item.requested_data).items():
            old_value = getattr(item.employee, field)
            if str(old_value or "") != str(value or ""):
                db.add(ChangedLog(
                    employee_id=item.employee_id,
                    changed_by=current_user.id,
                    category=item.section,
                    item_name=field.replace("_", " ").title(),
                    old_value=str(old_value or ""),
                    new_value=str(value or ""),
                ))
            setattr(item.employee, field, value)
    db.add(ActivityLog(user_id=current_user.id, activity=f"{payload.status} {item.section.replace('_', ' ')} edit request for {item.employee.name}"))
    if item.employee_id != current_user.id:
        create_notification(
            db,
            recipient_user_id=item.employee_id,
            actor_user_id=current_user.id,
            notification_type=f"profile_edit.{payload.status.lower()}",
            title=f"Profile correction {payload.status.lower()}",
            message=f"Your {item.section.replace('_', ' ')} profile correction request was {payload.status.lower()}.",
            route="/my-profile",
            entity_type="profile_edit_request",
            entity_id=item.id,
        )
    db.commit(); db.refresh(item)
    return _profile_request_dict(item)


def _profile_photo_path(user_id: int) -> Optional[Path]:
    return next(iter(PROFILE_UPLOAD_DIR.glob(f"{user_id}.*")), None)


@router.post("/me/profile-photo")
async def upload_profile_photo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}: raise HTTPException(status_code=400, detail="Upload a JPG, PNG, or WEBP image")
    data = await file.read()
    if not data: raise HTTPException(status_code=400, detail="Profile image is empty")
    if len(data) > 5 * 1024 * 1024: raise HTTPException(status_code=400, detail="Profile image must be 5 MB or smaller")
    previous = _profile_photo_path(current_user.id)
    # A stable public filename lets every existing avatar surface use the same
    # uploaded image without persisting another user-table field.
    path = PROFILE_UPLOAD_DIR / f"{current_user.id}.jpg"
    temporary_path = PROFILE_UPLOAD_DIR / f".{current_user.id}.uploading"
    try:
        temporary_path.write_bytes(data)
        temporary_path.replace(path)
    except OSError as error:
        temporary_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Unable to store profile image") from error
    if previous and previous != path:
        previous.unlink(missing_ok=True)
    db.add(ActivityLog(user_id=current_user.id, activity="Updated profile photo"))
    record_changed_log(db, current_user.id, current_user.id, "profile", "Profile photo",
                       previous.name if previous else None, path.name)
    db.commit()
    return {"message": "Profile image updated"}


@router.get("/me/profile-photo")
def get_profile_photo(current_user: User = Depends(get_current_user)):
    path = _profile_photo_path(current_user.id)
    if not path: raise HTTPException(status_code=404, detail="Profile image not found")
    return FileResponse(path)


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Self access remains available; broader access is permission- and scope-controlled.
    role_key = effective_role_key(current_user)
    if current_user.id != user_id:
        if has_permission(current_user, "employees.all_view", db):
            pass
        elif role_key == "team_leader":
            require_team_member_access(db, current_user, user_id, "employees.team_view")
        else:
            raise HTTPException(status_code=403, detail="You do not have permission to view this user")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("employees.manage")),
):
    role_record = db.query(Role).filter(Role.id == payload.role_id).first() if payload.role_id else db.query(Role).filter(Role.key == payload.role).first()
    if payload.role_id and not role_record:
        raise HTTPException(422, "Role not found")
    if role_record and not role_record.is_active:
        raise HTTPException(422, "Role is inactive")
    role_key = role_record.key if role_record else payload.role
    if role_key == "admin" and not is_superadmin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can create Admin accounts")
    if role_key == "superadmin":
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
        role=role_key if role_key in {"superadmin", "admin", "team_leader", "user"} else "user",
        role_id=role_record.id if role_record else None,
        attendance_mode=payload.attendance_mode,
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
    current_user: User = Depends(require_admin_permission("employees.manage")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    current_role = db.query(Role).filter(Role.id == user.role_id).first() if user.role_id else None
    if (current_role.key if current_role else user.role) == "superadmin" and not is_superadmin(current_user):
        raise HTTPException(status_code=403, detail="Not authorized to modify a Super Admin account")
    requested_role = db.query(Role).filter(Role.id == payload.role_id).first() if payload.role_id else (
        db.query(Role).filter(Role.key == payload.role).first() if payload.role else None
    )
    if payload.role_id and not requested_role:
        raise HTTPException(422, "Role not found")
    if requested_role and not requested_role.is_active:
        raise HTTPException(422, "Role is inactive")
    requested_key = requested_role.key if requested_role else payload.role
    if requested_key == "admin" and not is_superadmin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can promote users to Admin")

    update_data = payload.model_dump(exclude_unset=True)
    if requested_role:
        update_data["role_id"] = requested_role.id
        update_data["role"] = requested_role.key if requested_role.key in {"superadmin", "admin", "team_leader", "user"} else "user"
    for field, value in update_data.items():
        old_value = getattr(user, field)
        if str(old_value or "") != str(value or ""):
            record_changed_log(db, user.id, current_user.id, "profile",
                               field.replace("_", " ").title(), old_value, value)
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
    # Department assignment may be normalized after the initial update.
    if payload.department is not None and user.department != payload.department:
        record_changed_log(db, user.id, current_user.id, "profile", "Department",
                           payload.department, user.department)
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

    old_status = user.status
    user.status = "inactive"
    record_changed_log(db, user.id, current_user.id, "profile", "Status", old_status, user.status)
    db.commit()

    db.add(ActivityLog(user_id=current_user.id, activity=f"Deactivated user '{user.name}'"))
    db.commit()

    return {"message": f"User '{user.name}' has been deactivated"}


@router.post("/{user_id}/reset-device")
def reset_user_device(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("employees.manage")),
):
    """Clears a user's registered device so they can register a new one on next login."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_device_values = {
        "device_token": user.device_token,
        "device_name": user.device_name,
        "browser_name": user.browser_name,
        "device_registered_at": user.device_registered_at,
    }
    user.device_token = None
    user.device_name = None
    user.browser_name = None
    user.device_registered_at = None
    for field, old_value, new_value in (
        ("Device token", old_device_values["device_token"], None),
        ("Device name", old_device_values["device_name"], None),
        ("Browser", old_device_values["browser_name"], None),
        ("Registered at", old_device_values["device_registered_at"], None),
    ):
        if str(old_value) != str(new_value):
            record_changed_log(db, user.id, current_user.id, "device", field, old_value, new_value)
    db.commit()

    db.add(ActivityLog(user_id=current_user.id, activity=f"Reset device for user '{user.name}'"))
    db.commit()

    return {"message": "Device reset. The user can register a new device on next login."}  


@router.get("/{user_id}/departments", response_model=List[UserDepartmentOut])
def list_user_departments(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("employees.manage")),
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
    current_user: User = Depends(require_admin_permission("employees.manage")),
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
    record_changed_log(db, user.id, current_user.id, "profile", "Department", None, department.name)
    db.commit()

    return assignment


@router.put("/{user_id}/departments/primary", response_model=UserDepartmentOut)
def set_primary_department(
    user_id: int,
    payload: UserDepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("employees.manage")),
):
    assignment = db.query(UserDepartment).filter(
        UserDepartment.user_id == user_id,
        UserDepartment.department_id == payload.department_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Department assignment not found for this user")

    user = db.query(User).filter(User.id == user_id).first()
    old_department = user.department if user else None
    db.query(UserDepartment).filter(UserDepartment.user_id == user_id).update({"is_primary": 0})
    assignment.is_primary = 1

    department = db.query(Department).filter(Department.id == payload.department_id).first()
    if user and department:
        user.department = department.name

    db.commit()
    db.refresh(assignment)

    db.add(ActivityLog(user_id=current_user.id, activity=f"Set primary department '{department.name}' for user '{user.name}'"))
    record_changed_log(db, user.id, current_user.id, "profile", "Department", old_department, department.name)
    db.commit()

    return assignment


@router.delete("/{user_id}/departments/{assignment_id}")
def remove_user_department(
    user_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("employees.manage")),
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
    removed_department_id = assignment.department_id
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

    user = db.query(User).filter(User.id == user_id).first()
    department_name = None
    if user and remaining:
        department_name = db.query(Department).filter(Department.id == remaining[0].department_id).first()
        department_name = department_name.name if department_name else None
    db.add(ActivityLog(user_id=current_user.id, activity=f"Removed department assignment from user '{user.name if user else user_id}'"))
    record_changed_log(db, user_id, current_user.id, "profile", "Department", removed_department_id, department_name)
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

    if effective_role_key(user) == "superadmin":
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
