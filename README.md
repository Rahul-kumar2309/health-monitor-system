# 🏥 Smart Health Monitoring System

> Real-time IoT patient monitor with a **cyberpunk medical dashboard**, WebSocket-powered live updates, AI-powered health risk scoring, light/dark theme switcher, SQLite persistence, multiple medicine reminders with device sync, fall-detection alerts with maintenance mode, and downloadable aggregated PDF reports.

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-Live-00ff9f)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

### 📊 Real-Time Vital Signs Dashboard

- **Heart Rate**, **SpO₂**, **Temperature** — live cards with pulse animation
- Color-coded status indicators (Normal/Warning/Critical)
- Live **Chart.js** heart rate trend graph (last 40 data points)

### 💊 Multiple Medicine Reminders

- Add **unlimited named reminders** (e.g., "Dolo-650 at 02:30 PM")
- Active reminders list with **individual delete** buttons
- Full minute precision (00–59) for exact scheduling
- **WebSocket alarm** triggers on both dashboard and mock device
- Alarm overlay shows **specific medicine name and time**
- OLED simulation on mock device displays medicine details

### 🛡️ Fall Detection with Maintenance Mode

- Real-time fall alerts with **full-screen emergency overlay** and siren
- **Toggle switch** to enable/disable fall detection (maintenance mode)
- Toast notifications for system state changes
- When disabled, fall signals are silently ignored

### 📋 History Summary (1-Minute Averages)

- Table displays **last 10 minutes** of averaged data (up to 10 rows)
- Each row = **1-minute bucket** with avg HR, SpO₂, Temp
- Auto-refreshes every **5 seconds** via polling
- Fall detection status per minute

### 📄 Downloadable Smart Aggregated Report (PDF)

- Choose duration: **Last 1 Minute** or **Last 1 Hour**
- Generates a multi-slot averaged PDF via **jsPDF + AutoTable**
- Includes **digital verification footer** with randomly selected doctor profile
- S.No. numbering starts from 1

### 🤖 AI-Powered Health Risk Analysis

- Real-time **risk scoring** (0–100%) based on weighted vital sign rules
- **SVG ring gauge** + progress bar with dynamic color coding
- Three risk levels: **Normal** (Green), **Warning** (Orange), **Critical** (Red + pulse)
- Context-aware **advice text** updates with each reading
- Risk data injected server-side and broadcast via WebSocket

### 🎨 Light / Dark Theme Switcher

- **Light mode** (default): clean white cards, soft shadows, professional blue accent
- **Dark mode**: cyberpunk neon with glowing cyan borders and scanline effect
- Smooth `.4s` animated transitions between themes
- Preference saved to **localStorage** — persists across sessions

### 📟 Mock ESP32 Device Simulation

- Simulates realistic randomized vital signs every 1 second
- Handles **SYNC_TIME**, **ALARM**, and **STOP_ALARM** commands
- Displays medicine name and alarm time on simulated **OLED display**
- Auto-reconnect on connection loss

---

## 📁 Project Structure

```
Health Monitoring System/
│
├── backend/
│   └── server.py          # FastAPI server (WebSocket, REST API, SQLite, alarm checker, AI risk)
│
├── frontend/
│   ├── index.html          # Dashboard UI (vitals, AI risk card, chart, reminders, history)
│   ├── style.css           # Themeable CSS (light/dark), risk gauge, toast, reminder styles
│   └── script.js           # WebSocket client, Chart.js, theme switcher, risk updater, PDF
│
├── simulation/
│   └── mock_device.py      # Simulated ESP32 — streams vitals, handles ALARM with medicine name
│
├── requirements.txt        # Python dependencies
├── render.yaml             # Render.com deployment config
├── .gitignore
└── README.md               # ← You are here
```

> ⚠️ **Critical:** Always `cd` into the correct folder before running commands. The server must be started from the **project root** (`Health Monitoring System/`), NOT from inside `backend/`.

---

