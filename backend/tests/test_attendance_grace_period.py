import os
from datetime import datetime, time, timedelta
from types import SimpleNamespace

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException

import routers.attendance as attendance_router
from models import Attendance, ChangedLog, CompanySettings, Holiday, User
from utils.attendance_status import (
    _effective_grace_minutes_for_check_in,
    calculate_status,
    determine_attendance_status_for_date,
)


class StopAfterAttendanceAdd(Exception):
    def __init__(self, record):
        self.record = record


class FakeQuery:
    def __init__(self, model, settings):
        self.model = model
        self.settings = settings

    def filter(self, *_criteria):
        return self

    def first(self):
        if self.model is Attendance:
            return None
        if self.model is CompanySettings:
            return self.settings
        raise AssertionError(f"Unexpected query: {self.model}")


class FakeDatabase:
    def __init__(self, settings):
        self.settings = settings

    def query(self, model):
        return FakeQuery(model, self.settings)

    def add(self, record):
        if isinstance(record, Attendance):
            raise StopAfterAttendanceAdd(record)
        raise AssertionError(f"Unexpected database write: {record}")


class AttendanceStatusQuery:
    def __init__(
        self,
        model,
        settings,
        instant,
        changed_logs,
        attendance_status,
        manual_override,
        attendance_mode,
    ):
        self.model = model
        self.settings = settings
        self.instant = instant
        self.changed_logs = changed_logs
        self.attendance_status = attendance_status
        self.manual_override = manual_override
        self.attendance_mode = attendance_mode
        self.criteria = []
        self.order_criteria = []

    def filter(self, *criteria):
        self.criteria.extend(criteria)
        return self

    def order_by(self, *criteria):
        self.order_criteria.extend(criteria)
        return self

    def first(self):
        if self.model is ChangedLog:
            candidates = self._filtered_changed_log_rows()
            if not candidates:
                return None
            cutoff = any(criterion.left.key == "created_at" for criterion in self.criteria)
            return (
                max(candidates, key=lambda row: (row.created_at, row.id))
                if cutoff
                else min(candidates, key=lambda row: (row.created_at, row.id))
            )
        if self.model is User:
            return SimpleNamespace(date_of_joining=None, attendance_mode=self.attendance_mode)
        if self.model is Attendance:
            return SimpleNamespace(
                manual_override=self.manual_override,
                status=self.attendance_status,
                check_in=self.instant,
                check_out=None,
            )
        if self.model is CompanySettings:
            return self.settings
        return None

    def _filtered_changed_log_rows(self):
        candidates = list(self.changed_logs)
        for criterion in self.criteria:
            field = criterion.left.key
            expected = criterion.right.value
            operator_name = criterion.operator.__name__
            if operator_name == "eq":
                candidates = [
                    row for row in candidates if getattr(row, field) == expected
                ]
            elif operator_name == "le":
                candidates = [
                    row for row in candidates if getattr(row, field) <= expected
                ]
        return candidates

    def all(self):
        if self.model is ChangedLog:
            candidates = self._filtered_changed_log_rows()
            if not self.order_criteria:
                return candidates

            def order_key(criterion):
                element = getattr(criterion, "element", None)
                name = getattr(element, "name", None) or getattr(criterion, "key", None)
                return name or "id"

            return sorted(
                candidates,
                key=lambda row: tuple(
                    getattr(row, order_key(criterion))
                    for criterion in self.order_criteria
                ),
            )
        if self.model is Holiday:
            return []
        raise AssertionError(f"Unexpected query: {self.model}")


class AttendanceStatusDatabase:
    def __init__(
        self,
        settings,
        instant,
        changed_logs=(),
        attendance_status=None,
        manual_override=False,
        attendance_mode="office",
    ):
        self.settings = settings
        self.instant = instant
        self.changed_logs = list(changed_logs)
        self.attendance_status = attendance_status
        self.manual_override = manual_override
        self.attendance_mode = attendance_mode

    def query(self, model):
        return AttendanceStatusQuery(
            model,
            self.settings,
            self.instant,
            self.changed_logs,
            self.attendance_status,
            self.manual_override,
            self.attendance_mode,
        )


def _settings(grace_minutes, office_start_time=time(10, 0)):
    return CompanySettings(
        office_start_time=office_start_time,
        office_end_time=time(18, 30),
        late_grace_minutes=grace_minutes,
        weekly_off_day="Sunday",
    )


