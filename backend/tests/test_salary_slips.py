import os
import json
import uuid
from datetime import date, datetime, time

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

import routers.employee_documents as salary_router
from database import Base, SessionLocal, engine
from models import Attendance, CompanySettings, Holiday, LeaveRequest, LeaveRequestAllocation, Notification, SalarySlip, User, WFHRequest
from schemas import SalarySlipEmployeeDetails, SalarySlipRequestCreate, SalarySlipReviewUpdate, SalarySlipParticular, SalarySlipRow
from services.salary_attendance import derive_salary_attendance_counts
import services.salary_attendance as salary_attendance


@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def default_no_attendance_suggestions(monkeypatch):
    """Keep legacy workflow assertions independent of the real current date."""
    monkeypatch.setattr(salary_router, "derive_salary_attendance_counts", lambda *_args: {"lwp_days": 0.0, "half_day_days": 0.0})


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


def structured_rows():
    return [SalarySlipRow(name=name, amount=amount) for name, amount in (
        ("Basic Salary", 10000), ("House Rent Allowance", 2000), ("Incentive Pay", 100),
        ("Travelling Allowance", 200), ("Overtime", 100), ("Extra Working Day", 100),
    )]


def structured_deductions():
    return [SalarySlipRow(name=name, amount=amount) for name, amount in (
        ("Provident Fund", 100), ("Professional Tax", 50), ("Health Insurance Contribution", 25),
    )]


def structured_details(days_in_month=30):
    return SalarySlipEmployeeDetails(
        name="Employee", designation="Tester", department="Test", phone_number="123",
        email="employee@example.com", joining_date="01/01/2025", pan_number="", account_number="",
        location="Office", payment_mode="Bank Transfer", days_in_month=days_in_month,
        days_worked=min(28, days_in_month), days_paid=min(28, days_in_month),
    )


def structured_salary_slip(employee: User, **overrides) -> SalarySlip:
    values = {
        "employee_id": employee.id, "month": 5, "year": 2026,
        "particulars": json.dumps([row.model_dump() for row in structured_rows()]),
        "total_amount": 12325, "status": "Sent", "created_by": employee.id,
        "employee_details": json.dumps(structured_details().model_dump()),
        "earnings": json.dumps([row.model_dump() for row in structured_rows()]),
        "deductions": json.dumps([row.model_dump() for row in structured_deductions()]),
        "lwp_days": 0, "half_day_days": 0, "total_earnings": 12500,
        "lop_deduction": 0, "half_day_deduction": 0, "total_deductions": 175,
        "net_pay": 12325,
    }
    values.update(overrides)
    return SalarySlip(**values)


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


