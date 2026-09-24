from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import routers.attendance as attendance


class QueryStub:
    def __init__(self, result):
        self.result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self.result

    def all(self):
        return self.result


class DatabaseStub:
    def __init__(self, settings):
        self.settings = settings

    def query(self, model):
        if model.__name__ == "CompanySettings":
            return QueryStub(self.settings)
        return QueryStub(None)


def make_request(client_host, forwarded_ip=None, **headers):
    if forwarded_ip is not None:
        headers["x-forwarded-for"] = forwarded_ip
    return SimpleNamespace(
        client=SimpleNamespace(host=client_host),
        headers=headers,
    )


def make_db(office_ip):
    return make_location_db(
        office_ip=office_ip,
        mode="ip_only",
        location_enabled=False,
        office_latitude=None,
        office_longitude=None,
        radius=200,
    )


def make_location_db(
    office_ip="203.0.113.10",
    mode="location_only",
    location_enabled=True,
    office_latitude=19.2262567,
    office_longitude=72.8262230,
    radius=200,
):
    settings = SimpleNamespace(
        attendance_validation_mode=mode,
        attendance_location_enabled=location_enabled,
        office_latitude=office_latitude,
        office_longitude=office_longitude,
        attendance_radius_meters=radius,
    )
    return DatabaseStub(settings)


def validate_ip(request, payload_ip, office_ip, monkeypatch):
    resolved_ip = attendance._get_client_ip(request)
    assert resolved_ip == request.client.host
    monkeypatch.setattr(
        attendance,
        "_validate_office_ip",
        lambda ip_address, db: ip_address == office_ip,
    )
    return attendance._attendance_validation(
        make_db(office_ip),
        resolved_ip,
        None,
        None,
        None,
        SimpleNamespace(attendance_mode="office"),
    )


def test_supplied_payload_ip_cannot_override_actual_request_ip(monkeypatch):
    request = make_request("198.51.100.20", "203.0.113.10")

    with pytest.raises(HTTPException) as error:
        validate_ip(request, "203.0.113.10", "203.0.113.10", monkeypatch)

    assert error.value.status_code == 403


def test_forwarded_ip_cannot_override_actual_request_ip(monkeypatch):
    request = make_request("198.51.100.20", "203.0.113.10")

    with pytest.raises(HTTPException) as error:
        validate_ip(request, None, "203.0.113.10", monkeypatch)

    assert error.value.status_code == 403


def test_forwarded_public_ip_is_used_when_request_comes_from_trusted_proxy(monkeypatch):
    request = make_request("172.18.0.1", "203.0.113.10")

    resolved_ip = attendance._get_client_ip(request)

    assert resolved_ip == "203.0.113.10"


def test_forwarded_ip_is_ignored_for_untrusted_request_peer(monkeypatch):
    request = make_request("198.51.100.20", "203.0.113.10")

    resolved_ip = attendance._get_client_ip(request)

    assert resolved_ip == "198.51.100.20"


def test_trusted_proxy_uses_x_real_ip_when_forwarded_for_is_missing():
    request = make_request("172.18.0.1", **{"x-real-ip": "203.0.113.10"})

    assert attendance._get_client_ip(request) == "203.0.113.10"


def test_trusted_proxy_uses_cloudflare_ip_when_other_forwarded_headers_are_missing():
    request = make_request("172.18.0.1", **{"cf-connecting-ip": "203.0.113.10"})

    assert attendance._get_client_ip(request) == "203.0.113.10"


def test_approved_actual_request_ip_passes_ip_only(monkeypatch):
    request = make_request("203.0.113.10", "198.51.100.20")

    assert validate_ip(request, "198.51.100.20", "203.0.113.10", monkeypatch) == ("ip", None)


def test_unapproved_actual_request_ip_fails_ip_only(monkeypatch):
    request = make_request("198.51.100.20", None)

    with pytest.raises(HTTPException) as error:
        validate_ip(request, None, "203.0.113.10", monkeypatch)

    assert error.value.status_code == 403


def test_location_inside_configured_radius_is_accepted(monkeypatch):
    monkeypatch.setattr(attendance, "_validate_office_ip", lambda ip_address, db: False)

    result = attendance._attendance_validation(
        make_location_db(),
        "198.51.100.20",
        19.2262567,
        72.8262230,
        50,
        SimpleNamespace(attendance_mode="office"),
    )

    assert result[0] == "location"
    assert result[1] == 0


def test_location_outside_configured_radius_is_rejected(monkeypatch):
    monkeypatch.setattr(attendance, "_validate_office_ip", lambda ip_address, db: False)

    with pytest.raises(HTTPException) as error:
        attendance._attendance_validation(
            make_location_db(radius=200),
            "198.51.100.20",
            19.2300000,
            72.8262230,
            50,
            SimpleNamespace(attendance_mode="office"),
        )

    assert error.value.status_code == 403
    assert error.value.detail.startswith("LOCATION_OUTSIDE_RADIUS")


def test_inaccurate_gps_is_rejected():
    with pytest.raises(HTTPException) as error:
        attendance._attendance_validation(
            make_location_db(),
            "198.51.100.20",
            19.2262567,
            72.8262230,
            101,
            SimpleNamespace(attendance_mode="office"),
        )

    assert error.value.status_code == 400
    assert error.value.detail.startswith("LOCATION_INACCURATE")


def test_missing_coordinates_are_rejected_for_location_only():
    with pytest.raises(HTTPException) as error:
        attendance._attendance_validation(
            make_location_db(),
            "198.51.100.20",
            None,
            None,
            None,
            SimpleNamespace(attendance_mode="office"),
        )

    assert error.value.status_code == 400
    assert error.value.detail.startswith("LOCATION_REQUIRED")


def test_ip_or_location_accepts_valid_ip_when_gps_is_invalid(monkeypatch):
    monkeypatch.setattr(attendance, "_validate_office_ip", lambda ip_address, db: True)

    result = attendance._attendance_validation(
        make_location_db(mode="ip_or_location"),
        "203.0.113.10",
        91,
        181,
        50,
        SimpleNamespace(attendance_mode="office"),
    )

    assert result == ("ip", None)


def test_ip_or_location_accepts_valid_gps_when_ip_is_invalid(monkeypatch):
    monkeypatch.setattr(attendance, "_validate_office_ip", lambda ip_address, db: False)

    result = attendance._attendance_validation(
        make_location_db(mode="ip_or_location"),
        "198.51.100.20",
        19.2262567,
        72.8262230,
        50,
        SimpleNamespace(attendance_mode="office"),
    )

    assert result[0] == "location"


def test_wfh_validation_skip_does_not_require_gps_or_ip(monkeypatch):
    monkeypatch.setattr(attendance, "_validate_office_ip", lambda ip_address, db: False)

    assert attendance._attendance_validation(
        make_location_db(),
        "198.51.100.20",
        None,
        None,
        None,
        SimpleNamespace(attendance_mode="office"),
        skip=True,
    ) == (None, None)


def test_onsite_requires_gps_and_preserves_existing_behavior():
    with pytest.raises(HTTPException) as error:
        attendance._attendance_validation(
            make_location_db(mode="ip_only", location_enabled=False),
            "203.0.113.10",
            None,
            None,
            None,
            SimpleNamespace(attendance_mode="onsite"),
        )

    assert error.value.status_code == 400
