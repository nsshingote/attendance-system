from datetime import date, datetime
from zoneinfo import ZoneInfo


IST = ZoneInfo("Asia/Kolkata")


def india_now() -> datetime:
    """Return the current timestamp in the attendance calendar timezone."""
    return datetime.now(IST)


def india_today() -> date:
    """Return today's date using the same timezone as attendance check-in."""
    return india_now().date()


def iso_with_offset(dt: datetime | None) -> str | None:
    """Return timestamps as explicit IST values."""
    if not dt:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    else:
        dt = dt.astimezone(IST)

    return dt.isoformat()
