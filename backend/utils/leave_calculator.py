"""
utils/leave_calculator.py
Leave balance logic with two separate buckets:

- paid_leave_available (0 or 1): this calendar month's single paid-leave
  slot. Only usable once per month.
- carried_leave: an accumulated pool built from any past month (WITHIN
  THE SAME CALENDAR YEAR) where the paid slot went unused. Used to gate
  whether "Carried" can be selected on the leave form, and how much can
  be encashed.

LEAVE YEAR MODEL
-----------------
The leave year is the calendar year (Jan-Dec). Accrual for this
application begins LEAVE_TRACKING_START_DATE (August 2026), so 2026 is a
prorated year: Aug, Sep, Oct, Nov, Dec = 5 months = 5 total days. From
2027 onward, every full year = 12 days (1/month x 12) — computed
automatically from the calendar year, no DB change needed at the
year boundary.

TOTAL LEAVE BALANCE (the headline number shown to the employee)
------------------------------------------------------------------
This is NOT the old "this month's slot + carried pool" sum (that grew
slowly month by month, which was confusing). It is now:

    year_quota - (approved Paid+Carried leave days taken this leave year)
               - (approved encashment days this leave year)

So on Aug 1, 2026 it immediately shows 5 (the full prorated year's
quota) — not 1. Taking a day of Paid or Carried leave reduces it.
Approved encashment reduces it. Simply letting a month's unused Paid
slot roll into the Carried bucket does NOT reduce it, since nothing
was actually spent yet.

Unused carried_leave does NOT roll over across a year boundary — it's
forfeited at each January 1st reset. The year_quota itself resets too
(back to the full 12), since it's computed live from the current date,
not stored.

ACCRUAL MODEL (lazy, no cron job)
----------------------------------
accrue_monthly_leave() walks month-by-month from last_leave_accrual_date
to today. For each month boundary crossed:
  - if that month's paid_leave_available was never used, it moves into
    carried_leave (+1), UNLESS the month being entered is January, in
    which case carried_leave resets to 0 first (year-end forfeiture)
    before granting the new year's first slot.
Capped at 60 months per call as a safety limit against runaway loops.
"""

from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, or_

from models import LeaveRequest, LeaveRequestAllocation, User, LeaveEncashmentRequest

MAX_MONTHS_PER_ACCRUAL_RUN = 60

# The leave year is Jan-Dec. Accrual for this app starts here — change
# this if the actual go-live date differs.
LEAVE_TRACKING_START_DATE = date(2026, 8, 1)

# Leave categories that actually consume the year's balance. Emergency,
# Sick, Unpaid, and Privilege do NOT draw from this quota.
BALANCE_CONSUMING_CATEGORIES = ("Paid", "Carried")
NON_BALANCE_CONSUMING_CATEGORIES = ("Unpaid", "Privilege", "Emergency", "Sick")


def count_leave_category_days(leave_requests) -> dict[str, int]:
    """Count approved leave days by category for summary and reporting."""
    counts = {category: 0 for category in ("Paid", "Carried", "Unpaid", "Privilege")}
    for leave_request in leave_requests or []:
        if getattr(leave_request, "status", None) != "Approved":
            continue
        if hasattr(leave_request, "allocations") and leave_request.allocations:
            for alloc in leave_request.allocations:
                if alloc.leave_category in counts:
                    counts[alloc.leave_category] += 1
            continue
        category = getattr(leave_request, "leave_category", None)
        if category in counts:
            counts[category] += int(getattr(leave_request, "total_days", 0) or 0)
    return counts


def _has_paid_leave_in_month(
    db: Session,
    user_id: int,
    on_date: date,
    exclude_leave_id: int | None = None,
) -> bool:
    query = db.query(LeaveRequest).filter(
        LeaveRequest.user_id == user_id,
        LeaveRequest.status.in_(["Pending", "Approved"]),
    )
    if exclude_leave_id is not None:
        query = query.filter(LeaveRequest.id != exclude_leave_id)

    legacy_paid_exists = query.filter(
        LeaveRequest.leave_category == "Paid",
        extract("year", LeaveRequest.from_date) == on_date.year,
        extract("month", LeaveRequest.from_date) == on_date.month,
    ).first()
    if legacy_paid_exists:
        return True

    allocated_paid_exists = query.join(LeaveRequest.allocations).filter(
        LeaveRequestAllocation.leave_category == "Paid",
        extract("year", LeaveRequestAllocation.allocation_date) == on_date.year,
        extract("month", LeaveRequestAllocation.allocation_date) == on_date.month,
    ).first()
    return allocated_paid_exists is not None


