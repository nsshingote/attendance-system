from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def iso_with_offset(dt: datetime | None) -> str | None:
    """Return timestamps as explicit IST values.

    MySQL DATETIME/TIMESTAMP values are stored as UTC by this application;
    naive values are therefore interpreted as UTC before presentation.
    """
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZoneInfo("Asia/Kolkata")).isoformat()
