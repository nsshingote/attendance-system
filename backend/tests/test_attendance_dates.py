from datetime import datetime, timezone
import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import utils.date_helpers as date_helpers
import routers.attendance as attendance_router
import routers.dashboard as dashboard_router


def test_dashboard_and_check_in_share_india_calendar_date(monkeypatch):
    utc_instant = datetime(2026, 10, 8, 20, 0, tzinfo=timezone.utc)

    class FrozenDateTime:
        @staticmethod
        def now(tz=None):
            return utc_instant.astimezone(tz) if tz else utc_instant.replace(tzinfo=None)

    monkeypatch.setattr(date_helpers, "datetime", FrozenDateTime)

    check_in_date = attendance_router.india_now().date()
    dashboard_date = dashboard_router.india_today()

    assert check_in_date.isoformat() == "2026-10-09"
    assert dashboard_date == check_in_date
