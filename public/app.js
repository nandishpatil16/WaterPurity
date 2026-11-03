/**
 * Water Community IoT Network — Dashboard Client
 * Connects via WebSocket. Renders real data only.
 */

// ─── State ─────────────────────────────────────────────────────
const S = {
  stations: {},
  latest: {},
  history: {},
  alerts: [],
  limits: {
    ph:        { min: 6.5, max: 8.5 },
    tds:       { min: 50,  max: 500 },
    turbidity: { min: 0,   max: 1.0 },
  },
  sparkCharts: {},   // { stationId_sensor : Chart instance }
  analyticsChart: null,
  historyRows: [],   // array of reading rows
};

let ws = null;
let wsReconnectTimer = null;

// ─── Helpers ────────────────────────────────────────────────────
function isStationOnline(s) {
  if (!s) return false;
  if (typeof s.online === 'boolean') return s.online;
  if (!s.lastSeen) return false;
  return (Date.now() - new Date(s.lastSeen).getTime()) < 30000;
}

function updateTopBarStatus() {
  const stationList = Object.values(S.stations);
  const onlineStations = stationList.filter(isStationOnline).length;
  const totalStations = stationList.length;

  const liveDot = document.getElementById('liveDot');
  if (liveDot) {
    liveDot.style.opacity = '1';
    const liveLabel = liveDot.querySelector('.live-label');
    if (onlineStations > 0) {
      liveDot.className = 'live-dot online';
      if (liveLabel) liveLabel.textContent = `ESP32 Online (${onlineStations})`;
    } else {
      liveDot.className = 'live-dot offline';
      if (liveLabel) liveLabel.textContent = 'ESP32 Offline';
    }
  }

  const stnEl = document.getElementById('statusStations');
  if (stnEl) stnEl.textContent = `${onlineStations}/${totalStations}`;

  const sensEl = document.getElementById('statusSensors');
  if (sensEl) sensEl.textContent = `${onlineStations * 3}/${totalStations * 3}`;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5)  return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec/60)}m ago`;
  return `${Math.round(sec/3600)}h ago`;
}

function isoToTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function safeStatus(sensor, val, limits) {
  if (sensor === 'ph')        return val >= limits.ph.min        && val <= limits.ph.max;
  if (sensor === 'tds')       return val >= limits.tds.min       && val <= limits.tds.max;
  if (sensor === 'turbidity') return val >= limits.turbidity.min && val <= limits.turbidity.max;
  return true;
}

function phLabel(ph) {
  if (ph === null || ph === undefined) return '—';
  if (ph < 6.5) return 'Acidic — below the BIS safe limit';
  if (ph > 8.5) return 'Alkaline — above the BIS safe limit';
  if (ph < 7.0) return 'Slightly acidic — within the safe range';
  if (ph > 7.5) return 'Slightly alkaline — ideal for drinking water';
  return 'Neutral · Ideal for drinking water';
}

function tdsLabel(tds, limits) {
  if (tds === null || tds === undefined) return '—';
  if (tds > limits.tds.max) return `High — exceeds the ${limits.tds.max} ppm BIS limit`;
  if (tds > 400) return `Acceptable — upper end of the BIS limit`;
  if (tds < 100) return `Very low TDS — possibly soft water`;
  return `Good — within BIS desirable range`;
}

function turbLabel(turb, limits) {
  if (turb === null || turb === undefined) return '—';
  if (turb > limits.turbidity.max) return `Turbid — exceeds WHO ${limits.turbidity.max} NTU target`;
  if (turb > 0.5) return `Slightly cloudy — approaching WHO limit`;
  return `Clear — within the WHO drinking-water target`;
}

// ─── Gauge drawing ───────────────────────────────────────────────
function drawGauge(canvas, value, label) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H - 10;
  const r  = Math.min(W, H * 2) * 0.42;
  const startAngle = Math.PI;
  const endAngle   = 2 * Math.PI;

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Fill
  const pct = Math.max(0, Math.min(100, value || 0)) / 100;
  const fillEnd = startAngle + pct * Math.PI;
  const color = pct >= .9 ? '#22c55e' : pct >= .7 ? '#3b82f6' : pct >= .5 ? '#f59e0b' : '#ef4444';

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, fillEnd);
  ctx.strokeStyle = color;
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ─── Sparkline Chart ─────────────────────────────────────────────
const COLORS = {
  ph:        { border: '#3b82f6', bg: 'rgba(59,130,246,.08)' },
  tds:       { border: '#f97316', bg: 'rgba(249,115,22,.08)' },
  turbidity: { border: '#14b8a6', bg: 'rgba(20,184,166,.08)' },
  temperature:{ border: '#f59e0b', bg: 'rgba(245,158,11,.08)' },
};

function makeSparkline(canvasEl, sensor) {
  if (typeof Chart === 'undefined') return null;
  const c = COLORS[sensor] || COLORS.ph;
  try {
    return new Chart(canvasEl.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [{ data: [], borderColor: c.border, backgroundColor: c.bg, borderWidth: 1.8, pointRadius: 0, fill: true, tension: 0.35 }] },
      options: {
        responsive: false, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
        elements: { line: { borderCapStyle: 'round' } }
      }
    });
  } catch (err) {
    console.warn('Sparkline initialization skipped:', err);
    return null;
  }
}

function updateSparkline(chart, histArr) {
  if (!chart || !histArr) return;
  try {
    chart.data.labels   = histArr.map(p => '');
    chart.data.datasets[0].data = histArr.map(p => p.value);
    chart.update('none');
  } catch (err) {
    // Ignore sparkline chart update errors
  }
}

// ─── Render Dashboard ─────────────────────────────────────────────
function renderDashboard() {
  const stationIds = Object.keys(S.stations);
  const hasData    = stationIds.length > 0;

  document.getElementById('emptyState').style.display  = hasData ? 'none' : '';
  document.getElementById('sensorCards').style.display = hasData ? '' : 'none';
  document.getElementById('bottomRow').style.display   = hasData ? '' : 'none';

  // Station count
  document.getElementById('stationCount').textContent = stationIds.length;

  if (!hasData) {
    updateStatusBar(null);
    return;
  }

  // Aggregate latest values across stations for summary cards
  const allLatest = Object.values(S.latest);
  const wqiValues = allLatest.filter(r => r.wqi !== undefined).map(r => r.wqi);
  const overallWQI = wqiValues.length
    ? Math.round((wqiValues.reduce((a, b) => a + b, 0) / wqiValues.length) * 10) / 10
    : null;

  updateStatusBar({ overallWQI, stationIds });
  renderSensorCards(allLatest);
  renderGauge(overallWQI);
  renderDashAlerts();
}

function updateStatusBar({ overallWQI, stationIds } = {}) {
  const unacked = S.alerts.filter(a => !a.acknowledged);
  const hasWarning = unacked.length > 0;

  document.getElementById('statusBadge').classList.toggle('hidden', !hasWarning);
  const safePill = document.getElementById('safeStatusPill');
  const onlineStations = Object.values(S.stations).filter(isStationOnline).length;
  safePill.style.display = (!hasWarning && onlineStations > 0) ? '' : 'none';

  if (overallWQI !== null && overallWQI !== undefined) {
    const label = overallWQI >= 90 ? 'Excellent' : overallWQI >= 70 ? 'Good' : overallWQI >= 50 ? 'Fair' : 'Poor';
    document.getElementById('statusWQI').textContent    = `${overallWQI}`;
    document.getElementById('statusLabel').textContent  = label;
  } else {
    document.getElementById('statusWQI').textContent   = '—';
    document.getElementById('statusLabel').textContent = '—';
  }

  updateTopBarStatus();

  const lastTs = Object.values(S.latest).map(r => r.timestamp).filter(Boolean).sort().pop();
  document.getElementById('statusLastUpdate').textContent = lastTs ? timeAgo(lastTs) : '—';

  // Nav alert badge
  const badge = document.getElementById('navAlertCount');
  badge.textContent = unacked.length || '';
  badge.style.display = unacked.length > 0 ? '' : 'none';
}

// ─── Sensor Cards ─────────────────────────────────────────────────
function renderSensorCards(allLatest) {
  const container = document.getElementById('sensorCards');
  // For each sensor type, show its latest across stations
  // (For multi-station, show per-station cards; for now show first station with all sensors)
  const stationIds = Object.keys(S.stations);
  if (!stationIds.length) { container.innerHTML = ''; return; }

  let html = '';

  stationIds.forEach(sid => {
    const r     = S.latest[sid];
    const stn   = S.stations[sid];
    if (!r) return;

    const sensors = [
      { key: 'ph',        label: 'pH Level',              dot: 'dot-blue',   unit: 'pH',  limitTxt: `Safe ${S.limits.ph.min}–${S.limits.ph.max} pH`,      descFn: ph => phLabel(ph) },
      { key: 'tds',       label: 'Total Dissolved Solids', dot: 'dot-orange', unit: 'ppm', limitTxt: `Safe ${S.limits.tds.min}–${S.limits.tds.max} ppm`,    descFn: tds => tdsLabel(tds, S.limits) },
      { key: 'turbidity', label: 'Turbidity',              dot: 'dot-teal',   unit: 'NTU', limitTxt: `Safe 0–${S.limits.turbidity.max} NTU`,                descFn: t => turbLabel(t, S.limits) },
    ];

    sensors.forEach(({ key, label, dot, unit, limitTxt, descFn }) => {
      const val  = r[key];
      const hist = S.history[sid]?.[key] || [];
      const safe = val !== undefined ? safeStatus(key, val, S.limits) : true;
      const prev = hist.length >= 2 ? hist[hist.length - 2]?.value : null;
      const delta = (val !== undefined && prev !== null) ? (val - prev) : null;
      const deltaStr = delta !== null ? `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)}` : '';
      const deltaClass = delta !== null && delta < 0 ? 'neg' : '';

      const cardId = `card-${sid}-${key}`;
      html += `
