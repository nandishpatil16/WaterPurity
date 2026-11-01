# Hosting Guide — Water Community IoT Network
## AITM Belagavi · Department of CSE · VTU 2025-26

---

## STEP 1 — Start the Server (Local Network / LAN)

This runs the dashboard on your laptop/PC so that ESP32 can POST to it over Wi-Fi.

```bash
cd "C:\Users\SHREE\.gemini\antigravity\scratch\community-water-quality-iot"
npm start
```

You will see:
```
Water Community IoT Network — Server
Dashboard  : http://localhost:3000
ESP32 POST : POST http://localhost:3000/api/data
WebSocket  : ws://localhost:3000
```

**Find your computer's LAN IP address:**
```
# Windows — open Command Prompt (cmd):
ipconfig
# Look for: IPv4 Address . . . . . . : 192.168.x.x
```

Your ESP32 must use this IP in its firmware:
```cpp
const char* SERVER_URL = "http://192.168.1.15:3000/api/data";  // example
```

---

## STEP 2 — Flash the ESP32

### 2.1 Install Arduino IDE
Download from: https://www.arduino.cc/en/software

### 2.2 Install ESP32 Board Support
1. Open Arduino IDE → **File → Preferences**
2. Paste in "Additional Boards Manager URLs":
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. **Tools → Board → Boards Manager** → search `esp32` → Install **esp32 by Espressif Systems**

### 2.3 Install Required Libraries
**Tools → Manage Libraries** → search and install:
- `ArduinoJson` by Benoit Blanchon (version 6.x)
- `OneWire` by Paul Stoffregen
- `DallasTemperature` by Miles Burton

### 2.4 Update Firmware Settings
Open `firmware/community_water_iot/community_water_iot.ino` and edit:
```cpp
const char* WIFI_SSID     = "YOUR_WIFI_SSID";       // ← Your Wi-Fi name
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // ← Your Wi-Fi password
const char* SERVER_URL    = "http://192.168.1.15:3000/api/data";  // ← Your LAN IP
const char* STATION_ID    = "ST01";                 // ← Unique ID for this node
const char* STATION_NAME  = "Main Reservoir";       // ← Display name
const char* STATION_LOC   = "AITM Campus, Belagavi"; // ← Location
```

### 2.5 Upload
1. **Tools → Board** → Select `DOIT ESP32 DEVKIT V1` or `ESP32 Dev Module`
2. **Tools → Port** → Select the COM port (e.g., COM3, COM7)
3. Click **Upload (→)**
4. Open **Serial Monitor** at `115200` baud to confirm:
   ```
   === Water Community IoT Network — AITM CSE ===
   Station : Main Reservoir (ST01)
   Connecting to YourWifi.......
   [OK] IP: 192.168.1.42
   pH:7.22  TDS:248.0ppm  Turb:0.92NTU  Temp:24.5°C
   [SENT] pH:7.22 TDS:248.0ppm Turb:0.92NTU Temp:24.5°C → HTTP 201
   ```

---

## STEP 3 — Wire the Sensors

### Sensor → ESP32 Connections

| Sensor Module    | Signal Pin | ESP32 GPIO | Notes                        |
|:-----------------|:----------:|:----------:|:-----------------------------|
| pH Module OUT    | Analog     | GPIO 34    | 3.3V only (ADC1)             |
| TDS Module AOUT  | Analog     | GPIO 35    | 3.3V only (ADC1)             |
| Turbidity OUT    | Analog     | GPIO 32    | 3.3V only (ADC1)             |
| DS18B20 DATA     | Digital    | GPIO 4     | 4.7kΩ pullup to 3.3V         |
| All sensors VCC  | Power      | 3.3V       | Do NOT use 5V for ADC inputs |
| All sensors GND  | Ground     | GND        | Common ground                |

> ⚠️ **Important:** ESP32 ADC pins (34, 35, 32) are **3.3V max**. Do not connect 5V signals directly.
> If your sensor module outputs 5V analog, add a voltage divider (10kΩ + 20kΩ).

### pH Sensor Calibration (one-time)
1. Fill small glass with pH 7 buffer solution.
2. Upload firmware and open Serial Monitor.
3. Note the pH reading. If it shows 6.8 instead of 7.0, adjust `PH_NEUTRAL_V`:
   - Increase by 0.05V for each 0.5 pH units of error.
4. Repeat with pH 4 buffer to verify linearity.

---

## STEP 4 — Multiple Nodes (More than one ESP32)

Just change `STATION_ID` in each board's firmware:
```cpp
// Board 1:
const char* STATION_ID = "ST01";
const char* STATION_NAME = "Main Reservoir";

// Board 2:
const char* STATION_ID = "ST02";
const char* STATION_NAME = "Community Overhead Tank";

// Board 3:
const char* STATION_ID = "ST03";
const char* STATION_NAME = "Village Center";
```

All boards POST to the same `SERVER_URL`. The dashboard shows them all.

---

## STEP 5 — Deploy Online (Optional: Public Access)

### Option A — ngrok (Instant public tunnel, no domain needed)
1. Download ngrok: https://ngrok.com/download
2. Sign up free → get your auth token
3. In a terminal:
   ```bash
   ngrok http 3000
   ```
4. You get a public URL like: `https://abc123.ngrok-free.app`
5. Update ESP32 firmware:
   ```cpp
   const char* SERVER_URL = "https://abc123.ngrok-free.app/api/data";
   ```

### Option B — Railway / Render (Free cloud hosting)
1. Push project to GitHub:
   ```bash
   cd "C:\Users\SHREE\.gemini\antigravity\scratch\community-water-quality-iot"
   git init && git add . && git commit -m "Water IoT Network"
   gh repo create water-iot --public --push --source=.
   ```
2. Go to https://railway.app → **New Project → Deploy from GitHub**
3. Select your repository → Railway auto-detects `npm start`
4. Set environment variable: `PORT=3000`
5. Copy the deployed URL → update ESP32:
   ```cpp
   const char* SERVER_URL = "https://water-iot.up.railway.app/api/data";
   ```

---

## API Quick Reference

| Method | URL | Description |
|:-------|:----|:------------|
| `POST` | `/api/data` | **ESP32 sends here** — JSON body required |
| `GET` | `/api/snapshot` | Full current state (for debugging) |
| `GET` | `/api/stations` | All registered stations |
| `GET` | `/api/alerts` | All alerts |
| `POST` | `/api/alerts/:id/acknowledge` | Mark alert as seen |
| `GET` | `/api/history/:stationId/:sensor` | Sparkline data |

### ESP32 JSON Payload Format
```json
{
  "stationId":   "ST01",
  "name":        "Main Reservoir",
  "location":    "AITM Campus, Belagavi",
  "ph":          7.22,
  "tds":         248.5,
  "turbidity":   0.92,
  "temperature": 24.5
}
```
All fields except `stationId` are optional — send only what sensors you have.

---

## Troubleshooting

| Problem | Fix |
|:--------|:----|
| ESP32 can't connect to server | Check IP address in `SERVER_URL`. Must be LAN IP, not `localhost`. |
| HTTP 404 or connection refused | Make sure `npm start` is running on server. |
| pH reads wrong values | Calibrate `PH_NEUTRAL_V` with pH 7 buffer solution. |
| TDS reads 0 | Check `PIN_TDS` wiring and ensure sensor module is powered at 3.3V. |
| Dashboard shows "Waiting for ESP32" | No data received yet. Check Serial Monitor for `[SENT]` confirmation. |
| ADC reads noisy/fluctuating | Add 100nF decoupling capacitor between sensor VCC and GND. |
