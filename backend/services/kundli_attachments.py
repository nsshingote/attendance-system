"""Private file storage helpers for Kundli note attachments."""

import codecs
import hashlib
import logging
import os
import threading
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings

logger = logging.getLogger("attendance_system")

KUNDLI_ATTACHMENT_DIR = Path(settings.UPLOAD_DIR) / "kundli_attachments"
KUNDLI_ATTACHMENT_DIR.mkdir(parents=True, exist_ok=True)
MAX_KUNDLI_ATTACHMENT_SIZE = 20 * 1024 * 1024
UPLOAD_CHUNK_SIZE = 1024 * 1024

_OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ZIP_SIGNATURES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".rtf": "application/rtf",
    ".txt": "text/plain",
    ".csv": "text/csv",
}
_OFFICE_ZIP_CONTENTS = {
    ".docx": ("[Content_Types].xml", "word/document.xml"),
    ".xlsx": ("[Content_Types].xml", "xl/workbook.xml"),
    ".pptx": ("[Content_Types].xml", "ppt/presentation.xml"),
}
PREVIEWABLE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
_UPLOAD_LOCK_TIMEOUT_SECONDS = 30
_SQLITE_UPLOAD_LOCKS: dict[str, threading.Lock] = {}
_SQLITE_UPLOAD_LOCKS_GUARD = threading.Lock()


def _discard_lock_connection(connection, lock_name: str) -> None:
    try:
        connection.invalidate()
    except Exception:
        logger.exception("Could not invalidate connection for Kundli upload lock %s", lock_name)
        try:
            connection.detach()
        except Exception:
            logger.exception("Could not detach connection for Kundli upload lock %s", lock_name)


def _safe_original_filename(filename: str | None) -> tuple[str, str]:
    if not filename:
        raise HTTPException(status_code=400, detail="Each attachment must have a filename")
    name = filename.replace("\\", "/").split("/")[-1]
    name = "".join(character for character in name if character.isprintable()).strip()
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid attachment filename")
    extension = Path(name).suffix.lower()
    if extension not in _MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported attachment format. Allowed: {', '.join(sorted(_MIME_TYPES))}",
        )
    if len(name) > 255:
        stem = Path(name).stem[: 255 - len(extension)]
        name = f"{stem}{extension}"
    return name, extension


def _validate_content(path: Path, extension: str) -> str:
    with path.open("rb") as file:
        signature = file.read(16)

    valid = False
    if extension in {".jpg", ".jpeg"}:
        valid = signature.startswith(b"\xff\xd8\xff")
    elif extension == ".png":
        valid = signature.startswith(b"\x89PNG\r\n\x1a\n")
    elif extension == ".webp":
        valid = len(signature) >= 12 and signature[:4] == b"RIFF" and signature[8:12] == b"WEBP"
    elif extension == ".pdf":
        valid = signature.startswith(b"%PDF-")
    elif extension in {".doc", ".xls", ".ppt"}:
        valid = signature.startswith(_OLE_SIGNATURE)
    elif extension in _OFFICE_ZIP_CONTENTS:
        if signature.startswith(_ZIP_SIGNATURES):
            try:
                with zipfile.ZipFile(path) as archive:
                    names = set(archive.namelist())
                valid = all(name in names for name in _OFFICE_ZIP_CONTENTS[extension])
            except (OSError, zipfile.BadZipFile):
                valid = False
    elif extension == ".rtf":
        valid = signature.startswith(b"{\\rtf")
    elif extension in {".txt", ".csv"}:
        decoder = codecs.getincrementaldecoder("utf-8-sig")()
        try:
            with path.open("rb") as file:
                while chunk := file.read(UPLOAD_CHUNK_SIZE):
                    if b"\x00" in chunk:
                        raise UnicodeDecodeError("utf-8", chunk, 0, 1, "NUL byte in text file")
                    decoder.decode(chunk)
                decoder.decode(b"", final=True)
            valid = True
        except UnicodeDecodeError:
            valid = False

    if not valid:
        raise HTTPException(status_code=415, detail="File content does not match its filename type")
    return _MIME_TYPES[extension]


async def store_kundli_upload(upload: UploadFile) -> dict:
    original_filename, extension = _safe_original_filename(upload.filename)
    storage_filename = f"{uuid.uuid4().hex}{extension}"
    path = KUNDLI_ATTACHMENT_DIR / storage_filename
    file_size = 0
    digest = hashlib.sha256()
    try:
        with path.open("xb") as destination:
            while chunk := await upload.read(UPLOAD_CHUNK_SIZE):
                file_size += len(chunk)
                if file_size > MAX_KUNDLI_ATTACHMENT_SIZE:
                    raise HTTPException(status_code=413, detail="Each attachment must be 20 MB or smaller")
                destination.write(chunk)
                digest.update(chunk)
        if file_size == 0:
            raise HTTPException(status_code=400, detail="Empty files cannot be uploaded")
        content_type = _validate_content(path, extension)
        return {
            "original_filename": original_filename,
            "storage_filename": storage_filename,
            "content_type": content_type,
            "file_size": file_size,
            "sha256": digest.hexdigest(),
        }
    except BaseException:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove incomplete Kundli attachment %s", path.name)
        raise
    finally:
        await upload.close()


