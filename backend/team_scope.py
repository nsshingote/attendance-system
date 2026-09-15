"""Team assignment and scope helpers for future Team Leader authorization."""

from typing import List

from fastapi import HTTPException
from sqlalchemy.orm import Session

from auth import has_permission
from models import Team, TeamMember, User


def get_active_teams_for_user(db: Session, user: User) -> List[Team]:
    """Return active teams led by the supplied user."""
    return (
        db.query(Team)
        .filter(Team.team_leader_id == user.id, Team.status == "active")
        .order_by(Team.id)
        .all()
    )


def is_team_member(db: Session, team_leader: User, employee_id: int) -> bool:
    """Return whether an employee belongs to one of the leader's active teams."""
    return (
        db.query(TeamMember.id)
        .join(Team, Team.id == TeamMember.team_id)
        .filter(
            Team.team_leader_id == team_leader.id,
            Team.status == "active",
            TeamMember.employee_id == employee_id,
        )
        .first()
        is not None
    )


def get_team_member_ids(db: Session, team_leader: User) -> List[int]:
    """Return employee IDs in the leader's active teams."""
    rows = (
        db.query(TeamMember.employee_id)
        .join(Team, Team.id == TeamMember.team_id)
        .filter(Team.team_leader_id == team_leader.id, Team.status == "active")
        .distinct()
        .all()
    )
    return [employee_id for (employee_id,) in rows]


def require_team_member_access(
    db: Session,
    current_user: User,
    employee_id: int,
    permission_key: str,
) -> None:
    """Authorize a Team Leader for one employee in an active assigned team."""
    if current_user.role in ("admin", "superadmin"):
        return
    if current_user.role != "team_leader":
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action")
    if not has_permission(current_user, permission_key, db):
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action")
    if not is_team_member(db, current_user, employee_id):
        raise HTTPException(status_code=403, detail="Employee is outside your active team")


def require_team_permission(db: Session, current_user: User, permission_key: str) -> List[int]:
    """Authorize a Team Leader for team-wide reads and return scoped IDs."""
    if current_user.role in ("admin", "superadmin"):
        return []
    if current_user.role != "team_leader" or not has_permission(current_user, permission_key, db):
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action")
    return get_team_member_ids(db, current_user)


def assign_team_leader(db: Session, team: Team, user_id: int | None) -> Team:
    """Assign an existing Team Leader without changing the user's role."""
    if user_id is None:
        team.team_leader_id = None
        return team

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "team_leader":
        raise HTTPException(status_code=422, detail="Assigned user must have the team_leader role")

    team.team_leader_id = user.id
    return team
