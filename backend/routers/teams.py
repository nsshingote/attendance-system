from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import require_admin_permission
from database import get_db
from models import ActivityLog, Department, Team, TeamMember, User
from schemas import TeamCreate, TeamMemberOut, TeamOut, TeamUpdate
from team_scope import assign_team_leader
from routers.changed_logs import record_changed_log
from services.recycle_bin import archive_object

router = APIRouter()


def _validate_team_inputs(
    db: Session,
    department_id: int | None,
    leader_id: int | None,
    member_ids: list[int],
) -> None:
    if department_id is not None and db.query(Department.id).filter(
        Department.id == department_id, Department.is_active == 1
    ).first() is None:
        raise HTTPException(status_code=422, detail="Department not found or inactive")
    if leader_id is not None:
        leader = db.query(User).filter(User.id == leader_id).first()
        if leader is None:
            raise HTTPException(status_code=404, detail="Team Leader not found")
    if len(member_ids) != len(set(member_ids)):
        raise HTTPException(status_code=422, detail="Duplicate team members are not allowed")
    if member_ids and db.query(User.id).filter(User.id.in_(member_ids)).count() != len(member_ids):
        raise HTTPException(status_code=422, detail="One or more team members were not found")


def _team_response(team: Team) -> dict:
    return {
        "id": team.id,
        "name": team.name,
        "department_id": team.department_id,
        "team_leader_id": team.team_leader_id,
        "status": team.status,
        "created_at": team.created_at,
        "updated_at": team.updated_at,
        "team_leader": team.team_leader,
        "members": [member.employee for member in team.members],
    }


def _replace_members(team: Team, member_ids: list[int]) -> None:
    team.members.clear()
    team.members.extend(TeamMember(employee_id=employee_id) for employee_id in member_ids)


@router.get("/", response_model=List[TeamOut])
def list_teams(db: Session = Depends(get_db), current_user: User = Depends(require_admin_permission("teams.view"))):
    return [_team_response(team) for team in db.query(Team).order_by(Team.name).all()]


@router.get("/eligible-leaders")
def list_eligible_team_leaders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("teams.view")),
):
    return (
        db.query(User)
        .filter(User.status == "active", User.role == "team_leader")
        .order_by(User.name)
        .all()
    )


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin_permission("teams.view"))):
    team = db.query(Team).filter(Team.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return _team_response(team)


@router.post("/", response_model=TeamOut, status_code=201)
def create_team(payload: TeamCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin_permission("teams.manage"))):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Team name is required")
    _validate_team_inputs(db, payload.department_id, payload.team_leader_id, payload.member_ids)

    team = Team(name=name, department_id=payload.department_id, status=payload.status)
    assign_team_leader(db, team, payload.team_leader_id)
    _replace_members(team, payload.member_ids)
    db.add(team)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A team with this name already exists")
    db.refresh(team)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Created team '{team.name}'"))
    db.commit()
    return _team_response(team)


@router.put("/{team_id}", response_model=TeamOut)
def update_team(
    team_id: int,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("teams.manage")),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    data = payload.model_dump(exclude_unset=True)
    member_ids = data.pop("member_ids", None)
    if "name" in data:
        data["name"] = data["name"].strip()
        if not data["name"]:
            raise HTTPException(status_code=422, detail="Team name is required")
        duplicate = (
            db.query(Team.id)
            .filter(Team.name == data["name"], Team.id != team_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="A team with this name already exists")
    leader_id = data.get("team_leader_id", team.team_leader_id)
    department_id = data.get("department_id", team.department_id)
    current_member_ids = [member.employee_id for member in team.members]
    old_values = {
        "name": team.name,
        "department_id": team.department_id,
        "team_leader_id": team.team_leader_id,
        "status": team.status,
        "member_ids": sorted(current_member_ids),
    }
    _validate_team_inputs(db, department_id, leader_id, member_ids if member_ids is not None else current_member_ids)
    if "team_leader_id" in data:
        assign_team_leader(db, team, data.pop("team_leader_id"))
    for field, value in data.items():
        setattr(team, field, value)
    if member_ids is not None:
        _replace_members(team, member_ids)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A team with this name already exists")
    db.refresh(team)
    new_values = {
        "name": team.name,
        "department_id": team.department_id,
        "team_leader_id": team.team_leader_id,
        "status": team.status,
        "member_ids": sorted(member.employee_id for member in team.members),
    }
    for field in ("name", "department_id", "team_leader_id", "status", "member_ids"):
        if old_values[field] != new_values[field]:
            record_changed_log(db, None, current_user.id, "teams", f"{team.name} - {field}", old_values[field], new_values[field])
    db.add(ActivityLog(user_id=current_user.id, activity=f"Updated team '{team.name}'"))
    db.commit()
    return _team_response(team)


@router.delete("/{team_id}", response_model=dict)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("teams.manage")),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    archive_object(
        db,
        team,
        deleted_by=current_user.id,
        extra_values={
            "team_leader_name": team.team_leader.name if team.team_leader else None,
            "member_names": ", ".join(member.employee.name for member in team.members),
        },
    )
    db.info["skip_recycle"] = True
    db.delete(team)
    db.info["skip_recycle"] = False
    db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted team '{team.name}'"))
    db.commit()
    return {"message": "Team deleted"}


@router.get("/{team_id}/members", response_model=List[TeamMemberOut])
def list_team_members(team_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin_permission("teams.view"))):
    team = db.query(Team).filter(Team.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return [member.employee for member in team.members]


@router.put("/{team_id}/members", response_model=TeamOut)
def replace_team_members(
    team_id: int,
    member_ids: List[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_permission("teams.manage")),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    _validate_team_inputs(db, team.department_id, team.team_leader_id, member_ids)
    old_member_ids = sorted(member.employee_id for member in team.members)
    _replace_members(team, member_ids)
    db.commit()
    db.refresh(team)
    if old_member_ids != sorted(member_ids):
        record_changed_log(db, None, current_user.id, "teams", f"{team.name} - member_ids", old_member_ids, sorted(member_ids))
    db.add(ActivityLog(user_id=current_user.id, activity=f"Replaced members for team '{team.name}'"))
    db.commit()
    return _team_response(team)
