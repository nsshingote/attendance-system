import os
import json
import uuid
from datetime import time

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

import routers.employee_documents as salary_router
from database import Base, SessionLocal, engine
from models import CompanySettings, Notification, SalarySlip, User
from schemas import SalarySlipRequestCreate, SalarySlipReviewUpdate, SalarySlipParticular


@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def make_user(db: Session, role: str = "user") -> User:
    suffix = uuid.uuid4().hex[:10]
    user = User(name=f"Salary {suffix}", mobile=suffix, email=f"{suffix}@example.com",
                password_hash="test", role=role, department="Test", designation="Tester", status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def request_payload(**overrides):
    values = dict(month=5, year=2026, salary=1000, incentive=100, overtime=50, extra_working_day=25)
    custom = overrides.pop("custom", [("Other detail", 10)])
    values.update(overrides)
    rows = [SalarySlipParticular(name=name, amount=values[field]) for name, field in (
        ("Salary", "salary"), ("Incentive", "incentive"), ("Overtime", "overtime"), ("Extra Working Day", "extra_working_day"),
    )]
    rows.extend(SalarySlipParticular(name=name, amount=amount) for name, amount in custom)
    return SalarySlipRequestCreate(month=values["month"], year=values["year"], particulars=rows)


def review_payload(*amounts):
    if not amounts:
        amounts = (1200, 100, 50, 25, 10)
    names = ("Salary", "Incentive", "Overtime", "Extra Working Day")
    rows = [SalarySlipParticular(name=name, amount=amount) for name, amount in zip(names, amounts[:4])]
    if len(amounts) > 4:
        rows.append(SalarySlipParticular(name="Travel Allowance", amount=amounts[4]))
    return SalarySlipReviewUpdate(particulars=rows)


def test_employee_submits_own_request_and_duplicate_is_rejected(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    other = make_user(db_session)
    admin = make_user(db_session, "admin")
    notifications = []
    monkeypatch.setattr(salary_router, "get_admin_user_ids", lambda *_args, **_kwargs: [admin.id])
    monkeypatch.setattr(salary_router, "create_notification", lambda _db, **kwargs: notifications.append(kwargs))
    payload = request_payload(employee_id=other.id)
    assert "employee_id" not in payload.model_dump()
    created = salary_router.request_salary_slip(payload, db_session, employee)
    row = db_session.query(SalarySlip).filter_by(id=created["id"]).one()
    assert row.employee_id == employee.id
    assert row.status == "Pending Review"
    assert row.total_amount == 1185
    assert notifications[0]["recipient_user_id"] == admin.id
    assert "May 2026" in notifications[0]["message"]
    assert notifications[0]["route"] == "/employee-documents/salary-slips"
    with pytest.raises(HTTPException) as error:
        salary_router.request_salary_slip(payload, db_session, employee)
    assert error.value.status_code == 409


def test_pending_request_is_returned_as_pending_and_not_final(db_session: Session):
    employee = make_user(db_session)
    salary_router.request_salary_slip(request_payload(), db_session, employee)
    slips = salary_router.list_my_salary_slips(db_session, employee)
    assert [slip["status"] for slip in slips] == ["Pending Review"]
    assert all(slip["status"] == "Sent" for slip in slips if slip["status"] != "Pending Review")


def test_request_accepts_multiple_custom_particulars_and_calculates_them(db_session: Session):
    employee = make_user(db_session)
    created = salary_router.request_salary_slip(
        request_payload(custom=[("Travel Allowance", 2000), ("Performance Bonus", 3000)]),
        db_session,
        employee,
    )
    rows = json.loads(created["particulars"])
    assert [row["name"] for row in rows][-2:] == ["Travel Allowance", "Performance Bonus"]
    assert created["total_amount"] == 6175


def test_admin_edits_pending_request_and_backend_recalculates_total(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    edited = salary_router.review_salary_slip(created["id"], review_payload(2000, 15, 20, 5, 3), db_session, admin)
    assert edited["status"] == "Pending Review"
    assert edited["total_amount"] == 2043


def test_approve_send_finalizes_and_email_failure_does_not_hide_slip(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "superadmin")
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    monkeypatch.setattr(salary_router, "send_email", lambda *_args, **_kwargs: False)
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    result = salary_router.approve_salary_slip(created["id"], review_payload(2100, 30, 10, 5, 1), db_session, admin)
    assert result["status"] == "Sent"
    assert result["total_amount"] == 2146
    assert result["email_sent"] is False
    notices = db_session.query(Notification).order_by(Notification.id).all()
    assert [notice.recipient_user_id for notice in notices] == [admin.id, employee.id]
    assert notices[0].notification_type == "salary_slip.requested"
    assert notices[1].title == "Salary slip approved and sent"
    visible = salary_router.list_my_salary_slips(db_session, employee)
    assert len(visible) == 1 and visible[0]["status"] == "Sent"


def test_employee_cannot_review_another_employees_request(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    other = make_user(db_session)
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    with pytest.raises(HTTPException) as error:
        salary_router.review_salary_slip(created["id"], review_payload(), db_session, other)
    assert error.value.status_code == 403


def test_pending_request_cannot_be_approved_twice(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    monkeypatch.setattr(salary_router, "send_email", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(salary_router, "create_notification", lambda *_args, **_kwargs: None)
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    salary_router.approve_salary_slip(created["id"], review_payload(), db_session, admin)
    with pytest.raises(HTTPException) as error:
        salary_router.approve_salary_slip(created["id"], review_payload(), db_session, admin)
    assert error.value.status_code == 404


def test_employee_can_cancel_only_their_own_pending_request_and_resubmit(db_session: Session):
    employee = make_user(db_session)
    other = make_user(db_session)
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    with pytest.raises(HTTPException) as error:
        salary_router.delete_my_pending_salary_slip(created["id"], db_session, other)
    assert error.value.status_code == 404
    result = salary_router.delete_my_pending_salary_slip(created["id"], db_session, employee)
    assert result["message"] == "Salary slip request cancelled"
    replacement = salary_router.request_salary_slip(request_payload(), db_session, employee)
    assert replacement["status"] == "Pending Review"


def test_employee_cannot_cancel_finalized_slip(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    monkeypatch.setattr(salary_router, "send_email", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(salary_router, "create_notification", lambda *_args, **_kwargs: None)
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    salary_router.approve_salary_slip(created["id"], review_payload(), db_session, admin)
    with pytest.raises(HTTPException) as error:
        salary_router.delete_my_pending_salary_slip(created["id"], db_session, employee)
    assert error.value.status_code == 404


def test_company_toggle_suppresses_only_salary_slip_notifications(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    db_session.add(CompanySettings(
        office_start_time=time(10, 0), office_end_time=time(18, 30), late_grace_minutes=30,
        weekly_off_day="Sunday", salary_slip_notifications_enabled=False,
    ))
    db_session.commit()
    monkeypatch.setattr(salary_router, "get_admin_user_ids", lambda *_args, **_kwargs: pytest.fail("notification toggle should suppress recipients"))
    notifications = []
    monkeypatch.setattr(salary_router, "create_notification", lambda _db, **kwargs: notifications.append(kwargs))
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    monkeypatch.setattr(salary_router, "send_email", lambda *_args, **_kwargs: False)
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    salary_router.approve_salary_slip(created["id"], review_payload(), db_session, admin)
    assert notifications == []
