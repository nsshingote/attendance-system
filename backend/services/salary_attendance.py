"""Side-effect-free attendance counts used by salary-slip calculations."""

import calendar
from datetime import date

from sqlalchemy.orm import Session

from models import Attendance, LeaveRequest, User, WFHRequest
from utils.attendance_status import determine_attendance_status_for_date
from utils.date_helpers import india_today


def derive_salary_attendance_counts(db: Session, employee: User, year: int, month: int) -> dict[str, float]:
    """Return suggested unpaid-leave and half-day counts without changing attendance.

    Approved unpaid leave is counted only when the final status remains On Leave.
    An uncovered Absent date is LWP, except dates covered by a pending/approved
    leave request. Half-days under leave-request coverage are left for review.
    Future dates, dates before joining, weekly offs, holidays and approved WFH
    dates cannot become automatic deductions.
    """
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])
    today = india_today()
    end_day = min(last_day, today)
    if employee.date_of_joining:
        first_day = max(first_day, employee.date_of_joining)
    if first_day > end_day:
        return {"lwp_days": 0.0, "half_day_days": 0.0}

    leave_requests = db.query(LeaveRequest).filter(
        LeaveRequest.user_id == employee.id,
        LeaveRequest.status.in_(("Pending", "Approved")),
        LeaveRequest.from_date <= last_day,
        LeaveRequest.to_date >= first_day,
    ).all()
    leave_coverage: dict[date, list[LeaveRequest]] = {}
    approved_categories: dict[date, list[tuple[bool, str]]] = {}
    for request in leave_requests:
        all_allocations = list(request.allocations)
        allocations = [allocation for allocation in all_allocations if not allocation.is_cancelled]
        if all_allocations:
            dates_and_categories = [(item.allocation_date, item.leave_category) for item in allocations]
        else:
            dates_and_categories = []
            current = max(first_day, request.from_date)
            final = min(last_day, request.to_date)
            while current <= final:
                dates_and_categories.append((current, request.leave_category))
                current = date.fromordinal(current.toordinal() + 1)

        for leave_date, category in dates_and_categories:
            if not first_day <= leave_date <= last_day:
                continue
            leave_coverage.setdefault(leave_date, []).append(request)
            if request.status == "Approved":
                approved_categories.setdefault(leave_date, []).append(
                    (request.manual_override_attendance_id is not None, category)
                )

    approved_wfh_dates = {
        request.attendance_date
        for request in db.query(WFHRequest).filter(
            WFHRequest.user_id == employee.id,
            WFHRequest.attendance_date >= first_day,
            WFHRequest.attendance_date <= end_day,
            WFHRequest.status == "Approved",
        ).all()
    }

    lwp_days = 0
    half_day_days = 0
    review_details: list[dict[str, str]] = []
    current = first_day
    while current <= end_day:
        status = determine_attendance_status_for_date(db, employee.id, current)
        covered_by_leave = bool(leave_coverage.get(current))

        if status == "On Leave":
            categories = approved_categories.get(current, [])
            if categories:
                # Match leave reporting: an admin-created manual leave wins;
                # otherwise use the first approved allocation for this date.
                manual = next((category for is_manual, category in categories if is_manual), None)
                category = manual if manual is not None else categories[0][1]
                if category == "Unpaid":
                    lwp_days += 1
                    review_details.append({"date": current.isoformat(), "status": status, "suggestion": "LWP (approved unpaid leave)"})
        elif status == "Absent":
            # An absent status inferred for today before attendance is finalized
            # is provisional. A manual override is explicit and can be counted.
            today_attendance = None
            if current == today:
                today_attendance = db.query(Attendance).filter(
                    Attendance.user_id == employee.id,
                    Attendance.attendance_date == current,
                ).order_by(Attendance.manual_override.desc(), Attendance.id.desc()).first()
            unfinished_today = current == today and not getattr(today_attendance, "manual_override", False)
            if not unfinished_today and not covered_by_leave and current not in approved_wfh_dates:
                lwp_days += 1
                review_details.append({"date": current.isoformat(), "status": status, "suggestion": "LWP"})
        elif status == "Half Day":
            if not covered_by_leave and current not in approved_wfh_dates:
                half_day_days += 1
                review_details.append({"date": current.isoformat(), "status": status, "suggestion": "Half-Day"})

        current = date.fromordinal(current.toordinal() + 1)

    return {
        "lwp_days": float(lwp_days),
        "half_day_days": float(half_day_days),
        "review_details": review_details,
    }
