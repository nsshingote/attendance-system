from datetime import datetime
from zoneinfo import ZoneInfo


IST = ZoneInfo("Asia/Kolkata")


def iso_with_offset(dt: datetime | None) -> str | None:
    """Return timestamps as explicit IST values."""
    if not dt:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    else:
        dt = dt.astimezone(IST)

    return dt.isoformat()