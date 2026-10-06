import os
import uuid

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

import routers.employee_documents as salary_router
from database import Base, SessionLocal, engine
from models import SalarySlip, User
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
    values = dict(month=5, year=2026, salary=1000, incentive=100, overtime=50,
                  extra_working_day=25, other=10)
    values.update(overrides)
    return SalarySlipRequestCreate(**values)


def review_payload(*amounts):
    if not amounts:
        amounts = (1200, 100, 50, 25, 10)
    names = ("Salary", "Incentive", "Overtime", "Extra Working Day", "Other")
    return SalarySlipReviewUpdate(particulars=[SalarySlipParticular(name=name, amount=amount) for name, amount in zip(names, amounts)])


def test_employee_submits_own_request_and_duplicate_is_rejected(db_session: Session):
    employee = make_user(db_session)
    other = make_user(db_session)
    payload = request_payload(employee_id=other.id)
    assert "employee_id" not in payload.model_dump()
    created = salary_router.request_salary_slip(payload, db_session, employee)
    row = db_session.query(SalarySlip).filter_by(id=created["id"]).one()
    assert row.employee_id == employee.id
    assert row.status == "Pending Review"
    assert row.total_amount == 1185
    with pytest.raises(HTTPException) as error:
        salary_router.request_salary_slip(payload, db_session, employee)
    assert error.value.status_code == 409


def test_pending_request_is_returned_as_pending_and_not_final(db_session: Session):
    employee = make_user(db_session)
    salary_router.request_salary_slip(request_payload(), db_session, employee)
    slips = salary_router.list_my_salary_slips(db_session, employee)
    assert [slip["status"] for slip in slips] == ["Pending Review"]
    assert all(slip["status"] == "Sent" for slip in slips if slip["status"] != "Pending Review")


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
    notifications = []
    monkeypatch.setattr(salary_router, "create_notification", lambda _db, **kwargs: notifications.append(kwargs))
    created = salary_router.request_salary_slip(request_payload(), db_session, employee)
    result = salary_router.approve_salary_slip(created["id"], review_payload(2100, 30, 10, 5, 1), db_session, admin)
    assert result["status"] == "Sent"
    assert result["total_amount"] == 2146
    assert result["email_sent"] is False
    assert notifications[0]["recipient_user_id"] == employee.id
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
