import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_admin_permission
from database import get_db
from models import ActivityLog, User
from services.recycle_bin import list_entries, permanently_delete, restore

router = APIRouter()


@router.get("/")
def get_recycle_bin(db: Session = Depends(get_db), current_user: User = Depends(require_admin_permission("recycle_bin.view"))):
    entries = list_entries(db)
    actor_ids = {item.deleted_by for item in entries if item.deleted_by is not None}
    team_names: dict[int, str] = {}
    team_member_values: dict[int, dict] = {}
    employee_ids: set[int] = set()
    for item in entries:
        try:
            snapshot = json.loads(item.snapshot)
        except (TypeError, ValueError):
            continue
        if item.table_name == "teams" and snapshot.get("name"):
            team_names[item.record_id] = str(snapshot["name"])
        elif item.table_name == "team_members":
            team_member_values[item.id] = snapshot
            if snapshot.get("employee_id") is not None:
                employee_ids.add(snapshot["employee_id"])

    users = {
        user.id: user.name
        for user in db.query(User).filter(User.id.in_(actor_ids | employee_ids)).all()
    } if actor_ids or employee_ids else {}

    def display_label(item):
        # Upgrade existing generic team-member entries as well as future ones.
        # The original team may be deleted, so use its archived snapshot.
        values = team_member_values.get(item.id)
        if values is None:
            return item.record_label
        employee_id = values.get("employee_id")
        team_id = values.get("team_id")
        employee = users.get(employee_id, f"User #{employee_id}")
        team = team_names.get(team_id, f"team #{team_id}")
        return f"{employee} removed from {team}"

    return [{
        "id": item.id,
        "table_name": item.table_name,
        "record_id": item.record_id,
        "label": display_label(item),
        "deleted_by": users.get(item.deleted_by),
        "deleted_at": item.deleted_at,
        "expires_at": item.expires_at,
    } for item in entries]


@router.post("/{entry_id}/restore")
def restore_recycle_bin_entry(entry_id: int, db: Session = Depends(get_db),
                              current_user: User = Depends(require_admin_permission("recycle_bin.restore"))):
    result = restore(db, entry_id)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Restored recycle-bin entry #{entry_id}"))
    db.commit()
    return result


@router.delete("/{entry_id}")
def permanently_delete_recycle_bin_entry(entry_id: int, db: Session = Depends(get_db),
                                         current_user: User = Depends(require_admin_permission("recycle_bin.permanent_delete"))):
    result = permanently_delete(db, entry_id)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Permanently deleted recycle-bin entry #{entry_id}"))
    db.commit()
    return result
