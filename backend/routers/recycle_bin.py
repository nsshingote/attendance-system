from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from models import ActivityLog, User
from services.recycle_bin import list_entries, permanently_delete, restore

router = APIRouter()


@router.get("/")
def get_recycle_bin(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    entries = list_entries(db)
    actor_ids = {item.deleted_by for item in entries if item.deleted_by is not None}
    actors = {
        user.id: user.name
        for user in db.query(User).filter(User.id.in_(actor_ids)).all()
    } if actor_ids else {}
    return [{
        "id": item.id,
        "table_name": item.table_name,
        "record_id": item.record_id,
        "label": item.record_label,
        "deleted_by": actors.get(item.deleted_by),
        "deleted_at": item.deleted_at,
        "expires_at": item.expires_at,
    } for item in list_entries(db)]


@router.post("/{entry_id}/restore")
def restore_recycle_bin_entry(entry_id: int, db: Session = Depends(get_db),
                              current_user: User = Depends(require_admin)):
    result = restore(db, entry_id)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Restored recycle-bin entry #{entry_id}"))
    db.commit()
    return result


@router.delete("/{entry_id}")
def permanently_delete_recycle_bin_entry(entry_id: int, db: Session = Depends(get_db),
                                         current_user: User = Depends(require_admin)):
    result = permanently_delete(db, entry_id)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Permanently deleted recycle-bin entry #{entry_id}"))
    db.commit()
    return result
