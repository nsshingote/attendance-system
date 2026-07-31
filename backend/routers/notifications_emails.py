"""
routers/notification_emails.py
Manage the list of recipients (e.g. HR addresses) who can be notified
when a leave request is submitted.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import NotificationEmail, User, ActivityLog
from schemas import NotificationEmailCreate, NotificationEmailOut

router = APIRouter()


@router.get("/", response_model=List[NotificationEmailOut])
def list_notification_emails(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Authenticated users can view notification emails for composing leave emails."""
    return db.query(NotificationEmail).filter(
        NotificationEmail.is_active == 1
    ).order_by(NotificationEmail.id.desc()).all()


@router.post("/", response_model=NotificationEmailOut, status_code=201)
def add_notification_email(
    payload: NotificationEmailCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(NotificationEmail).filter(NotificationEmail.email == payload.email).first():
        raise HTTPException(status_code=400, detail="This email is already in the notification list")

    entry = NotificationEmail(
        name=payload.name,
        email=payload.email,
        is_active=1  # Always active
    )
    db.add(entry)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Added notification email '{payload.email}'"))
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{email_id}")
def delete_notification_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entry = db.query(NotificationEmail).filter(NotificationEmail.id == email_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Notification email not found")

    db.delete(entry)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Removed notification email '{entry.email}'"))
    db.commit()
    return {"message": "Notification email removed"}
