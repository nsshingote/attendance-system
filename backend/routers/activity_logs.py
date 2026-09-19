"""
routers/activity_logs.py
Read-only audit trail of user activity (logins, approvals, edits, etc.),
visible to Admin/SuperAdmin. Supports filtering to a single user via
?user_id=<id>.
"""

import re
from datetime import timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import require_admin_permission
from database import get_db
from models import (    
    
    ActivityLog,
    Attendance,
    AttendanceCorrection,
    DeviceRequest,
    HalfDayRequest,
    LeaveRequest,
    User,
    WFHRequest,
    Team,
    TeamMember,
)
from schemas import ActivityLogOut

router = APIRouter()
IST = ZoneInfo("Asia/Kolkata")


@router.get("/", response_model=List[ActivityLogOut])
def list_activity_logs(
    user_id: Optional[int] = None,
    employee_ids: Optional[List[int]] = Query(None),
    team_ids: Optional[List[int]] = Query(None),
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("activity_logs.view")),
):
    query = db.query(ActivityLog)
    team_employee_ids = []
    if team_ids:
        team_employee_ids = [employee_id for (employee_id,) in db.query(TeamMember.employee_id).filter(TeamMember.team_id.in_(team_ids)).all()]
    if employee_ids or team_employee_ids:
        query = query.filter(ActivityLog.user_id.in_(set(employee_ids or []) | set(team_employee_ids)))
    elif user_id:
        query = query.filter(ActivityLog.user_id == user_id)
    logs = query.order_by(ActivityLog.created_at.desc()).limit(min(limit, 5000)).all()
    users_by_id = {user.id: user.name for user in db.query(User).all()}

    employee_names_by_activity_id = {
        "correction": {
            item_id: name
            for item_id, name in db.query(AttendanceCorrection.id, User.name)
            .join(User, AttendanceCorrection.requested_by == User.id)
            .all()
        },
        "half day request": {
            item_id: name
            for item_id, name in db.query(HalfDayRequest.id, User.name)
            .join(User, HalfDayRequest.user_id == User.id)
            .all()
        },
        "WFH request": {
            item_id: name
            for item_id, name in db.query(WFHRequest.id, User.name)
            .join(User, WFHRequest.user_id == User.id)
            .all()
        },
        "device request": {
            item_id: name
            for item_id, name in db.query(DeviceRequest.id, User.name)
            .join(User, DeviceRequest.user_id == User.id)
            .all()
        },
        "leave request": {
            item_id: name
            for item_id, name in db.query(LeaveRequest.id, User.name)
            .join(User, LeaveRequest.user_id == User.id)
            .all()
        },
        "leave": {
            item_id: name
            for item_id, name in db.query(LeaveRequest.id, User.name)
            .join(User, LeaveRequest.user_id == User.id)
            .all()
        },
        "attendance": {
            item_id: name
            for item_id, name in db.query(Attendance.id, User.name)
            .join(User, Attendance.user_id == User.id)
            .all()
        },
    }

    def resolve_target_names(activity: str) -> str:
        activity = re.sub(r"\s*\(Attendance #\d+\)", "", activity, flags=re.IGNORECASE)
        activity = re.sub(
            r"\buser #(\d+)\b",
            lambda match: users_by_id.get(int(match.group(1)), match.group(0)),
            activity,
            flags=re.IGNORECASE,
        )

        for activity_kind, names_by_id in employee_names_by_activity_id.items():
            activity = re.sub(
                rf"\b{re.escape(activity_kind)} #(\d+)\b",
                lambda match: (
                    f"{activity_kind} for {names_by_id[int(match.group(1))]}"
                    if int(match.group(1)) in names_by_id
                    else match.group(0)
                ),
                activity,
                flags=re.IGNORECASE,
            )
        return activity

    def serialize_created_at(created_at):
        if created_at is None:
            return None
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return created_at.astimezone(IST).isoformat()

    return [
        {
            "id": log.id,
            "user_id": log.user_id,
            "activity": resolve_target_names(log.activity),
            "created_at": serialize_created_at(log.created_at),
        }
        for log in logs
    ]
