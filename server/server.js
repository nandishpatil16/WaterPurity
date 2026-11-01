/**
 * Water Community IoT Network — Backend Server
 * Real data only. No simulation. No fake feeds.
 * ESP32 POST to /api/data — dashboard reads via REST + WebSocket.
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── In-memory stores ───────────────────────────────────────────────────────

// Stations registered (ESP32 registers itself on first POST)
const stations = {};   // { stationId: { id, name, location, lastSeen } }

// Latest reading per station
const latest = {};     // { stationId: { ph, tds, turbidity, temperature, timestamp, ... } }

// Sparkline history per station per sensor (last 30 points)
const history = {};    // { stationId: { ph: [], tds: [], turbidity: [] } }

// Active alerts (unacknowledged)
const alerts = [];

// Thresholds (IS 10500:2012 / WHO)
const LIMITS = {
  ph:        { min: 6.5,   max: 8.5,   unit: 'pH'  },
  tds:       { min: 50,    max: 500,    unit: 'ppm' },
  turbidity: { min: 0,     max: 1.0,   unit: 'NTU' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeWQI(ph, tds, turbidity) {
  const scorePH  = Math.max(0, 100 - (Math.abs(ph - 7.0) / 3.5) * 100);
  const scoreTDS = Math.max(0, 100 - ((tds - 50) / 450) * 100);
  const scoreTurb= Math.max(0, 100 - (turbidity / 2.0) * 100);
  return Math.round((scorePH * 0.4 + scoreTDS * 0.35 + scoreTurb * 0.25) * 10) / 10;
}

function safetyLabel(wqi) {
  if (wqi >= 90) return 'Excellent';
  if (wqi >= 70) return 'Good';
  if (wqi >= 50) return 'Fair';
  return 'Poor';
}

function checkAlerts(stationId, reading) {
  const station = stations[stationId] || { name: stationId, location: 'Unknown' };
  const now = new Date().toISOString();

  if (reading.tds > LIMITS.tds.max) {
    alerts.unshift({
      id: `ALT-${Date.now()}-TDS`,
      type: 'WARNING',
      title: 'TDS above limit',
      message: `TDS ${reading.tds} ppm exceeds the ${LIMITS.tds.max} ppm limit for drinking water.`,
      station: station.name,
      location: station.location,
      sensor: 'TDS',
      reading: `${reading.tds} ppm`,
      timestamp: now,
      acknowledged: false,
    });
  }

  if (reading.turbidity > LIMITS.turbidity.max) {
    alerts.unshift({
      id: `ALT-${Date.now()}-TURB`,
      type: 'WARNING',
      title: 'Turbidity above limit',
      message: `Turbidity ${reading.turbidity} NTU exceeds the ${LIMITS.turbidity.max} NTU limit — water is visibly cloudy.`,
      station: station.name,
      location: station.location,
      sensor: 'Turbidity',
      reading: `${reading.turbidity} NTU`,
      timestamp: now,
      acknowledged: false,
    });
  }

  if (reading.ph < LIMITS.ph.min || reading.ph > LIMITS.ph.max) {
    alerts.unshift({
      id: `ALT-${Date.now()}-PH`,
      type: 'WARNING',
      title: 'pH out of safe range',
      message: `pH ${reading.ph} is outside the safe range (${LIMITS.ph.min}–${LIMITS.ph.max}).`,
      station: station.name,
      location: station.location,
      sensor: 'pH',
      reading: `${reading.ph} pH`,
      timestamp: now,
      acknowledged: false,
    });
  }

  // Keep at most 50 alerts
  if (alerts.length > 50) alerts.splice(50);
}

function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

function addHistory(stationId, sensor, value) {
  if (!history[stationId]) history[stationId] = { ph: [], tds: [], turbidity: [] };
  const arr = history[stationId][sensor];
  if (arr) {
    arr.push({ value, t: Date.now() });
    if (arr.length > 30) arr.shift();
  }
}

// ─── API Routes ──────────────────────────────────────────────────────────────

/**
 * ESP32 posts data here.
 * Body: { stationId, name, location, ph, tds, turbidity, temperature }
 * All fields except stationId are optional (send what sensors you have).
 */
app.post('/api/data', (req, res) => {
  const { stationId, name, location, ph, tds, turbidity, temperature } = req.body;

  if (!stationId) return res.status(400).json({ error: 'stationId is required' });

  // Register / update station
  stations[stationId] = {
    id: stationId,
    name: name || stationId,
    location: location || 'Unknown',
    lastSeen: new Date().toISOString(),
    online: true,
  };

  const timestamp = new Date().toISOString();
  const reading = { stationId, timestamp };

  if (ph        !== undefined) { reading.ph         = +parseFloat(ph).toFixed(2);  addHistory(stationId, 'ph', reading.ph); }
  if (tds       !== undefined) { reading.tds        = +parseFloat(tds).toFixed(1); addHistory(stationId, 'tds', reading.tds); }
  if (turbidity !== undefined) { reading.turbidity  = +parseFloat(turbidity).toFixed(2); addHistory(stationId, 'turbidity', reading.turbidity); }
  if (temperature !== undefined) reading.temperature = +parseFloat(temperature).toFixed(1);

  // WQI (only if all three key params present)
  if (reading.ph !== undefined && reading.tds !== undefined && reading.turbidity !== undefined) {
    reading.wqi   = computeWQI(reading.ph, reading.tds, reading.turbidity);
    reading.label = safetyLabel(reading.wqi);
  }

  latest[stationId] = reading;
  checkAlerts(stationId, reading);

  broadcast({ type: 'NEW_READING', data: reading, station: stations[stationId] });
  broadcast({ type: 'ALERTS_UPDATE', data: alerts.filter(a => !a.acknowledged).slice(0, 20) });

  return res.status(201).json({ ok: true, received: reading });
});

