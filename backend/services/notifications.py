"""Persistence operations for user-targeted in-app notifications."""

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from auth import has_permission
from models import Notification, Team, TeamMember, User
from services.realtime import notification_connections


_PENDING_REALTIME_KEY = "pending_notification_realtime"


@event.listens_for(Session, "after_commit")
def _deliver_committed_notifications(session: Session) -> None:
    pending = session.info.pop(_PENDING_REALTIME_KEY, [])
    for user_id, payload in pending:
        notification_connections.send_after_commit(user_id, payload)


@event.listens_for(Session, "after_rollback")
def _discard_rolled_back_notifications(session: Session) -> None:
    session.info.pop(_PENDING_REALTIME_KEY, None)


def serialize_notification(notification: Notification) -> dict:
    metadata = None
    if notification.metadata_json:
        try:
            metadata = json.loads(notification.metadata_json)
        except (TypeError, ValueError):
            metadata = {}
    return {
        "id": notification.id,
        "recipient_user_id": notification.recipient_user_id,
        "actor_user_id": notification.actor_user_id,
        "notification_type": notification.notification_type,
        "title": notification.title,
        "message": notification.message,
        "route": notification.route,
        "entity_type": notification.entity_type,
        "entity_id": notification.entity_id,
        "metadata": metadata,
        "is_read": notification.is_read,
        "read_at": notification.read_at,
        "created_at": notification.created_at,
    }


def create_notification(
    db: Session,
    *,
    recipient_user_id: int,
    notification_type: str,
    title: str,
    message: str,
    actor_user_id: Optional[int] = None,
    route: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    metadata: Optional[dict] = None,
) -> Notification:
    notification = Notification(
        recipient_user_id=recipient_user_id,
        actor_user_id=actor_user_id,
        notification_type=notification_type,
        title=title,
        message=message,
        route=route,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata_json=json.dumps(metadata) if metadata is not None else None,
    )
    db.add(notification)
    db.flush()
    db.info.setdefault(_PENDING_REALTIME_KEY, []).append(
        (recipient_user_id, {"type": "notification", "notification": serialize_notification(notification)})
    )
    return notification


def get_approver_user_ids(
    db: Session,
    *,
    employee_id: int,
    permission_key: str,
    actor_user_id: Optional[int] = None,
    include_team_leaders: bool = True,
) -> list[int]:
    """Return active users authorized to manage an employee's request."""
    query = db.query(User.id).filter(User.status == "active")
    role_filter = [User.role.in_(("admin", "superadmin"))]
    if include_team_leaders:
        role_filter.append(User.role == "team_leader")
    rows = query.filter(
        (role_filter[0] | role_filter[1]) if len(role_filter) == 2 else role_filter[0]
    ).all()
    recipients: list[int] = []
    for (user_id,) in rows:
        if actor_user_id is not None and user_id == actor_user_id:
            continue
        user = db.query(User).filter(User.id == user_id).first()
        if user is None:
            continue
        if user.role in ("admin", "superadmin"):
            recipients.append(user.id)
            continue
        if has_permission(user, permission_key, db) and db.query(TeamMember.id).join(
            Team, Team.id == TeamMember.team_id
        ).filter(
            Team.team_leader_id == user.id,
            Team.status == "active",
            TeamMember.employee_id == employee_id,
        ).first():
            recipients.append(user.id)
    return recipients


def get_admin_user_ids(db: Session, *, actor_user_id: Optional[int] = None) -> list[int]:
    query = db.query(User.id).filter(User.status == "active", User.role.in_(("admin", "superadmin")))
    if actor_user_id is not None:
        query = query.filter(User.id != actor_user_id)
    return [user_id for (user_id,) in query.all()]


def list_notifications(
    db: Session,
    user_id: int,
    *,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[Notification], int, int]:
    query = db.query(Notification).filter(Notification.recipient_user_id == user_id)
    total = query.count()
    unread_count = query.filter(Notification.is_read.is_(False)).count()
    items = query.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(offset).limit(limit).all()
    return items, total, unread_count


def get_notification_for_user(db: Session, notification_id: int, user_id: int) -> Optional[Notification]:
    return db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.recipient_user_id == user_id,
    ).first()


def mark_notification_read(db: Session, notification: Notification) -> Notification:
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.flush()
    return notification


def mark_all_notifications_read(db: Session, user_id: int) -> int:
    updated = db.query(Notification).filter(
        Notification.recipient_user_id == user_id,
        Notification.is_read.is_(False),
    ).update({"is_read": True, "read_at": datetime.now(timezone.utc).replace(tzinfo=None)}, synchronize_session=False)
    db.flush()
    return updated
