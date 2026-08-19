"""Admin salary slips, employee docs, and employee-uploaded personal files."""
import json
import os
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from config import settings
from database import get_db
from models import ActivityLog, CompanySettings, EmployeeDocument, EmployeePersonalDocument, PersonalDocumentChangeRequest, KundliNote, LetterTemplate, SalarySlip, User
from schemas import AppointmentLetterCreate, DynamicLetterCreate, KundliNoteCreate, LetterTemplateCreate, LetterTemplateUpdate, OfferLetterCreate, PersonalDocumentRequestDecision, SalarySlipCreate
from utils.email_service import send_email

router = APIRouter()
PERSONAL_UPLOAD_DIR = Path(settings.UPLOAD_DIR) / "personal_documents"
PERSONAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_PERSONAL_DOC_TYPES = {"aadhaar", "pan", "bank_passbook", "highest_degree", "other"}
PLACEHOLDER_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)\s*}}")


DEFAULT_COMPANY_NAME = "PropCheckup"
DEFAULT_COMPANY_ADDRESS = "Office No. 62, Xth Central Mall, 2nd Floor, Above Kotak Bank, Mahavir Nagar, Kandivali West, Mumbai - 400067"


def _personal_document_path(item: EmployeePersonalDocument) -> Path:
    stored_path = Path(item.file_path)
    candidates = [stored_path, PERSONAL_UPLOAD_DIR / item.file_name]
    if not stored_path.is_absolute():
        candidates.append(Path.cwd() / stored_path)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return PERSONAL_UPLOAD_DIR / item.file_name


def _personal_document_request_dict(item: PersonalDocumentChangeRequest):
    return {
        "id": item.id, "employee_id": item.employee_id, "employee_name": item.employee.name if item.employee else None,
        "document_id": item.document_id, "document_title": item.document.title if item.document else None,
        "request_type": item.request_type, "pending_original_filename": item.pending_original_filename,
        "status": item.status, "created_at": item.created_at, "decided_at": item.decided_at,
    }


def _seed_default_letter_templates(db: Session):
    existing = db.query(LetterTemplate).count()
    if existing > 0:
        return

    creator = db.query(User).filter(User.role.in_(["admin", "superadmin"])).order_by(User.id.asc()).first()
    if not creator:
        return

    default_templates = [
        {
            "name": "Offer Letter",
            "document_type": "offer_letter",
            "content": """PropCheckup\nIndia's First Home Inspection Startup\n\nOFFER LETTER\n\nDate: {{letter_date}}\n\nCompany Address - {{company_address}}\n\nTo,\n{{employee_name}}\n\nSubject: Offer of Employment\n\nDear {{employee_name}},\n\nWe are pleased to offer you the position of {{designation}} at {{company_name}}. Based on your qualifications and experience, we believe you will be a valuable addition to our team.\n\n• Designation: {{designation}}\n• Department: {{department}}\n• Place of Posting: {{place_of_posting}}\n• Date of Joining: {{date_of_joining}}\n\nThis offer is subject to verification of the documents and information provided by you during the recruitment process.\n\nPlease confirm your acceptance of this offer by signing and returning a copy of this letter as a token of your acceptance.\n\nWe are excited about the opportunity to have you join our team and look forward to a successful association.\n\nSincerely,\nAuthorized Signatory\n{{company_name}}\n\n• Offer Acceptance\nI, {{employee_name}}, accept the terms and conditions mentioned in this offer letter.\n\nSignature: ____________________                 Date: ______________""",
        },
        {
            "name": "Appointment Letter",
            "document_type": "appointment_letter",
            "content": """PropCheckup\nIndia's First Home Inspection Startup\n\nAPPOINTMENT LETTER\n\nDate: {{letter_date}}\n\nCompany Address - {{company_address}}\n\nTo,\n{{employee_name}}\n\nSubject: Appointment for the Position of {{designation}}\n\nDear {{employee_name}},\n\nWe are pleased to offer you the position of {{designation}} at {{company_name}}. Based on your qualifications and experience, we believe you will be a valuable addition to our team.\n\n• Your appointment will be effective from {{date_of_joining}}. You will be working at our {{place_of_posting}} / {{department}}.\n• Your compensation details are as follows: Salary: {{salary}} per month/year.\n• Your working hours will be from {{working_hours}}, {{working_days}}.\n\nYou are expected to comply with company policies, rules, and regulations at all times. Any breach may result in disciplinary action. Kindly sign and return a copy of this letter as a token of your acceptance.\n\nWe look forward to having you on our team and wish you a successful career with us.\n\nSincerely,\n{{authorized_signatory}}\n{{company_name}}\n\n• Employee Acceptance\nI, {{employee_name}}, accept the terms and conditions mentioned above.\n\nSignature: ____________________                 Date: ______________""",
        },
    ]

    for template in default_templates:
        db.add(LetterTemplate(name=template["name"], document_type=template["document_type"], content=template["content"], created_by=creator.id))

    db.commit()