def has_approved_or_pending_paid_leave_this_month(db: Session, user_id: int, on_date: date) -> bool:
    return _has_paid_leave_in_month(db, user_id, on_date)


def has_other_approved_or_pending_paid_leave_this_month(
    db: Session,
    user_id: int,
    on_date: date,
    exclude_leave_id: int | None = None,
) -> bool:
    return _has_paid_leave_in_month(db, user_id, on_date, exclude_leave_id=exclude_leave_id)


def accrue_monthly_leave(db: Session, user: User) -> User:
    """Lazily runs the monthly carry-forward/refresh logic, with an
    annual reset at each January boundary. See module docstring."""
    today = date.today()

    if today < LEAVE_TRACKING_START_DATE:
        # Accrual hasn't started yet — nothing to grant.
        return user

    if user.last_leave_accrual_date is None or user.last_leave_accrual_date < LEAVE_TRACKING_START_DATE:
        # First run, or a stale/pre-launch date — (re)initialize cleanly
        # from the tracking start date.
        user.last_leave_accrual_date = LEAVE_TRACKING_START_DATE
        user.carried_leave = 0
        user.paid_leave_available = 1
        db.commit()

    months_elapsed = (
        (today.year - user.last_leave_accrual_date.year) * 12
        + (today.month - user.last_leave_accrual_date.month)
    )

    if months_elapsed <= 0:
        return user

    months_elapsed = min(months_elapsed, MAX_MONTHS_PER_ACCRUAL_RUN)
    cursor = user.last_leave_accrual_date

    for _ in range(months_elapsed):
        used_this_month = has_approved_or_pending_paid_leave_this_month(db, user.id, cursor)
        if not used_this_month and (user.paid_leave_available or 0) >= 1:
            user.carried_leave = (user.carried_leave or 0) + 1

        next_cursor = cursor + relativedelta(months=1)

        if next_cursor.month == 1:
            # Crossing into a new calendar year — forfeit whatever's left
            # in the carry-forward pool before granting the new year.
            user.carried_leave = 0

        cursor = next_cursor
        user.paid_leave_available = 1  # fresh slot for the new month

    user.last_leave_accrual_date = cursor
    db.commit()
    db.refresh(user)
    return user


def refresh_leave_accrual(db: Session, user: User) -> User:
    """Compatibility wrapper used by routers: ensure accrual state is up-to-date.

    Some router code expects a function named `refresh_leave_accrual`. The
    underlying behavior is implemented in `accrue_monthly_leave`; expose a
    thin wrapper so imports succeed and callers get the same semantics.
    """
    return accrue_monthly_leave(db, user)


def get_carried_leave_balance(db: Session, user: User) -> int:
    accrue_monthly_leave(db, user)
    return user.carried_leave or 0


def _get_date_range(from_date: date, to_date: date) -> list[date]:
    days = []
    current_date = from_date
    while current_date <= to_date:
        days.append(current_date)
        current_date += timedelta(days=1)
    return days


def allocate_leave_days(db: Session, user: User, from_date: date, to_date: date, submission_date: date | None = None) -> list[tuple[date, str]]:
    submission_date = submission_date or date.today()
    advanced = (from_date - submission_date).days >= 4
    allocations = []

    if not advanced:
        return [(day, "Unpaid") for day in _get_date_range(from_date, to_date)]

    carried_balance = get_carried_leave_balance(db, user)
    paid_months_used: set[tuple[int, int]] = set()

    for allocation_date in _get_date_range(from_date, to_date):
        month_key = (allocation_date.year, allocation_date.month)
        if month_key not in paid_months_used and not has_approved_or_pending_paid_leave_this_month(db, user.id, allocation_date):
            allocations.append((allocation_date, "Paid"))
            paid_months_used.add(month_key)
        elif carried_balance > 0:
            allocations.append((allocation_date, "Carried"))
            carried_balance -= 1
        else:
            allocations.append((allocation_date, "Unpaid"))

    return allocations


def summarize_allocations(allocations: list[tuple[date, str]]) -> str:
    counts: dict[str, int] = {}
    for _, category in allocations:
        counts[category] = counts.get(category, 0) + 1
    if len(counts) == 1:
        return next(iter(counts))
    return ", ".join(f"{value} {key}" for key, value in counts.items())


def compute_request_category_from_allocations(allocations: list[tuple[date, str]]) -> str:
    categories = {category for _, category in allocations}
    if len(categories) == 1:
        return next(iter(categories))
    return "Unpaid"


