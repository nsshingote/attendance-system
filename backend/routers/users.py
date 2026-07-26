"""
routers/users.py
User management. Admin/SuperAdmin can view all users and create/update
Employee & Admin accounts. Only SuperAdmin can create/manage Admin accounts.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user, hash_password, require_admin, require_superadmin
from database import get_db
from models import User, ActivityLog
from schemas import UserCreate, UserUpdate, UserOut

router = APIRouter()


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
        query = query.filter(User.department == department)
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