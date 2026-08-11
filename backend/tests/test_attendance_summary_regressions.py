"""Regression tests for final-status attendance summaries."""

from datetime import date
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from routers.reports import _count_final_leave_category_days
from utils.attendance_status import update_summary_counts


class AttendanceSummaryRegressionTests(TestCase):
    def test_late_status_has_a_dedicated_counter(self):
        summary = {
            "Present": 0,
            "Late": 0,
            "Half Day": 0,
            "Holiday": 0,
            "Absent": 0,
            "WFH": 0,
            "Leave": 0,
        }

        update_summary_counts(summary, "Late")

        self.assertEqual(summary["Late"], 1)
        self.assertEqual(summary["Present"], 0)

    def test_overridden_lwp_day_is_not_counted_as_leave(self):
        target_date = date(2026, 8, 10)
        lwp_request = SimpleNamespace(
            manual_override_attendance_id=None,
            allocations=[
                SimpleNamespace(allocation_date=target_date, leave_category="Unpaid")
            ],
            from_date=target_date,
            to_date=target_date,
            leave_category="Unpaid",
        )

        with patch("routers.reports.determine_attendance_status_for_date", return_value="Present"):
            counts = _count_final_leave_category_days(
                db=None,
                user_id=7,
                leave_requests=[lwp_request],
                start_date=date(2026, 8, 1),
                end_date=date(2026, 9, 1),
            )

        self.assertEqual(counts["Unpaid"], 0)
