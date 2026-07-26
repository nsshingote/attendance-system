"""
routers/office_ips.py
Manage the list of approved office IP addresses/networks that employees
are allowed to check in/out from.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from models import OfficeIP, User, ActivityLog
from schemas import OfficeIPCreate, OfficeIPOut

router = APIRouter()


@router.get("/", response_model=List[OfficeIPOut])
def list_office_ips(db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return db.query(OfficeIP).order_by(OfficeIP.created_at.desc()).all()


@router.post("/", response_model=OfficeIPOut, status_code=201)
def add_office_ip(
    payload: OfficeIPCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(OfficeIP).filter(OfficeIP.ip_address == payload.ip_address).first():
        raise HTTPException(status_code=400, detail="This IP address is already registered")

    entry = OfficeIP(
        ip_address=payload.ip_address,
        network_name=payload.network_name,
        status=payload.status,
    )
    db.add(entry)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Added office IP '{payload.ip_address}'"))
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/{ip_id}/toggle", response_model=OfficeIPOut)
def toggle_office_ip(
    ip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entry = db.query(OfficeIP).filter(OfficeIP.id == ip_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Office IP not found")

    entry.status = "inactive" if entry.status == "active" else "active"
    db.add(ActivityLog(user_id=current_user.id, activity=f"Toggled office IP '{entry.ip_address}' to {entry.status}"))
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{ip_id}")
def delete_office_ip(
    ip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entry = db.query(OfficeIP).filter(OfficeIP.id == ip_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Office IP not found")

    db.delete(entry)
    db.add(ActivityLog(user_id=current_user.id, activity=f"Deleted office IP '{entry.ip_address}'"))
    db.commit()
    return {"message": "Office IP deleted"}