import os
import json
import uuid
from datetime import date, datetime, time, timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from database import Base, engine, SessionLocal
from models import (
    Attendance,
    CompanySettings,
    Holiday,
    LeaveHolidayAllocationHistory,
    LeaveRequest,
    LeaveRequestAllocation,
    User,
)
from routers.holidays import add_holiday, delete_holiday
from routers.company_settings import _read_company_settings_row, _upsert_company_settings_row
from routers.leave import (
    _apply_sandwich_rule_on_request,
    _reconcile_sandwich_allocations_for_user,
    apply_leave,
    cancel_leave,
    decide_leave,
    override_leave_allocations,
)
from schemas import (
    HolidayCreate,
    LeaveAllocationOverride,
    LeaveDecision,
    LeaveRequestAllocationIn,
    LeaveRequestCreate,
)
from utils.attendance_status import determine_attendance_status_for_date, holiday_applies_to_user
from utils.leave_calculator import _get_chargeable_leave_dates, allocate_leave_days


@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def create_user(db: Session, *, role: str = "user") -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        name=f"Leave Calculator Tester {suffix}",
        mobile=f"999999{suffix[:4]}",
        email=f"leave_calculator_{suffix}@example.com",
        password_hash="testhash",
        role=role,
        department="Test",
        designation="Tester",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_holiday(
    db: Session,
    created_by: int,
    target_date: date,
    *,
    applies_to: str = "all_users",
    target_user_ids: list[int] | None = None,
) -> Holiday:
    holiday = Holiday(
        holiday_date=target_date,
        holiday_name="Test Holiday",
        applies_to=applies_to,
        target_user_ids_json=(
            json.dumps(target_user_ids) if target_user_ids is not None else None
        ),
        created_by=created_by,
    )
    db.add(holiday)
    db.commit()
    return holiday


def create_company_settings(
    db: Session,
    *,
    weekly_off_day: str = "Sunday",
    sandwich_method_enabled: bool = False,
) -> CompanySettings:
    settings = CompanySettings(
        office_start_time=time(9, 30),
        office_end_time=time(18, 30),
        late_grace_minutes=15,
        weekly_off_day=weekly_off_day,
        sandwich_method_enabled=sandwich_method_enabled,
    )
    db.add(settings)
    db.commit()
    return settings


def create_leave_request(
    db: Session,
    user: User,
    from_date: date,
    to_date: date,
    allocations: list[tuple[date, str]],
    *,
    status: str = "Approved",
) -> LeaveRequest:
    leave_request = LeaveRequest(
        user_id=user.id,
        from_date=from_date,
        to_date=to_date,
        total_days=len(allocations),
        reason="Test leave",
        status=status,
        leave_category=(
            allocations[0][1] if allocations and len({c for _, c in allocations}) == 1 else "Unpaid"
        ),
    )
    leave_request.allocations = [
        LeaveRequestAllocation(allocation_date=allocation_date, leave_category=category)
        for allocation_date, category in allocations
    ]
    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)
    return leave_request


def chargeable_dates(
    db: Session,
    user: User,
    from_date: date,
    to_date: date,
    *,
    weekly_off_day: str,
    sandwich_method_enabled: bool,
) -> list[date]:
    """Exercise the intended calculator contract for weekly-off policy."""
    return _get_chargeable_leave_dates(
        db,
        user.id,
        from_date,
        to_date,
        weekly_off_day=weekly_off_day,
        sandwich_method_enabled=sandwich_method_enabled,
    )


def dates_between(from_date: date, to_date: date) -> list[date]:
    dates = []
    current_date = from_date
    while current_date <= to_date:
        dates.append(current_date)
        current_date += timedelta(days=1)
    return dates


def test_sunday_is_excluded_when_sandwich_method_is_off(db_session: Session):
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 20),
        date(2026, 9, 22),
        weekly_off_day="Sunday",
        sandwich_method_enabled=False,
    )

    assert result == [date(2026, 9, 21), date(2026, 9, 22)]