def _template_dict(item: LetterTemplate):
    return {"id": item.id, "name": item.name, "document_type": item.document_type, "content": item.content,
            "created_at": item.created_at, "updated_at": item.updated_at}


def _placeholder_values(employee: User, db: Session):
    company = db.query(CompanySettings).order_by(CompanySettings.id.desc()).first()
    date_value = lambda value: value.strftime("%d/%m/%Y") if value else ""
    # Safely access company_name and company_address; they may not exist in older databases
    company_name = DEFAULT_COMPANY_NAME
    company_address = DEFAULT_COMPANY_ADDRESS
    if company:
        try:
            company_name = company.company_name or DEFAULT_COMPANY_NAME
            company_address = company.company_address or DEFAULT_COMPANY_ADDRESS
        except AttributeError:
            pass
    return {
        "employee_id": str(employee.id), "employee_name": employee.name or "", "designation": employee.designation or "",
        "department": employee.department or "", "email": employee.email or "", "mobile": employee.mobile or "",
        "phone": employee.mobile or "", "place_of_posting": employee.place_of_posting or "",
        "date_of_joining": date_value(employee.date_of_joining), "employee_address_line_1": employee.address_line_1 or "",
        "employee_address_line_2": employee.address_line_2 or "", "employee_city": employee.city or "",
        "employee_state": employee.state or "", "employee_pincode": employee.pincode or "", "employee_country": employee.country or "",
        "emergency_contact_name": employee.emergency_contact_name or "", "emergency_contact_relationship": employee.emergency_contact_relationship or "",
        "emergency_contact_phone": employee.emergency_contact_phone or "", "company_name": company_name,
        "company_address": company_address, "letter_date": datetime.now().strftime("%d/%m/%Y"),
        "salary": "", "working_hours": "9:30 AM to 6:30 PM", "working_days": "6 days of the week",
        "authorized_signatory": "Authorized Signatory", "office_location": employee.place_of_posting or "",
        "date_of_leaving": "", "start_date": date_value(employee.date_of_joining),
    }


def _resolve_template(content: str, values: dict[str, str]):
    def replace(match: re.Match[str]):
        raw_name = match.group(1).strip()
        key = re.sub(r"\s+", "_", raw_name).lower()
        return values.get(key, values.get(raw_name, match.group(0)))

    return PLACEHOLDER_PATTERN.sub(replace, content)


def _document_dict(item: EmployeeDocument):
    return {"id": item.id, "employee_id": item.employee_id, "employee_name": item.employee.name if item.employee else None,
            "document_type": item.document_type, "title": item.title, "content": item.content,
            "status": item.status, "created_at": item.created_at, "sent_at": item.sent_at}


