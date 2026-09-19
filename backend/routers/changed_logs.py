from datetime import timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import require_admin_permission
from database import get_db
from models import ChangedLog, User, TeamMember

router = APIRouter()


def _as_utc_iso(value):
    """Return database timestamps with an explicit UTC offset for clients.

    MySQL returns TIMESTAMP/DATETIME values without tzinfo.  The database is
    operated in UTC, so leaving the offset out makes browsers guess the zone.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def record_changed_log(
    db: Session,
    employee_id: Optional[int],
    changed_by: int,
    category: str,
    item_name: str,
    old_value=None,
    new_value=None,
):
    """Queue a changed-log entry without changing the caller's transaction."""
    db.add(ChangedLog(
        employee_id=employee_id,
        changed_by=changed_by,
        category=category,
        item_name=item_name,
        old_value=None if old_value is None else str(old_value),
        new_value=None if new_value is None else str(new_value),
    ))


@router.get("/")
def list_changed_logs(
    employee_id: Optional[int] = None,
    employee_ids: Optional[list[int]] = Query(None),
    team_ids: Optional[list[int]] = Query(None),
    limit: int = Query(5000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("changed_logs.view")),
):
    query = db.query(ChangedLog).order_by(ChangedLog.created_at.desc())
    selected_ids = set(employee_ids or [])
    if employee_id is not None:
        selected_ids.add(employee_id)
    if team_ids:
        selected_ids.update(employee_id for (employee_id,) in db.query(TeamMember.employee_id).filter(TeamMember.team_id.in_(team_ids)).all())
    if selected_ids:
        query = query.filter(ChangedLog.employee_id.in_(selected_ids))
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
            "created_at": _as_utc_iso(row.created_at),
        }
        for row in rows
    ]
