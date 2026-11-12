"""Recycle-bin operations shared by the API and startup cleanup."""
import json
import os
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from models import Base, KundliNoteAttachment, LeaveRequestAllocation, RecycleBinEntry
from services.kundli_attachments import (
    finalize_staged_attachment_deletion,
    kundli_attachment_path,
    restore_staged_attachment_files,
    stage_attachment_files,
)

KUNDLI_ATTACHMENT_SNAPSHOT_KEY = "__kundli_attachments"


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
    elif mapper.local_table.name == "team_members":
        employee_name = getattr(getattr(obj, "employee", None), "name", None)
        team_name = getattr(getattr(obj, "team", None), "name", None)
        employee_label = employee_name or f"User #{values.get('employee_id')}"
        team_label = team_name or f"team #{values.get('team_id')}"
        label = f"{employee_label} removed from {team_label}"
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
    staged = _stage_kundli_snapshot_files(rows)
    try:
        for row in rows:
            _remove_snapshot_files(row.snapshot)
            db.info["skip_recycle"] = True
            db.delete(row)
        if rows:
            db.commit()
    except Exception:
        db.rollback()
        restore_staged_attachment_files(staged)
        raise
    finally:
        db.info.pop("skip_recycle", None)
    finalize_staged_attachment_deletion(staged)
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


def _snapshot_attachment_records(snapshot: str) -> list[dict]:
    try:
        values = json.loads(snapshot)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid recycle-bin snapshot") from error
    records = values.get(KUNDLI_ATTACHMENT_SNAPSHOT_KEY, [])
    if not isinstance(records, list) or any(not isinstance(item, dict) for item in records):
        raise HTTPException(status_code=400, detail="Invalid Kundli attachment snapshot")
    for record in records:
        storage_filename = record.get("storage_filename")
        if not isinstance(storage_filename, str):
            raise HTTPException(status_code=400, detail="Invalid Kundli attachment snapshot")
        kundli_attachment_path(storage_filename)
    return records


def _stage_kundli_snapshot_files(entries) -> list:
    filenames = []
    for entry in entries:
        if entry.table_name == "kundli_notes":
            filenames.extend(
                item["storage_filename"]
                for item in _snapshot_attachment_records(entry.snapshot)
            )
    return stage_attachment_files(filenames)


def list_entries(db: Session):
    purge_expired(db)
    entries = db.query(RecycleBinEntry).order_by(RecycleBinEntry.deleted_at.desc()).all()
    visible = []
    for entry in entries:
        if entry.table_name in {"leave_request_allocations", "attendance"}:
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
    table_name = entry.table_name
    record_id = entry.record_id
    raw = json.loads(entry.snapshot)
    allocations = raw.pop("__allocations", [])
    attachment_records = (
        _snapshot_attachment_records(entry.snapshot)
        if table_name == "kundli_notes"
        else []
    )
    attachment_values = []
    for record in attachment_records:
        storage_path = kundli_attachment_path(record["storage_filename"])
        if not storage_path.is_file():
            raise HTTPException(
                status_code=409,
                detail="A Kundli attachment file is missing and the note cannot be restored",
            )
        values = _restore_column_values(KundliNoteAttachment, record)
        values["note_id"] = record_id
        attachment_id = values.get("id")
        if attachment_id is not None and db.get(KundliNoteAttachment, attachment_id) is not None:
            raise HTTPException(status_code=409, detail="A Kundli attachment with this ID already exists")
        attachment_values.append(values)

    values = _restore_column_values(model, raw)
    db.info["skip_recycle"] = True
    try:
        restored = model(**values)
        db.add(restored)
        db.flush()
        db.add_all(KundliNoteAttachment(**item) for item in attachment_values)
        if table_name == "leave_requests":
            for allocation in allocations:
                db.add(LeaveRequestAllocation(
                    leave_request_id=record_id,
                    allocation_date=date.fromisoformat(allocation["allocation_date"]),
                    leave_category=allocation["leave_category"],
                ))
        db.delete(entry)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.info.pop("skip_recycle", None)
    return {"message": "Record restored", "table": table_name, "record_id": record_id}


def _restore_column_values(model, raw: dict) -> dict:
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
    return values


def permanently_delete(db: Session, entry_id: int):
    entry = db.query(RecycleBinEntry).filter(RecycleBinEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Recycle-bin entry not found")
    staged = _stage_kundli_snapshot_files([entry])
    try:
        _remove_snapshot_files(entry.snapshot)
        db.info["skip_recycle"] = True
        db.delete(entry)
        db.commit()
    except Exception:
        db.rollback()
        restore_staged_attachment_files(staged)
        raise
    finally:
        db.info.pop("skip_recycle", None)
    finalize_staged_attachment_deletion(staged)
    return {"message": "Record permanently deleted"}
