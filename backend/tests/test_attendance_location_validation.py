import os
import math
from types import SimpleNamespace

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException

import routers.attendance as attendance_router
from models import Attendance


class StopAfterGeofence(Exception):
    """Stop a route after validation without exercising unrelated attendance logic."""


class FakeQuery:
    def __init__(self, model, settings_rows):
        self.model = model
        self.settings_rows = settings_rows

    def order_by(self, _ordering):
        self.settings_rows = sorted(self.settings_rows, key=lambda row: row.id, reverse=True)
        return self

    def first(self):
        return self.settings_rows[0] if self.settings_rows else None

    def filter(self, *_criteria):
        if self.model is Attendance:
            raise StopAfterGeofence
        return self


class FakeDatabase:
    def __init__(self, settings_rows):
        self.settings_rows = settings_rows

    def query(self, model):
        return FakeQuery(model, self.settings_rows)


def settings_row(row_id=1, radius=200, mode="location_only"):
    return SimpleNamespace(
        id=row_id,
        attendance_location_enabled=True,
        attendance_validation_mode=mode,
        office_latitude=0.0,
        office_longitude=0.0,
        attendance_radius_meters=radius,
    )


def route_context(monkeypatch, settings_rows, *, onsite=False):
    monkeypatch.setattr(attendance_router, "_has_pending_wfh", lambda *_args: False)
    monkeypatch.setattr(attendance_router, "_has_approved_wfh", lambda *_args: False)
    monkeypatch.setattr(attendance_router, "_validate_office_ip", lambda *_args: False)
    db = FakeDatabase(settings_rows)
    request = SimpleNamespace(
        client=SimpleNamespace(host="192.0.2.10"),
        headers={},
    )
    user = SimpleNamespace(id=7, attendance_mode="onsite" if onsite else "office")
    return db, request, user


@pytest.mark.parametrize("endpoint", [attendance_router.check_in, attendance_router.check_out], ids=["check-in", "check-out"])
@pytest.mark.parametrize(("radius", "distance", "expected_error"), [
    (200, 200.0, None), (200, 200.01, "LOCATION_OUTSIDE_RADIUS"),
    (300, 300.0, None), (300, 300.01, "LOCATION_OUTSIDE_RADIUS"),
])
def test_check_in_and_out_apply_the_same_inclusive_configured_radius(
    monkeypatch, endpoint, radius, distance, expected_error
):
    db, request, user = route_context(monkeypatch, [settings_row(radius=radius)])
    monkeypatch.setattr(attendance_router, "_location_distance_meters", lambda *_args: distance)
    longitude = 0.0
    payload = SimpleNamespace(latitude=0.0, longitude=longitude, accuracy=float(radius), reason="test")

    if expected_error:
        with pytest.raises(HTTPException) as error:
            endpoint(request, payload, db, user)
        assert error.value.status_code == 403
        assert error.value.detail.startswith(expected_error)
    else:
        with pytest.raises(StopAfterGeofence):
            endpoint(request, payload, db, user)


@pytest.mark.parametrize("endpoint", [attendance_router.check_in, attendance_router.check_out], ids=["check-in", "check-out"])
@pytest.mark.parametrize("radius", [200, 300])
def test_accuracy_limit_uses_configured_radius_including_boundary(monkeypatch, endpoint, radius):
    db, request, user = route_context(monkeypatch, [settings_row(radius=radius)])
    monkeypatch.setattr(
        attendance_router,
        "_location_distance_meters",
        lambda *_args: 0.0,
    )
    payload = SimpleNamespace(latitude=37.0, longitude=-122.0, accuracy=float(radius), reason="test")

    with pytest.raises(StopAfterGeofence):
        endpoint(request, payload, db, user)

    payload.accuracy = radius + 0.01

    with pytest.raises(HTTPException) as error:
        endpoint(request, payload, db, user)
    assert error.value.status_code == 400
    assert error.value.detail.startswith("LOCATION_INACCURATE")


@pytest.mark.parametrize("endpoint", [attendance_router.check_in, attendance_router.check_out], ids=["check-in", "check-out"])
def test_validator_uses_the_latest_company_settings_row(monkeypatch, endpoint):
    db, request, user = route_context(
        monkeypatch,
        [settings_row(row_id=1, radius=100), settings_row(row_id=2, radius=200)],
    )
    longitude = math.degrees(150 / 6_371_000)
    payload = SimpleNamespace(latitude=0.0, longitude=longitude, accuracy=20.0, reason="test")

    # A 150 m fix is allowed by the latest row's 200 m radius, not the older row's 100 m radius.
    with pytest.raises(StopAfterGeofence):
        endpoint(request, payload, db, user)


def test_ip_or_location_mode_still_accepts_an_approved_ip_fallback(monkeypatch):
    db = FakeDatabase([settings_row(radius=200, mode="ip_or_location")])
    monkeypatch.setattr(attendance_router, "_validate_office_ip", lambda *_args: True)
    monkeypatch.setattr(attendance_router, "_location_distance_meters", lambda *_args: 250.0)
    user = SimpleNamespace(attendance_mode="office")

    method, distance = attendance_router._attendance_validation(
        db, "192.0.2.10", 37.0, -122.0, 20.0, user
    )

    assert (method, distance) == ("ip", None)


@pytest.mark.parametrize("endpoint", [attendance_router.check_in, attendance_router.check_out], ids=["check-in", "check-out"])
def test_onsite_route_keeps_its_existing_location_only_validation(monkeypatch, endpoint):
    db, request, user = route_context(monkeypatch, [settings_row(radius=1)], onsite=True)
    monkeypatch.setattr(
        attendance_router,
        "_location_distance_meters",
        lambda *_args: pytest.fail("onsite attendance must not use the office-radius geofence"),
    )
    payload = SimpleNamespace(latitude=37.0, longitude=-122.0, accuracy=150.0, reason="test")

    with pytest.raises(StopAfterGeofence):
        endpoint(request, payload, db, user)


def test_location_only_requires_a_reported_accuracy(monkeypatch):
    db = FakeDatabase([settings_row(radius=200)])
    monkeypatch.setattr(attendance_router, "_validate_office_ip", lambda *_args: False)
    monkeypatch.setattr(
        attendance_router,
        "_location_distance_meters",
        lambda *_args: pytest.fail("distance must not be calculated without reported accuracy"),
    )
    user = SimpleNamespace(attendance_mode="office")

    with pytest.raises(HTTPException) as error:
        attendance_router._attendance_validation(db, "192.0.2.10", 0.0, 0.0, None, user)

    assert error.value.status_code == 400
    assert error.value.detail.startswith("LOCATION_INACCURATE")
