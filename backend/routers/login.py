"""
routers/login.py
Handles login. Employees must log in from a registered device/browser;
Admins and Super Admins can log in from any device. Unrecognized employee
devices automatically create a pending device_requests entry.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import verify_password, create_access_token
from database import get_db
from models import User, DeviceRequest, ActivityLog
from schemas import LoginRequest, TokenResponse

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.mobile == payload.mobile).first()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid mobile number or password")

    if user.status != "active":
        raise HTTPException(status_code=403, detail="Your account has been deactivated")

    # Admins / Super Admins can log in from any device — no restriction.
    if user.role in ("admin", "superadmin"):
        return _issue_token(user, db)

    # ---- Employee device restriction ----
    if not payload.device_token:
        raise HTTPException(status_code=400, detail="Device token is required")

    # First-ever login: auto-register this device as the user's trusted device.
    if user.device_token is None:
        user.device_token = payload.device_token
        user.device_name = payload.device_name
        user.browser_name = payload.browser_name
        user.device_registered_at = datetime.utcnow()
        db.commit()
        return _issue_token(user, db)

    # Recognized device -> allow login.
    if user.device_token == payload.device_token:
        return _issue_token(user, db)

    # Unrecognized device -> create/reuse a pending device request, deny login.
    existing_request = (
        db.query(DeviceRequest)
        .filter(
            DeviceRequest.user_id == user.id,
            DeviceRequest.device_token == payload.device_token,
            DeviceRequest.status == "Pending",
        )
        .first()
    )
    if not existing_request:
        new_request = DeviceRequest(
            user_id=user.id,
            device_token=payload.device_token,
            device_name=payload.device_name,
            browser_name=payload.browser_name,
            status="Pending",
        )
        db.add(new_request)
        db.commit()

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This device is not registered. A request has been sent to the admin for approval.",
    )


def _issue_token(user: User, db: Session) -> TokenResponse:
    user.last_login = datetime.utcnow()
    db.add(ActivityLog(user_id=user.id, activity="Logged in"))
    db.commit()

    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    return TokenResponse(
        access_token=access_token,
        role=user.role,
        user_id=user.id,
        name=user.name,
    )


@router.post("/logout")
def logout():
    # JWTs are stateless; logout is handled client-side by discarding the token.
    return {"message": "Logged out successfully"}