## ⚙️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Rahul-kumar2309/health-monitor-system.git
cd health-monitor-system
```

### 2. Create a Virtual Environment

```bash
python -m venv .venv
```

### 3. Activate the Virtual Environment

| OS                       | Command                        |
| ------------------------ | ------------------------------ |
| **Windows (PowerShell)** | `.\.venv\Scripts\Activate.ps1` |
| **Windows (CMD)**        | `.\.venv\Scripts\activate.bat` |
| **macOS / Linux**        | `source .venv/bin/activate`    |

You should see `(.venv)` in your terminal prompt after activation.

### 4. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## 🚀 How to Run Locally

You need **two terminals** open — one for the server and one for the mock device.

### Terminal 1 — Start the Server

```bash
# Make sure you are in the PROJECT ROOT folder (not inside backend/)
cd "Health Monitoring System"

# Activate venv
.\.venv\Scripts\Activate.ps1

# Start the FastAPI server
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

You should see:

```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

### Terminal 2 — Start the Mock Device

```bash
cd "Health Monitoring System"
.\.venv\Scripts\Activate.ps1

python simulation/mock_device.py
```

You should see:

```
[MOCK DEVICE] Connected as 'PATIENT_001'  ✓
[2026-...] HR=78  SpO2=98  Temp=36.9°C  Fall=No
```

### Open the Dashboard

Open your browser and go to:

```
http://localhost:8000
```

🎉 You'll see the dashboard (light mode default) with live vitals, AI risk gauge, real-time chart, medicine reminders, history summary, and fall detection controls! Click **🌞 Light** in the header to switch to cyberpunk dark mode.

---

## 📱 How to Run on Mobile (Local Network)

You can access the dashboard from your phone/tablet if both devices are on the **same Wi-Fi network**.

### Step 1 — Find Your PC's Local IP

Open a terminal on your PC and run:

| OS          | Command                                                         |
| ----------- | --------------------------------------------------------------- |
| **Windows** | `ipconfig` → Look for **IPv4 Address** under your Wi-Fi adapter |
| **macOS**   | `ifconfig en0` → Look for `inet`                                |
| **Linux**   | `hostname -I`                                                   |

Example: `192.168.1.105`

### Step 2 — Start the Server on All Interfaces

```bash
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

> The `--host 0.0.0.0` flag is crucial — it makes the server accessible from other devices on the network, not just `localhost`.

### Step 3 — Open on Mobile

On your phone's browser, navigate to:

```
http://192.168.x.x:8000
```

Replace `192.168.x.x` with your PC's actual IP from Step 1.

> **Note:** The mock device (`mock_device.py`) only needs to run on the PC. Your phone just views the dashboard.

---

## 🌐 Deployment Guide (Render.com)