def test_sandwich_method_setting_persists_and_defaults_off(db_session: Session):
    defaults = _read_company_settings_row(db_session)
    assert defaults["sandwich_method_enabled"] is False

    updated = _upsert_company_settings_row(
        db_session,
        {
            "weekly_off_day": "Monday",
            "sandwich_method_enabled": True,
        },
    )

    assert updated["weekly_off_day"] == "Monday"
    assert updated["sandwich_method_enabled"] is True


def test_sandwich_setting_change_preserves_existing_approved_allocations(
    db_session: Session,
):
    settings = create_company_settings(db_session, sandwich_method_enabled=True)
    user = create_user(db_session)
    dates = [date(2026, 10, 10), date(2026, 10, 11), date(2026, 10, 12)]
    request = create_leave_request(
        db_session,
        user,
        dates[0],
        dates[-1],
        [(dates[0], "Unpaid"), (dates[1], "Unpaid"), (dates[2], "Unpaid")],
    )
    request.allocations[1].is_sandwich = True
    db_session.commit()

    _upsert_company_settings_row(
        db_session,
        {"weekly_off_day": "Sunday", "sandwich_method_enabled": False},
    )
    db_session.refresh(request)
    db_session.refresh(settings)

    assert settings.sandwich_method_enabled is False
    assert [row.allocation_date for row in request.allocations] == dates
    assert request.total_days == len(request.allocations) == 3


def test_sandwich_on_excludes_boundary_sunday(db_session: Session):
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 20),
        date(2026, 9, 22),
        weekly_off_day="Sunday",
        sandwich_method_enabled=True,
    )

    assert result == [date(2026, 9, 21), date(2026, 9, 22)]


def test_sandwich_on_includes_sunday_between_leave_dates(db_session: Session):
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 21),
        date(2026, 9, 28),
        weekly_off_day="Sunday",
        sandwich_method_enabled=True,
    )

    assert result == dates_between(date(2026, 9, 21), date(2026, 9, 28))


def test_configured_monday_off_is_excluded_when_sandwich_is_off(db_session: Session):
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 20),
        date(2026, 9, 22),
        weekly_off_day="Monday",
        sandwich_method_enabled=False,
    )

    assert result == [date(2026, 9, 20), date(2026, 9, 22)]


def test_configured_monday_off_can_be_sandwiched(db_session: Session):
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 20),
        date(2026, 9, 22),
        weekly_off_day="Monday",
        sandwich_method_enabled=True,
    )

    assert result == dates_between(date(2026, 9, 20), date(2026, 9, 22))


def test_applicable_weekday_holiday_is_excluded(db_session: Session):
    user = create_user(db_session)
    holiday_date = date(2026, 9, 22)
    create_holiday(db_session, user.id, holiday_date)

    result = _get_chargeable_leave_dates(
        db_session, user.id, date(2026, 9, 21), date(2026, 9, 23)
    )

    assert result == [date(2026, 9, 21), date(2026, 9, 23)]


@pytest.mark.parametrize("sandwich_method_enabled", [False, True])
def test_holiday_on_weekly_off_is_excluded_in_either_mode(
    db_session: Session,
    sandwich_method_enabled: bool,
):
    user = create_user(db_session)
    holiday_date = date(2026, 9, 27)
    create_holiday(db_session, user.id, holiday_date)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 26),
        date(2026, 9, 28),
        weekly_off_day="Sunday",
        sandwich_method_enabled=sandwich_method_enabled,
    )

    assert result == [date(2026, 9, 26), date(2026, 9, 28)]


def test_sandwich_on_includes_weekly_off_between_leave_dates(db_session: Session):
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 26),
        date(2026, 9, 28),
        weekly_off_day="Sunday",
        sandwich_method_enabled=True,
    )

    assert result == dates_between(date(2026, 9, 26), date(2026, 9, 28))


