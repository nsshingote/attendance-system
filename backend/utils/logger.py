"""
utils/logger.py
Application-wide logger configuration.
"""

import logging
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from models import ActivityLog

logger = logging.getLogger("attendance_system")
logger.setLevel(logging.INFO)

if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)


# =========================================================
# Database activity logging
# =========================================================

def log_activity(db: Session, user_id: int, activity: str):
    """
    Log a user activity to the database.
    """
    log_entry = ActivityLog(
        user_id=user_id,
        activity=activity,
    )
    db.add(log_entry)
    db.commit()
    return log_entry


def get_user_activity_logs(db: Session, user_id: int, limit: int = 100):
    """
    Get activity logs for a specific user.
    """
    return db.query(ActivityLog).filter(
        ActivityLog.user_id == user_id
    ).order_by(ActivityLog.created_at.desc()).limit(limit).all()


def get_all_activity_logs(db: Session, limit: int = 200):
    """
    Get all activity logs.
    """
    return db.query(ActivityLog).order_by(
        ActivityLog.created_at.desc()
    ).limit(limit).all()