"""
routers/device_requests.py
Admin/SuperAdmin review of pending employee device registration requests
(created automatically during login from an unrecognized device — see
routers/login.py).
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from models import DeviceRequest, User, ActivityLog
from schemas import DeviceRequestDecision, DeviceRequestOut

router = APIRouter()


@router.get("/", response_model=List[DeviceRequestOut])
def list_device_requests(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = db.query(DeviceRequest, User.name).join(User, User.id == DeviceRequest.user_id)
    if status_filter:
        query = query.filter(DeviceRequest.status == status_filter)
    return [
        {
            "id": request.id,
            "user_id": request.user_id,
            "user_name": user_name,
            "device_token": request.device_token,
            "device_name": request.device_name,
            "browser_name": request.browser_name,
            "status": request.status,
            "requested_at": request.requested_at,
            "approved_by": request.approved_by,
        }
        for request, user_name in query.order_by(DeviceRequest.requested_at.desc()).all()
    ]


@router.put("/{request_id}", response_model=DeviceRequestOut)
def decide_device_request(
    request_id: int,
    payload: DeviceRequestDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if payload.status not in ("Approved", "Rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'Approved' or 'Rejected'")

    device_request = db.query(DeviceRequest).filter(DeviceRequest.id == request_id).first()
    if not device_request:
        raise HTTPException(status_code=404, detail="Device request not found")
    if device_request.status != "Pending":
        raise HTTPException(status_code=400, detail="This request has already been processed")

    device_request.status = payload.status
    device_request.approved_by = current_user.id

    if payload.status == "Approved":
        user = db.query(User).filter(User.id == device_request.user_id).first()
        if user:
            user.device_token = device_request.device_token
            user.device_name = device_request.device_name
            user.browser_name = device_request.browser_name
            user.device_registered_at = datetime.utcnow()

    db.add(
        ActivityLog(
            user_id=current_user.id,
            activity=f"{payload.status} device request #{device_request.id}",
        )
    )
    db.commit()
    db.refresh(device_request)
    return device_request