def paid_leave_available_this_month(db: Session, user: User, on_date: date | None = None) -> bool:
    """True if the paid slot for the given month is unused.

    If no date is provided, the current month is used.
    Always returns False before the leave year has started.
    """
    on_date = on_date or date.today()
    if on_date < LEAVE_TRACKING_START_DATE:
        return False
    accrue_monthly_leave(db, user)
    return not has_approved_or_pending_paid_leave_this_month(db, user.id, on_date)


def get_used_paid_leave_days(db: Session, user_id: int) -> int:
    """Sum of approved paid leave days across allocations and legacy requests."""
    paid_allocated = (
        db.query(func.coalesce(func.count(LeaveRequestAllocation.id), 0))
        .join(LeaveRequest)
        .filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status == "Approved",
            LeaveRequestAllocation.leave_category == "Paid",
        )
        .scalar()
    )
    legacy_paid = (
        db.query(func.coalesce(func.sum(LeaveRequest.total_days), 0))
        .filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status == "Approved",
            LeaveRequest.leave_category == "Paid",
            ~LeaveRequest.allocations.any(),
        )
        .scalar()
    )
    return int((paid_allocated or 0) + (legacy_paid or 0))


def get_leave_year_bounds(year: int):
    """Returns (start_date, end_date) for the given leave year. For the
    launch year, the leave year starts at LEAVE_TRACKING_START_DATE
    (prorated); every other year runs Jan 1 - Dec 31."""
    if year == LEAVE_TRACKING_START_DATE.year:
        start = LEAVE_TRACKING_START_DATE
    else:
        start = date(year, 1, 1)
    end = date(year, 12, 31)
    return start, end


def get_leave_year_quota(year: int) -> int:
    """Total days granted for this leave year — 5 for the prorated 2026
    launch year (Aug-Dec), 12 for every full year after. Computed live
    from the calendar, so 2027 automatically becomes 12 with no DB
    migration or manual change needed."""
    start, end = get_leave_year_bounds(year)
    months = (end.year - start.year) * 12 + (end.month - start.month) + 1
    return months


def get_used_balance_days_this_year(db: Session, user_id: int, year: int) -> int:
    """Sum of approved Paid/Carried leave days for the year, using allocations when present."""
    start, end = get_leave_year_bounds(year)
    allocated = (
        db.query(func.coalesce(func.count(LeaveRequestAllocation.id), 0))
        .join(LeaveRequest)
        .filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status == "Approved",
            LeaveRequestAllocation.leave_category.in_(BALANCE_CONSUMING_CATEGORIES),
            LeaveRequestAllocation.allocation_date >= start,
            LeaveRequestAllocation.allocation_date <= end,
        )
        .scalar()
    )
    legacy = (
        db.query(func.coalesce(func.sum(LeaveRequest.total_days), 0))
        .filter(
            LeaveRequest.user_id == user_id,
            LeaveRequest.status == "Approved",
            LeaveRequest.leave_category.in_(BALANCE_CONSUMING_CATEGORIES),
            ~LeaveRequest.allocations.any(),
            LeaveRequest.from_date.between(start, end),
        )
        .scalar()
    )
    return int((allocated or 0) + (legacy or 0))


def get_encashed_days_this_year(db: Session, user_id: int, year: int) -> int:
    """Sum of days across Approved encashment requests approved within
    the given leave year."""
    encashed = (
        db.query(func.coalesce(func.sum(LeaveEncashmentRequest.days), 0))
        .filter(
            LeaveEncashmentRequest.user_id == user_id,
            LeaveEncashmentRequest.status == "Approved",
            extract("year", LeaveEncashmentRequest.approved_at) == year,
        )
        .scalar()
    )
    return int(encashed or 0)


def get_remaining_leave(db: Session, user: User, year: int = None) -> int:
    """The headline 'Total Leave Balance' — the current leave year's
    quota minus whatever's actually been used or encashed this year.
    Before the leave year has started, this is 0. Carrying an unused
    month's slot into the Carried bucket does NOT reduce this number —
    only actual usage or approved encashment does."""
    today = date.today()
    if today < LEAVE_TRACKING_START_DATE:
        return 0

    accrue_monthly_leave(db, user)
    year = year or today.year

    quota = get_leave_year_quota(year)
    used = get_used_balance_days_this_year(db, user.id, year)
    encashed = get_encashed_days_this_year(db, user.id, year)

    return max(quota - used - encashed, 0)


def calculate_total_days(from_date, to_date) -> int:
    """Inclusive day count between two dates."""
    return (to_date - from_date).days + 1


def can_encash(user: User, db: Session, requested_days: int) -> bool:
    """Encashment spends from the carried_leave pool only — the current
    month's single Paid slot cannot be encashed, only actually taken."""
    accrue_monthly_leave(db, user)
    return requested_days <= (user.carried_leave or 0)