const TIMEOUT_MS = 15000; // 15 seconds without packet = offline

function isStationOnline(s) {
  if (!s || !s.lastSeen) return false;
  return (Date.now() - new Date(s.lastSeen).getTime()) < TIMEOUT_MS;
}

// Background heartbeat to monitor when stations disconnect
setInterval(() => {
  let changed = false;
  Object.values(stations).forEach(s => {
    const active = isStationOnline(s);
    if (s.online !== active) {
      s.online = active;
      changed = true;
    }
  });

  if (changed) {
    const stationList = Object.values(stations).map(s => ({
      ...s,
      online: isStationOnline(s)
    }));
    const onlineStations = stationList.filter(s => s.online).length;
    broadcast({
      type: 'STATIONS_STATUS',
      data: {
        stations: stationList,
        onlineStations,
        totalStations: stationList.length,
        onlineSensors: onlineStations * 3,
        totalSensors: stationList.length * 3
      }
    });
  }
}, 3000);

// Dashboard snapshot
app.get('/api/snapshot', (req, res) => {
  const stationList = Object.values(stations).map(s => ({
    ...s,
    online: isStationOnline(s)
  }));
  const onlineStations = stationList.filter(s => s.online).length;
  const totalSensors = stationList.length * 3; // ph, tds, turbidity per station
  const onlineSensors = onlineStations * 3;

  // Overall WQI across all stations
  const wqiValues = Object.values(latest)
    .filter(r => r.wqi !== undefined)
    .map(r => r.wqi);
  const overallWQI = wqiValues.length
    ? Math.round((wqiValues.reduce((a, b) => a + b, 0) / wqiValues.length) * 10) / 10
    : null;

  res.json({
    stations: stationList,
    latest,
    history,
    alerts: alerts.filter(a => !a.acknowledged).slice(0, 20),
    summary: {
      totalStations: stationList.length,
      onlineStations,
      totalSensors,
      onlineSensors,
      overallWQI,
      overallLabel: overallWQI ? safetyLabel(overallWQI) : null,
      unacknowledgedAlerts: alerts.filter(a => !a.acknowledged).length,
    },
    limits: LIMITS,
  });
});

// All alerts
app.get('/api/alerts', (req, res) => {
  res.json(alerts);
});

// Acknowledge alert
app.post('/api/alerts/:id/acknowledge', (req, res) => {
  const alert = alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  alert.acknowledged = true;
  broadcast({ type: 'ALERTS_UPDATE', data: alerts.filter(a => !a.acknowledged).slice(0, 20) });
  res.json({ ok: true });
});

// History for a station+sensor (for charts)
app.get('/api/history/:stationId/:sensor', (req, res) => {
  const { stationId, sensor } = req.params;
  const data = history[stationId]?.[sensor] || [];
  res.json(data);
});

// Station list
app.get('/api/stations', (req, res) => {
  res.json(Object.values(stations).map(s => ({
    ...s,
    latest: latest[s.id] || null,
  })));
});

// WebSocket: send snapshot on connect
wss.on('connection', ws => {
  const stationList = Object.values(stations).map(s => ({
    ...s,
    online: isStationOnline(s)
  }));
  const onlineStations = stationList.filter(s => s.online).length;
  const totalSensors = stationList.length * 3;
  const onlineSensors = onlineStations * 3;

  const wqiValues = Object.values(latest).filter(r => r.wqi !== undefined).map(r => r.wqi);
  const overallWQI = wqiValues.length
    ? Math.round((wqiValues.reduce((a, b) => a + b, 0) / wqiValues.length) * 10) / 10
    : null;

  ws.send(JSON.stringify({
    type: 'INIT',
    data: {
      stations: stationList,
      latest,
      history,
      alerts: alerts.filter(a => !a.acknowledged).slice(0, 20),
      summary: {
        totalStations: stationList.length,
        onlineStations,
        totalSensors,
        onlineSensors,
        overallWQI,
        overallLabel: overallWQI ? safetyLabel(overallWQI) : null,
        unacknowledgedAlerts: alerts.filter(a => !a.acknowledged).length,
      },
      limits: LIMITS,
    },
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nWater Community IoT Network — Server`);
  console.log(`Dashboard  : http://localhost:${PORT}`);
  console.log(`ESP32 POST : POST http://localhost:${PORT}/api/data`);
  console.log(`WebSocket  : ws://localhost:${PORT}\n`);
});
