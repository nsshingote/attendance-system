"""Recycle-bin operations shared by the API and startup cleanup."""
import json
import os
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from models import Base, RecycleBinEntry


def purge_expired(db: Session) -> int:
    """Permanently remove expired snapshots and any retained upload files."""
    rows = db.query(RecycleBinEntry).filter(RecycleBinEntry.expires_at <= datetime.utcnow()).all()
    for row in rows:
        _remove_snapshot_files(row.snapshot)
        db.info["skip_recycle"] = True
        db.delete(row)
    if rows:
        db.commit()
    db.info.pop("skip_recycle", None)
    return len(rows)


def _remove_snapshot_files(snapshot: str) -> None:
    try:
        values = json.loads(snapshot)
    except (TypeError, ValueError):
        return
    for key, value in values.items():
        if not isinstance(value, str) or not value:
            continue
        if key.endswith(("_path", "_file")) and os.path.isfile(value):
            try:
                os.remove(value)
            except OSError:
                pass


def list_entries(db: Session):
    purge_expired(db)
    return db.query(RecycleBinEntry).order_by(RecycleBinEntry.deleted_at.desc()).all()


def restore(db: Session, entry_id: int):
    entry = db.query(RecycleBinEntry).filter(RecycleBinEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Recycle-bin entry not found")
    table = Base.metadata.tables.get(entry.table_name)
    if table is None:
        raise HTTPException(status_code=400, detail="The original table is no longer available")
    model = next((mapper.class_ for mapper in Base.registry.mappers
                  if mapper.local_table.name == entry.table_name), None)
    if model is None:
        raise HTTPException(status_code=400, detail="The original model is no longer available")
    if db.get(model, entry.record_id) is not None:
        raise HTTPException(status_code=409, detail="A record with this ID already exists")
    raw = json.loads(entry.snapshot)
    values = {}
    for column in inspect(model).columns:
        if column.name not in raw:
            continue
        value = raw[column.name]
        if value is not None and isinstance(value, str):
            if column.type.__class__.__name__ == "Date":
                value = date.fromisoformat(value)
            elif column.type.__class__.__name__ in {"DateTime", "TIMESTAMP"}:
                value = datetime.fromisoformat(value)
            elif column.type.__class__.__name__ == "DECIMAL":
                value = Decimal(value)
        values[column.name] = value
    db.info["skip_recycle"] = True
    db.add(model(**values))
    db.delete(entry)
    db.commit()
    db.info.pop("skip_recycle", None)
    return {"message": "Record restored", "table": entry.table_name, "record_id": entry.record_id}


def permanently_delete(db: Session, entry_id: int):
    entry = db.query(RecycleBinEntry).filter(RecycleBinEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Recycle-bin entry not found")
    _remove_snapshot_files(entry.snapshot)
    db.info["skip_recycle"] = True
    db.delete(entry)
    db.commit()
    db.info.pop("skip_recycle", None)
    return {"message": "Record permanently deleted"}
