from datetime import datetime


def iso_with_offset(dt: datetime | None) -> str | None:
    """Return an ISO string with +05:30 appended for naive datetimes, or
    the existing ISO string for timezone-aware datetimes. Returns None if dt is None."""
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "+05:30"
    return dt.isoformat()
