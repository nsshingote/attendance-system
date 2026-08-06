"""
routers/users.py
User management. Admin/SuperAdmin can view all users and create/update
Employee & Admin accounts. Only SuperAdmin can create/manage Admin accounts.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_current_user, hash_password, require_admin, require_superadmin
from database import get_db
from models import (
    User, ActivityLog, Department, UserDepartment, DynamicReportType,
    DynamicReportSubtype, DynamicReportField, ReportDefaultRow
)
from schemas import UserCreate, UserUpdate, UserOut, UserDepartmentCreate, UserDepartmentOut

router = APIRouter()


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