<div class="card sensor-card" id="${cardId}">
  <div class="sensor-card-header">
    <div class="sensor-name">
      <span class="sensor-dot ${dot}"></span>
      ${label}
    </div>
    <span class="${safe ? 'safe-badge' : 'unsafe-badge'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      ${safe ? 'Safe' : 'Warning'}
    </span>
  </div>
  <div class="sensor-limit">${limitTxt}</div>
  <div class="sensor-value-row">
    <span class="sensor-value">${val !== undefined ? (key === 'ph' ? val.toFixed(2) : key === 'turbidity' ? val.toFixed(2) : Math.round(val)) : '—'}</span>
    <span class="sensor-unit">${val !== undefined ? unit : ''}</span>
    ${deltaStr ? `<span class="sensor-delta ${deltaClass}">${deltaStr}</span>` : ''}
  </div>
  <div class="sensor-desc" id="desc-${sid}-${key}">${val !== undefined ? descFn(val) : 'Waiting for data...'}</div>
  <div class="sparkline-wrap">
    <canvas id="spark-${sid}-${key}" height="50"></canvas>
  </div>
  <div class="sensor-footer">
    <span>Updated ${r.timestamp ? timeAgo(r.timestamp) : '—'}</span>
    <span class="sensor-pts">${hist.length} pts</span>
  </div>
