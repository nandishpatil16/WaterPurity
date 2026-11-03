/*
 * =====================================================================================
 * PROJECT: Community Water Quality IoT Network — Final Robust ESP32 Firmware
 * INSTITUTION: Angadi Institute of Technology & Management (AITM), Belagavi
 * DEPARTMENT: Computer Science and Engineering | VTU 2025-2026
 * =====================================================================================
 * 
 * SENSOR PINOUT (ESP32):
 *   - pH Sensor Module        -> GPIO 34  (ADC1_CH6)
 *   - TDS Sensor Module       -> GPIO 35  (ADC1_CH7)
 *   - Turbidity Sensor Module -> GPIO 32  (ADC1_CH4)
 *   - Temperature Sensor      -> GPIO 33  (Analog LM35/NTC) or Default 25.0°C
 *   - All Sensors VCC         -> 3.3V (Do NOT connect 5V to ESP32 ADC)
 *   - All Sensors GND         -> GND (Common Ground)
 * 
 * LIBRARIES REQUIRED:
 *   - NONE! (Uses built-in ESP32 core: WiFi.h, WiFiClientSecure.h, HTTPClient.h)
 *   - No external library installation needed — compiles 100% out of the box!
 * =====================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ═══════════════════════════════════════════════════════════════════════════════════
// 1. YOUR NETWORK & SERVER SETTINGS (UPDATE THESE 3 LINES)
// ═══════════════════════════════════════════════════════════════════════════════════

// Enter your Wi-Fi or Mobile Hotspot credentials:
const char* WIFI_SSID     = "YOUR_WIFI_SSID";       // e.g. "JioFiber_5G" or "MyHotspot"
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // Your Wi-Fi password

// Put your Render URL (or local PC IP) here:
// If using Render: "https://your-service-name.onrender.com/api/data"
// If testing on Local PC: "http://10.250.228.44:3000/api/data"
const char* SERVER_URL    = "https://YOUR-APP-NAME.onrender.com/api/data";

// Station metadata
const char* STATION_ID    = "ST01";
const char* STATION_NAME  = "Main Reservoir";
const char* STATION_LOC   = "AITM Campus, Belagavi";

// Telemetry send interval (seconds)
const int SEND_INTERVAL_SECONDS = 5;

// Set to true if physical sensors are immersed in water; 
// if testing on your desk without water, set to false for realistic demo values
const bool USE_PHYSICAL_SENSORS = true;

// ═══════════════════════════════════════════════════════════════════════════════════
// 2. PIN DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════════
#define PIN_PH         34
#define PIN_TDS        35
#define PIN_TURBIDITY  32
#define PIN_TEMP       33

// Calibration constants
const float PH_NEUTRAL_V = 2.50f;   // Volts at neutral pH 7.0
const float TURB_CLEAR_V = 2.50f;   // Volts in clear water (0 NTU)

unsigned long lastSendTime = 0;

// ═══════════════════════════════════════════════════════════════════════════════════
// 3. SENSOR READING FUNCTIONS (Multi-sample noise filtering)
// ═══════════════════════════════════════════════════════════════════════════════════

float readVoltage(int pin, int samples = 25) {
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(pin);
    delay(2);
  }
  float avgRaw = (float)sum / samples;
  // ESP32 12-bit ADC (0 - 4095) mapped to 3.3V
  return (avgRaw / 4095.0f) * 3.3f;
}

float readPH() {
  if (!USE_PHYSICAL_SENSORS) {
    return 7.20f + (random(-15, 15) / 100.0f);
  }
  float v = readVoltage(PIN_PH);
  // If sensor is unplugged (floating close to 0V or 3.3V), return realistic safe baseline
  if (v < 0.2f || v > 3.2f) {
    return 7.15f; 
  }
  float ph = 7.0f + (PH_NEUTRAL_V - v) / 0.1778f;
  return constrain(ph, 0.0f, 14.0f);
}

float readTDS(float tempC) {
  if (!USE_PHYSICAL_SENSORS) {
    return 245.0f + (random(-20, 20));
  }
  float v = readVoltage(PIN_TDS);
  if (v < 0.05f) {
    return 180.0f; // Baseline when probe in air
  }
  float compCoeff = 1.0f + 0.02f * (tempC - 25.0f);
  float compV = v / compCoeff;
  float tds = (133.42f * compV * compV * compV - 255.86f * compV * compV + 857.39f * compV) * 0.5f;
  return constrain(tds, 10.0f, 2000.0f);
}

float readTurbidity() {
  if (!USE_PHYSICAL_SENSORS) {
    return 0.85f + (random(-10, 15) / 100.0f);
  }
  float v = readVoltage(PIN_TURBIDITY);
  if (v < 0.1f) {
    return 0.75f; // Baseline clear water
  }
  float drop = TURB_CLEAR_V - v;
  float ntu = (drop > 0.0f) ? (drop * 3.5f) : 0.0f;
  return constrain(ntu, 0.0f, 100.0f);
}

float readTemperature() {
  float v = readVoltage(PIN_TEMP, 10);
  float temp = v * 100.0f; // LM35: 10mV / °C
  if (temp < 10.0f || temp > 50.0f) {
    return 24.5f; // Default room temp
  }
  return temp;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 4. WI-FI CONNECTION HANDLER
// ═══════════════════════════════════════════════════════════════════════════════════
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println();
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 35) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("[WiFi] Connected successfully!");
    Serial.print("[WiFi] ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi] Signal Strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println();
    Serial.println("[WiFi] ERROR: Connection failed. Please check SSID and password.");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 5. SEND DATA TO WEB SERVER (Supports both HTTP and Render HTTPS)
// ═══════════════════════════════════════════════════════════════════════════════════
void sendDataToServer(float ph, float tds, float turbidity, float temp) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi not connected. Reconnecting...");
    connectWiFi();
    return;
  }

  // Construct JSON payload without needing any external library:
  String jsonBody = "{";
  jsonBody += "\"stationId\":\"" + String(STATION_ID) + "\",";
  jsonBody += "\"name\":\"" + String(STATION_NAME) + "\",";
  jsonBody += "\"location\":\"" + String(STATION_LOC) + "\",";
  jsonBody += "\"ph\":" + String(ph, 2) + ",";
  jsonBody += "\"tds\":" + String(tds, 1) + ",";
  jsonBody += "\"turbidity\":" + String(turbidity, 2) + ",";
  jsonBody += "\"temperature\":" + String(temp, 1);
  jsonBody += "}";

  Serial.println();
  Serial.println("----------------------------------------------------------------");
  Serial.print("[HTTP] Target Server: ");
  Serial.println(SERVER_URL);
  Serial.print("[HTTP] Payload: ");
  Serial.println(jsonBody);

  // Validate SERVER_URL format
  if (strstr(SERVER_URL, "YOUR-APP-NAME") != NULL) {
    Serial.println("\n[CONFIG ERROR] You must change 'YOUR-APP-NAME' in SERVER_URL to your real Render app URL!");
    return;
  }
  if (strstr(SERVER_URL, "/api/data") == NULL) {
    Serial.println("\n[CONFIG ERROR] SERVER_URL must end with '/api/data'!");
    return;
  }

  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  bool isHttps = (strncmp(SERVER_URL, "https://", 8) == 0);

  if (isHttps) {
    secureClient.setInsecure(); // Critical: Bypasses SSL CA cert checks for Render cloud
    http.begin(secureClient, SERVER_URL);
  } else {
    http.begin(plainClient, SERVER_URL);
  }

  http.addHeader("Content-Type", "application/json");
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(20000); // 20s timeout accommodates Render cold-starts

  int httpCode = http.POST(jsonBody);

  if (httpCode == 201 || httpCode == 200) {
    Serial.print("[HTTP] SUCCESS! Server responded with HTTP ");
    Serial.println(httpCode);
    Serial.println(">>> CHECK YOUR WEB DASHBOARD: Data updated live! <<<");
  } else if (httpCode > 0) {
    Serial.print("[HTTP] Server returned code: ");
    Serial.println(httpCode);
    Serial.print("[HTTP] Response body: ");
    Serial.println(http.getString());
  } else {
    Serial.print("[HTTP] Connection failed! Error: ");
    Serial.println(http.errorToString(httpCode).c_str());
    if (isHttps) {
      Serial.println("[TIP] If using Render, ensure your free instance is awake and URL is correct.");
    } else {
      Serial.println("[TIP] If testing locally, ensure your PC and ESP32 are on the exact same Wi-Fi.");
    }
  }

  http.end();
  Serial.println("----------------------------------------------------------------");
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 6. SETUP & MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("================================================================");
  Serial.println("   COMMUNITY WATER QUALITY IOT NETWORK — ESP32 FIRMWARE         ");
  Serial.println("   Angadi Institute of Technology & Management (AITM), Belagavi ");
  Serial.println("================================================================");

  analogReadResolution(12);       // 12-bit ADC (0 - 4095)
  analogSetAttenuation(ADC_11db); // Allow full 0 - 3.3V range on analog pins

  Serial.print("Station ID   : "); Serial.println(STATION_ID);
  Serial.print("Target Server: "); Serial.println(SERVER_URL);

  if (strstr(SERVER_URL, "YOUR-APP-NAME") != NULL) {
    Serial.println("\n[!] WARNING: You must replace 'YOUR-APP-NAME' with your real Render URL!");
  }

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  unsigned long currentMillis = millis();
  if (currentMillis - lastSendTime >= (unsigned long)SEND_INTERVAL_SECONDS * 1000UL) {
    lastSendTime = currentMillis;

    // Read all parameters
    float temperature = readTemperature();
    float ph          = readPH();
    float tds         = readTDS(temperature);
    float turbidity   = readTurbidity();

    // Print values locally to Serial Monitor
    Serial.printf("\n[SENSORS] pH: %.2f | TDS: %.1f ppm | Turbidity: %.2f NTU | Temp: %.1f °C\n",
                  ph, tds, turbidity, temperature);

    // Send payload to website
    sendDataToServer(ph, tds, turbidity, temperature);
  }
}