def test_sandwich_off_excludes_weekly_off_between_leave_dates(db_session: Session):
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 26),
        date(2026, 9, 28),
        weekly_off_day="Sunday",
        sandwich_method_enabled=False,
    )

    assert result == [date(2026, 9, 26), date(2026, 9, 28)]


def test_sandwich_on_does_not_reinclude_holiday_between_leave_dates(
    db_session: Session,
):
    user = create_user(db_session)
    holiday_date = date(2026, 9, 22)
    create_holiday(db_session, user.id, holiday_date)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 21),
        date(2026, 9, 24),
        weekly_off_day="Sunday",
        sandwich_method_enabled=True,
    )

    assert result == [
        date(2026, 9, 21),
        date(2026, 9, 23),
        date(2026, 9, 24),
    ]


def test_each_configured_weekly_off_occurrence_is_sandwiched_independently(
    db_session: Session,
):
    """One weekly_off_day represents recurring weekdays, not adjacent off-days."""
    user = create_user(db_session)

    result = chargeable_dates(
        db_session,
        user,
        date(2026, 9, 21),
        date(2026, 10, 5),
        weekly_off_day="Sunday",
        sandwich_method_enabled=True,
    )

    assert result == dates_between(date(2026, 9, 21), date(2026, 10, 5))


def test_mixed_allocation_assigns_one_category_to_every_chargeable_date(
    db_session: Session,
):
    user = create_user(db_session)
    chargeable = [
        date(2026, 10, 12),
        date(2026, 10, 13),
        date(2026, 10, 14),
    ]

    with (
        patch(
            "utils.leave_calculator._get_chargeable_leave_dates",
            return_value=chargeable,
        ),
        patch("utils.leave_calculator.get_carried_leave_balance", return_value=1),
        patch(
            "utils.leave_calculator.has_other_approved_or_pending_paid_leave_this_month",
            return_value=False,
        ),
    ):
        allocations = allocate_leave_days(
            db_session,
            user,
            chargeable[0],
            chargeable[-1],
            submission_date=date(2026, 10, 1),
        )

    assert [allocation_date for allocation_date, _ in allocations] == chargeable
    assert [category for _, category in allocations] == ["Paid", "Carried", "Unpaid"]
    assert all(category in {"Paid", "Carried", "Unpaid"} for _, category in allocations)


def test_allocation_does_not_drop_dates_when_paid_and_carried_balances_are_exhausted(
    db_session: Session,
):
    user = create_user(db_session)
    chargeable = [
        date(2026, 10, 12),
        date(2026, 10, 13),
        date(2026, 10, 14),
    ]

    with (
        patch(
            "utils.leave_calculator._get_chargeable_leave_dates",
            return_value=chargeable,
        ),
        patch("utils.leave_calculator.get_carried_leave_balance", return_value=0),
        patch(
            "utils.leave_calculator.has_other_approved_or_pending_paid_leave_this_month",
            return_value=True,
        ),
    ):
        allocations = allocate_leave_days(
            db_session,
            user,
            chargeable[0],
            chargeable[-1],
            submission_date=date(2026, 10, 1),
        )

    assert [allocation_date for allocation_date, _ in allocations] == chargeable
    assert [category for _, category in allocations] == ["Unpaid", "Unpaid", "Unpaid"]


def test_holiday_audience_excludes_only_users_it_applies_to(db_session: Session):
    user = create_user(db_session)
    other_user = create_user(db_session)
    holiday_date = date(2026, 9, 22)
    holiday = create_holiday(
        db_session,
        user.id,
        holiday_date,
        applies_to="specific_users",
        target_user_ids=[user.id],
    )

    assert holiday_applies_to_user(db_session, holiday, user.id) is True
    assert holiday_applies_to_user(db_session, holiday, other_user.id) is False
    assert _get_chargeable_leave_dates(
        db_session, user.id, holiday_date, holiday_date
    ) == []
    assert _get_chargeable_leave_dates(
        db_session, other_user.id, holiday_date, holiday_date
    ) == [holiday_date]


