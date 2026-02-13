/**
 * IoT Health Monitor — Frontend Controller
 * ==========================================
 * • WebSocket client with auto-reconnect
 * • Real-time Chart.js line graph (heart rate)
 * • Vital card updates with neon status colours
 * • Fall-detection full-screen overlay
 * • Medicine reminder POST + alarm overlay
 * • History table from GET /history
 * • System log panel
 */

(() => {
    "use strict";

    /* ── DOM refs ─────────────────────────────────────────── */
    const $ = (id) => document.getElementById(id);

    const statusBadge    = $("status-badge");
    const statusText     = $("status-text");
    const deviceLabel    = $("device-id-label");

    const valHR   = $("val-hr");
    const valSPO2 = $("val-spo2");
    const valTemp = $("val-temp");
    const barHR   = $("bar-hr");
    const barSPO2 = $("bar-spo2");
    const barTemp = $("bar-temp");

    const chartTag       = $("chart-tag");
    const logsBody       = $("logs-body");
    const clearLogsBtn   = $("clear-logs-btn");

    const fallOverlay    = $("fall-overlay");
    const fallDismiss    = $("fall-dismiss-btn");

    // Medicine reminder
    const reminderInput  = $("reminder-time");
    const setReminderBtn = $("set-reminder-btn");
    const reminderStatus = $("reminder-status");

    // Alarm overlay
    const alarmOverlay   = $("alarm-overlay");
    const alarmDismiss   = $("alarm-dismiss-btn");

    // History
    const historyTbody   = $("history-tbody");
    const refreshHistBtn = $("refresh-history-btn");

    /* ── Config ───────────────────────────────────────────── */
    const WS_PROTO         = location.protocol === "https:" ? "wss:" : "ws:";
    const WS_URL           = `${WS_PROTO}//${location.host}/ws/frontend`;
    const RECONNECT_MS     = 3000;
    const MAX_CHART_POINTS = 40;
    const MAX_LOG_ENTRIES  = 80;
    const HISTORY_INTERVAL = 8000;  // auto-refresh history every 8 s

    const RANGE = {
        hr:   { min: 60, max: 100 },
        spo2: { min: 95, max: 100 },
        temp: { min: 36, max: 38  },
    };

    let socket = null;
    let alarmAudio = null;

    /* ── Create alarm beep via Web Audio API ──────────────── */
    function playAlarmSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const beep = (freq, start, dur) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "square";
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.25, start);
                gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
                osc.connect(gain).connect(ctx.destination);
                osc.start(start);
                osc.stop(start + dur);
            };
            const now = ctx.currentTime;
            beep(880, now, 0.15);
            beep(880, now + 0.2, 0.15);
            beep(1100, now + 0.45, 0.3);
        } catch (_) { /* silent fallback */ }
    }

    /* ── Chart.js Setup ───────────────────────────────────── */
    const chartCtx = $("hr-chart").getContext("2d");
    const gradientFill = chartCtx.createLinearGradient(0, 0, 0, 280);
    gradientFill.addColorStop(0, "rgba(0, 255, 159, .30)");
    gradientFill.addColorStop(1, "rgba(0, 255, 159, .00)");

    const hrChart = new Chart(chartCtx, {
        type: "line",
        data: { labels: [], datasets: [{
            label: "Heart Rate (BPM)", data: [],
            borderColor: "#00ff9f", backgroundColor: gradientFill,
            borderWidth: 2.5, pointRadius: 3,
            pointBackgroundColor: "#00ff9f", pointBorderColor: "#121212",
            pointBorderWidth: 1.5, pointHoverRadius: 6,
            pointHoverBackgroundColor: "#fff", tension: 0.35, fill: true,
        }]},
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 400, easing: "easeOutQuart" },
            interaction: { mode: "index", intersect: false },
            scales: {
                x: { ticks: { color: "#7a7a8e", font: { size: 10 }, maxTicksLimit: 10 },
                     grid: { color: "rgba(255,255,255,.04)" } },
                y: { min: 50, max: 120,
                     ticks: { color: "#7a7a8e", font: { size: 11 }, stepSize: 10 },
                     grid: { color: "rgba(255,255,255,.06)" } },
            },
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: "#1a1a2e", titleColor: "#00ff9f",
                           bodyColor: "#e0e0e0", borderColor: "#00ff9f",
                           borderWidth: 1, cornerRadius: 8, padding: 10 },
            },
        },
    });

    /* ── WebSocket ─────────────────────────────────────────── */
    function connect() {
        socket = new WebSocket(WS_URL);

        socket.addEventListener("open", () => {
            setConnection(true);
            addLog("info", "WebSocket connected to server.");
            fetchHistory();
        });

        socket.addEventListener("message", (e) => {
            try {
                const msg = JSON.parse(e.data);
                // Check if it's a typed message (ALARM, etc.)
                if (msg.type === "ALARM" && msg.payload === true) {
                    triggerAlarmOverlay();
                    return;
                }
                // Otherwise treat as vital data
                onVitalData(msg);
            } catch (err) {
                addLog("danger", `Parse error: ${err.message}`);
            }
        });

        socket.addEventListener("close", () => {
            setConnection(false);
            addLog("warning", "Connection lost — reconnecting in 3 s…");
            setTimeout(connect, RECONNECT_MS);
        });

        socket.addEventListener("error", () => socket.close());
    }

    function setConnection(live) {
        if (live) {
            statusBadge.classList.add("live");
            statusText.textContent = "Live 🟢";
        } else {
            statusBadge.classList.remove("live");
            statusText.textContent = "Offline";
        }
    }

    /* ── Vital Data Handler ────────────────────────────────── */
    function onVitalData(d) {
        if (d.device_id) deviceLabel.textContent = `Device: ${d.device_id}`;
        updateVital(valHR,   barHR,   d.heart_rate, RANGE.hr,   0);
        updateVital(valSPO2, barSPO2, d.spo2,       RANGE.spo2, 0);
        updateVital(valTemp, barTemp,  d.temp,       RANGE.temp, 1);
        pushChart(d.heart_rate);
        if (d.fall_detected === true) triggerFallAlert();
        addLog("data",
            `HR=${d.heart_rate} bpm  SpO₂=${d.spo2}%  Temp=${
                d.temp != null ? d.temp.toFixed(1) : "--"
            }°C  Fall=${d.fall_detected ? "⚠ YES" : "No"}`);
    }

    function updateVital(valEl, barEl, raw, range, dec) {
        valEl.textContent = (dec > 0 && raw != null) ? raw.toFixed(dec) : (raw ?? "--");
        const ok = raw >= range.min && raw <= range.max;
        valEl.classList.remove("normal", "danger");
        valEl.classList.add(ok ? "normal" : "danger");
        barEl.classList.remove("danger");
        if (!ok) barEl.classList.add("danger");
        const pct = Math.min(100, Math.max(0, ((raw - range.min) / (range.max - range.min)) * 100));
        barEl.style.width = `${pct}%`;
    }

    function pushChart(hr) {
        const now = new Date().toLocaleTimeString();
        hrChart.data.labels.push(now);
        hrChart.data.datasets[0].data.push(hr);
        if (hrChart.data.labels.length > MAX_CHART_POINTS) {
            hrChart.data.labels.shift();
            hrChart.data.datasets[0].data.shift();
        }
        hrChart.update();
        chartTag.textContent = `${hr} BPM`;
        chartTag.classList.add("live");
    }

    /* ── Fall Alert ────────────────────────────────────────── */
    function triggerFallAlert() {
        fallOverlay.classList.add("active");
        addLog("danger", "🚨 FALL DETECTED — Immediate attention required!");
    }
    fallDismiss.addEventListener("click", () => {
        fallOverlay.classList.remove("active");
        addLog("info", "Fall alert dismissed.");
    });

    /* ── Medicine Alarm Overlay ────────────────────────────── */
    function triggerAlarmOverlay() {
        alarmOverlay.classList.add("active");
        playAlarmSound();
        addLog("warning", "💊 ALARM — Time to take medicine!");
    }
    alarmDismiss.addEventListener("click", () => {
        alarmOverlay.classList.remove("active");
        addLog("info", "Medicine alarm acknowledged.");
    });

    /* ── Medicine Reminder (POST /set-reminder) ───────────── */
    setReminderBtn.addEventListener("click", async () => {
        const time = reminderInput.value;
        if (!time) { addLog("warning", "Please select a time."); return; }
        try {
            const res = await fetch("/set-reminder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ time }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            reminderStatus.textContent = `✅ Reminder synced with Device: ${data.reminder_time}`;
            reminderStatus.classList.add("synced");
            addLog("info", `⏰ Reminder set & synced → ${data.reminder_time}`);
        } catch (err) {
            reminderStatus.textContent = `❌ Sync failed: ${err.message}`;
            reminderStatus.classList.remove("synced");
            addLog("danger", `Reminder sync failed: ${err.message}`);
        }
    });

    /* ── History Table (GET /history) ──────────────────────── */
    async function fetchHistory() {
        try {
            const res = await fetch("/history");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = await res.json();
            renderHistory(rows);
        } catch (err) {
            addLog("warning", `History fetch failed: ${err.message}`);
        }
    }

    function renderHistory(rows) {
        if (!rows.length) {
            historyTbody.innerHTML = '<tr><td colspan="6" class="history-table__empty">No history available yet.</td></tr>';
            return;
        }
        historyTbody.innerHTML = rows.map((r, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${r.timestamp || "—"}</td>
                <td>${r.heart_rate ?? "—"}</td>
                <td>${r.spo2 ?? "—"}</td>
                <td>${r.temp != null ? Number(r.temp).toFixed(1) : "—"}</td>
                <td class="${r.fall_detected ? "fall-yes" : "fall-no"}">${r.fall_detected ? "⚠ YES" : "No"}</td>
            </tr>`).join("");
    }

    refreshHistBtn.addEventListener("click", fetchHistory);
    // Auto-refresh history periodically
    setInterval(fetchHistory, HISTORY_INTERVAL);

    /* ── System Logs ──────────────────────────────────────── */
    function addLog(level, msg) {
        const entry = document.createElement("p");
        entry.className = `log-entry log-entry--${level}`;
        const ts = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-ts">[${ts}]</span> ${msg}`;
        logsBody.prepend(entry);
        while (logsBody.children.length > MAX_LOG_ENTRIES) logsBody.removeChild(logsBody.lastChild);
    }
    clearLogsBtn.addEventListener("click", () => {
        logsBody.innerHTML = "";
        addLog("info", "Logs cleared.");
    });

    /* ── Boot ─────────────────────────────────────────────── */
    connect();
})();
