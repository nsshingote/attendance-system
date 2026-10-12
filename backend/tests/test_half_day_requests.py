import os
import uuid
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

import routers.attendance as attendance_router
import utils.email_service as email_service
from database import Base, SessionLocal, engine
from models import HalfDayRequest, Notification, User, WFHRequest
from schemas import HalfDayCreate, HalfDayDecision


@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def make_user(db: Session, role: str = "user", email: str | None = None) -> User:
    suffix = uuid.uuid4().hex[:10]
    user = User(
        name=f"Half Day {suffix}",
        mobile=suffix,
        email=email,
        password_hash="test",
        role=role,
        department="Test",
        designation="Tester",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_half_day_request(
    db: Session,
    employee: User,
    *,
    slot: str = "morning",
    reason: str | None = None,
) -> HalfDayRequest:
    request = HalfDayRequest(
        user_id=employee.id,
        attendance_date=date(2026, 10, 10),
        slot=slot,
        reason=reason,
        status="Pending",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


def allow_half_day_decision(monkeypatch) -> None:
    monkeypatch.setattr(attendance_router, "has_permission", lambda *_args: True)
    monkeypatch.setattr(attendance_router, "_require_approval_request_team_scope", lambda *_args: None)
    monkeypatch.setattr(attendance_router, "_require_office_request_mode", lambda *_args: None)


def decide_half_day(
    db: Session,
    admin: User,
    request: HalfDayRequest,
    status: str = "Approved",
):
    return attendance_router.decide_half_day(
        request.id,
        HalfDayDecision(status=status),
        db,
        admin,
    )


def test_half_day_submission_notifies_active_admins_and_superadmins(
    db_session: Session,
):
    employee = make_user(db_session)
    admin = make_user(db_session, role="admin")
    superadmin = make_user(db_session, role="superadmin")
    inactive_admin = make_user(db_session, role="admin")
    inactive_admin.status = "inactive"
    db_session.commit()
    attendance_date = date(2026, 10, 20)

    request = attendance_router.request_half_day(
        HalfDayCreate(
            attendance_date=attendance_date,
            slot="morning",
        ),
        db_session,
        employee,
    )

    notifications = db_session.query(Notification).order_by(Notification.recipient_user_id).all()
    assert {notification.recipient_user_id for notification in notifications} == {
        admin.id,
        superadmin.id,
    }
    assert all(notification.recipient_user_id != employee.id for notification in notifications)
    assert all(notification.notification_type == "half_day.submitted" for notification in notifications)
    assert all(notification.title == "New half-day request" for notification in notifications)
    assert all(
        notification.message
        == f"{employee.name} submitted a half-day request for {attendance_date} (Morning Slot)."
        for notification in notifications
    )
    assert all(notification.route == "/leave" for notification in notifications)
    assert all(notification.entity_type == "half_day_request" for notification in notifications)
    assert all(notification.entity_id == request.id for notification in notifications)


def test_half_day_submission_failure_does_not_persist_request_or_notifications(
    db_session: Session,
    monkeypatch,
):
    employee = make_user(db_session)
    make_user(db_session, role="admin")
    original_commit = db_session.commit

    def fail_commit():
        raise RuntimeError("simulated request transaction failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="simulated request transaction failure"):
        attendance_router.request_half_day(
            HalfDayCreate(
                attendance_date=date(2026, 10, 20),
                slot="afternoon",
            ),
            db_session,
            employee,
        )

    monkeypatch.setattr(db_session, "commit", original_commit)
    db_session.rollback()
    assert db_session.query(HalfDayRequest).count() == 0
    assert db_session.query(Notification).count() == 0


def test_approved_half_day_notifies_employee_and_emails_slot_and_date(db_session: Session, monkeypatch):
    employee = make_user(db_session, email="employee@example.com")
    admin = make_user(db_session, role="admin", email="admin@example.com")
    request = make_half_day_request(db_session, employee, slot="morning")
    email_calls = []
    monkeypatch.setattr(
        attendance_router,
        "send_half_day_decision_notification",
        lambda *args: email_calls.append(args) or True,
    )
    allow_half_day_decision(monkeypatch)

    decide_half_day(db_session, admin, request)

    notification = db_session.query(Notification).filter_by(recipient_user_id=employee.id).one()
    assert notification.notification_type == "half_day.approved"
    assert notification.title == "Half-day request approved"
    assert notification.message == "Your half-day request for 2026-10-10 (Morning Slot) was approved."
    assert notification.route == "/attendance"
    assert notification.entity_type == "half_day_request"
    assert notification.entity_id == request.id
    assert email_calls == [
        ("employee@example.com", employee.name, "Approved", date(2026, 10, 10), "Morning Slot")
    ]


def test_email_failure_does_not_undo_half_day_approval(db_session: Session, monkeypatch):
    employee = make_user(db_session, email="employee@example.com")
    admin = make_user(db_session, role="admin", email="admin@example.com")
    request = make_half_day_request(db_session, employee, slot="afternoon")
    monkeypatch.setattr(
        attendance_router,
        "send_half_day_decision_notification",
        lambda *_args: False,
    )
    allow_half_day_decision(monkeypatch)

    decided = decide_half_day(db_session, admin, request)

    assert decided.status == "Approved"
    assert db_session.query(HalfDayRequest).filter_by(id=request.id).one().status == "Approved"
    assert db_session.query(Notification).filter_by(recipient_user_id=employee.id).count() == 1


def test_repeated_approval_does_not_duplicate_notification_or_email(db_session: Session, monkeypatch):
    employee = make_user(db_session, email="employee@example.com")
    admin = make_user(db_session, role="admin", email="admin@example.com")
    request = make_half_day_request(db_session, employee)
    email_calls = []
    monkeypatch.setattr(
        attendance_router,
        "send_half_day_decision_notification",
        lambda *args: email_calls.append(args) or True,
    )
    allow_half_day_decision(monkeypatch)

    decide_half_day(db_session, admin, request)
    with pytest.raises(HTTPException) as exc_info:
        decide_half_day(db_session, admin, request)

    assert exc_info.value.status_code == 400
    assert db_session.query(Notification).filter_by(recipient_user_id=employee.id).count() == 1
    assert len(email_calls) == 1


def test_rejected_half_day_does_not_send_approval_notification_or_email(db_session: Session, monkeypatch):
    employee = make_user(db_session, email="employee@example.com")
    admin = make_user(db_session, role="admin", email="admin@example.com")
    request = make_half_day_request(db_session, employee)
    email_calls = []
    monkeypatch.setattr(
        attendance_router,
        "send_half_day_decision_notification",
        lambda *args: email_calls.append(args) or True,
    )
    allow_half_day_decision(monkeypatch)

    decided = decide_half_day(db_session, admin, request, "Rejected")

    assert decided.status == "Rejected"
    assert db_session.query(Notification).filter_by(recipient_user_id=employee.id).count() == 0
    assert email_calls == []


@pytest.mark.parametrize(
    ("reason", "expected_reason"),
    [(None, None), ("", ""), ("Medical appointment", "Medical appointment")],
)
def test_half_day_request_accepts_optional_reason_and_saves_provided_value(
    db_session: Session,
    monkeypatch,
    reason: str | None,
    expected_reason: str | None,
):
    employee = make_user(db_session)
    payload_values = {
        "attendance_date": date.today() + timedelta(days=1),
        "slot": "afternoon",
    }
    if reason is not None:
        payload_values["reason"] = reason

    request = attendance_router.request_half_day(
        HalfDayCreate(**payload_values),
        db_session,
        employee,
    )

    assert request.reason == expected_reason
    assert request.slot == "afternoon"
    saved = db_session.query(HalfDayRequest).filter_by(id=request.id).one()
    assert saved.reason == expected_reason
    assert saved.slot == "afternoon"


def test_existing_slot_values_remain_accepted_by_request_and_notification(db_session: Session, monkeypatch):
    employee = make_user(db_session, email="employee@example.com")
    admin = make_user(db_session, role="admin", email="admin@example.com")
    morning = make_half_day_request(db_session, employee, slot="morning")
    # Keep a single request per date; both legacy enum values are exercised.
    morning.attendance_date = date(2026, 10, 9)
    afternoon = make_half_day_request(db_session, employee, slot="afternoon")
    email_calls = []
    monkeypatch.setattr(
        attendance_router,
        "send_half_day_decision_notification",
        lambda *args: email_calls.append(args) or True,
    )
    allow_half_day_decision(monkeypatch)

    decide_half_day(db_session, admin, morning)
    decide_half_day(db_session, admin, afternoon)

    assert {item.slot for item in db_session.query(HalfDayRequest).all()} == {"morning", "afternoon"}
    assert [call[-1] for call in email_calls] == ["Morning Slot", "Afternoon Slot"]


def test_half_day_decision_skips_email_without_valid_employee_email(db_session: Session, monkeypatch):
    employee = make_user(db_session, email="not-an-email")
    calls = []
    monkeypatch.setattr(email_service, "send_email", lambda *args, **kwargs: calls.append(args) or True)

    sent = email_service.send_half_day_decision_notification(
        employee.email,
        employee.name,
        "Approved",
        date(2026, 10, 10),
        "Morning Slot",
    )

    assert sent is False
    assert calls == []


def test_half_day_email_uses_approval_status_date_and_slot_label(monkeypatch):
    calls = []
    monkeypatch.setattr(email_service, "send_email", lambda *args: calls.append(args) or True)

    sent = email_service.send_half_day_decision_notification(
        "employee@example.com",
        "Employee Name",
        "Approved",
        date(2026, 10, 10),
        "Afternoon Slot",
    )

    assert sent is True
    recipients, subject, body = calls[0]
    assert recipients == ["employee@example.com"]
    assert subject == "Your half-day request for 2026-10-10 has been Approved"
    assert "Employee Name" in body
    assert "2026-10-10" in body
    assert "Afternoon Slot" in body
    assert "Approved" in body


def test_wfh_approval_notification_flow_remains_unchanged(db_session: Session, monkeypatch):
    employee = make_user(db_session, email="employee@example.com")
    admin = make_user(db_session, role="admin", email="admin@example.com")
    request = WFHRequest(
        user_id=employee.id,
        attendance_date=date.today() + timedelta(days=1),
        status="Pending",
    )
    db_session.add(request)
    db_session.commit()
    db_session.refresh(request)
    wfh_email_calls = []
    monkeypatch.setattr(attendance_router, "has_permission", lambda *_args: True)
    monkeypatch.setattr(attendance_router, "_require_approval_request_team_scope", lambda *_args: None)
    monkeypatch.setattr(attendance_router, "_require_office_request_mode", lambda *_args: None)
    monkeypatch.setattr(attendance_router, "send_wfh_decision_notification", lambda *args: wfh_email_calls.append(args))

    decided = attendance_router.decide_wfh(
        request.id,
        attendance_router.WFHDecision(status="Approved"),
        db_session,
        admin,
    )

    notification = db_session.query(Notification).filter_by(recipient_user_id=employee.id).one()
    assert decided.status == "Approved"
    assert notification.notification_type == "wfh.approved"
    assert wfh_email_calls[0][0] == "employee@example.com"