def _salary_slip_dict(item: SalarySlip):
    return {"id": item.id, "employee_id": item.employee_id, "employee_name": item.employee.name if item.employee else None,
            "month": item.month, "year": item.year, "particulars": item.particulars,
            "total_amount": float(item.total_amount), "status": item.status, "created_at": item.created_at, "sent_at": item.sent_at}


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
            item.sent_at = datetime.utcnow()
            db.commit()
            db.refresh(item)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Created salary slip for '{employee.name}'"))
    db.commit()
    return _salary_slip_dict(item)


@router.put("/salary-slips/{slip_id}")
def update_salary_slip(slip_id: int, payload: SalarySlipCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    item = db.query(SalarySlip).filter(SalarySlip.id == slip_id).first()
    if not item: raise HTTPException(status_code=404, detail="Salary slip not found")
    employee = db.query(User).filter(User.id == payload.employee_id, User.status == "active").first()
    if not employee: raise HTTPException(status_code=404, detail="Active employee not found")
    particulars = [{"name": row.name.strip(), "amount": round(row.amount, 2)} for row in payload.particulars if row.name.strip()]
    if not particulars: raise HTTPException(status_code=422, detail="Add at least one salary particular")
    item.employee_id, item.month, item.year, item.particulars = employee.id, payload.month, payload.year, json.dumps(particulars)
    item.total_amount, item.status, item.sent_at = sum(max(0, row["amount"]) for row in particulars), "Saved", None
    if payload.send and employee.email:
        period = datetime(payload.year, payload.month, 1).strftime("%B %Y")
        if send_email([employee.email], f"Salary slip for {period}", f"<p>Hi {employee.name},</p><p>Your updated salary slip for <b>{period}</b> is available in My Profile.</p>"):
            item.status, item.sent_at = "Sent", datetime.utcnow()
    db.add(ActivityLog(user_id=current_user.id, activity=f"Updated salary slip for '{employee.name}'")); db.commit(); db.refresh(item)
    return _salary_slip_dict(item)


@router.delete("/salary-slips/{slip_id}")
def delete_salary_slip(slip_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    item = db.query(SalarySlip).filter(SalarySlip.id == slip_id).first()
    if not item: raise HTTPException(status_code=404, detail="Salary slip not found")
    employee_name = item.employee.name if item.employee else f"employee {item.employee_id}"
    db.delete(item); db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted salary slip for '{employee_name}'")); db.commit()
    return {"message": "Salary slip deleted"}


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


@router.put("/kundli/{note_id}")
def update_kundli_note(note_id: int, payload: KundliNoteCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    note = db.query(KundliNote).filter(KundliNote.id == note_id).first()
    if not note: raise HTTPException(status_code=404, detail="Kundli note not found")
    positive, negative = (payload.positive_note or "").strip() or None, (payload.negative_note or "").strip() or None
    if not positive and not negative: raise HTTPException(status_code=422, detail="Write a positive or negative note")
    note.positive_note, note.negative_note = positive, negative
    db.add(ActivityLog(user_id=current_user.id, activity=f"Updated Kundli note for '{note.employee.name}'")); db.commit(); db.refresh(note)
    return {"id": note.id, "positive_note": note.positive_note, "negative_note": note.negative_note, "created_at": note.created_at}


@router.delete("/kundli/{note_id}")
def delete_kundli_note(note_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    note = db.query(KundliNote).filter(KundliNote.id == note_id).first()
    if not note: raise HTTPException(status_code=404, detail="Kundli note not found")
    employee_name = note.employee.name
    db.delete(note); db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted Kundli note for '{employee_name}'")); db.commit()
    return {"message": "Kundli note deleted"}


@router.get("/letter-templates")
def list_letter_templates(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    _seed_default_letter_templates(db)
    return [_template_dict(item) for item in db.query(LetterTemplate).order_by(LetterTemplate.name).all()]


@router.get("/letter-templates/placeholders")
def list_letter_placeholders(current_user: User = Depends(require_admin)):
    return [
        {"key": key, "label": label} for key, label in [
            ("employee_name", "Employee name"), ("employee_id", "Employee ID"), ("designation", "Designation"),
            ("department", "Department"), ("email", "Email"), ("mobile", "Mobile / phone"),
            ("place_of_posting", "Place of posting"), ("date_of_joining", "Date of joining"), ("date_of_leaving", "Date of leaving"),
            ("salary", "Salary"), ("working_hours", "Working hours"), ("working_days", "Working days"),
            ("authorized_signatory", "Authorized signatory"), ("office_location", "Office location"),
            ("employee_address_line_1", "Address line 1"), ("employee_address_line_2", "Address line 2"),
            ("employee_city", "City"), ("employee_state", "State"), ("employee_pincode", "Pincode"),
            ("employee_country", "Country"), ("emergency_contact_name", "Emergency contact name"),
            ("emergency_contact_relationship", "Emergency contact relationship"), ("emergency_contact_phone", "Emergency contact phone"),
            ("company_name", "Company name"), ("company_address", "Company address"), ("letter_date", "Letter date"),
        ]
    ]


def _clean_document_type(value: str):
    cleaned = re.sub(r"[^a-z0-9_]+", "_", value.strip().lower()).strip("_")
    if not cleaned:
        raise HTTPException(status_code=422, detail="Document type must contain letters or numbers")
    if len(cleaned) > 80:
        raise HTTPException(status_code=422, detail="Document type must be 80 characters or fewer")
    return cleaned


@router.post("/letter-templates", status_code=201)
def create_letter_template(payload: LetterTemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    name, content, document_type = payload.name.strip(), payload.content.strip(), _clean_document_type(payload.document_type)
    if not name or not content:
        raise HTTPException(status_code=422, detail="Template name and content are required")
    if db.query(LetterTemplate).filter(LetterTemplate.document_type == document_type).first():
        raise HTTPException(status_code=409, detail="A template already uses this document type")
    item = LetterTemplate(name=name, document_type=document_type, content=content, created_by=current_user.id)
    db.add(item); db.add(ActivityLog(user_id=current_user.id, activity=f"Created letter template '{name}'")); db.commit(); db.refresh(item)
    return _template_dict(item)


@router.put("/letter-templates/{template_id}")
def update_letter_template(template_id: int, payload: LetterTemplateUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    item = db.query(LetterTemplate).filter(LetterTemplate.id == template_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Letter template not found")
    name, content, document_type = payload.name.strip(), payload.content.strip(), _clean_document_type(payload.document_type)
    if not name or not content:
        raise HTTPException(status_code=422, detail="Template name and content are required")
    duplicate = db.query(LetterTemplate).filter(LetterTemplate.document_type == document_type, LetterTemplate.id != template_id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A template already uses this document type")
    item.name, item.document_type, item.content = name, document_type, content
    db.add(ActivityLog(user_id=current_user.id, activity=f"Updated letter template '{name}'")); db.commit(); db.refresh(item)
    return _template_dict(item)


@router.delete("/letter-templates/{template_id}")
def delete_letter_template(template_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    item = db.query(LetterTemplate).filter(LetterTemplate.id == template_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Letter template not found")
    name = item.name
    db.delete(item); db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted letter template '{name}'")); db.commit()
    return {"message": "Letter template deleted"}


@router.post("/letters/generate", status_code=201)
def generate_dynamic_letter(payload: DynamicLetterCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    template = db.query(LetterTemplate).filter(LetterTemplate.id == payload.template_id).first()
    employee = db.query(User).filter(User.id == payload.employee_id, User.status == "active").first()
    if not template:
        raise HTTPException(status_code=404, detail="Letter template not found")
    if not employee:
        raise HTTPException(status_code=404, detail="Active employee not found")
    values = _placeholder_values(employee, db)
    resolved_content = _resolve_template(template.content, values)
    snapshot = {"format": "dynamic_letter_v1", "template_id": template.id, "template_name": template.name,
                "template_content": template.content, "resolved_content": resolved_content, "placeholder_values": values}
    status = "Sent" if payload.send else "Draft"
    item = EmployeeDocument(employee_id=employee.id, document_type=template.document_type, title=template.name,
                            content=json.dumps(snapshot), status=status, created_by=current_user.id,
                            sent_at=datetime.utcnow() if payload.send else None)
    db.add(item); db.commit(); db.refresh(item)
    if payload.send and employee.email:
        send_email([employee.email], template.name, f"<p>Hi {employee.name},</p><p>Your <b>{template.name}</b> is available in My Profile → Documents.</p>")
    db.add(ActivityLog(user_id=current_user.id, activity=f"{'Sent' if payload.send else 'Generated'} {template.name} for '{employee.name}'")); db.commit()
    return _document_dict(item)


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


@router.delete("/documents/{document_id}")
def delete_generated_document(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    item = db.query(EmployeeDocument).filter(EmployeeDocument.id == document_id).first()
    if not item: raise HTTPException(status_code=404, detail="Document not found")
    db.delete(item); db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted {item.document_type.replace('_', ' ')} for '{item.employee.name}'")); db.commit()
    return {"message": "Document deleted"}


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
    title: str = Form(""),
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
        title=(title.strip() if norm_type == "other" and title.strip() else dict(aadhaar="Aadhaar Card", pan="PAN Card", bank_passbook="Bank Passbook", highest_degree="Highest Degree", other="Other").get(norm_type, norm_type.title())),
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
    file_path = _personal_document_path(item)
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(path=str(file_path), filename=item.original_filename, media_type=item.mime_type or "application/octet-stream")


@router.post("/personal-documents/{document_id}/replace-request", status_code=201)
async def request_personal_document_replace(
    document_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.id == document_id, EmployeePersonalDocument.employee_id == current_user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Personal document not found")
    if db.query(PersonalDocumentChangeRequest).filter(PersonalDocumentChangeRequest.document_id == document_id, PersonalDocumentChangeRequest.status == "Pending").first():
        raise HTTPException(status_code=409, detail="A change request is already pending for this document")
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
    safe_name = "".join(ch for ch in file.filename if ch.isalnum() or ch in "._- ")
    stored_name = f"pending_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}_{safe_name}"
    stored_path = PERSONAL_UPLOAD_DIR / stored_name
    file_bytes = await file.read()
    stored_path.write_bytes(file_bytes)
    request = PersonalDocumentChangeRequest(
        employee_id=current_user.id, document_id=document_id, request_type="replace",
        pending_file_name=stored_name, pending_original_filename=file.filename,
        pending_file_path=str(stored_path).replace("\\", "/"), pending_mime_type=file.content_type,
        pending_file_size=len(file_bytes),
    )
    db.add(request); db.commit(); db.refresh(request)
    return _personal_document_request_dict(request)


@router.post("/personal-documents/{document_id}/delete-request", status_code=201)
def request_personal_document_delete(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.id == document_id, EmployeePersonalDocument.employee_id == current_user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Personal document not found")
    if db.query(PersonalDocumentChangeRequest).filter(PersonalDocumentChangeRequest.document_id == document_id, PersonalDocumentChangeRequest.status == "Pending").first():
        raise HTTPException(status_code=409, detail="A change request is already pending for this document")
    request = PersonalDocumentChangeRequest(employee_id=current_user.id, document_id=document_id, request_type="delete")
    db.add(request); db.commit(); db.refresh(request)
    return _personal_document_request_dict(request)


@router.get("/personal-document-requests/mine")
def list_my_personal_document_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_personal_document_request_dict(item) for item in db.query(PersonalDocumentChangeRequest).filter(PersonalDocumentChangeRequest.employee_id == current_user.id).order_by(PersonalDocumentChangeRequest.created_at.desc()).all()]


@router.get("/personal-document-requests")
def list_personal_document_requests(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return [_personal_document_request_dict(item) for item in db.query(PersonalDocumentChangeRequest).filter(PersonalDocumentChangeRequest.status == "Pending").order_by(PersonalDocumentChangeRequest.created_at.desc()).all()]


@router.post("/personal-document-requests/{request_id}/decision")
def decide_personal_document_request(request_id: int, payload: PersonalDocumentRequestDecision, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    request = db.query(PersonalDocumentChangeRequest).filter(PersonalDocumentChangeRequest.id == request_id).first()
    if not request:
        raise HTTPException(status_code=404, detail="Personal document request not found")
    if request.status != "Pending":
        raise HTTPException(status_code=409, detail="This request has already been decided")
    document = db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.id == request.document_id).first()
    pending_path = Path(request.pending_file_path) if request.pending_file_path else None
    if payload.status == "Approved" and document:
        if request.request_type == "replace":
            old_path = _personal_document_path(document)
            if old_path.is_file() and old_path != pending_path:
                old_path.unlink()
            document.file_name = request.pending_file_name or document.file_name
            document.original_filename = request.pending_original_filename or document.original_filename
            document.file_path = request.pending_file_path or document.file_path
            document.mime_type = request.pending_mime_type
            document.file_size = request.pending_file_size or 0
        else:
            old_path = _personal_document_path(document)
            if old_path.is_file():
                old_path.unlink()
            db.delete(document)
    elif payload.status == "Rejected" and pending_path and pending_path.is_file():
        pending_path.unlink()
    request.status, request.decided_by, request.decided_at = payload.status, current_user.id, datetime.utcnow()
    db.add(ActivityLog(user_id=current_user.id, activity=f"{payload.status} personal document {request.request_type} request for '{request.employee.name}'"))
    db.commit()
    return _personal_document_request_dict(request)


@router.delete("/personal-documents/{document_id}")
def delete_personal_document(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(EmployeePersonalDocument).filter(EmployeePersonalDocument.id == document_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Document not found")
    if current_user.role == "user":
        raise HTTPException(status_code=403, detail="Submit a delete request for approval")
    if current_user.role not in {"admin", "superadmin"} and current_user.id != item.employee_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    file_path = _personal_document_path(item)
    if file_path.is_file():
        try:
            os.remove(file_path)
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
    item = db.query(EmployeeDocument).filter(EmployeeDocument.employee_id == employee.id, EmployeeDocument.document_type == "offer_letter").first()
    if item:
        item.title, item.content, item.status, item.created_by, item.sent_at = "Offer Letter", json.dumps(values), status, current_user.id, datetime.utcnow() if payload.send else None
    else:
        item = EmployeeDocument(employee_id=employee.id, document_type="offer_letter", title="Offer Letter", content=json.dumps(values), status=status, created_by=current_user.id, sent_at=datetime.utcnow() if payload.send else None)
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
    item = db.query(EmployeeDocument).filter(EmployeeDocument.employee_id == employee.id, EmployeeDocument.document_type == "appointment_letter").first()
    if item:
        item.title, item.content, item.status, item.created_by, item.sent_at = "Appointment Letter", json.dumps(values), "Sent" if payload.send else "Draft", current_user.id, datetime.utcnow() if payload.send else None
    else:
        item = EmployeeDocument(employee_id=employee.id, document_type="appointment_letter", title="Appointment Letter", content=json.dumps(values), status="Sent" if payload.send else "Draft", created_by=current_user.id, sent_at=datetime.utcnow() if payload.send else None)
        db.add(item)
    db.commit()
    db.refresh(item)
    if payload.send and employee.email:
        send_email([employee.email], "Your Appointment Letter", f"<p>Hi {employee.name},</p><p>Your Appointment Letter is available in My Profile → Documents.</p>")
    db.add(ActivityLog(user_id=current_user.id, activity=f"{'Sent' if payload.send else 'Saved draft'} appointment letter for '{employee.name}'"))
    db.commit()
    return _document_dict(item)
