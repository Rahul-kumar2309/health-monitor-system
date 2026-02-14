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
from datetime import datetime, timedelta
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
# Medicine Reminder State (Multiple Alarms)
# ---------------------------------------------------------------------------
alarms: list = []           # [{"id": 1, "time": "02:30 PM", "medicine": "Dolo"}, ...]
next_alarm_id: int = 1
alarm_fired_set: set = set()  # tracks (alarm_id, minute_str) to avoid repeats

# ---------------------------------------------------------------------------
# Fall Detection Toggle (Maintenance Mode)
# ---------------------------------------------------------------------------
FALL_DETECTION_ENABLED: bool = True


class AddReminderRequest(BaseModel):
    time: str       # "hh:mm AM/PM"
    medicine: str   # medicine name

class DeleteReminderRequest(BaseModel):
    id: int

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
    """Runs every 10 s — checks ALL alarms and fires matching ones."""
    global alarm_fired_set
    while True:
        await asyncio.sleep(10)
        if not alarms:
            continue
        now_12 = datetime.now().strftime("%I:%M %p")
        for alarm in alarms:
            fire_key = (alarm["id"], now_12)
            if alarm["time"] == now_12 and fire_key not in alarm_fired_set:
                alarm_fired_set.add(fire_key)
                alarm_msg = json.dumps({
                    "type": "ALARM",
                    "medicine": alarm["medicine"],
                    "time": alarm["time"],
                })
                logger.info("⏰  ALARM: %s at %s — broadcasting", alarm["medicine"], now_12)
                await manager.broadcast_to_frontends(alarm_msg)
                await manager.broadcast_to_devices(alarm_msg)
        # Clean up fired keys for times that no longer match
        alarm_fired_set = {k for k in alarm_fired_set if k[1] == now_12}

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
# AI Health Risk Calculator
# ---------------------------------------------------------------------------

def calculate_health_risk(hr, spo2, temp):
    """
    Weighted rule-based risk scoring (simulated AI).
    Returns (risk_score: int 0-100, risk_label: str).
    """
    risk = 0

    # Heart Rate rules
    if hr is not None:
        if hr > 120:
            risk += 40
        elif hr > 100 or hr < 60:
            risk += 20

    # SpO2 rules
    if spo2 is not None:
        if spo2 < 90:
            risk += 50
        elif spo2 < 95:
            risk += 30

    # Temperature rules
    if temp is not None:
        if temp > 37.5:
            risk += 10

    risk = min(risk, 100)

    if risk >= 71:
        label = "Critical"
    elif risk >= 31:
        label = "Warning"
    else:
        label = "Normal"

    return risk, label


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
                try:
                    parsed = json.loads(data)
                    # Guard: suppress fall events when fall detection is OFF
                    if not FALL_DETECTION_ENABLED and parsed.get("fall_detected"):
                        parsed["fall_detected"] = False
                        logger.info("Fall suppressed — detection disabled")

                    save_vital(parsed)

                    # Inject AI health risk into the payload
                    risk_score, risk_label = calculate_health_risk(
                        parsed.get("heart_rate"),
                        parsed.get("spo2"),
                        parsed.get("temp"),
                    )
                    parsed["risk_score"] = risk_score
                    parsed["risk_label"] = risk_label
                    data = json.dumps(parsed)
                except Exception as e:
                    logger.error("DB save error: %s", e)
                # Broadcast to frontends (now includes risk data)
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
    """Return the last 50 vital readings (newest first)."""
    rows = fetch_history(50)
    return JSONResponse(content=rows)


@app.get("/history-summary")
async def get_history_summary():
    """Return up to 10 rows of 1-minute averaged data (last 10 minutes)."""
    now = datetime.now()
    cutoff = (now - timedelta(minutes=10)).isoformat()

    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM vital_logs WHERE timestamp >= ? ORDER BY timestamp ASC",
        (cutoff,),
    ).fetchall()
    conn.close()

    raw = [dict(r) for r in rows]
    if not raw:
        return JSONResponse(content=[])

    summary = []
    for i in range(10):
        bucket_start = now - timedelta(minutes=10) + timedelta(minutes=i)
        bucket_end = bucket_start + timedelta(minutes=1)
        start_iso = bucket_start.isoformat()
        end_iso = bucket_end.isoformat()

        bucket = [r for r in raw if start_iso <= r.get("timestamp", "") < end_iso]
        if not bucket:
            continue

        hr_vals  = [r["heart_rate"] for r in bucket if r.get("heart_rate") is not None]
        spo_vals = [r["spo2"]       for r in bucket if r.get("spo2") is not None]
        tmp_vals = [r["temp"]       for r in bucket if r.get("temp") is not None]
        falls    = sum(1 for r in bucket if r.get("fall_detected"))

        summary.append({
            "timestamp": bucket_start.strftime("%I:%M %p"),
            "heart_rate": round(sum(hr_vals) / len(hr_vals), 1) if hr_vals else None,
            "spo2":       round(sum(spo_vals) / len(spo_vals), 1) if spo_vals else None,
            "temp":       round(sum(tmp_vals) / len(tmp_vals), 1) if tmp_vals else None,
            "fall_detected": falls > 0,
            "samples":    len(bucket),
        })

    return JSONResponse(content=summary)


