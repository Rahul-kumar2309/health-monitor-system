"""
Smart Health Monitoring System – Mock ESP32 Device
====================================================
Simulates an ESP32 sensor module streaming patient vitals
and handling incoming server commands (SYNC_TIME, ALARM).
"""

import asyncio
import json
import random
import sys
from datetime import datetime

import websockets

# ── Configuration ──────────────────────────────────────────
WS_URL    = "ws://localhost:8000/ws/device"
DEVICE_ID = "PATIENT_001"
INTERVAL  = 1  # seconds between readings


def generate_health_data() -> dict:
    """Return a realistic randomized health-data payload."""
    return {
        "device_id":     DEVICE_ID,
        "heart_rate":    random.randint(60, 100),
        "spo2":          random.randint(95, 100),
        "temp":          round(random.uniform(36.0, 38.0), 1),
        "fall_detected": random.random() < 0.02,
        "timestamp":     datetime.now().isoformat(),
    }


async def handle_incoming(ws):
    """Listen for commands from the server (runs concurrently)."""
    async for raw in ws:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue

        msg_type = msg.get("type")
        payload  = msg.get("payload")

        if msg_type == "SYNC_TIME":
            print(f"\n📟 [OLED DISPLAY]: Next Pill Alarm set for --> {payload}")
        elif msg_type == "ALARM":
            medicine = msg.get("medicine", "Unknown")
            alarm_time = msg.get("time", "")
            print(f"\n📟 [OLED DISPLAY]: 🔔 ALARM RANG! Take Medicine: {medicine}")
            print(f"   ⏰ Scheduled Time: {alarm_time}")
            print(f"   🔊 [BUZZER]: Beep! Beep! Beep!")
        elif msg_type == "STOP_ALARM":
            print(f"\n✅ [BUZZER OFF]: Patient confirmed safe — alarm stopped.")
        else:
            print(f"\n📩 [UNKNOWN MSG]: {msg}")


async def send_vitals(ws):
    """Send vital signs every INTERVAL seconds."""
    while True:
        payload = generate_health_data()
        await ws.send(json.dumps(payload))
        ts = payload["timestamp"]
        print(
            f"[{ts}]  HR={payload['heart_rate']}  "
            f"SpO2={payload['spo2']}  "
            f"Temp={payload['temp']}°C  "
            f"Fall={'YES' if payload['fall_detected'] else 'No'}"
        )
        await asyncio.sleep(INTERVAL)


async def stream():
    """Connect to the server and run send + receive concurrently."""
    print(f"[MOCK DEVICE] Connecting to {WS_URL} ...")

    async for ws in websockets.connect(WS_URL):
        try:
            print(f"[MOCK DEVICE] Connected as '{DEVICE_ID}'  ✓")
            # Run sender and receiver in parallel
            await asyncio.gather(
                send_vitals(ws),
                handle_incoming(ws),
            )
        except websockets.ConnectionClosed:
            print("[MOCK DEVICE] Connection lost – reconnecting …")
            continue
        except KeyboardInterrupt:
            print("\n[MOCK DEVICE] Shutting down.")
            break


if __name__ == "__main__":
    try:
        asyncio.run(stream())
    except KeyboardInterrupt:
        print("\n[MOCK DEVICE] Stopped.")
        sys.exit(0)