def test_approval_rebuilds_allocations_and_total_days_from_final_chargeable_dates(
    db_session: Session,
):
    create_company_settings(db_session)
    user = create_user(db_session)
    user.last_leave_accrual_date = date(2026, 9, 1)
    user.paid_leave_available = 1
    pending = create_leave_request(
        db_session,
        user,
        date(2026, 10, 10),
        date(2026, 10, 12),
        [
            (date(2026, 10, 10), "Paid"),
            (date(2026, 10, 11), "Unpaid"),
            (date(2026, 10, 12), "Unpaid"),
        ],
        status="Pending",
    )

    with (
        patch("routers.leave.require_team_member_access"),
        patch("routers.leave.refresh_leave_accrual"),
    ):
        approved = decide_leave(
            pending.id,
            LeaveDecision(status="Approved"),
            db=db_session,
            current_user=user,
        )

    assert approved.status == "Approved"
    assert [row.allocation_date for row in approved.allocations] == [
        date(2026, 10, 10),
        date(2026, 10, 12),
    ]
    assert approved.total_days == len(approved.allocations) == 2


def test_auto_approval_uses_final_allocations_for_total_and_attendance(
    db_session: Session,
):
    create_company_settings(db_session)
    approver = create_user(db_session, role="superadmin")
    employee = create_user(db_session)
    employee.last_leave_accrual_date = date(2026, 9, 1)
    employee.paid_leave_available = 1
    db_session.commit()

    with (
        patch("routers.leave.has_permission", return_value=True),
        patch("routers.leave.create_notification"),
    ):
        leave_request = apply_leave(
            LeaveRequestCreate(
                user_id=employee.id,
                from_date=date(2026, 10, 10),
                to_date=date(2026, 10, 12),
                reason="Auto-approval test",
            ),
            db=db_session,
            current_user=approver,
        )

    assert leave_request.status == "Approved"
    assert [row.allocation_date for row in leave_request.allocations] == [
        date(2026, 10, 10),
        date(2026, 10, 12),
    ]
    assert leave_request.total_days == len(leave_request.allocations) == 2
    assert db_session.query(Attendance).filter(
        Attendance.user_id == employee.id,
        Attendance.attendance_date == date(2026, 10, 11),
    ).first() is None
    assert db_session.query(Attendance).filter(
        Attendance.user_id == employee.id,
        Attendance.attendance_date.in_([date(2026, 10, 10), date(2026, 10, 12)]),
        Attendance.status == "On Leave",
    ).count() == 2


def test_sandwich_helper_adds_only_a_configured_weekly_off_between_adjacent_requests(
    db_session: Session,
):
    create_company_settings(db_session, sandwich_method_enabled=True)
    user = create_user(db_session)
    create_leave_request(
        db_session,
        user,
        date(2026, 10, 10),
        date(2026, 10, 10),
        [(date(2026, 10, 10), "Unpaid")],
    )
    current_request = create_leave_request(
        db_session,
        user,
        date(2026, 10, 12),
        date(2026, 10, 12),
        [(date(2026, 10, 12), "Unpaid")],
        status="Pending",
    )

    with patch("routers.leave.get_carried_leave_balance", return_value=0):
        _apply_sandwich_rule_on_request(db_session, current_request, user)

    assert [row.allocation_date for row in current_request.allocations] == [
        date(2026, 10, 11),
        date(2026, 10, 12),
    ]
    assert current_request.total_days == len(current_request.allocations) == 2