class FallToggleRequest(BaseModel):
    enabled: bool


@app.post("/toggle-fall-detection")
async def toggle_fall_detection(req: FallToggleRequest):
    """Enable or disable fall detection globally."""
    global FALL_DETECTION_ENABLED
    FALL_DETECTION_ENABLED = req.enabled
    state = "ENABLED" if req.enabled else "DISABLED"
    logger.info("Fall detection %s", state)
    return {"status": "ok", "fall_detection": state}


@app.get("/report-data")
async def get_report_data(duration: str = "1_day"):
    """
    Return time-slot averaged data for PDF reports.
    Durations: 1_minute (10 slots), 1_hour (20 slots), 1_day (50 slots).
    """
    if duration == "1_minute":
        delta = timedelta(minutes=1)
        slots = 10
    else:  # 1_hour (default)
        delta = timedelta(hours=1)
        slots = 15

    now = datetime.now()
    cutoff = (now - delta).isoformat()

    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM vital_logs WHERE timestamp >= ? ORDER BY timestamp ASC",
        (cutoff,),
    ).fetchall()
    conn.close()

    raw = [dict(r) for r in rows]
    total_raw = len(raw)

    if total_raw == 0:
        return JSONResponse(content={"slots": [], "total_raw": 0, "duration": duration})

    # Divide time range into equal slots and average
    slot_duration = delta / slots
    aggregated = []

    for i in range(slots):
        slot_start = now - delta + (slot_duration * i)
        slot_end = slot_start + slot_duration
        start_iso = slot_start.isoformat()
        end_iso = slot_end.isoformat()

        bucket = [r for r in raw if start_iso <= r.get("timestamp", "") < end_iso]

        if not bucket:
            continue

        hr_vals  = [r["heart_rate"] for r in bucket if r.get("heart_rate") is not None]
        spo_vals = [r["spo2"]       for r in bucket if r.get("spo2") is not None]
        tmp_vals = [r["temp"]       for r in bucket if r.get("temp") is not None]
        falls    = sum(1 for r in bucket if r.get("fall_detected"))

        aggregated.append({
            "slot":       i + 1,
            "time_start": slot_start.strftime("%I:%M:%S %p"),
            "time_end":   slot_end.strftime("%I:%M:%S %p"),
            "avg_hr":     round(sum(hr_vals) / len(hr_vals), 1) if hr_vals else None,
            "avg_spo2":   round(sum(spo_vals) / len(spo_vals), 1) if spo_vals else None,
            "avg_temp":   round(sum(tmp_vals) / len(tmp_vals), 1) if tmp_vals else None,
            "falls":      falls,
            "samples":    len(bucket),
        })

    return JSONResponse(content={
        "slots": aggregated,
        "total_raw": total_raw,
        "duration": duration,
    })


@app.post("/add-reminder")
async def add_reminder(req: AddReminderRequest):
    """Add a medicine reminder and sync with devices."""
    global next_alarm_id
    alarm = {"id": next_alarm_id, "time": req.time, "medicine": req.medicine}
    alarms.append(alarm)
    next_alarm_id += 1
    logger.info("Reminder added: %s at %s (id=%d)", req.medicine, req.time, alarm["id"])
    sync_msg = json.dumps({"type": "SYNC_TIME", "payload": f"{req.medicine} at {req.time}"})
    await manager.broadcast_to_devices(sync_msg)
    return {"status": "ok", "alarm": alarm}


@app.post("/delete-reminder")
async def delete_reminder(req: DeleteReminderRequest):
    """Remove a reminder by its ID."""
    global alarms
    alarms = [a for a in alarms if a["id"] != req.id]
    logger.info("Reminder deleted: id=%d", req.id)
    return {"status": "ok"}


@app.get("/reminders")
async def get_reminders():
    """Return the current list of active reminders."""
    return JSONResponse(content=alarms)


@app.post("/reset-alarm")
async def reset_alarm():
    """
    Stop the emergency fall alarm on ALL connected clients
    (frontends + device buzzer).
    """
    stop_msg = json.dumps({"type": "STOP_ALARM"})
    logger.info("🛑 Reset alarm — broadcasting STOP_ALARM to all clients")
    await manager.broadcast_to_frontends(stop_msg)
    await manager.broadcast_to_devices(stop_msg)
    return {"status": "ok", "message": "Alarm stopped"}

# ---------------------------------------------------------------------------
# Static Files & Root Route
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