def test_structured_earnings_lop_deductions_and_net_pay_are_server_calculated(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    created = salary_router.request_salary_slip(
        SalarySlipRequestCreate(month=5, year=2026, earnings=structured_rows(), deductions=structured_deductions()),
        db_session, employee,
    )
    edited = salary_router.review_salary_slip(
        created["id"],
        SalarySlipReviewUpdate(
            employee_details=structured_details(30),
            earnings=structured_rows() + [SalarySlipRow(name="Joining Bonus", amount=500)],
            deductions=structured_deductions() + [SalarySlipRow(name="Other Recovery", amount=125)],
            lwp_days=2,
        ),
        db_session,
        admin,
    )
    assert edited["total_earnings"] == 13000
    assert edited["lop_deduction"] == 866.67
    assert edited["total_deductions"] == 1166.67
    assert edited["net_pay"] == 11833.33
    assert edited["total_amount"] == edited["net_pay"]
    assert edited["earnings"][-1] == {"name": "Joining Bonus", "amount": 500.0}
    assert edited["deductions"][-1] == {"name": "Other Recovery", "amount": 125.0}
    assert edited["status"] == "Pending Review"


def test_zero_lwp_produces_no_lop_deduction(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    created = salary_router.request_salary_slip(
        SalarySlipRequestCreate(month=5, year=2026, earnings=structured_rows(), deductions=structured_deductions()),
        db_session, employee,
    )
    reviewed = salary_router.review_salary_slip(
        created["id"], SalarySlipReviewUpdate(employee_details=structured_details(), deductions=structured_deductions(), lwp_days=0), db_session, admin,
    )
    assert reviewed["lop_deduction"] == 0
    assert reviewed["total_deductions"] == 175
    assert reviewed["net_pay"] == 12325


def test_approval_uses_reviewed_structured_values(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda _user, _key, _db: True)
    monkeypatch.setattr(salary_router, "send_email", lambda *_args, **_kwargs: False)
    created = salary_router.request_salary_slip(
        SalarySlipRequestCreate(month=5, year=2026, earnings=structured_rows(), deductions=structured_deductions()),
        db_session, employee,
    )
    result = salary_router.approve_salary_slip(
        created["id"],
        SalarySlipReviewUpdate(
            employee_details=structured_details(20),
            earnings=[SalarySlipRow(name=name, amount=2000 if name == "Basic Salary" else 0) for name in (
                "Basic Salary", "House Rent Allowance", "Incentive Pay", "Travelling Allowance", "Overtime", "Extra Working Day",
            )],
            deductions=[SalarySlipRow(name=name, amount=0) for name in ("Provident Fund", "Professional Tax", "Health Insurance Contribution")],
            lwp_days=1,
        ),
        db_session,
        admin,
    )
    assert result["status"] == "Sent"
    assert result["total_earnings"] == 2000
    assert result["lop_deduction"] == 100
    assert result["total_deductions"] == 100
    assert result["net_pay"] == 1900


def test_half_day_and_lwp_are_recalculated_on_approval(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda *_args: True)
    monkeypatch.setattr(salary_router, "send_email", lambda *_args, **_kwargs: False)
    created = salary_router.request_salary_slip(
        SalarySlipRequestCreate(month=5, year=2026, earnings=structured_rows(), deductions=structured_deductions()),
        db_session,
        employee,
    )
    result = salary_router.approve_salary_slip(
        created["id"],
        SalarySlipReviewUpdate(
            employee_details=structured_details(30),
            earnings=structured_rows() + [SalarySlipRow(name="Joining Bonus", amount=500)],
            deductions=structured_deductions(),
            lwp_days=2,
            half_day_days=2,
        ),
        db_session,
        admin,
    )
    assert result["total_earnings"] == 13000
    assert result["lop_deduction"] == 866.67
    assert result["half_day_deduction"] == 433.33
    assert result["salary_breakdown_total"] == 11700
    assert result["total_deductions"] == 1475
    assert result["net_pay"] == 11525
    assert result["half_day_days"] == 2


def test_employee_request_uses_backend_attendance_counts_not_submitted_counts(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    monkeypatch.setattr(salary_router, "derive_salary_attendance_counts", lambda *_args: {"lwp_days": 1.0, "half_day_days": 2.0})
    payload = SalarySlipRequestCreate(
        month=5, year=2026, earnings=structured_rows(), deductions=structured_deductions(),
        lwp_days=20, half_day_days=20,
    )
    result = salary_router.request_salary_slip(payload, db_session, employee)
    assert result["lwp_days"] == 1
    assert result["half_day_days"] == 2
    assert result["lop_deduction"] == 403.23
    assert result["half_day_deduction"] == 403.23


def test_employee_cannot_set_request_deduction_amounts_but_admin_can(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda *_args: True)
    request = SalarySlipRequestCreate(
        month=5, year=2026, earnings=structured_rows(),
        deductions=[SalarySlipRow(name="Provident Fund", amount=9000),
                    SalarySlipRow(name="Professional Tax", amount=9000),
                    SalarySlipRow(name="Health Insurance Contribution", amount=9000),
                    SalarySlipRow(name="Custom Recovery", amount=9000)],
    )
    pending = salary_router.request_salary_slip(request, db_session, employee)
    assert pending["deductions"] == [
        {"name": name, "amount": 0.0}
        for name in ("Provident Fund", "Professional Tax", "Health Insurance Contribution")
    ]

    authorized_rows = structured_deductions() + [SalarySlipRow(name="Custom Recovery", amount=125)]
    reviewed = salary_router.review_salary_slip(
        pending["id"], SalarySlipReviewUpdate(deductions=authorized_rows), db_session, admin,
    )
    assert reviewed["deductions"][-1] == {"name": "Custom Recovery", "amount": 125.0}


def test_employee_request_inherits_latest_sent_deductions_and_ignores_client_rows(db_session: Session):
    employee = make_user(db_session)
    older = structured_salary_slip(
        employee, month=4, sent_at=datetime(2026, 5, 31),
        created_at=datetime(2026, 5, 1),
        deductions=json.dumps([{"name": name, "amount": 1} for name in (
            "Provident Fund", "Professional Tax", "Health Insurance Contribution",
        )]),
    )
    latest_null_sent_at = structured_salary_slip(
        employee, month=5, sent_at=None, created_at=datetime(2026, 6, 5),
        deductions=json.dumps([
            {"name": "Provident Fund", "amount": 75},
            {"name": "Custom Recovery", "amount": 30},
            {"name": "Professional Tax", "amount": "bad"},
            None,
        ]),
    )
    db_session.add_all([older, latest_null_sent_at])
    db_session.commit()

    request = SalarySlipRequestCreate(
        month=6, year=2026, earnings=structured_rows(),
        deductions=[SalarySlipRow(name=name, amount=9999) for name in (
            "Provident Fund", "Professional Tax", "Health Insurance Contribution", "Employee Override",
        )],
    )
    result = salary_router.request_salary_slip(request, db_session, employee)

    assert result["deductions"] == [
        {"name": "Provident Fund", "amount": 75.0},
        {"name": "Professional Tax", "amount": 0.0},
        {"name": "Health Insurance Contribution", "amount": 0.0},
        {"name": "Custom Recovery", "amount": 30.0},
    ]


def test_admin_reviewed_deductions_survive_approval_when_approval_omits_rows(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "superadmin")
    monkeypatch.setattr(salary_router, "has_permission", lambda *_args: True)
    monkeypatch.setattr(salary_router, "send_email", lambda *_args, **_kwargs: False)
    pending = salary_router.request_salary_slip(
        SalarySlipRequestCreate(month=5, year=2026, earnings=structured_rows()), db_session, employee,
    )
    reviewed = salary_router.review_salary_slip(
        pending["id"],
        SalarySlipReviewUpdate(deductions=structured_deductions() + [SalarySlipRow(name="Custom Recovery", amount=125)]),
        db_session, admin,
    )
    assert reviewed["deductions"][-1] == {"name": "Custom Recovery", "amount": 125.0}

    approved = salary_router.approve_salary_slip(pending["id"], SalarySlipReviewUpdate(), db_session, admin)

    assert approved["deductions"][-1] == {"name": "Custom Recovery", "amount": 125.0}
    assert approved["total_deductions"] == 300
    assert approved["net_pay"] == 12200


def test_review_without_counts_refreshes_pending_attendance_suggestions(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    admin = make_user(db_session, "admin")
    monkeypatch.setattr(salary_router, "has_permission", lambda *_args: True)
    monkeypatch.setattr(salary_router, "derive_salary_attendance_counts", lambda *_args: {"lwp_days": 0.0, "half_day_days": 0.0})
    pending = salary_router.request_salary_slip(
        SalarySlipRequestCreate(month=5, year=2026, earnings=structured_rows()), db_session, employee,
    )
    monkeypatch.setattr(salary_router, "derive_salary_attendance_counts", lambda *_args: {"lwp_days": 3.0, "half_day_days": 2.0})
    refreshed = salary_router.review_salary_slip(
        pending["id"], SalarySlipReviewUpdate(), db_session, admin,
    )
    assert refreshed["lwp_days"] == 3
    assert refreshed["half_day_days"] == 2


def test_attendance_count_suggestions_respect_leave_dates_and_calendar_rules(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    employee.date_of_joining = date(2026, 5, 1)
    admin = make_user(db_session, "admin")
    db_session.add(CompanySettings(
        office_start_time=time(10, 0), office_end_time=time(18, 30),
        late_grace_minutes=30, weekly_off_day="Sunday",
    ))
    db_session.add_all([
        Attendance(user_id=employee.id, attendance_date=date(2026, 5, 1), status="Present", manual_override=True),
        Attendance(user_id=employee.id, attendance_date=date(2026, 5, 2), status="Present", manual_override=True),
        Attendance(user_id=employee.id, attendance_date=date(2026, 5, 5), status="Half Day", manual_override=True),
        Attendance(user_id=employee.id, attendance_date=date(2026, 5, 6), status="Half Day", manual_override=True),
        Attendance(user_id=employee.id, attendance_date=date(2026, 5, 7), status="On Leave"),
        Attendance(user_id=employee.id, attendance_date=date(2026, 5, 8), status="On Leave"),
        LeaveRequest(user_id=employee.id, from_date=date(2026, 5, 4), to_date=date(2026, 5, 4), total_days=1, status="Pending", leave_category="Unpaid"),
        LeaveRequest(user_id=employee.id, from_date=date(2026, 5, 5), to_date=date(2026, 5, 5), total_days=1, status="Pending", leave_category="Paid"),
        LeaveRequest(user_id=employee.id, from_date=date(2026, 5, 7), to_date=date(2026, 5, 7), total_days=1, status="Approved", leave_category="Unpaid"),
        LeaveRequest(user_id=employee.id, from_date=date(2026, 5, 8), to_date=date(2026, 5, 8), total_days=1, status="Approved", leave_category="Paid"),
        WFHRequest(user_id=employee.id, attendance_date=date(2026, 5, 9), status="Approved"),
        Holiday(holiday_date=date(2026, 5, 11), holiday_name="Holiday", applies_to="all_users", created_by=admin.id),
    ])
    db_session.flush()
    db_session.add_all([
        LeaveRequestAllocation(leave_request_id=request.id, allocation_date=leave_date, leave_category=category)
        for request, leave_date, category in (
            (db_session.query(LeaveRequest).filter_by(user_id=employee.id, from_date=date(2026, 5, 7)).one(), date(2026, 5, 7), "Unpaid"),
            (db_session.query(LeaveRequest).filter_by(user_id=employee.id, from_date=date(2026, 5, 8)).one(), date(2026, 5, 8), "Paid"),
        )
    ])
    db_session.commit()
    monkeypatch.setattr(salary_attendance, "india_today", lambda: date(2026, 5, 11))

    counts = derive_salary_attendance_counts(db_session, employee, 2026, 5)

    assert counts["lwp_days"] == 1.0
    assert counts["half_day_days"] == 1.0
    assert {item["date"] for item in counts["review_details"]} == {"2026-05-06", "2026-05-07"}
    assert any(item["status"] == "Half Day" and item["suggestion"] == "Half-Day" for item in counts["review_details"])
    assert db_session.query(Attendance).filter_by(user_id=employee.id).count() == 6


def test_today_without_final_attendance_is_not_suggested_as_lwp(db_session: Session, monkeypatch):
    employee = make_user(db_session)
    employee.date_of_joining = date(2026, 5, 12)
    db_session.commit()
    monkeypatch.setattr(salary_attendance, "india_today", lambda: date(2026, 5, 12))

    counts = derive_salary_attendance_counts(db_session, employee, 2026, 5)

    assert counts["lwp_days"] == 0
    assert counts["half_day_days"] == 0
    assert counts["review_details"] == []


def test_legacy_salary_slip_keeps_stored_amount_and_has_no_half_day(db_session: Session):
    employee = make_user(db_session)
    legacy = SalarySlip(
        employee_id=employee.id, month=5, year=2026, particulars='[{"name":"Salary","amount":1000}]',
        total_amount=987.65, status="Sent", created_by=employee.id,
    )
    db_session.add(legacy)
    db_session.commit()
    db_session.refresh(legacy)

    result = salary_router._salary_slip_dict(legacy)

    assert result["total_amount"] == 987.65
    assert result["net_pay"] == 987.65
    assert result["half_day_days"] is None
    assert result["half_day_deduction"] is None
    assert result["salary_breakdown_total"] is None
    assert result["historical_breakdown_incomplete"] is True
    salary_router._salary_slip_dict(legacy)
    db_session.refresh(legacy)
    assert float(legacy.total_amount) == 987.65


@pytest.mark.parametrize("overrides", [
    {"earnings": "[]", "deductions": "[]"},
    {"earnings": "{malformed", "deductions": "[malformed"},
    {"earnings": "[null]", "deductions": "[42]"},
    {"employee_details": "[]"},
    {"earnings": json.dumps([{"name": "Basic Salary", "amount": 12500}])},
    {"deductions": json.dumps([{"name": "Provident Fund", "amount": 175}])},
])
def test_invalid_or_incomplete_historical_breakdown_is_unavailable(db_session: Session, overrides):
    employee = make_user(db_session)
    slip = structured_salary_slip(employee, **overrides)
    db_session.add(slip)
    db_session.commit()

    result = salary_router._salary_slip_dict(slip)

    assert result["historical_breakdown_incomplete"] is True
    assert result["salary_breakdown_total"] is None
    assert result["total_earnings"] is None
    assert result["total_deductions"] is None
    assert result["net_pay"] == 12325
    assert result["total_amount"] == 12325


@pytest.mark.parametrize("particulars", ['{"not":"rows"}', "{malformed"])
def test_non_list_or_malformed_legacy_json_does_not_break_slip_response(db_session: Session, particulars: str):
    employee = make_user(db_session)
    slip = SalarySlip(
        employee_id=employee.id, month=5, year=2026, particulars=particulars,
        total_amount=987.65, status="Sent", created_by=employee.id,
    )
    db_session.add(slip)
    db_session.commit()

    result = salary_router._salary_slip_dict(slip)

    assert result["historical_breakdown_incomplete"] is True
    assert result["salary_breakdown_total"] is None
    assert result["net_pay"] == 987.65


def test_historical_rows_that_do_not_reconcile_with_stored_net_are_unavailable(db_session: Session):
    employee = make_user(db_session)
    slip = structured_salary_slip(employee, total_amount=12000, net_pay=12000)
    db_session.add(slip)
    db_session.commit()

    result = salary_router._salary_slip_dict(slip)

    assert result["historical_breakdown_incomplete"] is True
    assert result["salary_breakdown_total"] is None
    assert result["net_pay"] == 12000
    assert result["total_amount"] == 12000
