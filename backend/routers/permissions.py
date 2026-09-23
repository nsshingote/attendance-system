import re

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, require_superadmin, require_admin_permission, is_superadmin
from database import get_db
from models import Permission, Role, RolePermission, User, UserPermission

router = APIRouter()


class RolePermissionUpdate(BaseModel):
    permission_ids: list[int] | None = None
    permission_keys: list[str] | None = None


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    key: str | None = Field(default=None, min_length=2, max_length=40, pattern=r"^[a-z][a-z0-9_-]*$")
    description: str | None = None


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class UserOverrideUpdate(BaseModel):
    permission_id: int
    effect: str


def _role_or_404(db: Session, key: str) -> Role:
    role = db.query(Role).filter(Role.key == key).first()
    if not role:
        raise HTTPException(404, "Role not found")
    return role


def _permission_ids(db: Session, role: Role) -> list[int]:
    return sorted({
        permission_id for (permission_id,) in db.query(RolePermission.permission_id).filter(
            RolePermission.role_id == role.id
        ).all()
    })


@router.get("/me", response_model=list[str])
def get_my_permissions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if is_superadmin(current_user):
        return [key for (key,) in db.query(Permission.key).order_by(Permission.key).all()]
    ids = {permission_id for (permission_id,) in db.query(UserPermission.permission_id).filter(
        UserPermission.user_id == current_user.id, UserPermission.effect == "allow").all()}
    denied = {permission_id for (permission_id,) in db.query(UserPermission.permission_id).filter(
        UserPermission.user_id == current_user.id, UserPermission.effect == "deny").all()}
    role_ids = []
    if current_user.role_record is not None:
        if current_user.role_record.is_active:
            role_ids = _permission_ids(db, current_user.role_record)
    else:
        role_ids = [
            p for (p,) in db.query(RolePermission.permission_id).filter(RolePermission.role == current_user.role).all()
        ]
    ids.update(role_ids)
    ids.difference_update(denied)
    return [key for (key,) in db.query(Permission.key).filter(Permission.id.in_(ids)).order_by(Permission.key).all()]


@router.get("/roles", dependencies=[Depends(require_superadmin)])
def list_roles(db: Session = Depends(get_db)):
    return [{
        "id": role.id, "key": role.key, "name": role.name, "description": role.description,
        "is_system": role.is_system, "is_active": role.is_active, "permission_ids": _permission_ids(db, role)
    } for role in db.query(Role).order_by(Role.name).all()]


@router.post("/roles", status_code=201, dependencies=[Depends(require_superadmin)])
def create_role(payload: RoleCreate, db: Session = Depends(get_db)):
    key = payload.key
    if not key:
        key = re.sub(r"[^a-z0-9]+", "-", payload.name.strip().lower()).strip("-")[:40]
        key = key.rstrip("-")
        if not key or not key[0].isalpha():
            raise HTTPException(422, "Role name must produce a valid role key")
        base_key = key
        suffix = 2
        while db.query(Role).filter(Role.key == key).first():
            suffix_text = f"-{suffix}"
            key = f"{base_key[:40 - len(suffix_text)]}{suffix_text}"
            suffix += 1
    if db.query(Role).filter(Role.key == key).first():
        raise HTTPException(409, "Role key already exists")
    role = Role(key=key, name=payload.name, description=payload.description)
    db.add(role); db.commit(); db.refresh(role)
    return {"id": role.id, "key": role.key, "name": role.name, "description": role.description,
            "is_system": role.is_system, "is_active": role.is_active, "permission_ids": []}


@router.put("/roles/{role_key}", dependencies=[Depends(require_superadmin)])
def update_role(role_key: str, payload: RoleUpdate, db: Session = Depends(get_db)):
    role = _role_or_404(db, role_key)
    if role.is_system and payload.model_dump(exclude_unset=True):
        raise HTTPException(422, "System roles cannot be edited or deactivated")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(role, field, value)
    db.commit()
    return {"id": role.id, "key": role.key, "name": role.name, "description": role.description,
            "is_system": role.is_system, "is_active": role.is_active, "permission_ids": _permission_ids(db, role)}