def test_holiday_added_after_approval_preserves_other_mixed_categories_and_attendance(
    db_session: Session,
):
    user = create_user(db_session)
    dates = dates_between(date(2026, 10, 12), date(2026, 10, 16))
    categories = ["Paid", "Paid", "Unpaid", "Unpaid", "Unpaid"]
    leave_request = create_leave_request(
        db_session,
        user,
        dates[0],
        dates[-1],
        list(zip(dates, categories)),
    )
    holiday_date = dates[2]
    attendance = Attendance(
        user_id=user.id,
        attendance_date=holiday_date,
        status="On Leave",
        check_in=datetime(2026, 10, 14, 9, 30),
        check_out=datetime(2026, 10, 14, 18, 30),
    )
    db_session.add(attendance)
    db_session.commit()

    add_holiday(
        HolidayCreate(holiday_date=holiday_date, holiday_name="New Holiday"),
        db=db_session,
        current_user=user,
    )

    saved = db_session.query(LeaveRequest).filter_by(id=leave_request.id).one()
    actual = {
        row.allocation_date: row.leave_category for row in saved.allocations
    }
    assert actual == dict(zip(dates[:2] + dates[3:], categories[:2] + categories[3:]))
    assert saved.total_days == len(saved.allocations) == 4
    assert attendance.status == "Holiday"
    assert attendance.check_in == datetime(2026, 10, 14, 9, 30)
    assert attendance.check_out == datetime(2026, 10, 14, 18, 30)


def test_holiday_added_restores_carried_leave_once(db_session: Session):
    user = create_user(db_session)
    user.carried_leave = 0
    target_date = date(2026, 10, 13)
    leave_request = create_leave_request(
        db_session,
        user,
        target_date,
        target_date,
        [(target_date, "Carried")],
    )
    db_session.refresh(user)
    user.carried_leave = 3
    db_session.commit()

    payload = HolidayCreate(holiday_date=target_date, holiday_name="Carry Holiday")
    add_holiday(payload, db=db_session, current_user=user)
    assert user.carried_leave == 4
    add_holiday(payload, db=db_session, current_user=user)
    assert user.carried_leave == 4


@pytest.mark.parametrize("category", ["Paid", "Carried", "Unpaid"])
def test_deleted_holiday_restores_the_original_allocation_category(
    db_session: Session,
    category: str,
):
    user = create_user(db_session)
    target_date = date(2026, 10, 13)
    user.carried_leave = 1
    request = create_leave_request(
        db_session,
        user,
        target_date,
        target_date,
        [(target_date, category)],
    )
    holiday = add_holiday(
        HolidayCreate(holiday_date=target_date, holiday_name="Category Holiday"),
        db=db_session,
        current_user=user,
    )

    history = db_session.query(LeaveHolidayAllocationHistory).filter_by(
        leave_request_id=request.id,
        allocation_date=target_date,
    ).one()
    assert history.leave_category == category
    assert history.is_restored is False

    delete_holiday(holiday["id"], db=db_session, current_user=user)

    db_session.refresh(request)
    db_session.refresh(user)
    db_session.refresh(history)
    assert [(row.allocation_date, row.leave_category) for row in request.allocations] == [
        (target_date, category)
    ]
    assert history.is_restored is True
    assert request.total_days == len(request.allocations) == 1
    assert user.carried_leave == (1 if category == "Carried" else 1)


def test_deleted_holiday_fallback_uses_request_start_for_paid_eligibility(
    db_session: Session,
):
    user = create_user(db_session)
    user.carried_leave = 0
    from_date = date(2026, 10, 12)
    holiday_date = date(2026, 10, 15)
    to_date = date(2026, 10, 16)
    holiday = create_holiday(db_session, user.id, holiday_date)
    request = create_leave_request(
        db_session,
        user,
        from_date,
        to_date,
        [
            (date(2026, 10, 12), "Unpaid"),
            (date(2026, 10, 13), "Unpaid"),
            (date(2026, 10, 14), "Unpaid"),
            (to_date, "Unpaid"),
        ],
    )
    submission_date = date(2026, 10, 10)
    request.created_at = datetime.combine(submission_date, time(9, 0))
    db_session.commit()

    delete_holiday(holiday.id, db=db_session, current_user=user)

    db_session.refresh(request)
    expected_category = dict(
        allocate_leave_days(
            db_session,
            user,
            from_date,
            to_date,
            submission_date=submission_date,
            exclude_leave_id=request.id,
        )
    )[holiday_date]
    restored_category = next(
        row.leave_category
        for row in request.allocations
        if row.allocation_date == holiday_date
    )
    assert expected_category == "Unpaid"
    assert restored_category == expected_category
    assert restored_category != "Paid"
    assert request.total_days == len(request.allocations) == 5