def _grace_change_history():
    return [
        ChangedLog(
            id=1,
            category="settings",
            item_name="Late Grace Minutes",
            old_value="31",
            new_value="30",
            created_at=datetime(2026, 10, 17, 5, 5, 29),
        ),
        ChangedLog(
            id=2,
            category="settings",
            item_name="Late Grace Minutes",
            old_value="30",
            new_value="15",
            created_at=datetime(2026, 11, 12, 13, 32, 14),
        ),
    ]


def _check_in(monkeypatch, instant, settings, *, reason=None, onsite=False):
    db = FakeDatabase(settings)
    monkeypatch.setattr(attendance_router, "india_now", lambda: instant)
    monkeypatch.setattr(attendance_router, "_has_pending_wfh", lambda *_args: False)
    monkeypatch.setattr(attendance_router, "_has_approved_wfh", lambda *_args: False)
    monkeypatch.setattr(attendance_router, "_get_client_ip", lambda *_args: "192.0.2.10")
    monkeypatch.setattr(attendance_router, "_is_working_day", lambda *_args: True)
    monkeypatch.setattr(attendance_router, "_attendance_validation", lambda *_args: ("ip", None))
    monkeypatch.setattr(attendance_router, "_validate_location", lambda *_args: None)

    request = SimpleNamespace(client=SimpleNamespace(host="192.0.2.10"), headers={})
    user = SimpleNamespace(id=1, attendance_mode="onsite" if onsite else "office")
    payload = SimpleNamespace(
        reason=reason,
        latitude=1.0,
        longitude=1.0,
        accuracy=1.0,
    )
    return attendance_router.check_in(request, payload, db, user)


