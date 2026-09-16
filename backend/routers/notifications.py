"""Authenticated in-app notification APIs and realtime delivery."""

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from auth import decode_access_token, get_current_user
from database import SessionLocal, get_db
from models import User
from schemas import NotificationListOut, NotificationOut
from services.notifications import (
    get_notification_for_user,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    serialize_notification,
)
from services.realtime import notification_connections

router = APIRouter()


@router.get("", response_model=NotificationListOut)
def get_notifications(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items, total, unread_count = list_notifications(db, current_user.id, offset=offset, limit=limit)
    return {"items": [serialize_notification(item) for item in items], "total": total, "unread_count": unread_count}


@router.get("/unread-count")
def get_unread_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _, _, unread_count = list_notifications(db, current_user.id, offset=0, limit=1)
    return {"unread_count": unread_count}


@router.patch("/{notification_id}/read", response_model=NotificationOut)
def read_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = get_notification_for_user(db, notification_id, current_user.id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    mark_notification_read(db, notification)
    db.commit()
    db.refresh(notification)
    return serialize_notification(notification)


@router.patch("/read-all")
def read_all_notifications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    updated = mark_all_notifications_read(db, current_user.id)
    db.commit()
    return {"updated": updated}


@router.websocket("/ws")
async def notifications_websocket(websocket: WebSocket):
    await websocket.accept()
    db = SessionLocal()
    user_id: int | None = None
    try:
        try:
            raw_message = await asyncio.wait_for(websocket.receive_text(), timeout=10)
            message = json.loads(raw_message)
            token = message.get("access_token") if isinstance(message, dict) else None
        except (asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
            await websocket.close(code=1008)
            return

        if not isinstance(token, str) or not token:
            await websocket.close(code=1008)
            return
        try:
            payload = decode_access_token(token)
            user_id = int(payload.get("sub"))
        except (HTTPException, TypeError, ValueError):
            await websocket.close(code=1008)
            return

        user = db.query(User).filter(User.id == user_id, User.status == "active").first()
        if user is None:
            await websocket.close(code=1008)
            return

        await notification_connections.connect(user.id, websocket)
        await websocket.send_json({"type": "ready"})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if user_id is not None:
            await notification_connections.disconnect(user_id, websocket)
        db.close()
