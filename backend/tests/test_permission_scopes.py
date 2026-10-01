import os
import uuid
from datetime import date

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

import routers.activity_logs as activity_logs_router
import routers.attendance_correction as corrections_router
import routers.reports as reports_router
import routers.users as users_router
import team_scope
from database import Base, SessionLocal, engine
from models import (
    ActivityLog,
    Attendance,
    AttendanceCorrection,
    EmployeeProfileEditRequest,
    PastReportSubmissionRequest,
    Team,
    TeamMember,
    User,
)
from schemas import CorrectionCreate, CorrectionDecision, ProfileEditRequestDecision


@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def _create_user(db: Session, role: str = "user") -> User:
    suffix = uuid.uuid4().hex[:10]
    user = User(
        name=f"Permission Scope {suffix}",
        mobile=suffix,
        email=f"scope_{suffix}@example.com",
        password_hash="test-hash",
        role=role,
        department="Test",
        designation="Tester",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_team(db: Session, leader: User, member: User) -> Team:
    team = Team(name=f"Permission Team {uuid.uuid4().hex[:8]}", team_leader_id=leader.id, status="active")
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, employee_id=member.id))
    db.commit()
    return team


def _grant(monkeypatch, module, permissions: set[str]) -> None:
    monkeypatch.setattr(module, "has_permission", lambda _user, key, _db: key in permissions)


def test_team_leader_pending_corrections_require_approval_and_stay_team_scoped(db_session: Session, monkeypatch):
    leader = _create_user(db_session, "team_leader")
    member = _create_user(db_session)
    outsider = _create_user(db_session)
    _create_team(db_session, leader, member)

    member_attendance = Attendance(user_id=member.id, attendance_date=date(2026, 9, 25))
    outsider_attendance = Attendance(user_id=outsider.id, attendance_date=date(2026, 9, 25))
    db_session.add_all([member_attendance, outsider_attendance])
    db_session.flush()
    db_session.add_all([
        AttendanceCorrection(attendance_id=member_attendance.id, requested_by=member.id, status="Pending"),
        AttendanceCorrection(attendance_id=outsider_attendance.id, requested_by=outsider.id, status="Pending"),
    ])
    db_session.commit()
    _grant(monkeypatch, corrections_router, {"corrections.approve"})

    results = corrections_router.get_pending_corrections(db=db_session, current_user=leader)

    assert [item.requested_by for item in results] == [member.id]


def test_team_leader_cannot_request_correction_for_team_member_attendance(
    db_session: Session, monkeypatch
):
    leader = _create_user(db_session, "team_leader")
    member = _create_user(db_session)
    _create_team(db_session, leader, member)
    member_attendance = Attendance(
        user_id=member.id,
        attendance_date=date(2026, 9, 25),
    )
    db_session.add(member_attendance)
    db_session.commit()
    _grant(monkeypatch, corrections_router, set())

    with pytest.raises(HTTPException) as exc_info:
        corrections_router.request_correction(
            CorrectionCreate(attendance_id=member_attendance.id, reason="Wrong checkout"),
            db_session,
            leader,
        )

    assert exc_info.value.status_code == 403
    assert db_session.query(AttendanceCorrection).count() == 0


def test_team_leader_activity_logs_restrict_empty_and_forged_filters(db_session: Session, monkeypatch):
    leader = _create_user(db_session, "team_leader")
    member = _create_user(db_session)
    outsider = _create_user(db_session)
    _create_team(db_session, leader, member)
    outsider_team = Team(name=f"Outsider Team {uuid.uuid4().hex[:8]}", status="active")
    db_session.add(outsider_team)
    db_session.flush()
    db_session.add(TeamMember(team_id=outsider_team.id, employee_id=outsider.id))
    db_session.add_all([
        ActivityLog(user_id=leader.id, activity="Leader action"),
        ActivityLog(user_id=member.id, activity="Team action"),
        ActivityLog(user_id=outsider.id, activity="Outside action"),
    ])
    db_session.commit()
    _grant(monkeypatch, activity_logs_router, {"activity_logs.team_view"})

    unfiltered = activity_logs_router.list_activity_logs(
        user_id=None,
        employee_ids=None,
        team_ids=None,
        db=db_session,
        current_user=leader,
    )
    forged_filter = activity_logs_router.list_activity_logs(
        db=db_session,
        current_user=leader,
        employee_ids=[outsider.id],
        team_ids=[outsider_team.id],
    )

    assert {item["user_id"] for item in unfiltered} == {member.id}
    assert forged_filter == []

    _grant(monkeypatch, activity_logs_router, {"activity_logs.view", "activity_logs.team_view"})
    legacy_all_user_results = activity_logs_router.list_activity_logs(
        user_id=None,
        employee_ids=None,
        team_ids=None,
        db=db_session,
        current_user=leader,
    )
    assert {item["user_id"] for item in legacy_all_user_results} == {member.id}