</div>`;
    });
  });

  container.innerHTML = html;

  // Create sparklines
  stationIds.forEach(sid => {
    ['ph','tds','turbidity'].forEach(key => {
      const canvas = document.getElementById(`spark-${sid}-${key}`);
      if (!canvas) return;
      const chartKey = `${sid}_${key}`;
      if (S.sparkCharts[chartKey]) S.sparkCharts[chartKey].destroy();
      S.sparkCharts[chartKey] = makeSparkline(canvas, key);
      updateSparkline(S.sparkCharts[chartKey], S.history[sid]?.[key] || []);
    });
  });
}

function updateSensorCard(sid, key, reading) {
  const chartKey = `${sid}_${key}`;
  updateSparkline(S.sparkCharts[chartKey], S.history[sid]?.[key] || []);

  const val  = reading[key];
  const hist = S.history[sid]?.[key] || [];
  const prev = hist.length >= 2 ? hist[hist.length - 2]?.value : null;
  const delta = (val !== undefined && prev !== null) ? (val - prev) : null;

  // Update value text
  const valEl = document.querySelector(`#card-${sid}-${key} .sensor-value`);
  if (valEl && val !== undefined) {
    valEl.textContent = key === 'ph' ? val.toFixed(2) : key === 'turbidity' ? val.toFixed(2) : Math.round(val);
  }

  // Update delta
  const deltaEl = document.querySelector(`#card-${sid}-${key} .sensor-delta`);
  if (deltaEl && delta !== null) {
    deltaEl.textContent = `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)}`;
    deltaEl.className = `sensor-delta ${delta < 0 ? 'neg' : ''}`;
  }

  // Updated time
  const footerEl = document.querySelector(`#card-${sid}-${key} .sensor-footer span:first-child`);
  if (footerEl) footerEl.textContent = `Updated ${timeAgo(reading.timestamp)}`;

  // Pts
  const ptsEl = document.querySelector(`#card-${sid}-${key} .sensor-pts`);
  if (ptsEl) ptsEl.textContent = `${hist.length} pts`;
}