def test_deleting_sandwiched_weekly_off_holiday_restores_same_request_allocation(
    db_session: Session,
):
    create_company_settings(db_session, sandwich_method_enabled=True)
    user = create_user(db_session)
    saturday, sunday, monday = (
        date(2026, 10, 10),
        date(2026, 10, 11),
        date(2026, 10, 12),
    )
    request = create_leave_request(
        db_session,
        user,
        saturday,
        monday,
        [(saturday, "Unpaid"), (sunday, "Unpaid"), (monday, "Unpaid")],
    )
    request.allocations[1].is_sandwich = True
    db_session.commit()
    # Run normal holiday application so category history is present.
    holiday = add_holiday(
        HolidayCreate(holiday_date=sunday, holiday_name="Weekly Off Holiday"),
        db=db_session,
        current_user=user,
    )
    db_session.refresh(request)
    assert [row.allocation_date for row in request.allocations] == [saturday, monday]

    delete_holiday(holiday["id"], db=db_session, current_user=user)

    db_session.refresh(request)
    assert [row.allocation_date for row in request.allocations] == [
        saturday,
        sunday,
        monday,
    ]
    assert request.allocations[1].leave_category == "Unpaid"
    assert request.allocations[1].is_sandwich is True
    assert request.total_days == len(request.allocations) == 3


def test_pending_holiday_allocation_is_not_a_sandwich_boundary(db_session: Session):
    create_company_settings(db_session, sandwich_method_enabled=True)
    user = create_user(db_session)
    saturday = date(2026, 10, 10)
    sunday = date(2026, 10, 11)
    monday = date(2026, 10, 12)
    create_holiday(db_session, user.id, saturday)
    create_leave_request(
        db_session,
        user,
        saturday,
        saturday,
        [(saturday, "Unpaid")],
        status="Pending",
    )
    monday_request = create_leave_request(
        db_session,
        user,
        monday,
        monday,
        [(monday, "Unpaid")],
        status="Pending",
    )

    _apply_sandwich_rule_on_request(db_session, monday_request, user)

    assert all(row.allocation_date != sunday for row in monday_request.allocations)
    assert monday_request.total_days == len(monday_request.allocations) == 1


def test_cancelled_leave_side_removes_only_its_stale_sandwich_allocation(
    db_session: Session,
):
    create_company_settings(db_session, sandwich_method_enabled=True)
    user = create_user(db_session)
    saturday, sunday, monday = (
        date(2026, 10, 10),
        date(2026, 10, 11),
        date(2026, 10, 12),
    )
    saturday_request = create_leave_request(
        db_session, user, saturday, saturday, [(saturday, "Unpaid")]
    )
    monday_request = create_leave_request(
        db_session, user, monday, monday, [(monday, "Unpaid")]
    )
    _apply_sandwich_rule_on_request(db_session, monday_request, user)
    assert any(row.allocation_date == sunday for row in monday_request.allocations)

    with (
        patch("routers.leave.has_permission", return_value=True),
        patch("routers.leave.require_team_member_access"),
        patch("routers.leave.refresh_leave_accrual"),
        patch("routers.leave.create_notification"),
        patch("routers.leave.log_activity"),
    ):
        cancel_leave(
            saturday_request.id,
            db=db_session,
            current_user=user,
        )

    db_session.refresh(monday_request)
    assert all(row.allocation_date != sunday for row in monday_request.allocations)
    assert monday_request.total_days == len(monday_request.allocations) == 1


