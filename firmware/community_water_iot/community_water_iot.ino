/*
 * ============================================================
 * Water Community IoT Network — ESP32 Firmware
 * AITM Belagavi | Dept. of CSE | VTU 2025-26
 * ============================================================
 *
 * HARDWARE CONNECTIONS:
 *   pH Sensor module  → GPIO 34  (ADC1_CH6)
 *   TDS Sensor module → GPIO 35  (ADC1_CH7)
 *   Turbidity Sensor  → GPIO 32  (ADC1_CH4)
 *   DS18B20 Temp      → GPIO 4   (OneWire, with 4.7kΩ pullup to 3.3V)
 *
 * LIBRARIES REQUIRED (Install via Arduino Library Manager):
 *   - OneWire              by Paul Stoffregen
 *   - DallasTemperature    by Miles Burton
 *   - ArduinoJson          by Benoit Blanchon (v6.x)
 *   - WiFi, HTTPClient     (built-in with ESP32 Arduino core)
 *
 * HOW IT WORKS:
 *   1. Reads all sensors with noise-averaged ADC sampling.
 *   2. Computes calibrated engineering units (pH, ppm, NTU, °C).
 *   3. Posts JSON payload to your backend server every INTERVAL seconds.
 *   4. Dashboard updates automatically via WebSocket push.
 * ============================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ─── USER CONFIGURATION ──────────────────────────────────────────
// ↓↓↓ UPDATE THESE VALUES BEFORE FLASHING ↓↓↓

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Replace <SERVER_IP> with your computer's LAN IP
// (run `ipconfig` on Windows or `hostname -I` on Linux)
// Example: "http://192.168.1.15:3000/api/data"
const char* SERVER_URL    = "http://<SERVER_IP>:3000/api/data";

const char* STATION_ID   = "ST01";
const char* STATION_NAME = "Main Reservoir";
const char* STATION_LOC  = "AITM Campus, Belagavi";

// Seconds between sensor readings
const int SEND_INTERVAL_S = 5;

// ─── PIN DEFINITIONS ─────────────────────────────────────────────
#define PIN_PH         34
#define PIN_TDS        35
#define PIN_TURBIDITY  32
#define PIN_TEMP_DS     4   // DS18B20 data line (4.7kΩ pullup to 3.3V)

// ─── pH CALIBRATION ──────────────────────────────────────────────
// Calibrate: dip probe in pH 7 buffer solution → adjust PH_NEUTRAL_V
// until Serial Monitor shows pH = 7.00.
const float PH_NEUTRAL_V = 2.50f;   // Volts when probe is in pH 7 buffer

// ─── TDS CALIBRATION ─────────────────────────────────────────────
// Uses DFRobot Gravity TDS sensor formula. Temperature compensated.
// No manual calibration usually needed for this sensor type.
const float TDS_VREF = 3.3f;

// ─── Turbidity CALIBRATION ───────────────────────────────────────
// Adjust TURB_CLEAR_V to the voltage your sensor reads in clean water.
// Check Serial Monitor: dip in clean water → note voltage → set below.
const float TURB_CLEAR_V = 2.5f;    // Volts in clean water (NTU ≈ 0)
const float TURB_SCALE   = 4.0f;    // NTU per volt of drop (tune by measurement)

// ─── DS18B20 SETUP ───────────────────────────────────────────────
OneWire           oneWire(PIN_TEMP_DS);
DallasTemperature tempSensor(&oneWire);

unsigned long lastSendTime = 0;

// ─── HELPER: Read and average ADC voltage (noise reduction) ──────
float readVoltage(int pin, int samples = 20) {
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(pin);
    delay(2);
  }
  return ((float)sum / samples) / 4095.0f * 3.3f;
}

// ─── pH Reading ──────────────────────────────────────────────────
// Generic pH electrode module: neutral pH 7.0 corresponds to ~2.50V.
// Each full pH unit shift ≈ 0.178V (Nernst equation at 25°C).
float readPH() {
  float v = readVoltage(PIN_PH, 30);
  // pH = 7 + (neutralV - measuredV) / 0.1778
  float ph = 7.0f + (PH_NEUTRAL_V - v) / 0.1778f;
  return constrain(ph, 0.0f, 14.0f);
}

// ─── TDS Reading (with temperature compensation) ─────────────────
float readTDS(float tempC) {
  float v = readVoltage(PIN_TDS, 30);
  // Temperature compensation: conductivity changes ~2%/°C
  float cc  = 1.0f + 0.02f * (tempC - 25.0f);
  float vc  = v / cc;
  // Polynomial fit from DFRobot Gravity TDS sensor datasheet
  float tds = (133.42f * vc * vc * vc
             - 255.86f * vc * vc
             + 857.39f * vc) * 0.5f;
  return constrain(tds, 0.0f, 2000.0f);
}

// ─── Turbidity Reading ───────────────────────────────────────────
// Sensor output: ~2.5V (clear) → drops as particles scatter light.
float readTurbidity() {
  float v   = readVoltage(PIN_TURBIDITY, 30);
  float drop = TURB_CLEAR_V - v;
  float ntu  = (drop > 0.0f) ? (drop * TURB_SCALE) : 0.0f;
  return constrain(ntu, 0.0f, 100.0f);
}

// ─── Temperature Reading (DS18B20) ───────────────────────────────
float readTemperature() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -40.0f || t > 85.0f) {
    return 25.0f;  // fallback if probe disconnected
  }
  return t;
}

// ─── Wi-Fi ───────────────────────────────────────────────────────
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("\nConnecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries++ < 30) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\n[OK] IP: %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("\n[FAIL] Wi-Fi not connected.");
}

// ─── HTTP POST ───────────────────────────────────────────────────
void sendData(float ph, float tds, float turbidity, float temperature) {
  if (WiFi.status() != WL_CONNECTED) { connectWiFi(); return; }

  StaticJsonDocument<256> doc;
  doc["stationId"]   = STATION_ID;
  doc["name"]        = STATION_NAME;
  doc["location"]    = STATION_LOC;
  doc["ph"]          = round(ph * 100.0f) / 100.0f;
  doc["tds"]         = round(tds * 10.0f)  / 10.0f;
  doc["turbidity"]   = round(turbidity * 100.0f) / 100.0f;
  doc["temperature"] = round(temperature * 10.0f) / 10.0f;

  char body[256];
  serializeJson(doc, body);

  HTTPClient http;

  if (strncmp(SERVER_URL, "https://", 8) == 0) {
    WiFiClientSecure secClient;
    secClient.setInsecure(); // Essential for Render HTTPS support without CA bundle
    http.begin(secClient, SERVER_URL);
  } else {
    WiFiClient plainClient;
    http.begin(plainClient, SERVER_URL);
  }

  http.addHeader("Content-Type", "application/json");
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(10000); // 10s timeout accommodates Render cloud latency

  int code = http.POST(body);
  if (code == 201)
    Serial.printf("[SENT] pH:%.2f TDS:%.1fppm Turb:%.2fNTU Temp:%.1f°C → HTTP %d\n",
                  ph, tds, turbidity, temperature, code);
  else
    Serial.printf("[ERR] HTTP %d : %s\n", code, http.getString().c_str());

  http.end();
}

// ─── setup() ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("=== Water Community IoT Network — AITM CSE ===");
  Serial.printf("Station : %s (%s)\n", STATION_NAME, STATION_ID);
  Serial.printf("Server  : %s\n", SERVER_URL);
  Serial.printf("Interval: %d seconds\n\n", SEND_INTERVAL_S);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);  // allow full 0–3.3V ADC range
  tempSensor.begin();
  connectWiFi();
}

// ─── loop() ──────────────────────────────────────────────────────
void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  if (millis() - lastSendTime >= (unsigned long)SEND_INTERVAL_S * 1000UL) {
    lastSendTime = millis();

    float temp = readTemperature();   // read temp first (TDS compensation)
    float ph   = readPH();
    float tds  = readTDS(temp);
    float turb = readTurbidity();

    Serial.printf("pH:%.2f  TDS:%.0fppm  Turb:%.2fNTU  Temp:%.1f°C\n",
                  ph, tds, turb, temp);

    sendData(ph, tds, turb, temp);
  }
}