def test_profile_and_report_approval_lists_are_team_scoped(db_session: Session, monkeypatch):
    leader = _create_user(db_session, "team_leader")
    member = _create_user(db_session)
    outsider = _create_user(db_session)
    _create_team(db_session, leader, member)

    db_session.add_all([
        EmployeeProfileEditRequest(employee_id=member.id, section="address", requested_data="{}"),
        EmployeeProfileEditRequest(employee_id=outsider.id, section="address", requested_data="{}"),
        PastReportSubmissionRequest(user_id=member.id, attendance_date=date(2026, 9, 24)),
        PastReportSubmissionRequest(user_id=outsider.id, attendance_date=date(2026, 9, 24)),
    ])
    db_session.commit()
    profile_permission = {"profile_corrections.team_view"}
    report_permission = {"report_approvals.team_view"}
    _grant(monkeypatch, users_router, profile_permission)
    _grant(monkeypatch, reports_router, report_permission)
    monkeypatch.setattr(team_scope, "has_permission", lambda _user, key, _db: key in profile_permission | report_permission)

    profile_results = users_router.list_profile_edit_requests(db=db_session, current_user=leader)
    report_results = reports_router.list_past_report_submission_requests(db=db_session, current_user=leader)

    assert {item["employee_id"] for item in profile_results} == {member.id}
    assert {item["user_id"] for item in report_results} == {member.id}


def test_legacy_requests_view_does_not_grant_team_leader_request_access(db_session: Session, monkeypatch):
    leader = _create_user(db_session, "team_leader")
    _grant(monkeypatch, users_router, {"requests.view"})
    _grant(monkeypatch, reports_router, {"requests.view"})
    _grant(monkeypatch, corrections_router, {"requests.view"})
    monkeypatch.setattr(team_scope, "has_permission", lambda _user, _key, _db: False)

    with pytest.raises(HTTPException) as profile_error:
        users_router.list_profile_edit_requests(db=db_session, current_user=leader)
    with pytest.raises(HTTPException) as report_error:
        reports_router.list_past_report_submission_requests(db=db_session, current_user=leader)
    with pytest.raises(HTTPException) as correction_error:
        corrections_router.get_all_corrections(db=db_session, current_user=leader)

    assert profile_error.value.status_code == 403
    assert report_error.value.status_code == 403
    assert correction_error.value.status_code == 403


def test_team_leader_approval_actions_reject_out_of_team_targets(db_session: Session, monkeypatch):
    leader = _create_user(db_session, "team_leader")
    outsider = _create_user(db_session)
    outside_team = _create_user(db_session)
    db_session.add(Team(name=f"Other Team {uuid.uuid4().hex[:8]}", team_leader_id=outside_team.id, status="active"))
    db_session.flush()
    attendance = Attendance(user_id=outsider.id, attendance_date=date(2026, 9, 25))
    db_session.add(attendance)
    db_session.flush()
    profile_request = EmployeeProfileEditRequest(employee_id=outsider.id, section="address", requested_data="{}")
    report_request = PastReportSubmissionRequest(user_id=outsider.id, attendance_date=date(2026, 9, 24))
    correction = AttendanceCorrection(attendance_id=attendance.id, requested_by=outsider.id, status="Pending")
    db_session.add_all([profile_request, report_request, correction])
    db_session.commit()

    _grant(monkeypatch, users_router, {"profile_corrections.approve"})
    _grant(monkeypatch, reports_router, {"report_approvals.approve"})
    monkeypatch.setattr(team_scope, "has_permission", lambda _user, key, _db: key == "corrections.approve")

    with pytest.raises(HTTPException) as profile_error:
        users_router.decide_profile_edit_request(
            profile_request.id, ProfileEditRequestDecision(status="Approved"), db_session, leader
        )
    with pytest.raises(HTTPException) as report_error:
        reports_router.review_past_report_submission_request(
            report_request.id, {"status": "Approved"}, db_session, leader
        )
    with pytest.raises(HTTPException) as correction_error:
        corrections_router.decide_correction(
            correction.id, CorrectionDecision(status="Approved"), db_session, leader
        )

    assert profile_error.value.status_code == 403
    assert report_error.value.status_code == 403
    assert correction_error.value.status_code == 403
