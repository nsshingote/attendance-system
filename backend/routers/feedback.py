from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin, require_superadmin
from database import get_db
from models import Feedback, User
from schemas import FeedbackCreate
from utils.date_helpers import iso_with_offset

router = APIRouter()

@router.post("/", status_code=201)
def create_feedback(payload: FeedbackCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.is_anonymous:
        now = datetime.utcnow()
        already_submitted = db.query(Feedback.id).filter(
            Feedback.user_id == current_user.id,
            Feedback.is_anonymous.is_(True),
            Feedback.created_at >= datetime(now.year, now.month, 1),
        ).first()
        if already_submitted:
            raise HTTPException(status_code=400, detail="Anonymous feedback can only be submitted once per calendar month")
    feedback = Feedback(user_id=current_user.id, **payload.model_dump())
    db.add(feedback)
    db.commit()
    return {"message": "Feedback submitted"}

@router.get("/")
def list_feedback(
    feedback_type: Optional[str] = Query(None, pattern="^(positive|negative)$"),
    visibility: Optional[str] = Query(None, pattern="^(anonymous|known)$"),
    year: Optional[int] = Query(None), month: Optional[int] = Query(None),
    start_date: Optional[datetime] = Query(None), end_date: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    sort: str = Query("newest", pattern="^(newest|oldest)$"),
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db), current_user: User = Depends(require_admin),
):
    query = db.query(Feedback)
    if feedback_type: query = query.filter(Feedback.feedback_type == feedback_type)
    if visibility == "anonymous": query = query.filter(Feedback.is_anonymous.is_(True))
    elif visibility == "known": query = query.filter(Feedback.is_anonymous.is_(False))
    if year and month: query = query.filter(Feedback.created_at >= datetime(year, month, 1), Feedback.created_at < datetime(year + (month == 12), 1 if month == 12 else month + 1, 1))
    if start_date: query = query.filter(Feedback.created_at >= start_date)
    if end_date: query = query.filter(Feedback.created_at <= end_date)
    if search:
        term = f"%{search.strip()}%"
        query = query.outerjoin(User, Feedback.user_id == User.id).filter(
            (Feedback.description.ilike(term)) | ((Feedback.is_anonymous.is_(False)) & User.name.ilike(term))
        )
    total = query.count()
    stats = {"total": db.query(Feedback).count(), "positive": db.query(Feedback).filter(Feedback.feedback_type == "positive").count(), "negative": db.query(Feedback).filter(Feedback.feedback_type == "negative").count(), "anonymous": db.query(Feedback).filter(Feedback.is_anonymous.is_(True)).count()}
    order = Feedback.created_at.asc() if sort == "oldest" else Feedback.created_at.desc()
    rows = query.order_by(order).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [{"id": item.id, "employee_name": None if item.is_anonymous else item.user.name, "description": item.description, "feedback_type": item.feedback_type, "is_anonymous": item.is_anonymous, "created_at": iso_with_offset(item.created_at)} for item in rows], "total": total, "stats": stats}

@router.delete("/{feedback_id}")
def delete_feedback(feedback_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_superadmin)):
    item = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Feedback not found")
    db.delete(item)
    db.commit()
    return {"message": "Feedback deleted"}
