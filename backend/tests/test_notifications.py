import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from database import Base, SessionLocal, engine
from fastapi import HTTPException
from models import Notification, User
from routers.notifications import read_notification
from services.notifications import (
    create_notification,
    get_notification_for_user,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
)


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def create_user(db, suffix: str) -> User:
    user = User(
        name=f"Notification {suffix}",
        mobile=f"888888{len(db.query(User).all()) + 100}",
        password_hash="hashed",
        role="user",
        department="Engineering",
        designation="Developer",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_creating_notification_persists_for_recipient():
    db = SessionLocal()
    user = create_user(db, "create")
    notification = create_notification(
        db,
        recipient_user_id=user.id,
        notification_type="test",
        title="Test notification",
        message="It works",
        route="/notifications",
        metadata={"source": "test"},
    )
    db.commit()

    saved = db.query(Notification).filter(Notification.id == notification.id).one()
    assert saved.recipient_user_id == user.id
    assert saved.metadata_json == '{"source": "test"}'
    db.close()


def test_fetching_notifications_returns_only_current_user_rows():
    db = SessionLocal()
    first = create_user(db, "first")
    second = create_user(db, "second")
    create_notification(db, recipient_user_id=first.id, notification_type="test", title="First", message="For first")
    create_notification(db, recipient_user_id=second.id, notification_type="test", title="Second", message="For second")
    db.commit()

    items, total, unread = list_notifications(db, first.id)
    assert [item.title for item in items] == ["First"]
    assert total == 1
    assert unread == 1
    db.close()


def test_unread_count_and_mark_one_as_read():
    db = SessionLocal()
    user = create_user(db, "one")
    first = create_notification(db, recipient_user_id=user.id, notification_type="test", title="First", message="One")
    create_notification(db, recipient_user_id=user.id, notification_type="test", title="Second", message="Two")
    db.commit()

    mark_notification_read(db, first)
    db.commit()
    _, _, unread = list_notifications(db, user.id)
    assert unread == 1
    assert first.is_read is True
    assert first.read_at is not None
    db.close()


def test_mark_all_as_read_updates_only_current_user():
    db = SessionLocal()
    first = create_user(db, "all-first")
    second = create_user(db, "all-second")
    create_notification(db, recipient_user_id=first.id, notification_type="test", title="First", message="One")
    create_notification(db, recipient_user_id=second.id, notification_type="test", title="Second", message="Two")
    db.commit()

    assert mark_all_notifications_read(db, first.id) == 1
    db.commit()
    assert list_notifications(db, first.id)[2] == 0
    assert list_notifications(db, second.id)[2] == 1
    db.close()


def test_marking_another_users_notification_is_not_allowed():
    db = SessionLocal()
    owner = create_user(db, "owner")
    other = create_user(db, "other")
    notification = create_notification(
        db,
        recipient_user_id=owner.id,
        notification_type="test",
        title="Private",
        message="Owner only",
    )
    db.commit()

    assert get_notification_for_user(db, notification.id, other.id) is None
    try:
        read_notification(notification.id, db=db, current_user=other)
    except HTTPException as error:
        assert error.status_code == 404
    else:
        raise AssertionError("A user must not read another user's notification")
    db.close()
