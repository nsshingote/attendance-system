"""
routers/login.py
Handles login. Employees must log in from a registered device/browser;
Admins and Super Admins can log in from any device. Unrecognized employee
devices automatically create a pending device_requests entry.
"""

from datetime import datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, Response, Cookie, status
from sqlalchemy.orm import Session

from auth import verify_password, create_access_token, get_current_user
from config import settings
from database import get_db
from models import User, DeviceRequest, ActivityLog, RefreshToken
from schemas import LoginRequest, TokenResponse

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.mobile == payload.mobile).first()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid mobile number or password")

    if user.status != "active":
        raise HTTPException(status_code=403, detail="Your account has been deactivated")

    # Admins / Super Admins can log in from any device — no restriction.
    if user.role in ("admin", "superadmin"):
        return _issue_token(user, db, response)

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
        return _issue_token(user, db, response)

    # Recognized device -> allow login.
    if user.device_token == payload.device_token:
        return _issue_token(user, db, response)

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


def _token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _issue_token(user: User, db: Session, response: Response) -> TokenResponse:
    user.last_login = datetime.utcnow()
    db.add(ActivityLog(user_id=user.id, activity="Logged in"))
    db.commit()

    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    refresh_token = token_urlsafe(48)
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=_token_hash(refresh_token),
        expires_at=datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    db.commit()
    response.set_cookie(
        key="ams_refresh_token", value=refresh_token, httponly=True,
        secure=settings.REFRESH_COOKIE_SECURE,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth",
    )
    return TokenResponse(
        access_token=access_token,
        role=user.role,
        user_id=user.id,
        name=user.name,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_session(response: Response, ams_refresh_token: str | None = Cookie(None), db: Session = Depends(get_db)):
    if not ams_refresh_token:
        raise HTTPException(status_code=401, detail="Refresh session not found")
    stored = db.query(RefreshToken).filter(RefreshToken.token_hash == _token_hash(ams_refresh_token)).first()
    if not stored or stored.revoked_at or stored.expires_at <= datetime.utcnow() or stored.user.status != "active":
        raise HTTPException(status_code=401, detail="Refresh session is invalid or expired")
    # Rotate on every refresh so a stolen token cannot be reused.
    stored.revoked_at = datetime.utcnow()
    return _issue_token(stored.user, db, response)


@router.post("/logout")
def logout(response: Response, ams_refresh_token: str | None = Cookie(None), db: Session = Depends(get_db)):
    if ams_refresh_token:
        stored = db.query(RefreshToken).filter(RefreshToken.token_hash == _token_hash(ams_refresh_token)).first()
        if stored and not stored.revoked_at:
            stored.revoked_at = datetime.utcnow()
            db.commit()
    response.delete_cookie("ams_refresh_token", path="/auth", samesite="lax", secure=settings.REFRESH_COOKIE_SECURE)
    return {"message": "Logged out successfully"}