def kundli_upload_storage_prefix(note_id: int, user_id: int, idempotency_key: str) -> str:
    key = uuid.UUID(idempotency_key)
    identity = f"kundli:{note_id}:{user_id}:{key.hex}"
    return f"{uuid.uuid5(uuid.NAMESPACE_URL, identity).hex}."


@contextmanager
def lock_kundli_upload(db: Session, note_id: int, user_id: int, idempotency_key: str):
    identity = f"kundli-upload:{note_id}:{user_id}:{uuid.UUID(idempotency_key).hex}"
    lock_name = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:64]
    dialect = db.get_bind().dialect.name

    if dialect in {"mysql", "mariadb"}:
        connection = db.get_bind().connect()
        acquired = False
        try:
            result = connection.execute(
                text("SELECT GET_LOCK(:lock_name, :timeout)"),
                {"lock_name": lock_name, "timeout": _UPLOAD_LOCK_TIMEOUT_SECONDS},
            ).scalar_one()
            if result != 1:
                raise HTTPException(
                    status_code=503,
                    detail="Could not acquire upload retry lock; retry using the same Idempotency-Key.",
                )
            acquired = True
            yield
        finally:
            if acquired:
                try:
                    result = connection.execute(
                        text("SELECT RELEASE_LOCK(:lock_name)"),
                        {"lock_name": lock_name},
                    ).scalar_one()
                    if result != 1:
                        logger.error(
                            "Could not release Kundli upload lock %s (result: %r); "
                            "invalidating the connection",
                            lock_name,
                            result,
                        )
                        _discard_lock_connection(connection, lock_name)
                except Exception:
                    logger.exception("Could not release Kundli upload lock %s", lock_name)
                    _discard_lock_connection(connection, lock_name)
            try:
                connection.close()
            except Exception:
                logger.exception("Could not close connection for Kundli upload lock %s", lock_name)
        return

    if dialect == "sqlite":
        with _SQLITE_UPLOAD_LOCKS_GUARD:
            lock = _SQLITE_UPLOAD_LOCKS.setdefault(identity, threading.Lock())
        if not lock.acquire(timeout=_UPLOAD_LOCK_TIMEOUT_SECONDS):
            raise HTTPException(
                status_code=503,
                detail="Could not acquire upload retry lock; retry using the same Idempotency-Key.",
            )
        try:
            yield
        finally:
            lock.release()
        return

    raise RuntimeError(f"Distributed Kundli upload locks are unsupported for {dialect}")


def idempotent_storage_filename(prefix: str, index: int) -> str:
    return f"{prefix}{index:08x}"


def promote_kundli_upload(stored: dict, storage_filename: str) -> bool:
    """Create the deterministic private file without overwriting an existing upload."""
    source = kundli_attachment_path(stored["storage_filename"])
    target = kundli_attachment_path(storage_filename)
    created = False
    try:
        with target.open("xb") as destination:
            created = True
            with source.open("rb") as uploaded:
                while chunk := uploaded.read(UPLOAD_CHUNK_SIZE):
                    destination.write(chunk)
    except FileExistsError:
        if attachment_file_sha256(target) != stored["sha256"]:
            raise HTTPException(
                status_code=409,
                detail="This upload request key was already used for different file content",
            )
    except OSError:
        if created:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not remove incomplete Kundli attachment %s", target.name)
        raise
    finally:
        try:
            source.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove temporary Kundli attachment %s", source.name)
    return created


def attachment_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(UPLOAD_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def kundli_attachment_path(storage_filename: str) -> Path:
    if Path(storage_filename).name != storage_filename or storage_filename.startswith("."):
        raise HTTPException(status_code=404, detail="Attachment file not found")
    return KUNDLI_ATTACHMENT_DIR / storage_filename


def stage_attachment_files(attachments) -> list[tuple[Path, Path]]:
    """Move files aside until the database delete commits, allowing rollback restoration."""
    staged: list[tuple[Path, Path]] = []
    try:
        for attachment in attachments:
            storage_filename = (
                attachment if isinstance(attachment, str) else attachment.storage_filename
            )
            source = kundli_attachment_path(storage_filename)
            if not source.exists():
                continue
            staged_path = KUNDLI_ATTACHMENT_DIR / f".{uuid.uuid4().hex}.deleting"
            os.replace(source, staged_path)
            staged.append((source, staged_path))
    except OSError as error:
        restore_staged_attachment_files(staged)
        logger.exception("Could not stage Kundli attachment files for deletion")
        raise HTTPException(status_code=500, detail="Could not safely remove the attachment files") from error
    return staged


def restore_staged_attachment_files(staged: list[tuple[Path, Path]]) -> None:
    for original, staged_path in reversed(staged):
        try:
            if staged_path.exists():
                os.replace(staged_path, original)
        except OSError:
            logger.exception("Could not restore staged Kundli attachment file %s", original.name)


def finalize_staged_attachment_deletion(staged: list[tuple[Path, Path]]) -> None:
    """Delete staged files after commit; failures are logged and remain private."""
    for _original, staged_path in staged:
        try:
            staged_path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove staged Kundli attachment file %s", staged_path.name)


def attachment_response(item) -> dict:
    return {
        "id": item.id,
        "note_id": item.note_id,
        "original_filename": item.original_filename,
        "content_type": item.content_type,
        "file_size": item.file_size,
        "uploaded_by": item.uploaded_by,
        "uploaded_at": item.uploaded_at,
    }
