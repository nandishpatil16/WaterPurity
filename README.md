# Community Water Quality IoT Network

**Angadi Institute of Technology & Management (AITM), Belagavi**  
*Department of Computer Science and Engineering*  
*Affiliated to Visvesvaraya Technological University (VTU), Belagavi*

---

### Project Members:
- **Balakrishna Golappa** (USN: 2AG23CS022)
- **Darshan Dhannugol** (USN: 2AG23CS034)
- **Kartik Mantur** (USN: 2AG23CS045)
- **Kiran Suryavanshi** (USN: 2AG23CS052)

### Project Guide:
- **Prof. Uttara Yadav**, Assistant Professor, Dept. of CSE, AITM

---

## 🌊 Overview

The **Community Water Quality IoT Network** is an intelligent, low-cost environmental sensing platform designed to continuously monitor critical water parameters in real time. It uses an **ESP32 microcontroller** edge node interfaced with precision water sensors, transmitting telemetry data over Wi-Fi/GSM/LoRa to a central analytical cloud dashboard. 

When contamination breaches **BIS (IS 10500:2012)** and **WHO** safety standards, the system generates instantaneous edge-level alerts (LED + Buzzer) and triggers real-time community dashboard notifications.

---

## ⚡ Key Features

1. **Multi-Parameter Edge Sensing:**
   - **pH Level:** Hydrogen ion concentration (0–14 scale; safe 6.5–8.5).
   - **Turbidity:** Suspended particles and water cloudiness measured in NTU (< 5.0 NTU limit).
   - **Total Dissolved Solids (TDS):** Mineral and salt concentration in ppm (< 500 ppm limit).
   - **Water Temperature:** Ambient water temperature with digital temperature compensation.
   - **Dissolved Oxygen (DO):** Oxygen concentration supporting aquatic ecosystems and potability (> 4.5 mg/L).

2. **Automated Water Quality Index (WQI):**
   - Weighted multi-parameter scoring engine giving an instant purity score (0–100) with classifications: *Excellent, Good, Marginal, Hazardous*.

3. **Edge-Level Alert System:**
   - Active Buzzer and Red LED activation on the ESP32 hardware upon parameter threshold breach.
   - Audio-visual alert banner and notification log on the web dashboard.

4. **Multi-Station Community Support:**
   - Built-in multi-node routing (Central Reservoir, Community Tank, Feeder Pipeline, Rural Well).

5. **Live Presentation & Viva Demo Suite:**
   - In-dashboard scenario injection to simulate:
     - Normal Potable Water
     - Acid Spill Contamination
     - Monsoon Silt & Flood Turbidity
     - Industrial Chemical / TDS Runoff
     - Water Hypoxia / Stagnation
   - Slider controls to manually tweak and test edge cases live during seminars.

6. **Lab & VTU Record Compatibility:**
   - 1-Click CSV telemetry data export for viva documentation and project record books.

---

## 🔌 Hardware Pinout Table

| Sensor / Component | ESP32 Pin | Interface Type | Standard Safe Range |
| :--- | :--- | :--- | :--- |
| **Analog pH Sensor** | `GPIO 34` | ADC1 Channel 6 | 6.5 – 8.5 |
| **Turbidity Sensor** | `GPIO 35` | ADC1 Channel 7 | < 5.0 NTU |
| **Analog TDS Sensor** | `GPIO 32` | ADC1 Channel 4 | < 500 ppm |
| **Dissolved Oxygen Sensor**| `GPIO 33` | ADC1 Channel 5 | > 4.5 mg/L |
| **Water Temperature** | `GPIO 36 / 4`| ADC / 1-Wire DS18B20 | 15°C – 32°C |
| **Normal Status LED** | `GPIO 2` | Digital Output (Green) | ON when safe |
| **Alert Warning LED** | `GPIO 18` | Digital Output (Red) | ON when contaminated |
| **Audible Alarm Buzzer**| `GPIO 19` | Digital Output (Active) | Pulsed on unsafe water |

---

## 🚀 Quick Start Guide

### 1. Start the Central Web Dashboard & API Server:
```bash
# Navigate to the project root directory
cd "C:\Users\SHREE\.gemini\antigravity\scratch\community-water-quality-iot"

# Start the server (Express + WebSockets)
npm start
```
The server will start at:
- **Web Dashboard:** [http://localhost:5000](http://localhost:5000)
- **ESP32 Ingestion API:** `POST http://localhost:5000/api/telemetry`
- **Real-time WebSocket:** `ws://localhost:5000`

### 2. Flashing the ESP32 Hardware:
1. Open the [community_water_iot.ino](file:///C:/Users/SHREE/.gemini/antigravity/scratch/community-water-quality-iot/firmware/community_water_iot/community_water_iot.ino) file in the **Arduino IDE**.
2. Select Board: `DOIT ESP32 DEVKIT V1` or `ESP32 Dev Module`.
3. Update your local Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   const char* SERVER_URL    = "http://<YOUR_COMPUTER_LAN_IP>:5000/api/telemetry";
   ```
4. Connect the sensors to the designated GPIO pins as shown in the pinout table.
5. Click **Upload** and open the Serial Monitor at `115200` baud.

### 3. Wokwi Virtual Simulator:
If you do not have physical hardware plugged in right now:
- The dashboard automatically includes a built-in **Real-Time Organic Simulator**.
- You can also upload `firmware/diagram.json` and `firmware/community_water_iot/community_water_iot.ino` directly to [Wokwi ESP32 Simulator](https://wokwi.com/esp32) for browser-based simulation!

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/telemetry` | ESP32 telemetry ingestion endpoint (JSON payload). |
| `GET` | `/api/telemetry/latest` | Returns latest readings across all stations. |
| `GET` | `/api/telemetry/history` | Historical time-series data for Chart.js. |
| `GET` | `/api/nodes` | List of all community monitoring stations. |
| `POST` | `/api/simulator/inject` | Trigger preset contamination scenarios. |
| `POST` | `/api/simulator/toggle` | Pause / resume background simulated feeds. |
| `GET` | `/api/alerts` | List of recent safety threshold breaches. |
| `POST` | `/api/alerts/clear` | Clear and acknowledge alert log. |
| `GET` | `/api/export/csv` | Download complete telemetry log as a `.csv` spreadsheet. |

---

## 📚 Project Structure

```
community-water-quality-iot/
├── firmware/
│   ├── community_water_iot/
│   │   └── community_water_iot.ino    # ESP32 C++ Arduino firmware
│   └── diagram.json                   # Wokwi simulation diagram
├── server/
│   └── server.js                      # Express & WebSocket telemetry server
├── public/
│   ├── index.html                     # Responsive glassmorphism dashboard UI
│   ├── app.js                         # Dynamic charts, WebSocket client & demo suite
│   └── style.css                      # Custom theme and animations
├── docs/
│   └── VIVA_DEFENSE_GUIDE.md          # Comprehensive Viva Voce questions & model answers
├── package.json                       # Node.js dependencies
└── README.md                          # Project documentation & setup manual
```