@router.get("/", dependencies=[Depends(require_superadmin)])
def list_permissions(db: Session = Depends(get_db)):
    return [{"id": p.id, "key": p.key, "name": p.name, "module": p.module, "action": p.action,
             "description": p.description} for p in db.query(Permission).order_by(Permission.module, Permission.key).all()]


@router.get("/role/{role}", dependencies=[Depends(require_superadmin)])
def get_role_permissions(role: str, db: Session = Depends(get_db)):
    return _permission_ids(db, _role_or_404(db, role))


@router.put("/role/{role}", dependencies=[Depends(require_superadmin)])
def update_role_permissions(role: str, payload: RolePermissionUpdate, db: Session = Depends(get_db)):
    record = _role_or_404(db, role)
    if payload.permission_ids is None and payload.permission_keys is None:
        raise HTTPException(422, "Permission IDs or keys are required")
    if payload.permission_ids is not None and payload.permission_keys is not None:
        raise HTTPException(422, "Provide permission IDs or keys, not both")
    if payload.permission_keys is not None:
        permissions = db.query(Permission).filter(Permission.key.in_(payload.permission_keys)).all()
        if len(permissions) != len(set(payload.permission_keys)):
            raise HTTPException(422, "One or more permission keys are invalid")
    else:
        ids = payload.permission_ids or []
        permissions = db.query(Permission).filter(Permission.id.in_(ids)).all() if ids else []
        if len(permissions) != len(set(ids)):
            raise HTTPException(422, "One or more permission IDs are invalid")
    dashboard = db.query(Permission).filter(Permission.key == "dashboard.view").first()
    if dashboard and dashboard not in permissions:
        permissions.append(dashboard)
    db.query(RolePermission).filter(RolePermission.role_id == record.id).delete(synchronize_session=False)
    db.query(RolePermission).filter(RolePermission.role == record.key, RolePermission.role_id.is_(None)).delete(synchronize_session=False)
    db.add_all(RolePermission(role=record.key, role_id=record.id, permission_id=p.id) for p in permissions)
    db.commit()
    return {"permission_ids": sorted(p.id for p in permissions)}


@router.get("/users/{user_id}/overrides", dependencies=[Depends(require_superadmin)])
def get_user_overrides(user_id: int, db: Session = Depends(get_db)):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(404, "User not found")
    return [{"permission_id": row.permission_id, "permission_key": row.permission.key, "effect": row.effect}
            for row in db.query(UserPermission).filter(UserPermission.user_id == user_id).all()]


@router.put("/users/{user_id}/overrides", dependencies=[Depends(require_superadmin)])
def set_user_override(user_id: int, payload: UserOverrideUpdate, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    if payload.effect not in ("allow", "deny"):
        raise HTTPException(422, "Effect must be allow or deny")
    if not db.query(User).filter(User.id == user_id).first() or not db.query(Permission).filter(Permission.id == payload.permission_id).first():
        raise HTTPException(404, "User or permission not found")
    row = db.query(UserPermission).filter(UserPermission.user_id == user_id, UserPermission.permission_id == payload.permission_id).first()
    if row:
        row.effect = payload.effect; row.created_by = current_user.id
    else:
        db.add(UserPermission(user_id=user_id, permission_id=payload.permission_id, effect=payload.effect, created_by=current_user.id))
    db.commit()
    return {"user_id": user_id, "permission_id": payload.permission_id, "effect": payload.effect}


@router.delete("/users/{user_id}/overrides/{permission_id}", dependencies=[Depends(require_superadmin)])
def delete_user_override(user_id: int, permission_id: int, db: Session = Depends(get_db)):
    db.query(UserPermission).filter(UserPermission.user_id == user_id, UserPermission.permission_id == permission_id).delete()
    db.commit()
    return {"message": "Override removed"}
