import os
import uuid

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from datetime import date

from sqlalchemy.orm import Session

from database import Base, engine, SessionLocal
from models import Attendance, Holiday, User, WorkingSunday
from routers.attendance import attendance_calendar, manual_update_by_user_date
from schemas import AttendanceManualUpdate


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def get_db_session() -> Session:
    return SessionLocal()


def create_user(db: Session, role: str = "superadmin") -> User:
    unique_suffix = uuid.uuid4().hex[:8]
    user = User(
        name=f"Override Tester {unique_suffix}",
        mobile=f"999999{unique_suffix[:4]}",
        email=f"override_{unique_suffix}@example.com",
        password_hash="testhash",
        role=role,
        department="Test",
        designation="Tester",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_holiday(db: Session, target_date: date, created_by: int) -> Holiday:
    holiday = Holiday(
        holiday_date=target_date,
        holiday_name="Test Holiday",
        created_by=created_by,
    )
    db.add(holiday)
    db.commit()
    return holiday


def test_override_present_status():
    db = get_db_session()
    user = create_user(db)
    target_date = date(2026, 8, 10)

    result = manual_update_by_user_date(
        user_id=user.id,
        date_value=target_date.isoformat(),
        payload=AttendanceManualUpdate(status="Present"),
        db=db,
        current_user=user,
    )

    assert result["status"] == "Present"
    attendance = db.query(Attendance).filter(Attendance.user_id == user.id, Attendance.attendance_date == target_date).one()
    assert attendance.status == "Present"
    assert attendance.manual_override is True
    db.close()


def test_override_late_status():
    db = get_db_session()
    user = create_user(db)
    target_date = date(2026, 8, 11)

    result = manual_update_by_user_date(
        user_id=user.id,
        date_value=target_date.isoformat(),
        payload=AttendanceManualUpdate(status="Late"),
        db=db,
        current_user=user,
    )

    assert result["status"] == "Late"
    attendance = db.query(Attendance).filter(Attendance.user_id == user.id, Attendance.attendance_date == target_date).one()
    assert attendance.status == "Late"
    assert attendance.manual_override is True
    db.close()


def test_override_absent_status():
    db = get_db_session()
    user = create_user(db)
    target_date = date(2026, 8, 12)

    result = manual_update_by_user_date(
        user_id=user.id,
        date_value=target_date.isoformat(),
        payload=AttendanceManualUpdate(status="Absent"),
        db=db,
        current_user=user,
    )

    assert result["status"] == "Absent"
    attendance = db.query(Attendance).filter(Attendance.user_id == user.id, Attendance.attendance_date == target_date).one()
    assert attendance.status == "Absent"
    assert attendance.manual_override is True
    db.close()


def test_override_wfh_status():
    db = get_db_session()
    user = create_user(db)
    target_date = date(2026, 8, 13)

    result = manual_update_by_user_date(
        user_id=user.id,
        date_value=target_date.isoformat(),
        payload=AttendanceManualUpdate(status="WFH"),
        db=db,
        current_user=user,
    )

    assert result["status"] == "WFH"
    attendance = db.query(Attendance).filter(Attendance.user_id == user.id, Attendance.attendance_date == target_date).one()
    assert attendance.status == "WFH"
    assert attendance.manual_override is True
    db.close()


def test_override_half_day_status():
    db = get_db_session()
    user = create_user(db)
    target_date = date(2026, 8, 14)

    result = manual_update_by_user_date(
        user_id=user.id,
        date_value=target_date.isoformat(),
        payload=AttendanceManualUpdate(status="Half Day"),
        db=db,
        current_user=user,
    )

    assert result["status"] == "Half Day"
    attendance = db.query(Attendance).filter(Attendance.user_id == user.id, Attendance.attendance_date == target_date).one()
    assert attendance.status == "Half Day"
    assert attendance.manual_override is True
    db.close()


def test_override_on_leave_status():
    db = get_db_session()
    user = create_user(db)
    target_date = date(2026, 8, 15)

    result = manual_update_by_user_date(
        user_id=user.id,
        date_value=target_date.isoformat(),
        payload=AttendanceManualUpdate(status="On Leave"),
        db=db,
        current_user=user,
    )

    assert result["status"] == "On Leave"
    assert result["leave_category"] == "Paid"
    attendance = db.query(Attendance).filter(Attendance.user_id == user.id, Attendance.attendance_date == target_date).one()
    assert attendance.status == "On Leave"
    assert attendance.check_in is None
    assert attendance.check_out is None
    assert attendance.manual_override is True
    db.close()


def test_override_extra_working_day_status():
    db = get_db_session()
    user = create_user(db)
    target_date = date(2026, 8, 16)
    create_holiday(db, target_date, created_by=user.id)

    result = manual_update_by_user_date(
        user_id=user.id,
        date_value=target_date.isoformat(),
        payload=AttendanceManualUpdate(status="Extra Working Day"),
        db=db,
        current_user=user,
    )

    assert result["status"] == "Present"
    attendance = db.query(Attendance).filter(Attendance.user_id == user.id, Attendance.attendance_date == target_date).one()
    assert attendance.status == "Present"
    assert attendance.manual_override is True

    working_day = db.query(WorkingSunday).filter(WorkingSunday.user_id == user.id, WorkingSunday.work_date == target_date).one_or_none()
    assert working_day is not None

    calendar = attendance_calendar(
        year=2026,
        month=8,
        user_id=user.id,
        employee_ids=None,
        department_id=None,
        db=db,
        current_user=user,
    )
    day = next((d for d in calendar if d["date"] == target_date.isoformat()), None)
    assert day is not None
    assert day["status"] == "Present"
    assert day["working_day_label"] == "Extra Working Day"
    db.close()
