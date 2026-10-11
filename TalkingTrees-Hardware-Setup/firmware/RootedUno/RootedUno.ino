// Arduino Uno R3 + Grove Base Shield V2 (switch at 5V).
// Grove analog moisture: A0. Optional analog light: A1.
// Optional, verified Grove BMP280: I2C socket. Keep it above soil.
// Moisture-only default requires no additional libraries.
#define USE_BMP280 0
#define USE_LIGHT 0
#if USE_BMP280
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <math.h>
Adafruit_BMP280 bmp;
bool bmpReady = false;
#endif
unsigned long sequence = 0;

int medianADC(uint8_t pin) {
  int values[9];
  analogRead(pin); // Discard first conversion after switching channels.
  for (uint8_t i = 0; i < 9; i++) {
    values[i] = analogRead(pin);
    delay(2);
  }
  for (uint8_t i = 1; i < 9; i++) {
    int value = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = value;
  }
  return values[4];
}

unsigned long normalizedADC(int raw) {
  // Preserve the existing app's 0..65535 data contract.
  // Scaling does NOT add precision to Uno's native 0..1023 readings.
  return ((unsigned long)raw * 65535UL + 511UL) / 1023UL;
}

void setup() {
  Serial.begin(115200);
#if USE_BMP280
  Wire.begin();
  bmpReady = bmp.begin(0x77) || bmp.begin(0x76);
#endif
}

void loop() {
  int raw = medianADC(A0);
  Serial.print(F("{\"device_id\":\"arduino-01\",\"seq\":"));
  Serial.print(sequence++);
  Serial.print(F(",\"adc_raw\":"));
  Serial.print(raw);
  Serial.print(F(",\"moisture_raw\":"));
  Serial.print(normalizedADC(raw));
  Serial.print(F(",\"air_temperature_c\":"));
#if USE_BMP280
  float temperature = bmpReady ? bmp.readTemperature() : NAN;
  if (!isnan(temperature) && !isinf(temperature) && temperature >= -40 && temperature <= 85) {
    Serial.print(temperature, 2);
  } else {
    Serial.print(F("null"));
  }
#else
  Serial.print(F("null"));
#endif
  Serial.print(F(",\"soil_temperature_c\":null,\"light_raw\":"));
#if USE_LIGHT
  Serial.print(normalizedADC(medianADC(A1)));
#else
  Serial.print(F("null"));
#endif
  Serial.println(F("}"));
  delay(2000);
}
