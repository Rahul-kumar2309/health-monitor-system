# 🏥 Smart Health Monitoring System

> Real-time IoT patient monitor with a **cyberpunk medical dashboard**, WebSocket-powered live updates, SQLite persistence, medicine reminders with device sync, and fall-detection alerts.

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-Live-00ff9f)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## 📁 Project Structure

```
Health Monitoring System/
│
├── backend/
│   └── server.py          # FastAPI server (WebSocket, REST API, SQLite, alarm logic)
│
├── frontend/
│   ├── index.html          # Dashboard UI (vitals, chart, reminder, history, alerts)
│   ├── style.css           # Cyberpunk neon theme
│   └── script.js           # WebSocket client, Chart.js, alarm/reminder logic
│
├── simulation/
│   └── mock_device.py      # Simulated ESP32 — streams random vitals via WebSocket
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
git clone https://github.com/YOUR_USERNAME/health-monitor.git
cd health-monitor
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

## 🚀 How to Run Locally (PC Only)

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

🎉 You'll see the cyberpunk dashboard with live vitals, real-time chart, history table, and medicine reminder!

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

## 🐛 Troubleshooting

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

## 🧩 Tech Stack

| Component      | Technology                                       |
| -------------- | ------------------------------------------------ |
| **Backend**    | Python 3.10+, FastAPI, Uvicorn, WebSockets       |
| **Database**   | SQLite (local), PostgreSQL (production / Render) |
| **Frontend**   | HTML5, CSS3, Vanilla JavaScript                  |
| **Charts**     | Chart.js                                         |
| **Hardware**   | ESP32 (simulated via `mock_device.py`)           |
| **Deployment** | Render.com                                       |

---

## 📡 API Reference

| Method | Endpoint        | Description                                     |
| ------ | --------------- | ----------------------------------------------- |
| `GET`  | `/`             | Serves the dashboard (index.html)               |
| `GET`  | `/history`      | Returns last 10 vital readings (JSON)           |
| `POST` | `/set-reminder` | Sets medicine alarm — Body: `{"time": "HH:MM"}` |
| `WS`   | `/ws/frontend`  | WebSocket for browser dashboard                 |
| `WS`   | `/ws/device`    | WebSocket for ESP32 / mock device               |

---

## 👨‍💻 Author

**Rahul Kumar**

---

<p align="center">
  Built with ❤️ and neon glow ✨
</p>
