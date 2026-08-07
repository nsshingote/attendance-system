"""
routers/activity_logs.py
Read-only audit trail of user activity (logins, approvals, edits, etc.),
visible to Admin/SuperAdmin. Supports filtering to a single user via
?user_id=<id>.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from models import ActivityLog, User
from schemas import ActivityLogOut
from utils.date_helpers import iso_with_offset

router = APIRouter()


@router.get("/", response_model=List[ActivityLogOut])
def list_activity_logs(
    user_id: Optional[int] = None,
    employee_ids: Optional[List[int]] = Query(None),
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = db.query(ActivityLog)
    if employee_ids:
        query = query.filter(ActivityLog.user_id.in_(employee_ids))
    elif user_id:
        query = query.filter(ActivityLog.user_id == user_id)
    logs = query.order_by(ActivityLog.created_at.desc()).limit(min(limit, 500)).all()
    return [
        {
            "id": log.id,
            "user_id": log.user_id,
            "activity": log.activity,
            "created_at": iso_with_offset(log.created_at),
        }
        for log in logs
    ]
