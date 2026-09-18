"""Recycle-bin operations shared by the API and startup cleanup."""
import json
import os
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from models import Base, LeaveRequestAllocation, RecycleBinEntry


def archive_object(
    db: Session,
    obj,
    *,
    deleted_by: int | None = None,
    extra_values: dict | None = None,
) -> None:
    """Archive one explicitly selected ORM object before deleting it."""
    mapper = obj.__mapper__
    primary_key = mapper.primary_key[0]
    record_id = getattr(obj, primary_key.name, None)
    if record_id is None:
        return
    values = {
        column.name: _serialize_value(getattr(obj, column.name))
        for column in mapper.columns
    }
    if extra_values:
        values.update(extra_values)
    label = next(
        (str(values[key]) for key in ("name", "title", "holiday_name", "file_name", "document_type", "description")
         if values.get(key)),
        f"{mapper.local_table.name} #{record_id}",
    )
    if mapper.local_table.name == "leave_requests":
        employee = getattr(obj, "user", None)
        employee_name = getattr(employee, "name", None)
        if employee_name:
            label = f"Leave request for {employee_name} ({values.get('from_date')} to {values.get('to_date')})"
    elif mapper.local_table.name == "employee_personal_documents":
        employee = getattr(obj, "employee", None)
        employee_name = getattr(employee, "name", None)
        document_name = values.get("title") or values.get("original_filename") or values.get("file_name")
        if employee_name and document_name:
            label = f"{document_name} ({employee_name})"
    db.add(RecycleBinEntry(
        table_name=mapper.local_table.name,
        record_id=record_id,
        record_label=label[:255],
        snapshot=json.dumps(values, default=str),
        deleted_by=deleted_by,
        expires_at=datetime.utcnow().replace(microsecond=0) + timedelta(days=30),
    ))


def _serialize_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


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
    entries = db.query(RecycleBinEntry).order_by(RecycleBinEntry.deleted_at.desc()).all()
    visible = []
    for entry in entries:
        if entry.table_name == "leave_request_allocations":
            continue
        if entry.table_name == "attendance":
            try:
                snapshot = json.loads(entry.snapshot)
            except (TypeError, ValueError):
                snapshot = {}
            if snapshot.get("status") == "On Leave" and snapshot.get("reason") == "Leave":
                continue
        visible.append(entry)
    return visible


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
    allocations = raw.pop("__allocations", [])
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
    restored = model(**values)
    db.add(restored)
    db.flush()
    if entry.table_name == "leave_requests":
        for allocation in allocations:
            db.add(LeaveRequestAllocation(
                leave_request_id=entry.record_id,
                allocation_date=date.fromisoformat(allocation["allocation_date"]),
                leave_category=allocation["leave_category"],
            ))
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