// ─── Gauge ────────────────────────────────────────────────────────
function renderGauge(wqi) {
  const canvas = document.getElementById('gaugeCanvas');
  const valEl  = document.getElementById('gaugeValue');
  const lblEl  = document.getElementById('gaugeLabel');
  if (!canvas) return;

  if (wqi === null || wqi === undefined) {
    valEl.textContent = '—';
    lblEl.textContent = '—';
    drawGauge(canvas, 0, '—');
    return;
  }

  const label = wqi >= 90 ? 'Excellent' : wqi >= 70 ? 'Good' : wqi >= 50 ? 'Fair' : 'Poor';
  valEl.textContent = wqi;
  lblEl.textContent = label;
  lblEl.className = `gauge-label`;
  drawGauge(canvas, wqi, label);
}

// ─── Alerts ───────────────────────────────────────────────────────
function renderDashAlerts() {
  const unacked = S.alerts.filter(a => !a.acknowledged).slice(0, 5);
  const listEl  = document.getElementById('dashAlertsList');
  const countEl = document.getElementById('alertsCount');
  if (!listEl) return;

  countEl.textContent = `${unacked.length} condition${unacked.length !== 1 ? 's' : ''} needing attention`;

  if (!unacked.length) {
    listEl.innerHTML = '<div class="alerts-empty">No active alerts — all parameters within safe limits.</div>';
    return;
  }

  listEl.innerHTML = unacked.map(a => alertHTML(a)).join('');
  attachAckHandlers(listEl);
}

function renderAlertsPage() {
  const listEl = document.getElementById('alertsFullList');
  if (!listEl) return;

  const all = S.alerts;
  if (!all.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:40px 0"><h3>No alerts</h3><p>All parameters within safe limits.</p></div>';
    return;
  }
  listEl.innerHTML = all.map(a => alertHTML(a, true)).join('');
  attachAckHandlers(listEl);
}

