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

  const statusBadge = $("status-badge");
  const statusText = $("status-text");
  const deviceLabel = $("device-id-label");

  const valHR = $("val-hr");
  const valSPO2 = $("val-spo2");
  const valTemp = $("val-temp");
  const barHR = $("bar-hr");
  const barSPO2 = $("bar-spo2");
  const barTemp = $("bar-temp");

  const chartTag = $("chart-tag");
  const logsBody = $("logs-body");
  const clearLogsBtn = $("clear-logs-btn");

  const fallOverlay = $("fall-overlay");
  const fallSafeBtn = $("fall-safe-btn");
  const fallSiren   = $("fall-siren");

  // Medicine reminder (multiple reminders)
  const medName       = $("med-name");
  const pickHour      = $("pick-hour");
  const pickMinute    = $("pick-minute");
  const pickAmpm      = $("pick-ampm");
  const addReminderBtn = $("add-reminder-btn");
  const reminderListEl = $("reminder-list");
  const alarmMedicineName = $("alarm-medicine-name");

  // Alarm overlay
  const alarmOverlay = $("alarm-overlay");
  const alarmDismiss = $("alarm-dismiss-btn");

  // History
  const historyTbody = $("history-tbody");
  const refreshHistBtn = $("refresh-history-btn");

  // Fall detection toggle & toast
  const fallToggleCb = $("fall-toggle-cb");
  const toastEl     = $("toast");

  /* ── Config ───────────────────────────────────────────── */
  const WS_PROTO = location.protocol === "https:" ? "wss:" : "ws:";
  const WS_URL = `${WS_PROTO}//${location.host}/ws/frontend`;
  const RECONNECT_MS = 3000;
  const MAX_CHART_POINTS = 40;
  const MAX_LOG_ENTRIES = 80;
  const HISTORY_INTERVAL = 5000; // poll history summary every 5 s

  const RANGE = {
    hr: { min: 60, max: 100 },
    spo2: { min: 95, max: 100 },
    temp: { min: 36, max: 38 },
  };

  let socket = null;
  let alarmAudio = null;

  /* ── Time Format Helpers (12-Hour AM/PM) ───────────────── */
  function formatTime(dateObj) {
    let h = dateObj.getHours();
    const m = String(dateObj.getMinutes()).padStart(2, "0");
    const s = String(dateObj.getSeconds()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${String(h).padStart(2, "0")}:${m}:${s} ${ampm}`;
  }

  function formatTimestamp(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d)) return isoStr || "—";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy} ${formatTime(d)}`;
  }

  function to12Hour(hhmm) {
    const [hStr, mStr] = hhmm.split(":");
    let h = parseInt(hStr, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${String(h).padStart(2, "0")}:${mStr} ${ampm}`;
  }

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
    } catch (_) {
      /* silent fallback */
    }
  }

  /* ── Chart.js Setup ───────────────────────────────────── */
  const chartCtx = $("hr-chart").getContext("2d");
  const gradientFill = chartCtx.createLinearGradient(0, 0, 0, 280);
  gradientFill.addColorStop(0, "rgba(0, 255, 159, .30)");
  gradientFill.addColorStop(1, "rgba(0, 255, 159, .00)");

  const hrChart = new Chart(chartCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Heart Rate (BPM)",
          data: [],
          borderColor: "#00ff9f",
          backgroundColor: gradientFill,
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: "#00ff9f",
          pointBorderColor: "#121212",
          pointBorderWidth: 1.5,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: "#fff",
          tension: 0.35,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: { color: "#7a7a8e", font: { size: 10 }, maxTicksLimit: 10 },
          grid: { color: "rgba(255,255,255,.04)" },
        },
        y: {
          min: 50,
          max: 120,
          ticks: { color: "#7a7a8e", font: { size: 11 }, stepSize: 10 },
          grid: { color: "rgba(255,255,255,.06)" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a1a2e",
          titleColor: "#00ff9f",
          bodyColor: "#e0e0e0",
          borderColor: "#00ff9f",
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
        },
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
      fetchReminders();
    });

    socket.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(e.data);
        // Typed messages
        if (msg.type === "ALARM") {
          triggerAlarmOverlay(msg.medicine, msg.time);
          return;
        }
        if (msg.type === "STOP_ALARM") {
          stopFallAlert();
          addLog("info", "✅ Alarm stopped by remote reset.");
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

  /* ── Toast Notification ──────────────────────────────── */
  function showToast(msg, type = "success") {
    toastEl.textContent = msg;
    toastEl.className = `toast toast--${type} show`;
    setTimeout(() => { toastEl.classList.remove("show"); }, 2500);
  }

  /* ── Fall Detection Toggle ──────────────────────────── */
  fallToggleCb.addEventListener("change", async () => {
    const enabled = fallToggleCb.checked;
    try {
      await fetch("/toggle-fall-detection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (enabled) {
        showToast("✅ Fall Detection Active", "success");
        addLog("info", "🛡️ Fall detection enabled.");
      } else {
        showToast("🚫 Fall Detection Disabled", "warning");
        addLog("warning", "🛡️ Fall detection disabled (maintenance mode).");
      }
    } catch (err) {
      addLog("danger", `Toggle failed: ${err.message}`);
      fallToggleCb.checked = !enabled; // revert on failure
    }
  });

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
    updateVital(valHR, barHR, d.heart_rate, RANGE.hr, 0);
    updateVital(valSPO2, barSPO2, d.spo2, RANGE.spo2, 0);
    updateVital(valTemp, barTemp, d.temp, RANGE.temp, 1);
    pushChart(d.heart_rate);
    if (d.fall_detected === true) triggerFallAlert();
    addLog(
      "data",
      `HR=${d.heart_rate} bpm  SpO₂=${d.spo2}%  Temp=${
        d.temp != null ? d.temp.toFixed(1) : "--"
      }°C  Fall=${d.fall_detected ? "⚠ YES" : "No"}`,
    );
  }

  function updateVital(valEl, barEl, raw, range, dec) {
    valEl.textContent =
      dec > 0 && raw != null ? raw.toFixed(dec) : (raw ?? "--");
    const ok = raw >= range.min && raw <= range.max;
    valEl.classList.remove("normal", "danger");
    valEl.classList.add(ok ? "normal" : "danger");
    barEl.classList.remove("danger");
    if (!ok) barEl.classList.add("danger");
    const pct = Math.min(
      100,
      Math.max(0, ((raw - range.min) / (range.max - range.min)) * 100),
    );
    barEl.style.width = `${pct}%`;
  }

  function pushChart(hr) {
    const now = formatTime(new Date());
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
    try { fallSiren.currentTime = 0; fallSiren.play(); } catch(e) {}
    addLog("danger", "🚨 FALL DETECTED — Emergency siren activated!");
  }

  function stopFallAlert() {
    fallOverlay.classList.remove("active");
    try { fallSiren.pause(); fallSiren.currentTime = 0; } catch(e) {}
  }

  fallSafeBtn.addEventListener("click", async () => {
    stopFallAlert();
    addLog("info", "✅ Patient confirmed safe — alarm stopped.");
    try {
      await fetch("/reset-alarm", { method: "POST" });
    } catch (err) {
      addLog("warning", `Reset broadcast failed: ${err.message}`);
    }
  });

  /* ── Medicine Alarm Overlay ────────────────────────────── */
  function triggerAlarmOverlay(medicine, time) {
    const label = medicine || "Your scheduled medication";
    alarmMedicineName.textContent = `💊 Take: ${label}${time ? " — " + time : ""}`;
    alarmOverlay.classList.add("active");
    playAlarmSound();
    addLog("warning", `💊 ALARM — Time to take ${label}!`);
  }
  alarmDismiss.addEventListener("click", () => {
    alarmOverlay.classList.remove("active");
    addLog("info", "Medicine alarm acknowledged.");
  });

  /* ── Multiple Medicine Reminders ───────────────────────── */
  async function fetchReminders() {
    try {
      const res = await fetch("/reminders");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      renderReminders(list);
    } catch (err) {
      addLog("warning", `Failed to fetch reminders: ${err.message}`);
    }
  }

  function renderReminders(list) {
    if (!list.length) {
      reminderListEl.innerHTML = '<li class="reminder-list__empty">No reminders set yet.</li>';
      return;
    }
    reminderListEl.innerHTML = list.map(r => `
      <li class="reminder-list__item" data-id="${r.id}">
        <div class="reminder-list__info">
          <span class="reminder-list__medicine">${r.medicine}</span>
          <span class="reminder-list__time">⏰ ${r.time}</span>
        </div>
        <button class="reminder-list__delete" title="Delete" onclick="window.__deleteReminder(${r.id})">❌</button>
      </li>
    `).join('');
  }

  addReminderBtn.addEventListener("click", async () => {
    const medicine = medName.value.trim();
    if (!medicine) { showToast("Enter medicine name", "warning"); return; }
    const h = pickHour.value;
    const m = pickMinute.value;
    const ap = pickAmpm.value;
    const timeString = `${h}:${m} ${ap}`;
    try {
      const res = await fetch("/add-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: timeString, medicine }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      medName.value = "";
      showToast(`✅ Reminder added: ${medicine} at ${timeString}`, "success");
      addLog("info", `⏰ Reminder: ${medicine} at ${timeString} — synced`);
      fetchReminders();
    } catch (err) {
      showToast(`❌ Failed: ${err.message}`, "warning");
      addLog("danger", `Reminder add failed: ${err.message}`);
    }
  });

  window.__deleteReminder = async (id) => {
    try {
      await fetch("/delete-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      showToast("🗑️ Reminder deleted", "success");
      fetchReminders();
    } catch (err) {
      addLog("danger", `Delete failed: ${err.message}`);
    }
  };

  /* ── History Table (GET /history) ──────────────────────── */
  async function fetchHistory() {
    try {
      const res = await fetch("/history-summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      renderHistory(rows);
    } catch (err) {
      addLog("warning", `History fetch failed: ${err.message}`);
    }
  }

  function renderHistory(rows) {
    if (!rows.length) {
      historyTbody.innerHTML =
        '<tr><td colspan="6" class="history-table__empty">No history available yet.</td></tr>';
      return;
    }
    historyTbody.innerHTML = rows
      .map(
        (r, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${r.timestamp}</td>
                <td>${r.heart_rate != null ? r.heart_rate : "—"}</td>
                <td>${r.spo2 != null ? r.spo2 : "—"}</td>
                <td>${r.temp != null ? Number(r.temp).toFixed(1) : "—"}</td>
                <td class="${r.fall_detected ? "fall-yes" : "fall-no"}">${r.fall_detected ? "⚠ YES" : "No"}</td>
            </tr>`,
      )
      .join("");
  }

  refreshHistBtn.addEventListener("click", fetchHistory);
  setInterval(fetchHistory, HISTORY_INTERVAL);

  /* ── System Logs ──────────────────────────────────────── */
  function addLog(level, msg) {
    const entry = document.createElement("p");
    entry.className = `log-entry log-entry--${level}`;
    const ts = formatTime(new Date());
    entry.innerHTML = `<span class="log-ts">[${ts}]</span> ${msg}`;
    logsBody.prepend(entry);
    while (logsBody.children.length > MAX_LOG_ENTRIES)
      logsBody.removeChild(logsBody.lastChild);
  }
  clearLogsBtn.addEventListener("click", () => {
    logsBody.innerHTML = "";
    addLog("info", "Logs cleared.");
  });

  /* ── Download Aggregated Medical Report (PDF) ───────── */
  const downloadBtn = $("download-report-btn");

  async function generatePDF() {
    const choice = prompt(
      "Select Report Duration:\n\n" +
      "  1  →  Last 1 Minute\n" +
      "  2  →  Last 1 Hour\n\n" +
      "Enter 1 or 2:"
    );
    const durationMap = { "1": "1_minute", "2": "1_hour" };
    const duration = durationMap[choice];
    if (!duration) {
      addLog("warning", "Report cancelled or invalid choice.");
      return;
    }

    const durationLabels = { "1_minute": "Last 1 Minute", "1_hour": "Last 1 Hour" };
    const durLabel = durationLabels[duration];
    addLog("info", `📄 Generating aggregated report (${durLabel})…`);

    let report;
    try {
      const res = await fetch(`/report-data?duration=${duration}`);
      report = await res.json();
    } catch (e) {
      addLog("danger", "Failed to fetch report data.");
      return;
    }
    if (!report.slots || report.slots.length === 0) {
      addLog("warning", "No data available for this duration.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    const pw = doc.internal.pageSize.getWidth();
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const timeStr = formatTime(now);

    // Colours
    const dark = [15, 15, 30], green = [0, 200, 120], white = [255, 255, 255], grey = [170, 170, 190];

    // ── Header Bar ──
    doc.setFillColor(...dark);
    doc.rect(0, 0, pw, 35, "F");
    doc.setFillColor(...green);
    doc.rect(0, 33, pw, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(...white);
    doc.text("Aggregated Health Report", 14, 14);
    doc.setFontSize(10);
    doc.setTextColor(...grey);
    doc.text(`Duration: ${durLabel}  |  ${dateStr}  ${timeStr}`, 14, 22);
    doc.setFontSize(8);
    doc.text("Average Values Per Time Slot", 14, 28);
    doc.text("IoT Health Monitor v1.0", pw - 14, 28, { align: "right" });

    // ── Patient Info ──
    let y = 44;
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 60);
    doc.setFont("helvetica", "bold");
    doc.text("Patient:", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text("Rahul Kumar   |   ID: P-001", 38, y);

    // ── Overall Summary ──
    const slots = report.slots;
    let oHR = 0, oSP = 0, oTM = 0, oFalls = 0, hC = 0, sC = 0, tC = 0;
    slots.forEach(s => {
      if (s.avg_hr != null)   { oHR += s.avg_hr * s.samples; hC += s.samples; }
      if (s.avg_spo2 != null) { oSP += s.avg_spo2 * s.samples; sC += s.samples; }
      if (s.avg_temp != null) { oTM += s.avg_temp * s.samples; tC += s.samples; }
      oFalls += s.falls;
    });
    const oAvgHR = hC ? (oHR / hC).toFixed(1) : "N/A";
    const oAvgSP = sC ? (oSP / sC).toFixed(1) : "N/A";
    const oAvgTM = tC ? (oTM / tC).toFixed(1) : "N/A";

    y = 54;
    doc.setFillColor(240, 245, 255);
    doc.roundedRect(14, y, pw - 28, 34, 3, 3, "F");
    doc.setDrawColor(...green);
    doc.roundedRect(14, y, pw - 28, 34, 3, 3, "S");

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 120);
    doc.setFont("helvetica", "bold");
    doc.text(`OVERALL SUMMARY  (${report.total_raw} raw samples aggregated into ${slots.length} slots)`, 20, y + 8);

    doc.setFontSize(22);
    doc.setTextColor(0, 160, 100);
    const col1 = 30, col2 = 80, col3 = 130, col4 = 170;
    const valY = y + 22;
    doc.text(`${oAvgHR}`, col1, valY);
    doc.text(`${oAvgSP}`, col2, valY);
    doc.text(`${oAvgTM}`, col3, valY);
    doc.setTextColor(oFalls > 0 ? 200 : 0, oFalls > 0 ? 50 : 160, oFalls > 0 ? 50 : 100);
    doc.text(`${oFalls}`, col4, valY);

    doc.setFontSize(8);
    doc.setTextColor(120, 120, 140);
    doc.setFont("helvetica", "normal");
    doc.text("Avg HR (bpm)", col1 - 8, valY + 6);
    doc.text("Avg SpO\u2082 (%)", col2 - 8, valY + 6);
    doc.text("Avg Temp (\u00b0C)", col3 - 8, valY + 6);
    doc.text("Total Falls", col4 - 5, valY + 6);

    // ── Averaged Data Table ──
    y = 96;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(40, 40, 60);
    doc.text("Averaged Time-Slot Data", 14, y);

    doc.autoTable({
      startY: y + 4,
      head: [["S.No.", "Time Range", "Avg HR", "Avg SpO\u2082", "Avg Temp", "Falls", "Samples"]],
      body: slots.map((s, i) => [
        i + 1,
        `${s.time_start} - ${s.time_end}`,
        s.avg_hr != null ? s.avg_hr : "\u2014",
        s.avg_spo2 != null ? s.avg_spo2 : "\u2014",
        s.avg_temp != null ? s.avg_temp : "\u2014",
        s.falls,
        s.samples,
      ]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, textColor: [40, 40, 60] },
      headStyles: {
        fillColor: [0, 160, 100],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [245, 250, 248] },
      margin: { left: 14, right: 14 },
    });

    // ── Digital Verification Footer ──
    const ph = doc.internal.pageSize.getHeight();
    const tableEndY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 120;
    let sigY = tableEndY + 20;

    // If signature block would overflow, add a new page
    if (sigY + 45 > ph) {
      doc.addPage();
      sigY = 30;
    }

    // Left side — system copyright
    doc.setDrawColor(200, 200, 210);
    doc.line(14, ph - 16, pw - 14, ph - 16);
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(150, 150, 165);
    doc.text("Generated by IoT Health Monitor \u2014 Smart Health Monitoring System \u00a9 2026", 14, ph - 10);

    // Right side — Digital Signature Block
    const doctors = ["Dr. Rahul Kumar", "Dr. Rajat Raj Seth", "Dr. Sakshi Kumari"];
    const sigDoctor = doctors[Math.floor(Math.random() * doctors.length)];
    const sigX = pw - 80;

    // Signature line
    doc.setDrawColor(180, 180, 195);
    doc.setLineWidth(0.4);
    doc.line(sigX, sigY, pw - 14, sigY);

    // ✅ Medically Verified
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 160, 100);
    doc.text("\u2705 Medically Verified", sigX, sigY + 7);

    // Doctor name (italic blue)
    doc.setFontSize(13);
    doc.setFont("helvetica", "bolditalic");
    doc.setTextColor(30, 80, 180);
    doc.text(sigDoctor, sigX, sigY + 15);

    // Designation
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 100);
    doc.text("MBBS, MD | Chief Medical Officer (IoT Dept)", sigX, sigY + 21);

    // Digital timestamp
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 165);
    doc.text(`Digitally Signed: ${dateStr}  ${timeStr}`, sigX, sigY + 27);

    // ── Save ──
    doc.save(`Health_Report_${durLabel.replace(/ /g, "_")}_${dateStr.replace(/\//g, "-")}.pdf`);
    addLog("info", "✅ Aggregated PDF report downloaded.");
  }

  downloadBtn.addEventListener("click", generatePDF);

  /* ── Boot ───────────────────────────────────────────── */
  connect();
})();
