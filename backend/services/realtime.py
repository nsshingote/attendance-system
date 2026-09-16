"""Single-process WebSocket connection management for notifications."""

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class NotificationConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._connection_loops: dict[int, dict[WebSocket, asyncio.AbstractEventLoop]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[user_id].add(websocket)
            self._connection_loops[user_id][websocket] = asyncio.get_running_loop()

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(user_id)
            if not connections:
                return
            connections.discard(websocket)
            self._connection_loops[user_id].pop(websocket, None)
            if not connections:
                self._connections.pop(user_id, None)
                self._connection_loops.pop(user_id, None)

    async def send_to_user(self, user_id: int, payload: dict) -> None:
        async with self._lock:
            connections = list(self._connections.get(user_id, set()))
        stale: list[WebSocket] = []
        for websocket in connections:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.disconnect(user_id, websocket)

    def send_after_commit(self, user_id: int, payload: dict[str, Any]) -> None:
        """Schedule delivery on the recipient's active event loop.

        This method is intentionally synchronous so SQLAlchemy's synchronous
        transaction events can invoke it after commit without committing or
        awaiting from inside the notification service.
        """
        loops = set(self._connection_loops.get(user_id, {}).values())
        for loop in loops:
            if loop.is_closed():
                continue
            asyncio.run_coroutine_threadsafe(self.send_to_user(user_id, payload), loop)


notification_connections = NotificationConnectionManager()
