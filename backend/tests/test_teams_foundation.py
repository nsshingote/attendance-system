import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from database import Base, SessionLocal, engine
from models import Department, Team, TeamMember, User
from team_scope import assign_team_leader, get_active_teams_for_user, is_team_member


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def create_user(db, role: str, suffix: str) -> User:
    user = User(
        name=f"Team {suffix}",
        mobile=f"888888{len(db.query(User).all()) + 1000}",
        password_hash="hashed",
        role=role,
        department="Engineering",
        designation="Developer",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_team_creation_and_leader_assignment():
    db = SessionLocal()
    leader = create_user(db, "team_leader", "Leader")
    department = Department(name="Team Engineering", created_by=leader.id)
    db.add(department)
    db.flush()
    team = Team(name="Platform Team", department_id=department.id)
    db.add(team)
    db.flush()

    assert assign_team_leader(db, team, leader.id).team_leader_id == leader.id
    db.commit()
    saved = db.query(Team).filter(Team.id == team.id).one()
    assert saved.team_leader_id == leader.id
    db.close()


def test_non_team_leader_cannot_be_assigned():
    db = SessionLocal()
    employee = create_user(db, "user", "Employee")
    team = Team(name="Restricted Team")
    db.add(team)
    db.flush()

    with pytest.raises(HTTPException) as error:
        assign_team_leader(db, team, employee.id)

    assert error.value.status_code == 422
    db.rollback()
    db.close()


def test_team_membership_and_duplicate_membership_constraint():
    db = SessionLocal()
    leader = create_user(db, "team_leader", "Membership Leader")
    employee = create_user(db, "user", "Member")
    team = Team(name="Membership Team", team_leader_id=leader.id)
    db.add(team)
    db.flush()
    membership = TeamMember(team_id=team.id, employee_id=employee.id)
    db.add(membership)
    db.commit()

    db.add(TeamMember(team_id=team.id, employee_id=employee.id))
    with pytest.raises(IntegrityError):
        db.commit()

    db.rollback()
    assert is_team_member(db, leader, employee.id) is True
    db.close()


def test_team_scope_does_not_cross_team_boundaries():
    db = SessionLocal()
    leader = create_user(db, "team_leader", "Scope Leader")
    member = create_user(db, "user", "Scope Member")
    other_employee = create_user(db, "user", "Other Employee")
    team = Team(name="Scope Team", team_leader_id=leader.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, employee_id=member.id))
    db.commit()

    assert get_active_teams_for_user(db, leader)[0].id == team.id
    assert is_team_member(db, leader, member.id) is True
    assert is_team_member(db, leader, other_employee.id) is False
    db.close()
