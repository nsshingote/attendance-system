"""
utils/calender.py
Helpers for building monthly attendance calendars, merging in holidays
and weekly-off days.
"""

import calendar as pycalendar
from datetime import date
from typing import List, Dict

from sqlalchemy.orm import Session

from models import Holiday
from utils.attendance_status import get_company_settings


def get_month_dates(year: int, month: int) -> List[date]:
    """All calendar dates in a given month."""
    _, days_in_month = pycalendar.monthrange(year, month)
    return [date(year, month, day) for day in range(1, days_in_month + 1)]


def get_holidays_in_month(db: Session, year: int, month: int) -> Dict[str, str]:
    """Returns {iso_date: holiday_name} for holidays falling within the month."""
    start_date = date(year, month, 1)
    _, days_in_month = pycalendar.monthrange(year, month)
    end_date = date(year, month, days_in_month)
    
    holidays = (
        db.query(Holiday)
        .filter(Holiday.holiday_date.between(start_date, end_date))  # FIXED: holiday_date
        .all()
    )
    return {h.holiday_date.isoformat(): h.holiday_name for h in holidays}


def build_month_calendar(db: Session, year: int, month: int) -> List[Dict]:
    """
    Builds a base calendar structure for the month with day-type tags:
    'holiday', 'weekly_off', or 'working_day'. Attendance data is merged
    in separately by the calling router.
    """
    company_settings = get_company_settings(db)
    holidays_map = get_holidays_in_month(db, year, month)

    result = []
    for d in get_month_dates(year, month):
        iso = d.isoformat()
        if iso in holidays_map:
            day_type = "holiday"
            label = holidays_map[iso]
        elif company_settings and d.strftime("%A") == company_settings.weekly_off_day:
            day_type = "weekly_off"
            label = company_settings.weekly_off_day
        else:
            day_type = "working_day"
            label = None

        result.append({"date": iso, "day_type": day_type, "label": label})

    return result