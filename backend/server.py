"""
Smart Health Monitoring System - Backend Server
=================================================
FastAPI server with WebSocket, SQLite persistence,
medicine reminder sync, and background alarm checker.
"""

import asyncio
import json
import logging
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(message)s",
)
logger = logging.getLogger("health-monitor")

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
DB_PATH = Path(__file__).resolve().parent / "health.db"


def get_db():
    """Return a new SQLite connection (per-call for thread safety)."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """Create the vital_logs table if it doesn't exist."""
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vital_logs (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      TEXT    NOT NULL,
            heart_rate     INTEGER,
            spo2           INTEGER,
            temp           REAL,
            fall_detected  INTEGER DEFAULT 0
        )
        """
    )
    conn.commit()
    conn.close()
    logger.info("Database initialized at %s", DB_PATH)


def save_vital(data: dict):
    """Insert one vital-data row."""
    conn = get_db()
    conn.execute(
        """
        INSERT INTO vital_logs (timestamp, heart_rate, spo2, temp, fall_detected)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            data.get("timestamp", datetime.now().isoformat()),
            data.get("heart_rate"),
            data.get("spo2"),
            data.get("temp"),
            1 if data.get("fall_detected") else 0,
        ),
    )
    conn.commit()
    conn.close()


def fetch_history(limit: int = 10) -> list[dict]:
    """Return the last `limit` readings, newest first."""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM vital_logs ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ---------------------------------------------------------------------------
# Medicine Reminder State
# ---------------------------------------------------------------------------
reminder_time: str | None = None          # e.g. "14:30"
alarm_fired_for: str | None = None        # prevents repeated alarms for same minute


class ReminderRequest(BaseModel):
    time: str  # "HH:MM"

# ---------------------------------------------------------------------------
# Connection Manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    """Keeps track of active WebSocket connections by client type."""

    def __init__(self):
        self.device_connections: Set[WebSocket] = set()
        self.frontend_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket, client_type: str):
        await websocket.accept()
        if client_type == "device":
            self.device_connections.add(websocket)
            logger.info(
                "Device connected. Total devices: %d", len(self.device_connections)
            )
        elif client_type == "frontend":
            self.frontend_connections.add(websocket)
            logger.info(
                "Frontend connected. Total frontends: %d",
                len(self.frontend_connections),
            )

    def disconnect(self, websocket: WebSocket, client_type: str):
        if client_type == "device":
            self.device_connections.discard(websocket)
            logger.info(
                "Device disconnected. Total devices: %d", len(self.device_connections)
            )
        elif client_type == "frontend":
            self.frontend_connections.discard(websocket)
            logger.info(
                "Frontend disconnected. Total frontends: %d",
                len(self.frontend_connections),
            )

    async def broadcast_to_frontends(self, data: str):
        """Send a message to every connected frontend client."""
        disconnected = []
        for conn in self.frontend_connections:
            try:
                await conn.send_text(data)
            except Exception:
                disconnected.append(conn)
        for conn in disconnected:
            self.frontend_connections.discard(conn)

    async def broadcast_to_devices(self, data: str):
        """Send a message to every connected device client."""
        disconnected = []
        for conn in self.device_connections:
            try:
                await conn.send_text(data)
            except Exception:
                disconnected.append(conn)
        for conn in disconnected:
            self.device_connections.discard(conn)


manager = ConnectionManager()

# ---------------------------------------------------------------------------
# Background Alarm Checker
# ---------------------------------------------------------------------------

async def alarm_checker():
    """Runs every 10 s — fires alarm when current time matches reminder_time."""
    global alarm_fired_for
    while True:
        await asyncio.sleep(10)
        if reminder_time is None:
            continue
        now_hm = datetime.now().strftime("%H:%M")
        if now_hm == reminder_time and alarm_fired_for != now_hm:
            alarm_fired_for = now_hm
            alarm_msg = json.dumps({"type": "ALARM", "payload": True})
            logger.info("⏰  ALARM triggered for %s — broadcasting", now_hm)
            await manager.broadcast_to_frontends(alarm_msg)
            await manager.broadcast_to_devices(alarm_msg)
        elif now_hm != reminder_time:
            # Reset so alarm can fire again next time the minute matches
            alarm_fired_for = None

# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(alarm_checker())
    yield
    task.cancel()

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
app = FastAPI(title="Smart Health Monitoring System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# WebSocket Endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws/{client_type}")
async def websocket_endpoint(websocket: WebSocket, client_type: str):
    if client_type not in ("device", "frontend"):
        await websocket.close(code=1008, reason="Invalid client_type")
        return

    await manager.connect(websocket, client_type)
    try:
        while True:
            data = await websocket.receive_text()
            if client_type == "device":
                logger.info("Data from device → saving & broadcasting")
                # Save to DB
                try:
                    parsed = json.loads(data)
                    save_vital(parsed)
                except Exception as e:
                    logger.error("DB save error: %s", e)
                # Broadcast to frontends
                await manager.broadcast_to_frontends(data)
            else:
                logger.info("Message from frontend: %s", data)
    except WebSocketDisconnect:
        manager.disconnect(websocket, client_type)
    except Exception as exc:
        logger.error("WebSocket error: %s", exc)
        manager.disconnect(websocket, client_type)

# ---------------------------------------------------------------------------
# REST API Endpoints
# ---------------------------------------------------------------------------

@app.get("/history")
async def get_history():
    """Return the last 10 vital readings (newest first)."""
    rows = fetch_history(10)
    return JSONResponse(content=rows)


@app.post("/set-reminder")
async def set_reminder(req: ReminderRequest):
    """
    Set the medicine reminder time and immediately
    broadcast SYNC_TIME to all connected devices.
    """
    global reminder_time, alarm_fired_for
    reminder_time = req.time
    alarm_fired_for = None  # reset so alarm can fire for new time
    logger.info("Reminder set to %s — syncing with devices", reminder_time)

    sync_msg = json.dumps({"type": "SYNC_TIME", "payload": reminder_time})
    await manager.broadcast_to_devices(sync_msg)

    return {"status": "ok", "reminder_time": reminder_time}

# ---------------------------------------------------------------------------
# Static Files & Root Route
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
