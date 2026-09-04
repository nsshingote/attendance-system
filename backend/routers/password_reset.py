"""
routers/password_reset.py
Forgot-password flow: request a reset token via email, then confirm with
the token to set a new password.
"""

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import hash_password
from database import get_db
from models import User, PasswordResetToken
from schemas import PasswordResetRequest, PasswordResetConfirm
from utils.email_service import send_password_reset_email
from config import settings
from utils.logger import logger

router = APIRouter()

RESET_TOKEN_EXPIRY_MINUTES = 30


@router.post("/forgot-password")
def forgot_password(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    normalized_email = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(func.trim(User.email)) == normalized_email).first()

    # Always return a generic message so we don't leak which emails are registered.
    generic_response = {"message": "If that email is registered, a reset link has been sent."}

    if not user:
        return generic_response

    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(minutes=RESET_TOKEN_EXPIRY_MINUTES)

    reset_token = PasswordResetToken(user_id=user.id, token=token, expires_at=expires_at)
    db.add(reset_token)
    db.commit()

    frontend_origin = settings.FRONTEND_ORIGINS[0] if settings.FRONTEND_ORIGINS else "http://localhost:3000"
    reset_link = f"{frontend_origin}/reset-password?token={token}"
    if not send_password_reset_email(user.email, reset_link):
        logger.error(
            "Password reset email could not be sent for user_id=%s email=%s",
            user.id,
            user.email,
        )

    return generic_response


@router.post("/reset-password")
def reset_password(payload: PasswordResetConfirm, db: Session = Depends(get_db)):
    reset_token = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token == payload.token)
        .order_by(PasswordResetToken.id.desc())
        .first()
    )

    if not reset_token:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if reset_token.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="This reset token has expired")

    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(payload.new_password)
    db.delete(reset_token)
    db.commit()

    return {"message": "Password has been reset successfully. You can now log in."}
