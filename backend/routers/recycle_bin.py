from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from models import User
from services.recycle_bin import list_entries, permanently_delete, restore

router = APIRouter()


@router.get("/")
def get_recycle_bin(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return [{
        "id": item.id,
        "table_name": item.table_name,
        "record_id": item.record_id,
        "label": item.record_label,
        "deleted_at": item.deleted_at,
        "expires_at": item.expires_at,
    } for item in list_entries(db)]


@router.post("/{entry_id}/restore")
def restore_recycle_bin_entry(entry_id: int, db: Session = Depends(get_db),
                              current_user: User = Depends(require_admin)):
    return restore(db, entry_id)


@router.delete("/{entry_id}")
def permanently_delete_recycle_bin_entry(entry_id: int, db: Session = Depends(get_db),
                                         current_user: User = Depends(require_admin)):
    return permanently_delete(db, entry_id)
