"""Admin salary slips, employee docs, and employee-uploaded personal files."""
import json
import os
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import ActivityLog, EmployeeDocument, EmployeePersonalDocument, KundliNote, SalarySlip, User
from schemas import AppointmentLetterCreate, KundliNoteCreate, OfferLetterCreate, SalarySlipCreate
from utils.email_service import send_email

router = APIRouter()
PERSONAL_UPLOAD_DIR = Path("backend/uploads/personal_documents")
PERSONAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_PERSONAL_DOC_TYPES = {"aadhaar", "pan", "bank_passbook", "10th_marksheet", "other"}


def _document_dict(item: EmployeeDocument):
    return {"id": item.id, "employee_id": item.employee_id, "employee_name": item.employee.name if item.employee else None,
            "document_type": item.document_type, "title": item.title, "content": item.content,
            "status": item.status, "created_at": item.created_at, "sent_at": item.sent_at}


def _salary_slip_dict(item: SalarySlip):
    return {"id": item.id, "employee_id": item.employee_id, "employee_name": item.employee.name if item.employee else None,
            "month": item.month, "year": item.year, "particulars": item.particulars,
            "total_amount": float(item.total_amount), "status": item.status, "created_at": item.created_at}


@router.get("/salary-slips")
def list_salary_slips(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return [_salary_slip_dict(item) for item in db.query(SalarySlip).order_by(SalarySlip.created_at.desc()).all()]


@router.get("/salary-slips/mine")
def list_my_salary_slips(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_salary_slip_dict(item) for item in db.query(SalarySlip).filter(SalarySlip.employee_id == current_user.id).order_by(SalarySlip.created_at.desc()).all()]


@router.post("/salary-slips", status_code=201)
def create_salary_slip(payload: SalarySlipCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if not 1 <= payload.month <= 12:
        raise HTTPException(status_code=422, detail="Month must be between 1 and 12")
    employee = db.query(User).filter(User.id == payload.employee_id, User.status == "active").first()
    if not employee:
        raise HTTPException(status_code=404, detail="Active employee not found")
    particulars = [{"name": item.name.strip(), "amount": round(item.amount, 2)} for item in payload.particulars if item.name.strip()]
    if not particulars:
        raise HTTPException(status_code=422, detail="Add at least one salary particular")
    total = sum(max(0, item["amount"]) for item in particulars)
    item = SalarySlip(employee_id=employee.id, month=payload.month, year=payload.year, particulars=json.dumps(particulars),
                      total_amount=total, status="Saved", created_by=current_user.id)
    db.add(item)
    db.commit()
    db.refresh(item)
    if payload.send and employee.email:
        period = datetime(payload.year, payload.month, 1).strftime("%B %Y")
        if send_email([employee.email], f"Salary slip for {period}", f"<p>Hi {employee.name},</p><p>Your salary slip for <b>{period}</b> is now available in My Profile → Salary Slips.</p>"):
            item.status = "Sent"
            db.commit()
            db.refresh(item)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Created salary slip for '{employee.name}'"))
    db.commit()
    return _salary_slip_dict(item)


@router.get("/kundli/{employee_id}")
def get_kundli_notes(employee_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return [{"id": note.id, "positive_note": note.positive_note, "negative_note": note.negative_note, "created_at": note.created_at}
            for note in db.query(KundliNote).filter(KundliNote.employee_id == employee_id).order_by(KundliNote.created_at.desc()).all()]


@router.post("/kundli", status_code=201)
def create_kundli_note(payload: KundliNoteCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    employee = db.query(User).filter(User.id == payload.employee_id, User.status == "active").first()
    if not employee:
        raise HTTPException(status_code=404, detail="Active employee not found")
    positive, negative = (payload.positive_note or "").strip() or None, (payload.negative_note or "").strip() or None
    if not positive and not negative:
        raise HTTPException(status_code=422, detail="Write a positive or negative note")
    note = KundliNote(employee_id=employee.id, positive_note=positive, negative_note=negative, created_by=current_user.id)
    db.add(note)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Added Kundli note for '{employee.name}'"))
    db.commit()
    db.refresh(note)
    return {"id": note.id, "positive_note": note.positive_note, "negative_note": note.negative_note, "created_at": note.created_at}


@router.get("/documents")
def list_admin_documents(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return [_document_dict(item) for item in db.query(EmployeeDocument).order_by(EmployeeDocument.created_at.desc()).all()]


@router.get("/documents/mine")
def list_my_documents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_document_dict(item) for item in db.query(EmployeeDocument).filter(
        EmployeeDocument.employee_id == current_user.id, EmployeeDocument.status == "Sent"
    ).order_by(EmployeeDocument.sent_at.desc()).all()]


@router.get("/documents/{employee_id}")
def list_employee_documents(employee_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "user" and current_user.id != employee_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    return [_document_dict(item) for item in db.query(EmployeeDocument).filter(EmployeeDocument.employee_id == employee_id).order_by(EmployeeDocument.created_at.desc()).all()]


@router.get("/personal-documents/mine")
def list_my_personal_documents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [
        {
            "id": item.id,
            "employee_id": item.employee_id,
            "document_type": item.document_type,
            "title": item.title,
            "original_filename": item.original_filename,
            "file_name": item.file_name,
            "file_path": item.file_path,
            "mime_type": item.mime_type,
            "file_size": item.file_size,
            "uploaded_at": item.uploaded_at,
        }
        for item in db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.employee_id == current_user.id).order_by(EmployeePersonalDocument.uploaded_at.desc()).all()
    ]


@router.get("/personal-documents/{employee_id}")
def list_employee_personal_documents(employee_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "user" and current_user.id != employee_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    return [
        {
            "id": item.id,
            "employee_id": item.employee_id,
            "document_type": item.document_type,
            "title": item.title,
            "original_filename": item.original_filename,
            "file_name": item.file_name,
            "file_path": item.file_path,
            "mime_type": item.mime_type,
            "file_size": item.file_size,
            "uploaded_at": item.uploaded_at,
        }
        for item in db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.employee_id == employee_id).order_by(EmployeePersonalDocument.uploaded_at.desc()).all()
    ]


@router.post("/personal-documents/upload", status_code=201)
async def upload_personal_document(
    document_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    norm_type = (document_type or "").strip().lower()
    if norm_type not in ALLOWED_PERSONAL_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported document type")
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")

    safe_name = "".join(ch for ch in file.filename if ch.isalnum() or ch in "._-")
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
    stored_name = f"{timestamp}_{safe_name}"
    stored_path = PERSONAL_UPLOAD_DIR / stored_name

    file_bytes = await file.read()
    with open(stored_path, "wb") as fh:
        fh.write(file_bytes)

    item = EmployeePersonalDocument(
        employee_id=current_user.id,
        document_type=norm_type,
        title=(dict(aadhaar="Aadhaar", pan="PAN", bank_passbook="Bank Passbook", **{"10th_marksheet": "10th Marksheet"}, other="Other").get(norm_type, norm_type.title())),
        original_filename=file.filename,
        file_name=stored_name,
        file_path=str(stored_path).replace("\\", "/"),
        mime_type=file.content_type,
        file_size=len(file_bytes),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {
        "id": item.id,
        "employee_id": item.employee_id,
        "document_type": item.document_type,
        "title": item.title,
        "original_filename": item.original_filename,
        "file_name": item.file_name,
        "file_path": item.file_path,
        "mime_type": item.mime_type,
        "file_size": item.file_size,
        "uploaded_at": item.uploaded_at,
    }


@router.get("/personal-documents/download/{document_id}")
def download_personal_document(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.id == document_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Document not found")
    if current_user.role == "user" and current_user.id != item.employee_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if not os.path.exists(item.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(path=item.file_path, filename=item.original_filename, media_type=item.mime_type or "application/octet-stream")


@router.delete("/personal-documents/{document_id}")
def delete_personal_document(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.id == document_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Document not found")
    if current_user.role == "user" and current_user.id != item.employee_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if os.path.exists(item.file_path):
        try:
            os.remove(item.file_path)
        except OSError:
            pass
    db.delete(item)
    db.commit()
    return {"message": "Document deleted"}


@router.post("/letters/offer", status_code=201)
def create_offer_letter(payload: OfferLetterCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    employee = db.query(User).filter(User.id == payload.employee_id, User.status == "active").first()
    if not employee:
        raise HTTPException(status_code=404, detail="Active employee not found")
    values = payload.model_dump(exclude={"employee_id", "send"})
    required_values = ("employee_name", "designation", "department", "place_of_posting", "date_of_joining", "letter_date", "company_address")
    if any(not str(values.get(field) or "").strip() for field in required_values):
        raise HTTPException(status_code=422, detail="Complete all letter details before generating")
    status = "Sent" if payload.send else "Draft"
    item = EmployeeDocument(employee_id=employee.id, document_type="offer_letter", title="Offer / Appointment Letter",
                            content=json.dumps(values), status=status, created_by=current_user.id,
                            sent_at=datetime.utcnow() if payload.send else None)
    db.add(item)
    db.commit()
    db.refresh(item)
    if payload.send and employee.email:
        send_email([employee.email], "Your Offer / Appointment Letter", f"<p>Hi {employee.name},</p><p>Your Offer / Appointment Letter is available in My Profile → Documents.</p>")
    db.add(ActivityLog(user_id=current_user.id, activity=f"{'Sent' if payload.send else 'Saved draft'} offer letter for '{employee.name}'"))
    db.commit()
    return _document_dict(item)


@router.post("/letters/appointment", status_code=201)
def create_appointment_letter(payload: AppointmentLetterCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    employee = db.query(User).filter(User.id == payload.employee_id, User.status == "active").first()
    if not employee:
        raise HTTPException(status_code=404, detail="Active employee not found")
    values = payload.model_dump(exclude={"employee_id", "send"})
    required = ("employee_name", "designation", "department", "office_location", "start_date", "letter_date", "company_address", "salary", "working_hours", "working_days", "authorized_signatory")
    if any(not str(values.get(field) or "").strip() for field in required):
        raise HTTPException(status_code=422, detail="Complete all appointment letter details before generating")
    item = EmployeeDocument(employee_id=employee.id, document_type="appointment_letter", title="Appointment Letter",
                            content=json.dumps(values), status="Sent" if payload.send else "Draft", created_by=current_user.id,
                            sent_at=datetime.utcnow() if payload.send else None)
    db.add(item)
    db.commit()
    db.refresh(item)
    if payload.send and employee.email:
        send_email([employee.email], "Your Appointment Letter", f"<p>Hi {employee.name},</p><p>Your Appointment Letter is available in My Profile → Documents.</p>")
    db.add(ActivityLog(user_id=current_user.id, activity=f"{'Sent' if payload.send else 'Saved draft'} appointment letter for '{employee.name}'"))
    db.commit()
    return _document_dict(item)