function alertHTML(a, showAck = true) {
  return `
<div class="alert-item" id="alert-${a.id}">
  <div class="alert-item-header">
    <span class="alert-tag ${a.type}">${a.type}</span>
    <span class="alert-title">${a.title}</span>
    <span class="alert-time">${timeAgo(a.timestamp)}</span>
  </div>
  <div class="alert-message">${a.message}</div>
  <div class="alert-meta">
    <span class="alert-meta-item">STATION <strong>${a.station}</strong></span>
    <span class="alert-meta-item">SENSOR <strong>${a.sensor}</strong></span>
    <span class="alert-meta-item">READING <strong>${a.reading}</strong></span>
    ${!a.acknowledged && showAck ? `<button class="ack-btn" data-id="${a.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Acknowledge</button>` : ''}
  </div>
</div>`;
}

function attachAckHandlers(container) {
  container.querySelectorAll('.ack-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
      const a = S.alerts.find(x => x.id === id);
      if (a) a.acknowledged = true;
      renderDashAlerts();
      renderAlertsPage();
      updateStatusBar({ overallWQI: null, stationIds: Object.keys(S.stations) });
    });
  });
}

// ─── Stations Page ────────────────────────────────────────────────
function renderStationsPage() {
  const grid = document.getElementById('stationsGrid');
  const ids  = Object.keys(S.stations);

  if (!ids.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4"/></svg></div>
      <h3>No stations registered yet</h3>
      <p>Stations appear automatically when an ESP32 sends its first data packet.</p>
    </div>`;
    return;
  }

  grid.innerHTML = ids.map(sid => {
    const s = S.stations[sid];
    const r = S.latest[sid];
    const online = isStationOnline(s);
    return `<div class="station-card">
      <div class="station-card-head">
        <div>
          <div class="station-name">${s.name}</div>
          <div class="station-loc">${s.location}</div>
        </div>
        <div>
          <span class="station-id">${sid}</span>
          <div style="margin-top:6px">${online ? '<span class="online-pill">● Online</span>' : '<span class="offline-pill">● Offline</span>'}</div>
        </div>
      </div>
      ${r ? `
      <div class="station-row"><span class="station-row-label">pH Level</span><span class="station-row-val">${r.ph !== undefined ? r.ph.toFixed(2) : '—'} pH</span></div>
      <div class="station-row"><span class="station-row-label">TDS</span><span class="station-row-val">${r.tds !== undefined ? Math.round(r.tds) : '—'} ppm</span></div>
      <div class="station-row"><span class="station-row-label">Turbidity</span><span class="station-row-val">${r.turbidity !== undefined ? r.turbidity.toFixed(2) : '—'} NTU</span></div>
      <div class="station-row"><span class="station-row-label">Temperature</span><span class="station-row-val">${r.temperature !== undefined ? r.temperature : '—'} °C</span></div>
      <div class="station-row"><span class="station-row-label">WQI Score</span><span class="station-row-val">${r.wqi !== undefined ? r.wqi : '—'} / 100</span></div>
      <div class="station-row"><span class="station-row-label">Last Seen</span><span class="station-row-val">${timeAgo(s.lastSeen)}</span></div>
      ` : '<div class="station-row"><span style="color:#9ca3af;font-size:12px">Waiting for first reading...</span></div>'}
    </div>`;
  }).join('');
}

// ─── History Table ────────────────────────────────────────────────
function renderHistoryTable() {
  const tbody = document.getElementById('historyTableBody');
  if (!S.historyRows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No data received yet.</td></tr>';
    return;
  }
  const rows = [...S.historyRows].reverse().slice(0, 100);
  tbody.innerHTML = rows.map(r => `
<tr>
  <td>${isoToTime(r.timestamp)}</td>
  <td>${S.stations[r.stationId]?.name || r.stationId}</td>
  <td>${r.ph !== undefined ? r.ph.toFixed(2) : '—'}</td>
  <td>${r.tds !== undefined ? Math.round(r.tds) : '—'}</td>
  <td>${r.turbidity !== undefined ? r.turbidity.toFixed(2) : '—'}</td>
  <td>${r.temperature !== undefined ? r.temperature : '—'}</td>
  <td>${r.wqi !== undefined ? r.wqi : '—'}</td>
  <td><span class="status-badge ${r.label || ''}">${r.label || '—'}</span></td>
</tr>`).join('');
}

// ─── Analytics ────────────────────────────────────────────────────
function buildAnalyticsStationSelect() {
  const sel = document.getElementById('analyticsStation');
  const ids = Object.keys(S.stations);
  sel.innerHTML = '<option value="">— Select Station —</option>' +
    ids.map(id => `<option value="${id}">${S.stations[id].name}</option>`).join('');
}

