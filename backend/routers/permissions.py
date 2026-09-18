from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, require_superadmin
from database import get_db
from models import Permission, RolePermission, User

router = APIRouter()


class RolePermissionUpdate(BaseModel):
    permission_ids: list[int] | None = None
    permission_keys: list[str] | None = None


CONFIGURABLE_ROLES = {"admin", "team_leader"}
# Team Leaders retain exactly the original team/own/action permission model.
# Do not expose new Admin-only keys merely because they share a module name.
TEAM_LEADER_PERMISSION_KEYS = {
    "dashboard.view",
    "attendance.view_own", "attendance.team_view", "attendance.all_view",
    "reports.team_view", "reports.all_view",
    "leave.view_own", "leave.team_view", "leave.all_view", "leave.approve",
    "corrections.view_own", "corrections.team_view", "corrections.all_view", "corrections.approve",
    "kundli.team_view", "kundli.create", "kundli.edit", "kundli.delete",
    "employees.view_own", "employees.team_view", "employees.all_view",
}


def _role_permissions(db: Session, role: str) -> list[int]:
    return [
        permission_id
        for (permission_id,) in db.query(RolePermission.permission_id)
        .filter(RolePermission.role == role)
        .all()
    ]


def _validate_role(role: str) -> str:
    if role not in CONFIGURABLE_ROLES:
        raise HTTPException(status_code=422, detail="Only admin and team_leader permissions can be configured")
    return role


@router.get("/me", response_model=list[str])
def get_my_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "superadmin":
        return [permission_key for (permission_key,) in db.query(Permission.key).order_by(Permission.key).all()]
    return [
        permission_key
        for (permission_key,) in db.query(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role == current_user.role)
        .order_by(Permission.key)
        .all()
    ]


@router.get("/", dependencies=[Depends(require_superadmin)])
def list_permissions(db: Session = Depends(get_db)):
    return [
        {
            "id": permission.id,
            "key": permission.key,
            "name": permission.name,
            "module": permission.module,
            "action": permission.action,
            "description": permission.description,
        }
        for permission in db.query(Permission).order_by(Permission.module, Permission.key).all()
    ]


@router.get("/role/{role}", dependencies=[Depends(require_superadmin)])
def get_role_permissions(role: str, db: Session = Depends(get_db)):
    return _role_permissions(db, _validate_role(role))


@router.put("/role/{role}", dependencies=[Depends(require_superadmin)])
def update_role_permissions(
    role: str,
    payload: RolePermissionUpdate,
    db: Session = Depends(get_db),
):
    role = _validate_role(role)
    if payload.permission_ids is None and payload.permission_keys is None:
        raise HTTPException(status_code=422, detail="Permission IDs or keys are required")
    if payload.permission_ids is not None and payload.permission_keys is not None:
        raise HTTPException(status_code=422, detail="Provide permission IDs or keys, not both")

    if payload.permission_keys is not None:
        if len(payload.permission_keys) != len(set(payload.permission_keys)):
            raise HTTPException(status_code=422, detail="Duplicate permission keys are not allowed")
        permissions = db.query(Permission).filter(Permission.key.in_(payload.permission_keys)).all()
        if len(permissions) != len(payload.permission_keys):
            raise HTTPException(status_code=422, detail="One or more permission keys are invalid")
    else:
        permission_ids = payload.permission_ids or []
        if len(permission_ids) != len(set(permission_ids)):
            raise HTTPException(status_code=422, detail="Duplicate permission IDs are not allowed")
        permissions = db.query(Permission).filter(Permission.id.in_(permission_ids)).all() if permission_ids else []
        if len(permissions) != len(permission_ids):
            raise HTTPException(status_code=422, detail="One or more permission IDs are invalid")

    if role == "team_leader":
        invalid = [permission.key for permission in permissions if permission.key not in TEAM_LEADER_PERMISSION_KEYS]
        if invalid:
            raise HTTPException(status_code=422, detail="Team Leader permissions must use existing team-scoped modules")
    if role == "admin" and any(permission.key == "permissions.manage" for permission in permissions):
        raise HTTPException(status_code=422, detail="Only Super Admin can manage role permissions")

    dashboard = next((permission for permission in permissions if permission.key == "dashboard.view"), None)
    if dashboard is None:
        dashboard = db.query(Permission).filter(Permission.key == "dashboard.view").first()
        if dashboard is None:
            raise HTTPException(status_code=500, detail="dashboard.view permission is not configured")
        permissions.append(dashboard)

    db.query(RolePermission).filter(RolePermission.role == role).delete(
        synchronize_session=False
    )
    db.add_all(
        RolePermission(role=role, permission_id=permission.id)
        for permission in permissions
    )
    db.commit()
    return {"permission_ids": sorted(permission.id for permission in permissions)}
