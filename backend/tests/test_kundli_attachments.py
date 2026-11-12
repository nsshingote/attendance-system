from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from types import SimpleNamespace
import threading
import time
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker

import routers.employee_documents as employee_documents_router
import services.kundli_attachments as attachment_storage
import services.recycle_bin as recycle_bin_service
from auth import get_current_user
from database import Base, get_db
from models import ActivityLog, KundliNote, KundliNoteAttachment, RecycleBinEntry, Role, User


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\x0bIDAT\x08\xd7c\xf8\x0f\x00\x01\x01\x01\x00"
    b"\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
)
PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"


@pytest.fixture
def kundli_app(monkeypatch, tmp_path):
    engine = create_engine(
        URL.create("sqlite", database=str(tmp_path / "kundli-test.db")),
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    tables = [
        Role.__table__,
        User.__table__,
        KundliNote.__table__,
        KundliNoteAttachment.__table__,
        ActivityLog.__table__,
        RecycleBinEntry.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    test_session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    test_session = test_session_factory()
    current_user = User(
        name="Kundli Tester",
        mobile="9000000001",
        password_hash="test",
        role="superadmin",
        department="Test",
        designation="Tester",
        status="active",
    )
    employee = User(
        name="Kundli Employee",
        mobile="9000000002",
        password_hash="test",
        role="user",
        department="Test",
        designation="Tester",
        status="active",
    )
    other_employee = User(
        name="Other Employee",
        mobile="9000000003",
        password_hash="test",
        role="user",
        department="Test",
        designation="Tester",
        status="active",
    )
    test_session.add_all([current_user, employee, other_employee])
    test_session.commit()
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(attachment_storage, "KUNDLI_ATTACHMENT_DIR", upload_dir)
    def require_test_employee_scope(_db, _user, employee_id, _permission):
        if employee_id != employee.id:
            raise HTTPException(status_code=403, detail="Outside allowed employee scope")

    monkeypatch.setattr(employee_documents_router, "require_team_member_access", require_test_employee_scope)

    app = FastAPI()
    app.include_router(employee_documents_router.router, prefix="/employee-documents")
    app.dependency_overrides[get_db] = lambda: test_session
    app.dependency_overrides[get_current_user] = lambda: current_user
    yield SimpleNamespace(
        app=app,
        db=test_session,
        session_factory=test_session_factory,
        employee=employee,
        other_employee=other_employee,
        current_user=current_user,
    )
    app.dependency_overrides.clear()
    test_session.close()
    Base.metadata.drop_all(bind=engine, tables=list(reversed(tables)))
    engine.dispose()


def create_note(test_context, employee_id=None):
    note = KundliNote(
        employee_id=employee_id or test_context.employee.id,
        positive_note="Existing note",
        created_by=test_context.current_user.id,
    )
    test_context.db.add(note)
    test_context.db.commit()
    test_context.db.refresh(note)
    return note


def upload_files(client, note_id, files, idempotency_key=None):
    key = idempotency_key or str(uuid4())
    return client.post(
        f"/employee-documents/kundli/{note_id}/attachments",
        files=files,
        headers={"Idempotency-Key": key},
    )


def mysql_upload_lock_mocks(release_result=None, release_error=None):
    connection = Mock()
    acquired_result = Mock()
    acquired_result.scalar_one.return_value = 1
    released_result = Mock()
    released_result.scalar_one.return_value = release_result
    connection.execute.side_effect = [
        acquired_result,
        release_error if release_error is not None else released_result,
    ]
    engine = Mock()
    engine.dialect.name = "mysql"
    engine.connect.return_value = connection
    db = Mock()
    db.get_bind.return_value = engine
    return db, engine, connection


def test_mysql_upload_lock_releases_and_closes_connection():
    db, engine, connection = mysql_upload_lock_mocks(release_result=1)

    with attachment_storage.lock_kundli_upload(db, 3, 5, str(uuid4())):
        pass

    assert engine.connect.call_count == 1
    assert connection.execute.call_count == 2
    connection.invalidate.assert_not_called()
    connection.close.assert_called_once_with()


@pytest.mark.parametrize("release_result", [0, None])
def test_mysql_upload_lock_invalidates_connection_when_release_unsuccessful(release_result):
    db, engine, connection = mysql_upload_lock_mocks(release_result=release_result)

    with attachment_storage.lock_kundli_upload(db, 3, 5, str(uuid4())):
        pass

    assert engine.connect.call_count == 1
    connection.invalidate.assert_called_once_with()
    connection.close.assert_called_once_with()


def test_mysql_upload_lock_invalidates_connection_when_release_raises():
    db, engine, connection = mysql_upload_lock_mocks(
        release_error=RuntimeError("simulated release failure")
    )

    with attachment_storage.lock_kundli_upload(db, 3, 5, str(uuid4())):
        pass

    assert engine.connect.call_count == 1
    connection.invalidate.assert_called_once_with()
    connection.close.assert_called_once_with()


def test_mysql_upload_lock_cleanup_preserves_upload_exception():
    db, _engine, connection = mysql_upload_lock_mocks(
        release_error=RuntimeError("simulated release failure")
    )
    upload_error = RuntimeError("simulated upload failure")

    with pytest.raises(RuntimeError, match="simulated upload failure"):
        with attachment_storage.lock_kundli_upload(db, 3, 5, str(uuid4())):
            raise upload_error

    connection.invalidate.assert_called_once_with()
    connection.close.assert_called_once_with()


def test_uploads_valid_image_and_document_with_server_detected_types(kundli_app):
    note = create_note(kundli_app)

    response = upload_files(
        TestClient(kundli_app.app),
        note.id,
        [
            ("files", ("portrait.png", PNG_BYTES, "text/plain")),
            ("files", ("report.pdf", PDF_BYTES, "application/octet-stream")),
        ],
    )

    assert response.status_code == 201
    uploaded = response.json()
    assert [item["content_type"] for item in uploaded] == ["image/png", "application/pdf"]
    assert [item["original_filename"] for item in uploaded] == ["portrait.png", "report.pdf"]
    records = kundli_app.db.query(KundliNoteAttachment).filter_by(note_id=note.id).all()
    assert all((attachment_storage.KUNDLI_ATTACHMENT_DIR / item.storage_filename).exists()
               for item in records)
    assert kundli_app.db.query(KundliNoteAttachment).filter_by(note_id=note.id).count() == 2


def test_rejects_unsupported_and_mismatched_file_content_without_orphans(kundli_app):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)

    unsupported = upload_files(client, note.id, [("files", ("script.exe", b"nope", "application/octet-stream"))])
    mismatched = upload_files(client, note.id, [("files", ("fake.png", PDF_BYTES, "image/png"))])

    assert unsupported.status_code == 415
    assert mismatched.status_code == 415
    assert kundli_app.db.query(KundliNoteAttachment).count() == 0
    assert list(attachment_storage.KUNDLI_ATTACHMENT_DIR.iterdir()) == []


def test_rejects_file_over_twenty_megabytes(kundli_app):
    note = create_note(kundli_app)
    content = b"%PDF-" + b"x" * attachment_storage.MAX_KUNDLI_ATTACHMENT_SIZE

    response = upload_files(
        TestClient(kundli_app.app),
        note.id,
        [("files", ("large.pdf", content, "application/pdf"))],
    )

    assert response.status_code == 413
    assert kundli_app.db.query(KundliNoteAttachment).count() == 0
    assert list(attachment_storage.KUNDLI_ATTACHMENT_DIR.iterdir()) == []


def test_list_download_preview_and_cross_employee_access_are_note_scoped(kundli_app):
    note = create_note(kundli_app)
    other_note = create_note(kundli_app, kundli_app.other_employee.id)
    client = TestClient(kundli_app.app)
    response = upload_files(
        client,
        note.id,
        [
            ("files", ("image.png", PNG_BYTES, "image/png")),
            ("files", ("document.pdf", PDF_BYTES, "application/pdf")),
        ],
    )
    image_id, pdf_id = [item["id"] for item in response.json()]

    listed = client.get(f"/employee-documents/kundli/{note.id}/attachments")
    downloaded = client.get(f"/employee-documents/kundli/{note.id}/attachments/{image_id}/download")
    image_preview = client.get(f"/employee-documents/kundli/{note.id}/attachments/{image_id}/preview")
    pdf_preview = client.get(f"/employee-documents/kundli/{note.id}/attachments/{pdf_id}/preview")
    cross_employee = client.get(f"/employee-documents/kundli/{other_note.id}/attachments")
    mismatched_parent = client.get(
        f"/employee-documents/kundli/{other_note.id}/attachments/{image_id}/download"
    )
    mismatched_preview = client.get(
        f"/employee-documents/kundli/{other_note.id}/attachments/{image_id}/preview"
    )

    assert response.status_code == 201
    assert listed.status_code == 200 and len(listed.json()) == 2
    assert downloaded.status_code == 200
    assert downloaded.headers["content-disposition"].startswith("attachment;")
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert image_preview.status_code == 200
    assert pdf_preview.status_code == 200
    assert image_preview.headers["content-disposition"].startswith("inline;")
    assert pdf_preview.headers["content-disposition"].startswith("inline;")
    assert cross_employee.status_code == 403
    assert mismatched_parent.status_code == 403
    assert mismatched_preview.status_code == 403


def test_upload_requires_authentication(kundli_app):
    note = create_note(kundli_app)
    kundli_app.app.dependency_overrides.pop(get_current_user)

    response = TestClient(kundli_app.app).get(
        f"/employee-documents/kundli/{note.id}/attachments"
    )

    assert response.status_code == 401


def test_database_failure_does_not_leave_uploaded_file(kundli_app, monkeypatch):
    note = create_note(kundli_app)

    def fail_commit():
        raise RuntimeError("simulated database commit failure")

    monkeypatch.setattr(kundli_app.db, "commit", fail_commit)
    client = TestClient(kundli_app.app, raise_server_exceptions=False)
    response = upload_files(client, note.id, [("files", ("report.pdf", PDF_BYTES, "application/pdf"))])

    assert response.status_code == 500
    assert list(attachment_storage.KUNDLI_ATTACHMENT_DIR.iterdir()) == []
    kundli_app.db.rollback()
    assert kundli_app.db.query(KundliNoteAttachment).count() == 0


def test_refresh_failure_after_commit_keeps_attachment_file_and_record(kundli_app, monkeypatch):
    note = create_note(kundli_app)

    def fail_refresh(_item):
        raise RuntimeError("simulated refresh failure after commit")

    monkeypatch.setattr(kundli_app.db, "refresh", fail_refresh)
    client = TestClient(kundli_app.app, raise_server_exceptions=False)
    response = upload_files(client, note.id, [("files", ("report.pdf", PDF_BYTES, "application/pdf"))])

    attachment = kundli_app.db.query(KundliNoteAttachment).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / attachment.storage_filename
    assert response.status_code == 201
    assert attachment.note_id == note.id
    assert stored_path.is_file()
    assert stored_path.read_bytes() == PDF_BYTES


def test_retrying_same_upload_request_returns_existing_attachments(kundli_app):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    key = str(uuid4())
    files = [("files", ("report.pdf", PDF_BYTES, "application/pdf"))]

    first = upload_files(client, note.id, files, key)
    retry = upload_files(client, note.id, files, key)

    assert first.status_code == 201
    assert retry.status_code == 201
    assert [item["id"] for item in retry.json()] == [item["id"] for item in first.json()]
    assert kundli_app.db.query(KundliNoteAttachment).filter_by(note_id=note.id).count() == 1
    assert len(list(attachment_storage.KUNDLI_ATTACHMENT_DIR.iterdir())) == 1


def test_same_file_in_separate_requests_creates_separate_attachments(kundli_app):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    files = [("files", ("report.pdf", PDF_BYTES, "application/pdf"))]

    first = upload_files(client, note.id, files)
    second = upload_files(client, note.id, files)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()[0]["id"] != second.json()[0]["id"]
    assert kundli_app.db.query(KundliNoteAttachment).filter_by(note_id=note.id).count() == 2
    assert len(list(attachment_storage.KUNDLI_ATTACHMENT_DIR.iterdir())) == 2


def test_concurrent_retry_cannot_delete_committed_attachment_file(kundli_app, monkeypatch):
    note = create_note(kundli_app)
    key = str(uuid4())
    files = [("files", ("report.pdf", PDF_BYTES, "application/pdf"))]
    original_promote = attachment_storage.promote_kundli_upload
    active_promotions = 0
    max_active_promotions = 0
    promotion_state_lock = threading.Lock()

    def observe_promotion(stored, storage_filename):
        nonlocal active_promotions, max_active_promotions
        with promotion_state_lock:
            active_promotions += 1
            max_active_promotions = max(max_active_promotions, active_promotions)
        time.sleep(0.1)
        try:
            return original_promote(stored, storage_filename)
        finally:
            with promotion_state_lock:
                active_promotions -= 1

    monkeypatch.setattr(employee_documents_router, "promote_kundli_upload", observe_promotion)

    def get_test_db():
        session = kundli_app.session_factory()
        try:
            yield session
        finally:
            session.close()

    kundli_app.app.dependency_overrides[get_db] = get_test_db
    clients = [TestClient(kundli_app.app), TestClient(kundli_app.app)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(
            lambda client: upload_files(client, note.id, files, key),
            clients,
        ))

    assert [response.status_code for response in responses] == [201, 201]
    assert [item["id"] for item in responses[0].json()] == [
        item["id"] for item in responses[1].json()
    ]
    assert max_active_promotions == 1
    attachment = kundli_app.db.query(KundliNoteAttachment).filter_by(note_id=note.id).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / attachment.storage_filename
    assert stored_path.is_file()
    assert stored_path.read_bytes() == PDF_BYTES


def test_commit_that_succeeds_before_connection_error_reports_success(kundli_app, monkeypatch):
    note = create_note(kundli_app)
    original_commit = kundli_app.db.commit

    def commit_then_raise():
        original_commit()
        raise RuntimeError("simulated lost commit acknowledgement")

    monkeypatch.setattr(kundli_app.db, "commit", commit_then_raise)
    client = TestClient(kundli_app.app, raise_server_exceptions=False)
    key = str(uuid4())
    files = [("files", ("report.pdf", PDF_BYTES, "application/pdf"))]

    response = upload_files(client, note.id, files, key)
    retry = upload_files(client, note.id, files, key)

    assert response.status_code == 201
    assert retry.status_code == 201
    assert [item["id"] for item in retry.json()] == [item["id"] for item in response.json()]
    assert kundli_app.db.query(KundliNoteAttachment).filter_by(note_id=note.id).count() == 1


def test_attachment_delete_removes_database_record_and_file(kundli_app):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    uploaded = upload_files(client, note.id, [("files", ("report.pdf", PDF_BYTES, "application/pdf"))])
    item = kundli_app.db.query(KundliNoteAttachment).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / item.storage_filename

    response = client.delete(f"/employee-documents/kundli/{note.id}/attachments/{item.id}")

    assert response.status_code == 200
    assert not stored_path.exists()
    assert kundli_app.db.query(KundliNoteAttachment).count() == 0
    assert uploaded.status_code == 201


def test_deleted_note_restores_with_attachments_and_notes_without_files_still_list(kundli_app):
    note = create_note(kundli_app)
    empty_note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    uploaded = upload_files(client, note.id, [("files", ("portrait.png", PNG_BYTES, "image/png"))])
    item = kundli_app.db.query(KundliNoteAttachment).one()
    storage_filename = item.storage_filename
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / storage_filename

    notes = client.get(f"/employee-documents/kundli/{kundli_app.employee.id}")
    deleted = client.delete(f"/employee-documents/kundli/{note.id}")

    assert uploaded.status_code == 201
    assert notes.status_code == 200
    assert next(item for item in notes.json() if item["id"] == empty_note.id)["attachments"] == []
    assert deleted.status_code == 200
    assert stored_path.is_file()
    assert kundli_app.db.query(KundliNoteAttachment).count() == 0
    recycle_entry = (
        kundli_app.db.query(RecycleBinEntry)
        .filter_by(table_name="kundli_notes", record_id=note.id)
        .one()
    )
    recycle_entry_id = recycle_entry.id

    restored = recycle_bin_service.restore(kundli_app.db, recycle_entry_id)
    restored_note = kundli_app.db.get(KundliNote, note.id)
    restored_attachment = kundli_app.db.query(KundliNoteAttachment).one()

    assert restored == {"message": "Record restored", "table": "kundli_notes", "record_id": note.id}
    assert restored_note is not None
    assert restored_attachment.note_id == note.id
    assert restored_attachment.storage_filename == storage_filename
    assert stored_path.is_file()
    assert stored_path.read_bytes() == PNG_BYTES
    assert kundli_app.db.query(RecycleBinEntry).filter_by(id=recycle_entry_id).count() == 0


def test_permanent_note_deletion_cleans_attachment_file(kundli_app):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    uploaded = upload_files(client, note.id, [("files", ("portrait.png", PNG_BYTES, "image/png"))])
    item = kundli_app.db.query(KundliNoteAttachment).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / item.storage_filename
    assert uploaded.status_code == 201

    deleted = client.delete(f"/employee-documents/kundli/{note.id}")
    recycle_entry = (
        kundli_app.db.query(RecycleBinEntry)
        .filter_by(table_name="kundli_notes", record_id=note.id)
        .one()
    )
    recycle_entry_id = recycle_entry.id
    result = recycle_bin_service.permanently_delete(kundli_app.db, recycle_entry_id)

    assert deleted.status_code == 200
    assert result == {"message": "Record permanently deleted"}
    assert not stored_path.exists()
    assert kundli_app.db.query(RecycleBinEntry).filter_by(id=recycle_entry_id).count() == 0


def test_failed_permanent_delete_restores_staged_attachment_file(kundli_app, monkeypatch):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    uploaded = upload_files(client, note.id, [("files", ("portrait.png", PNG_BYTES, "image/png"))])
    item = kundli_app.db.query(KundliNoteAttachment).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / item.storage_filename
    assert uploaded.status_code == 201
    client.delete(f"/employee-documents/kundli/{note.id}")
    recycle_entry = (
        kundli_app.db.query(RecycleBinEntry)
        .filter_by(table_name="kundli_notes", record_id=note.id)
        .one()
    )
    recycle_entry_id = recycle_entry.id

    def fail_commit():
        raise RuntimeError("simulated recycle-bin delete failure")

    monkeypatch.setattr(kundli_app.db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="simulated recycle-bin delete failure"):
        recycle_bin_service.permanently_delete(kundli_app.db, recycle_entry_id)

    assert kundli_app.db.query(RecycleBinEntry).filter_by(id=recycle_entry_id).count() == 1
    assert stored_path.is_file()
    assert stored_path.read_bytes() == PNG_BYTES


def test_expired_note_cleanup_removes_attachment_file(kundli_app):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    uploaded = upload_files(client, note.id, [("files", ("portrait.png", PNG_BYTES, "image/png"))])
    item = kundli_app.db.query(KundliNoteAttachment).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / item.storage_filename
    assert uploaded.status_code == 201
    client.delete(f"/employee-documents/kundli/{note.id}")
    recycle_entry = (
        kundli_app.db.query(RecycleBinEntry)
        .filter_by(table_name="kundli_notes", record_id=note.id)
        .one()
    )
    recycle_entry.expires_at = datetime.now() - timedelta(days=1)
    kundli_app.db.commit()

    removed_count = recycle_bin_service.purge_expired(kundli_app.db)

    assert removed_count == 1
    assert not stored_path.exists()
    assert kundli_app.db.query(RecycleBinEntry).filter_by(record_id=note.id).count() == 0


def test_failed_expired_note_cleanup_restores_attachment_file(kundli_app, monkeypatch):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    uploaded = upload_files(client, note.id, [("files", ("portrait.png", PNG_BYTES, "image/png"))])
    item = kundli_app.db.query(KundliNoteAttachment).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / item.storage_filename
    assert uploaded.status_code == 201
    client.delete(f"/employee-documents/kundli/{note.id}")
    recycle_entry = (
        kundli_app.db.query(RecycleBinEntry)
        .filter_by(table_name="kundli_notes", record_id=note.id)
        .one()
    )
    recycle_entry.expires_at = datetime.now() - timedelta(days=1)
    kundli_app.db.commit()
    recycle_entry_id = recycle_entry.id

    def fail_commit():
        raise RuntimeError("simulated expired-entry cleanup failure")

    monkeypatch.setattr(kundli_app.db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="simulated expired-entry cleanup failure"):
        recycle_bin_service.purge_expired(kundli_app.db)

    assert kundli_app.db.query(RecycleBinEntry).filter_by(id=recycle_entry_id).count() == 1
    assert stored_path.is_file()
    assert stored_path.read_bytes() == PNG_BYTES


def test_failed_restore_keeps_recycle_entry_and_attachment_file(kundli_app, monkeypatch):
    note = create_note(kundli_app)
    client = TestClient(kundli_app.app)
    uploaded = upload_files(client, note.id, [("files", ("portrait.png", PNG_BYTES, "image/png"))])
    item = kundli_app.db.query(KundliNoteAttachment).one()
    stored_path = attachment_storage.KUNDLI_ATTACHMENT_DIR / item.storage_filename
    assert uploaded.status_code == 201
    client.delete(f"/employee-documents/kundli/{note.id}")
    recycle_entry = (
        kundli_app.db.query(RecycleBinEntry)
        .filter_by(table_name="kundli_notes", record_id=note.id)
        .one()
    )
    recycle_entry_id = recycle_entry.id

    def fail_commit():
        raise RuntimeError("simulated restore failure")

    monkeypatch.setattr(kundli_app.db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="simulated restore failure"):
        recycle_bin_service.restore(kundli_app.db, recycle_entry_id)

    assert kundli_app.db.get(KundliNote, note.id) is None
    assert kundli_app.db.query(KundliNoteAttachment).count() == 0
    assert kundli_app.db.query(RecycleBinEntry).filter_by(id=recycle_entry_id).count() == 1
    assert stored_path.is_file()
    assert stored_path.read_bytes() == PNG_BYTES
