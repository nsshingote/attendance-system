import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.leave_calculator import count_leave_category_days


class LeaveCategoryCountTests(unittest.TestCase):
    def test_unpaid_and_privilege_are_counted_separately(self):
        requests = [
            type("LeaveRequest", (), {"status": "Approved", "leave_category": "Unpaid", "total_days": 3})(),
            type("LeaveRequest", (), {"status": "Approved", "leave_category": "Privilege", "total_days": 1})(),
        ]

        counts = count_leave_category_days(requests)

        self.assertEqual(counts["Unpaid"], 3)
        self.assertEqual(counts["Privilege"], 1)

    def test_conversion_from_unpaid_to_privilege_updates_counts(self):
        before = [
            type("LeaveRequest", (), {"status": "Approved", "leave_category": "Unpaid", "total_days": 1})(),
        ]
        after = [
            type("LeaveRequest", (), {"status": "Approved", "leave_category": "Privilege", "total_days": 1})(),
        ]

        before_counts = count_leave_category_days(before)
        after_counts = count_leave_category_days(after)

        self.assertEqual(before_counts["Unpaid"], 1)
        self.assertEqual(before_counts["Privilege"], 0)
        self.assertEqual(after_counts["Unpaid"], 0)
        self.assertEqual(after_counts["Privilege"], 1)


if __name__ == "__main__":
    unittest.main()