function renderAnalyticsChart() {
  const sid    = document.getElementById('analyticsStation').value;
  const sensor = document.getElementById('analyticsSensor').value;
  const data   = sid ? (S.history[sid]?.[sensor] || []) : [];

  const canvas = document.getElementById('analyticsChart');
  if (!canvas) return;

  if (S.analyticsChart) {
    S.analyticsChart.destroy();
    S.analyticsChart = null;
  }

  const c = COLORS[sensor] || COLORS.ph;
  const sensorLabels = { ph: 'pH Level', tds: 'TDS (ppm)', turbidity: 'Turbidity (NTU)' };

  S.analyticsChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.map((_, i) => `#${i + 1}`),
      datasets: [{
        label: sensorLabels[sensor] || sensor,
        data: data.map(p => p.value),
        borderColor: c.border,
        backgroundColor: c.bg,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: c.border,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: { grid: { color: '#f3f4f6' }, ticks: { color: '#9ca3af', font: { size: 11 } } },
        y: { grid: { color: '#f3f4f6' }, ticks: { color: '#9ca3af', font: { size: 11 } } }
      }
    }
  });
}

// ─── Page Navigation ─────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  const navEl  = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  if (page === 'stations') renderStationsPage();
  if (page === 'alerts')   renderAlertsPage();
  if (page === 'analytics') { buildAnalyticsStationSelect(); renderAnalyticsChart(); }
  if (page === 'history')  renderHistoryTable();
}

// ─── Data Sync (REST Snapshot + Polling Fallback) ──────────────────
async function fetchSnapshot() {
  try {
    const res = await fetch('/api/snapshot');
    if (!res.ok) return;
    const d = await res.json();
    if (d && d.stations) {
      applySnapshotData(d);
    }
  } catch (err) {
    console.warn('Snapshot fetch warning:', err);
  }
}

function applySnapshotData(d) {
  if (!d) return;
  if (Array.isArray(d.stations)) {
    d.stations.forEach(s => S.stations[s.id] = s);
  }
  S.latest  = d.latest || S.latest || {};
  S.history = d.history || S.history || {};
  S.alerts  = d.alerts || S.alerts || [];
  S.limits  = d.limits || S.limits;

  // Sync history table rows if empty
  if (S.historyRows.length === 0 && d.latest) {
    Object.values(d.latest).forEach(r => {
      if (r && r.timestamp) S.historyRows.push(r);
    });
  }

  renderDashboard();
  updateTopBarStatus();

  // Refresh active page if needed
  const activePage = document.querySelector('.nav-item.active')?.dataset.page;
  if (activePage === 'stations') renderStationsPage();
  if (activePage === 'alerts')   renderAlertsPage();
  if (activePage === 'history')  renderHistoryTable();
}

// ─── WebSocket ────────────────────────────────────────────────────
function connectWS() {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    ws = new WebSocket(`${proto}//${location.host}`);
  } catch (e) {
    console.warn('WebSocket init error, relying on REST polling:', e);
    wsReconnectTimer = setTimeout(connectWS, 4000);
    return;
  }

  ws.onopen = () => {
    updateTopBarStatus();
  };

  ws.onclose = () => {
    updateTopBarStatus();
    wsReconnectTimer = setTimeout(connectWS, 4000);
  };

  ws.onerror = () => {
    // Rely on polling fallback and onclose reconnect
  };

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    handleMessage(msg);
  };
}