@pytest.mark.parametrize("grace_minutes", [15, 30])
@pytest.mark.parametrize("seconds_after_cutoff", [-1, 0, 59, 60])
def test_late_status_and_reason_requirement_share_the_grace_boundary(
    monkeypatch, grace_minutes, seconds_after_cutoff
):
    cutoff_minutes = 10 * 60 + grace_minutes
    instant = datetime(2026, 11, 12, cutoff_minutes // 60, cutoff_minutes % 60)
    instant += timedelta(seconds=seconds_after_cutoff)
    db = FakeDatabase(_settings(grace_minutes))
    expected_late = seconds_after_cutoff >= 60

    assert calculate_status(instant, db) == ("Late" if expected_late else "Present")
    assert determine_attendance_status_for_date(
        AttendanceStatusDatabase(_settings(grace_minutes), instant),
        user_id=1,
        target_date=instant.date(),
    ) == ("Late" if expected_late else "Present")

    if expected_late:
        with pytest.raises(HTTPException) as error:
            _check_in(monkeypatch, instant, _settings(grace_minutes))
        assert error.value.status_code == 400
        assert error.value.detail.startswith("REASON_REQUIRED")

        with pytest.raises(StopAfterAttendanceAdd) as checked_in:
            _check_in(monkeypatch, instant, _settings(grace_minutes), reason="Approved reason")
        assert checked_in.value.record.status == "Late"
    else:
        with pytest.raises(StopAfterAttendanceAdd) as checked_in:
            _check_in(monkeypatch, instant, _settings(grace_minutes))
        assert checked_in.value.record.status == "Present"


def test_configured_sqlalchemy_time_start_is_used_for_status_and_reason_boundary(monkeypatch):
    settings = _settings(15, office_start_time=time(9, 0))
    instant = datetime(2026, 11, 12, 9, 16)

    assert isinstance(settings.office_start_time, time)
    assert calculate_status(instant, FakeDatabase(settings)) == "Late"
    assert determine_attendance_status_for_date(
        AttendanceStatusDatabase(settings, instant),
        user_id=1,
        target_date=instant.date(),
    ) == "Late"
    with pytest.raises(HTTPException) as error:
        _check_in(monkeypatch, instant, settings)
    assert error.value.detail.startswith("REASON_REQUIRED")


def test_onsite_check_in_keeps_the_existing_no_reason_exception(monkeypatch):
    instant = datetime(2026, 11, 12, 10, 31)

    with pytest.raises(StopAfterAttendanceAdd) as checked_in:
        _check_in(monkeypatch, instant, _settings(30), onsite=True)

    assert checked_in.value.record.status == "Present"


@pytest.mark.parametrize(
    ("instant", "expected_status"),
    [
        (datetime(2026, 11, 11, 10, 20), "Present"),
        (datetime(2026, 11, 11, 10, 30), "Present"),
        (datetime(2026, 11, 11, 10, 31), "Late"),
        (datetime(2026, 11, 12, 10, 15), "Present"),
        (datetime(2026, 11, 12, 10, 16), "Present"),
        (datetime(2026, 11, 13, 10, 16), "Late"),
    ],
)
def test_status_uses_grace_period_effective_at_check_in(instant, expected_status):
    db = AttendanceStatusDatabase(
        _settings(15),
        instant,
        changed_logs=_grace_change_history(),
    )

    assert determine_attendance_status_for_date(db, user_id=1, target_date=instant.date()) == expected_status


def test_preloaded_grace_history_is_shared_across_employees_and_dates():
    history = _grace_change_history()
    first_instant = datetime(2026, 11, 12, 10, 14)
    second_instant = datetime(2026, 11, 13, 10, 15)

    first_db = AttendanceStatusDatabase(_settings(15), first_instant, changed_logs=history)
    second_db = AttendanceStatusDatabase(_settings(15), second_instant, changed_logs=history)

    assert determine_attendance_status_for_date(
        first_db,
        user_id=1,
        target_date=first_instant.date(),
        grace_history=history,
    ) == "Present"
    assert determine_attendance_status_for_date(
        second_db,
        user_id=2,
        target_date=second_instant.date(),
        grace_history=history,
    ) == "Present"


def test_no_grace_history_available_uses_current_setting():
    instant = datetime(2026, 11, 12, 10, 16)
    db = AttendanceStatusDatabase(_settings(30), instant, changed_logs=[])

    assert _effective_grace_minutes_for_check_in(
        db,
        instant,
        30,
        grace_history=[],
    ) == 30
    assert determine_attendance_status_for_date(
        db,
        user_id=1,
        target_date=instant.date(),
        grace_history=[],
    ) == "Present"


def test_grace_change_timestamp_is_compared_as_utc_against_ist_check_in():
    history = _grace_change_history()
    db = AttendanceStatusDatabase(_settings(15), datetime(2026, 11, 12), history)

    assert _effective_grace_minutes_for_check_in(
        db,
        datetime(2026, 11, 12, 19, 2, 13),
        15,
    ) == 30
    assert _effective_grace_minutes_for_check_in(
        db,
        datetime(2026, 11, 12, 19, 2, 14),
        15,
    ) == 15


def test_future_grace_changes_are_resolved_from_audit_history():
    history = _grace_change_history()
    history.append(
        ChangedLog(
            id=3,
            category="settings",
            item_name="Late Grace Minutes",
            old_value="15",
            new_value="10",
            created_at=datetime(2026, 11, 14, 0, 0, 0),
        )
    )
    db = AttendanceStatusDatabase(_settings(10), datetime(2026, 11, 14), history)

    assert _effective_grace_minutes_for_check_in(
        db, datetime(2026, 11, 14, 5, 29, 59), 10
    ) == 15
    assert _effective_grace_minutes_for_check_in(
        db, datetime(2026, 11, 14, 5, 30, 0), 10
    ) == 10


def test_approved_correction_uses_corrected_check_in_without_changing_stored_status():
    corrected_check_in = datetime(2026, 11, 11, 10, 20)
    db = AttendanceStatusDatabase(
        _settings(15),
        corrected_check_in,
        changed_logs=_grace_change_history(),
        attendance_status="Present",
    )

    assert determine_attendance_status_for_date(
        db, user_id=1, target_date=corrected_check_in.date()
    ) == "Present"
    assert db.attendance_status == "Present"


def test_onsite_attendance_remains_present_regardless_of_grace_history():
    instant = datetime(2026, 11, 13, 10, 31)
    db = AttendanceStatusDatabase(
        _settings(15),
        instant,
        changed_logs=_grace_change_history(),
        attendance_mode="onsite",
    )

    assert determine_attendance_status_for_date(db, user_id=1, target_date=instant.date()) == "Present"


def test_manual_override_remains_authoritative_after_grace_change():
    instant = datetime(2026, 11, 13, 10, 31)
    db = AttendanceStatusDatabase(
        _settings(15),
        instant,
        changed_logs=_grace_change_history(),
        attendance_status="Present",
        manual_override=True,
    )

    assert determine_attendance_status_for_date(db, user_id=1, target_date=instant.date()) == "Present"