Deploy the project to the internet for free using [Render.com](https://render.com).

### Prerequisites

- [ ] GitHub account with this repo pushed
- [ ] Render.com account (free tier)

### Step-by-Step

1. **Push to GitHub**

   ```bash
   git add -A
   git commit -m "ready for deployment"
   git remote add origin https://github.com/YOUR_USERNAME/health-monitor.git
   git branch -M main
   git push -u origin main
   ```

2. **Create Web Service on Render**
   - Go to [render.com/dashboard](https://dashboard.render.com) → **New +** → **Web Service**
   - Connect your GitHub account → Select `health-monitor` repo

3. **Configure Settings**

   | Setting           | Value                                                    |
   | ----------------- | -------------------------------------------------------- |
   | **Runtime**       | Python                                                   |
   | **Build Command** | `pip install -r requirements.txt`                        |
   | **Start Command** | `uvicorn backend.server:app --host 0.0.0.0 --port $PORT` |

4. **Click "Create Web Service"** → Wait 2–3 minutes for the build

5. **Your app will be live at:** `https://health-monitor-XXXX.onrender.com`

### Connecting the Mock Device to Deployed Server

Update `WS_URL` in `simulation/mock_device.py`:

```python
WS_URL = "wss://health-monitor-XXXX.onrender.com/ws/device"
```

> ⚠️ Use `wss://` (not `ws://`) for deployed servers — the frontend handles this automatically.

> 💡 **Free Tier Note:** Render spins down your app after 15 min of inactivity. The first request after sleep takes ~30 seconds to wake up.

---

## � API Reference

| Method | Endpoint                 | Description                                                       |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| `GET`  | `/`                      | Serves the dashboard (`index.html`)                               |
| `GET`  | `/history`               | Returns last 50 raw vital readings (JSON)                         |
| `GET`  | `/history-summary`       | Returns last 10 min of 1-minute averaged data (max 10 rows)       |
| `GET`  | `/reminders`             | Returns list of all active medicine reminders                     |
| `GET`  | `/report-data?duration=` | Returns aggregated report data (`1_minute` or `1_hour`)           |
| `POST` | `/add-reminder`          | Add a reminder — Body: `{"time": "HH:MM AM/PM", "medicine": "…"}` |
| `POST` | `/delete-reminder`       | Delete a reminder — Body: `{"id": 1}`                             |
| `POST` | `/toggle-fall-detection` | Enable/disable fall detection — Body: `{"enabled": true}`         |
| `POST` | `/reset-alarm`           | Stop emergency fall alarm on all connected clients                |
| `WS`   | `/ws/frontend`           | WebSocket for browser dashboard                                   |
| `WS`   | `/ws/device`             | WebSocket for ESP32 / mock device                                 |

### WebSocket Message Types

| Type         | Direction          | Description                                    |
| ------------ | ------------------ | ---------------------------------------------- |
| `ALARM`      | Server → Clients   | Medicine alarm with `medicine` and `time` keys |
| `SYNC_TIME`  | Server → Devices   | Syncs new reminder info to device display      |
| `STOP_ALARM` | Server → Clients   | Stops fall alarm on all clients                |
| `FALL`       | Server → Frontends | Emergency fall alert with patient data         |

---

## 🧩 Tech Stack

| Component      | Technology                                       |
| -------------- | ------------------------------------------------ |
| **Backend**    | Python 3.10+, FastAPI, Uvicorn, WebSockets       |
| **AI Risk**    | Weighted rule-based scoring (server-side)        |
| **Database**   | SQLite (local), PostgreSQL (production / Render) |
| **Frontend**   | HTML5, CSS3 Variables, Vanilla JavaScript        |
| **Charts**     | Chart.js                                         |
| **PDF Export** | jsPDF + jsPDF-AutoTable (via jsDelivr CDN)       |
| **Theming**    | CSS custom properties + localStorage             |
| **Hardware**   | ESP32 (simulated via `mock_device.py`)           |
| **Deployment** | Render.com                                       |

---

## �🐛 Troubleshooting

### `ModuleNotFoundError: No module named 'xxx'`

You forgot to install dependencies or activate the virtual environment.

```bash
# Activate venv first
.\.venv\Scripts\Activate.ps1

# Then install
pip install -r requirements.txt
```

### `Error loading ASGI app. Could not import module "server"`

You are running `uvicorn` from the **wrong directory**. You must be in the **project root**, not inside `backend/`.

```bash
# ❌ WRONG (inside backend/)
cd backend
uvicorn server:app --reload

# ✅ CORRECT (from project root)
cd "Health Monitoring System"
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

### `Address already in use` / Port 8000 is busy

Another process is using port 8000. Either kill it or use a different port:

```bash
# Option 1: Kill the process on port 8000 (Windows PowerShell)
Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Option 2: Use a different port
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8080 --reload
```

> If you change the port, also update `WS_URL` in `simulation/mock_device.py` to match.

### Mobile Can't Connect / Page Won't Load on Phone

1. **Same Wi-Fi?** Both PC and phone must be on the same network.
2. **Correct IP?** Run `ipconfig` and use the **IPv4 Address**, not `localhost`.
3. **Firewall blocking?** Temporarily allow Python through Windows Firewall:
   - **Windows Settings** → **Firewall & Network Protection** → **Allow an app through firewall**
   - Find **Python** → Check both **Private** and **Public** boxes.
4. **Server started with `0.0.0.0`?** The `--host 0.0.0.0` flag is mandatory for mobile access.

### Mock Device Disconnects Immediately

The server probably isn't running. Start the server first (Terminal 1), then the mock device (Terminal 2).

---

## 👨‍💻 Author

**Rahul Kumar**

---

<p align="center">
  Born to Build ❤️ Tech ✨
</p>
