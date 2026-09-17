from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from models import ChangedLog, User

router = APIRouter()


@router.get("/")
def list_changed_logs(
    employee_id: Optional[int] = None,
    limit: int = Query(5000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = db.query(ChangedLog).order_by(ChangedLog.created_at.desc())
    if employee_id is not None:
        query = query.filter(ChangedLog.employee_id == employee_id)
    rows = query.limit(limit).all()
    return [
        {
            "id": row.id,
            "employee_id": row.employee_id,
            "employee_name": row.employee.name if row.employee else None,
            "changed_by": row.changed_by,
            "changed_by_name": row.actor.name if row.actor else None,
            "category": row.category,
            "item_name": row.item_name,
            "old_value": row.old_value,
            "new_value": row.new_value,
            "created_at": row.created_at,
        }
        for row in rows
    ]