function handleMessage(msg) {
  switch (msg.type) {

    case 'INIT': {
      applySnapshotData(msg.data);
      break;
    }

    case 'NEW_READING': {
      const r   = msg.data;
      const stn = msg.station;
      S.stations[r.stationId] = stn || S.stations[r.stationId] || { id: r.stationId, name: r.stationId, online: true };
      S.latest[r.stationId] = r;

      // Update history in-memory
      if (!S.history[r.stationId]) S.history[r.stationId] = { ph: [], tds: [], turbidity: [] };
      ['ph','tds','turbidity'].forEach(key => {
        if (r[key] !== undefined) {
          const arr = S.history[r.stationId][key];
          arr.push({ value: r[key], t: Date.now() });
          if (arr.length > 30) arr.shift();
        }
      });

      // Add to history table rows
      S.historyRows.push(r);
      if (S.historyRows.length > 200) S.historyRows.shift();

      // Check if sensor card exists — update or full re-render
      const cardEl = document.getElementById(`card-${r.stationId}-ph`);
      if (cardEl) {
        // Incremental update
        ['ph','tds','turbidity'].forEach(key => {
          if (r[key] !== undefined) updateSensorCard(r.stationId, key, r);
        });
        // Gauge
        const wqiValues = Object.values(S.latest).filter(x => x.wqi !== undefined).map(x => x.wqi);
        const overallWQI = wqiValues.length ? Math.round((wqiValues.reduce((a,b)=>a+b,0)/wqiValues.length)*10)/10 : null;
        renderGauge(overallWQI);
        updateStatusBar({ overallWQI, stationIds: Object.keys(S.stations) });
      } else {
        // New station — full re-render
        renderDashboard();
      }

      // Refresh open page
      const activePage = document.querySelector('.nav-item.active')?.dataset.page;
      if (activePage === 'stations') renderStationsPage();
      if (activePage === 'history')  renderHistoryTable();
      break;
    }

    case 'ALERTS_UPDATE': {
      const incoming = msg.data || [];
      incoming.forEach(a => {
        const existing = S.alerts.find(x => x.id === a.id);
        if (!existing) S.alerts.unshift(a);
      });
      S.alerts = S.alerts.slice(0, 50);
      renderDashAlerts();
      updateStatusBar({ overallWQI: null, stationIds: Object.keys(S.stations) });
      const ap = document.querySelector('.nav-item.active')?.dataset.page;
      if (ap === 'alerts') renderAlertsPage();
      break;
    }

    case 'STATIONS_STATUS': {
      const d = msg.data;
      if (d.stations) {
        d.stations.forEach(s => {
          if (S.stations[s.id]) {
            S.stations[s.id].online = s.online;
            S.stations[s.id].lastSeen = s.lastSeen;
          } else {
            S.stations[s.id] = s;
          }
        });
      }
      updateTopBarStatus();
      const activePage = document.querySelector('.nav-item.active')?.dataset.page;
      if (activePage === 'stations') renderStationsPage();
      break;
    }
  }
}

// ─── Settings ─────────────────────────────────────────────────────
function saveSettings() {
  S.limits.ph.min        = parseFloat(document.getElementById('set-ph-min').value)   || 6.5;
  S.limits.ph.max        = parseFloat(document.getElementById('set-ph-max').value)   || 8.5;
  S.limits.tds.max       = parseFloat(document.getElementById('set-tds-max').value)  || 500;
  S.limits.turbidity.max = parseFloat(document.getElementById('set-turb-max').value) || 1.0;
  alert('Settings saved (applies to this session only).');
}

// ─── Bootstrap ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Auto-fill exact endpoint URL for ESP32
  const exactApiUrl = `${window.location.origin}/api/data`;
  const hintEl = document.getElementById('hintUrl');
  if (hintEl) hintEl.textContent = exactApiUrl;
  const apiEp = document.getElementById('apiEndpoint');
  if (apiEp) apiEp.textContent = exactApiUrl;

  // Nav click handlers
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.page); });
  });

  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => {
      if (el.tagName === 'A') e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Analytics selects
  document.getElementById('analyticsStation')?.addEventListener('change', renderAnalyticsChart);
  document.getElementById('analyticsSensor')?.addEventListener('change',  renderAnalyticsChart);

  // 1. Initial empty render
  renderDashboard();

  // 2. Fetch snapshot IMMEDIATELY via REST for instant dashboard display
  fetchSnapshot();

  // 3. Connect real-time WebSocket
  connectWS();

  // 4. Background polling fallback every 3 seconds
  // Ensures 100% reliability if WebSockets are slow, blocked, or restarting
  setInterval(fetchSnapshot, 3000);

  // 5. Periodically check station online status and refresh timestamps
  setInterval(() => {
    updateTopBarStatus();
    const lastTs = Object.values(S.latest).map(r => r.timestamp).filter(Boolean).sort().pop();
    if (lastTs) {
      document.getElementById('statusLastUpdate').textContent = timeAgo(lastTs);
    }
  }, 3000);
});
