import os
from datetime import datetime, time, timedelta
from types import SimpleNamespace

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException

import routers.attendance as attendance_router
from models import Attendance, CompanySettings, Holiday, User
from utils.attendance_status import calculate_status, determine_attendance_status_for_date


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
    def __init__(self, model, settings, instant):
        self.model = model
        self.settings = settings
        self.instant = instant

    def filter(self, *_criteria):
        return self

    def order_by(self, *_criteria):
        return self

    def first(self):
        if self.model is User:
            return SimpleNamespace(date_of_joining=None, attendance_mode="office")
        if self.model is Attendance:
            return SimpleNamespace(
                manual_override=False,
                status=None,
                check_in=self.instant,
                check_out=None,
            )
        if self.model is CompanySettings:
            return self.settings
        return None

    def all(self):
        if self.model is Holiday:
            return []
        raise AssertionError(f"Unexpected query: {self.model}")


class AttendanceStatusDatabase:
    def __init__(self, settings, instant):
        self.settings = settings
        self.instant = instant

    def query(self, model):
        return AttendanceStatusQuery(model, self.settings, self.instant)


def _settings(grace_minutes, office_start_time=time(10, 0)):
    return CompanySettings(
        office_start_time=office_start_time,
        office_end_time=time(18, 30),
        late_grace_minutes=grace_minutes,
        weekly_off_day="Sunday",
    )


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
