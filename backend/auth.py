"""
auth.py
Password hashing, JWT creation/verification, and FastAPI auth dependencies.
"""

from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import Permission, Role, RolePermission, User, UserPermission

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


# ---------------------------------------------------------
# Password helpers
# ---------------------------------------------------------
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


# ---------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="User account is inactive")
    db.info["recycle_actor_id"] = user.id
    return user


def require_roles(*allowed_roles: str):
    """Dependency factory to restrict an endpoint to specific roles.

    Usage: Depends(require_roles("admin", "superadmin"))
    """

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if effective_role_key(current_user) not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return role_checker


def effective_role_key(current_user: User) -> str:
    """Return the configured role key, falling back to the legacy role column."""
    return (current_user.role_record.key if current_user.role_record else None) or current_user.role


def is_superadmin(current_user: User) -> bool:
    return effective_role_key(current_user) == "superadmin"


def has_permission(current_user: User, permission_key: str, db: Session) -> bool:
    """Resolve explicit user overrides before the configured role (legacy-compatible)."""
    if is_superadmin(current_user):
        return True
    if not permission_key.strip():
        return False
    permission = db.query(Permission).filter(Permission.key == permission_key).first()
    if permission is None:
        return False
    override = db.query(UserPermission.effect).filter(
        UserPermission.user_id == current_user.id,
        UserPermission.permission_id == permission.id,
    ).first()
    if override:
        return override[0] == "allow"
    if current_user.role_record is not None and not current_user.role_record.is_active:
        return False
    role_query = db.query(RolePermission.id).filter(RolePermission.permission_id == permission.id)
    if current_user.role_record is not None:
        role_query = role_query.filter(RolePermission.role_id == current_user.role_id)
    else:
        role_query = role_query.filter(RolePermission.role == current_user.role)
    return role_query.first() is not None


def require_permission(permission_key: str):
    """Dependency factory for future permission-protected endpoints."""

    def permission_checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not has_permission(current_user, permission_key, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return permission_checker


def require_admin_permission(permission_key: str):
    """Require a configurable Admin permission while preserving Super Admin access."""

    def permission_checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if is_superadmin(current_user):
            return current_user
        if not has_permission(current_user, permission_key, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return permission_checker


# Common shortcuts
require_admin = require_roles("admin", "superadmin")
require_superadmin = require_roles("superadmin")
