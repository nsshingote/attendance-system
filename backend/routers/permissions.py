from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Permission, RolePermission, User

router = APIRouter()


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