@pytest.mark.parametrize(
    ("sandwich_method_enabled", "weekly_off_day", "retain_sandwich"),
    [
        (False, "Sunday", False),
        (True, "Monday", False),
        (True, "Sunday", True),
    ],
)
def test_reconcile_sandwich_allocation_uses_current_company_settings(
    db_session: Session,
    sandwich_method_enabled: bool,
    weekly_off_day: str,
    retain_sandwich: bool,
):
    settings = create_company_settings(
        db_session,
        weekly_off_day="Sunday",
        sandwich_method_enabled=True,
    )
    user = create_user(db_session)
    saturday, sunday, monday = (
        date(2026, 10, 10),
        date(2026, 10, 11),
        date(2026, 10, 12),
    )
    create_leave_request(
        db_session,
        user,
        saturday,
        saturday,
        [(saturday, "Unpaid")],
    )
    monday_request = create_leave_request(
        db_session,
        user,
        monday,
        monday,
        [(monday, "Unpaid")],
    )
    _apply_sandwich_rule_on_request(db_session, monday_request, user)
    assert any(
        row.allocation_date == sunday and row.is_sandwich
        for row in monday_request.allocations
    )

    settings.sandwich_method_enabled = sandwich_method_enabled
    settings.weekly_off_day = weekly_off_day
    db_session.commit()
    _reconcile_sandwich_allocations_for_user(db_session, user.id)

    db_session.refresh(monday_request)
    sandwich_rows = [
        row for row in monday_request.allocations if row.allocation_date == sunday
    ]
    assert bool(sandwich_rows) is retain_sandwich
    if retain_sandwich:
        assert sandwich_rows[0].is_sandwich is True
    assert monday_request.total_days == len(monday_request.allocations)


def test_manual_override_accepts_saved_sandwich_allocation(db_session: Session):
    create_company_settings(db_session, sandwich_method_enabled=True)
    user = create_user(db_session)
    saturday, sunday, monday = (
        date(2026, 10, 10),
        date(2026, 10, 11),
        date(2026, 10, 12),
    )
    create_leave_request(
        db_session,
        user,
        saturday,
        saturday,
        [(saturday, "Unpaid")],
    )
    request = create_leave_request(
        db_session,
        user,
        monday,
        monday,
        [(monday, "Unpaid")],
    )
    _apply_sandwich_rule_on_request(db_session, request, user)
    db_session.commit()
    payload = LeaveAllocationOverride(
        allocations=[
            LeaveRequestAllocationIn(allocation_date=sunday, leave_category="Unpaid"),
            LeaveRequestAllocationIn(allocation_date=monday, leave_category="Unpaid"),
        ]
    )

    with patch("routers.leave.refresh_leave_accrual"):
        updated = override_leave_allocations(
            request.id,
            payload,
            db=db_session,
            current_user=user,
        )

    assert updated.total_days == len(updated.allocations) == 2
    assert next(row for row in updated.allocations if row.allocation_date == sunday).is_sandwich


def test_removed_allocation_does_not_leave_attendance_as_on_leave(db_session: Session):
    user = create_user(db_session)
    target_date = date(2026, 10, 13)
    request = create_leave_request(
        db_session,
        user,
        target_date,
        target_date,
        [(target_date, "Unpaid")],
    )
    attendance = Attendance(
        user_id=user.id,
        attendance_date=target_date,
        status="On Leave",
    )
    db_session.add(attendance)
    db_session.commit()

    request.allocations.clear()
    request.total_days = 0
    db_session.flush()

    assert determine_attendance_status_for_date(db_session, user.id, target_date) == "Absent"
    assert request.total_days == len(request.allocations) == 0


def test_deleting_holiday_reallocates_new_chargeable_date_without_negative_balance(
    db_session: Session,
):
    user = create_user(db_session)
    user.carried_leave = 0
    target_date = date(2026, 10, 13)
    holiday = create_holiday(db_session, user.id, target_date)
    leave_request = create_leave_request(
        db_session,
        user,
        target_date,
        target_date,
        [],
    )

    delete_holiday(holiday.id, db=db_session, current_user=user)

    db_session.refresh(leave_request)
    assert len(leave_request.allocations) == 1
    assert leave_request.allocations[0].allocation_date == target_date
    assert leave_request.allocations[0].leave_category == "Paid"
    assert leave_request.total_days == 1
    assert user.carried_leave == 0


