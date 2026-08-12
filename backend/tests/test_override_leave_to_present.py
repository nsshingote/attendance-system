import os
import uuid

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from datetime import date

from sqlalchemy.orm import Session

from database import Base, engine, SessionLocal
from models import LeaveRequest, LeaveRequestAllocation, User
from routers.attendance import manual_update_by_user_date, monthly_summary


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def get_db_session() -> Session:
    return SessionLocal()


def create_user(db: Session) -> User:
    unique_suffix = uuid.uuid4().hex[:8]
    user = User(
        name=f"Jerry {unique_suffix}",
        mobile=f"999999{unique_suffix[:4]}",
        email=f"jerry_{unique_suffix}@example.com",
        password_hash="testhash",
        role="superadmin",
        department="Test",
        designation="Tester",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_leave_for_date(db: Session, user: User, target_date: date, category: str = "Unpaid"):
    lr = LeaveRequest(
        user_id=user.id,
        from_date=target_date,
        to_date=target_date,
        total_days=1,
        reason="Test leave",
        status="Approved",
        leave_category=category,
    )
    alloc = LeaveRequestAllocation(allocation_date=target_date, leave_category=category)
    lr.allocations = [alloc]
    db.add(lr)
    db.commit()
    return lr


def test_override_multiple_leave_dates_to_present():
    db = get_db_session()
    user = create_user(db)

    d1 = date(2026, 8, 10)
    d2 = date(2026, 8, 11)
    d3 = date(2026, 8, 12)

    # Create approved Unpaid leave (LWP) on three dates
    create_leave_for_date(db, user, d1, category="Unpaid")
    create_leave_for_date(db, user, d2, category="Unpaid")
    create_leave_for_date(db, user, d3, category="Unpaid")

    # Verify monthly summary counts leaves before override
    summary_before = monthly_summary(user_id=user.id, year=2026, month=8, from_date=None, to_date=None, db=db, current_user=user)
    assert summary_before["Leave"] >= 3

    # Apply manual Present override for each date
    for d in (d1, d2, d3):
        manual_update_by_user_date(user_id=user.id, date_value=d.isoformat(), payload=type("P", (), {"model_dump": lambda self, exclude_unset=True: {"status": "Present"}})(), db=db, current_user=user)

    # Recompute summary and expect leave counts to be zero for those dates
    summary_after = monthly_summary(user_id=user.id, year=2026, month=8, from_date=None, to_date=None, db=db, current_user=user)
    # The approved Unpaid leave days should no longer be counted as Leave
    assert summary_after["Leave"] == 0

    db.close()
