from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import Permission, RolePermission, User

router = APIRouter()


class RolePermissionUpdate(BaseModel):
    permission_ids: list[int] | None = None
    permission_keys: list[str] | None = None


@router.get("/me", response_model=list[str])
def get_my_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return [
        permission_key
        for (permission_key,) in db.query(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role == current_user.role)
        .order_by(Permission.key)
        .all()
    ]


@router.get("/", dependencies=[Depends(require_admin)])
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


@router.get("/role/team_leader", dependencies=[Depends(require_admin)])
def get_team_leader_permissions(db: Session = Depends(get_db)):
    return [
        permission.id
        for (permission_id,) in db.query(RolePermission.permission_id)
        .filter(RolePermission.role == "team_leader")
        .all()
        for permission in [db.query(Permission).filter(Permission.id == permission_id).first()]
        if permission is not None
    ]


@router.put("/role/team_leader", dependencies=[Depends(require_admin)])
def update_team_leader_permissions(
    payload: RolePermissionUpdate,
    db: Session = Depends(get_db),
):
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

    dashboard = next((permission for permission in permissions if permission.key == "dashboard.view"), None)
    if dashboard is None:
        dashboard = db.query(Permission).filter(Permission.key == "dashboard.view").first()
        if dashboard is None:
            raise HTTPException(status_code=500, detail="dashboard.view permission is not configured")
        permissions.append(dashboard)

    db.query(RolePermission).filter(RolePermission.role == "team_leader").delete(
        synchronize_session=False
    )
    db.add_all(
        RolePermission(role="team_leader", permission_id=permission.id)
        for permission in permissions
    )
    db.commit()
    return {"permission_ids": sorted(permission.id for permission in permissions)}