def test_deleting_holiday_on_weekly_off_does_not_add_leave_when_sandwich_is_off(
    db_session: Session,
):
    create_company_settings(db_session, sandwich_method_enabled=False)
    user = create_user(db_session)
    sunday = date(2026, 10, 11)
    holiday = create_holiday(db_session, user.id, sunday)
    leave_request = create_leave_request(
        db_session,
        user,
        date(2026, 10, 10),
        date(2026, 10, 12),
        [
            (date(2026, 10, 10), "Unpaid"),
            (date(2026, 10, 12), "Unpaid"),
        ],
    )
    attendance = Attendance(
        user_id=user.id,
        attendance_date=sunday,
        status="Holiday",
    )
    db_session.add(attendance)
    db_session.commit()

    delete_holiday(holiday.id, db=db_session, current_user=user)

    db_session.refresh(leave_request)
    assert [row.allocation_date for row in leave_request.allocations] == [
        date(2026, 10, 10),
        date(2026, 10, 12),
    ]
    assert leave_request.total_days == 2
    assert attendance.status == "Absent"


def test_manual_allocation_override_rejects_excluded_weekly_off_and_syncs_total(
    db_session: Session,
):
    create_company_settings(db_session, sandwich_method_enabled=False)
    user = create_user(db_session)
    user.carried_leave = 0
    leave_request = create_leave_request(
        db_session,
        user,
        date(2026, 10, 10),
        date(2026, 10, 12),
        [
            (date(2026, 10, 10), "Carried"),
            (date(2026, 10, 11), "Carried"),
            (date(2026, 10, 12), "Unpaid"),
        ],
    )
    user.carried_leave = 0
    db_session.commit()
    payload = LeaveAllocationOverride(
        allocations=[
            LeaveRequestAllocationIn(
                allocation_date=date(2026, 10, 10),
                leave_category="Unpaid",
            ),
            LeaveRequestAllocationIn(
                allocation_date=date(2026, 10, 12),
                leave_category="Unpaid",
            ),
        ]
    )

    with (
        patch("routers.leave.get_carried_leave_balance", return_value=0),
        patch("routers.leave.refresh_leave_accrual"),
    ):
        updated = override_leave_allocations(
            leave_request.id,
            payload,
            db=db_session,
            current_user=user,
        )

    assert [row.allocation_date for row in updated.allocations] == [
        date(2026, 10, 10),
        date(2026, 10, 12),
    ]
    assert updated.total_days == len(updated.allocations) == 2
    assert user.carried_leave == 2


def test_manual_allocation_override_rejects_holiday_date(db_session: Session):
    create_company_settings(db_session)
    user = create_user(db_session)
    target_date = date(2026, 10, 13)
    create_holiday(db_session, user.id, target_date)
    leave_request = create_leave_request(
        db_session,
        user,
        date(2026, 10, 12),
        date(2026, 10, 14),
        [
            (date(2026, 10, 12), "Unpaid"),
            (date(2026, 10, 14), "Unpaid"),
        ],
        status="Pending",
    )

    payload = LeaveAllocationOverride(
        allocations=[
            LeaveRequestAllocationIn(allocation_date=date(2026, 10, 12), leave_category="Unpaid"),
            LeaveRequestAllocationIn(allocation_date=target_date, leave_category="Unpaid"),
            LeaveRequestAllocationIn(allocation_date=date(2026, 10, 14), leave_category="Unpaid"),
        ]
    )
    with pytest.raises(HTTPException) as error:
        override_leave_allocations(
            leave_request.id,
            payload,
            db=db_session,
            current_user=user,
        )
    assert error.value.detail == "Allocations must contain exactly the chargeable dates in the leave range."
