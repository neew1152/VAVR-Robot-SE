Here are modular, self-contained test sketches and environment configurations.

All sketches use **115200 baud** (as strictly required by the simulator's baud-rate checking logic).

---

### DC Motors & Differential Drive (Actuators)

#### 1. Hardware Inspector Setup
* **Left Motor**: PWM Pin = `9`, DIR Pin = `7`, Offset X = `0`, Offset Y = `-18`, Angle = `0°`
* **Right Motor**: PWM Pin = `10`, DIR Pin = `4`, Offset X = `0`, Offset Y = `18`, Angle = `0°`

```cpp
/*
 * DC Motors & Differential Drive
 * Verifies PWM power scaling, direction control, and kinematic steering.
 */

const int PIN_PWM_L = 9;
const int PIN_DIR_L = 7;
const int PIN_PWM_R = 10;
const int PIN_DIR_R = 4;

void setMotors(int speedL, int speedR) {
  // Left Motor Direction & Speed
  if (speedL >= 0) {
    digitalWrite(PIN_DIR_L, LOW);
    analogWrite(PIN_PWM_L, constrain(speedL, 0, 255));
  } else {
    digitalWrite(PIN_DIR_L, HIGH);
    analogWrite(PIN_PWM_L, constrain(-speedL, 0, 255));
  }

  // Right Motor Direction & Speed
  if (speedR >= 0) {
    digitalWrite(PIN_DIR_R, LOW);
    analogWrite(PIN_PWM_R, constrain(speedR, 0, 255));
  } else {
    digitalWrite(PIN_DIR_R, HIGH);
    analogWrite(PIN_PWM_R, constrain(-speedR, 0, 255));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_PWM_L, OUTPUT);
  pinMode(PIN_DIR_L, OUTPUT);
  pinMode(PIN_PWM_R, OUTPUT);
  pinMode(PIN_DIR_R, OUTPUT);

  Serial.println(F("=== DC Motor Diagnostic Initialized ==="));
  delay(1000);
}

void loop() {
  Serial.println(F("[Action] Driving Forward (Half Speed)"));
  setMotors(128, 128);
  delay(2000);

  Serial.println(F("[Action] Driving Forward (Full Speed)"));
  setMotors(255, 255);
  delay(2000);

  Serial.println(F("[Action] Reversing"));
  setMotors(-150, -150);
  delay(2000);

  Serial.println(F("[Action] Pivot Turn Left"));
  setMotors(-150, 150);
  delay(1500);

  Serial.println(F("[Action] Pivot Turn Right"));
  setMotors(150, -150);
  delay(1500);

  Serial.println(F("[Action] Full Stop"));
  setMotors(0, 0);
  delay(3000);
}
```

* **Expected Result**: The robot drives forward, accelerates, moves backwards, pivots in both directions, and stops. Telemetry pin indicators in the inspector will switch between green (forward) and red (reverse).

---

### Ultrasonic Distance Sensor (Time-of-Flight)

#### 1. Hardware Inspector Setup
* Add **Ultrasonic**: Trig Pin = `3`, Echo Pin = `2`, Offset X = `25`, Offset Y = `0`, Angle = `0°`, Range = `400`
* **Environment Body**: Add a Dynamic or Static Box located ~100–150 units directly in front of the robot (e.g., Robot at `(200, 250)`, Box at `(320, 250)`).


```cpp
/*
 * HC-SR04 Ultrasonic Distance Sensor
 * Verifies trigger pulse cycle and pulseIn echo round-trip calculation.
 */

const int PIN_TRIG = 3;
const int PIN_ECHO = 2;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  digitalWrite(PIN_TRIG, LOW);
  Serial.println(F("=== Ultrasonic Distance Sensor Test ==="));
  delay(500);
}

long readDistanceCM() {
  // Send 10us trigger pulse
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // Measure echo pulse width (timeout 30ms ~ 500cm)
  unsigned long duration = pulseIn(PIN_ECHO, HIGH, 30000);

  if (duration == 0) {
    return -1; // Out of range or no echo received
  }

  // Simulator timing formula: duration_us / 58 = distance_cm
  return duration / 58;
}

void loop() {
  long distance = readDistanceCM();

  Serial.print(F("Distance to Obstacle: "));
  if (distance < 0) {
    Serial.println(F("Out of Range (>400cm)"));
  } else {
    Serial.print(distance);
    Serial.print(F(" cm | Bar: "));
    int bars = constrain(distance / 5, 0, 40);
    for (int i = 0; i < bars; i++) Serial.print(F("#"));
    Serial.println();
  }

  delay(200);
}
```

* **Expected Result**: Dragging the obstacle box closer to or farther from the robot's ray in the viewport changes the distance printed to the serial monitor in real time.

---

### IR Reflectance Sensor (Ground Surface & Line Tracking)

#### 1. Hardware Inspector Setup
* Add **IR LED**: Pin = `14` (`A0`), Offset X = `25`, Offset Y = `0`, Angle = `0°`
* **Environment Setup**: Click **Import** in the viewport header and select an image that has a black track, dark tape, or high-contrast lines on a white/transparent background.


```cpp
/*
 * Analog IR Optical Reflectance Sensor
 * Samples canvas luminance via the ADC hook (0 = Black, 1023 = White).
 */

const int PIN_IR = A0; // Pin 14

void setup() {
  Serial.begin(115200);
  Serial.println(F("=== IR Line Tracking Sensor Test ==="));
}

void loop() {
  int rawAdc = analogRead(PIN_IR);

  // High ADC = White/Reflective, Low ADC = Black/Absorption
  bool onLine = (rawAdc < 400);

  Serial.print(F("ADC Value: "));
  Serial.print(rawAdc);
  Serial.print(F(" | Surface: "));
  
  if (onLine) {
    Serial.println(F("[ DARK / LINE DETECTED ]"));
  } else {
    Serial.println(F("[ LIGHT / FLOOR ]"));
  }

  delay(150);
}
```

* **Expected Result**: While running, drag the robot manually across the canvas with your mouse. When the front sensor passes over a black line, the ADC drops and registers `LINE DETECTED`.

---

### Gripper / End-Effector (Matter.js Grasping)

#### 1. Hardware Inspector Setup
* **Gripper**: Pin = `5`, Offset X = `25`, Offset Y = `0`, Angle = `0°`
* **Left Motor**: PWM Pin = `9`, DIR Pin = `7`, Offset Y = `-18`
* **Right Motor**: PWM Pin = `10`, DIR Pin = `4`, Offset Y = `18`
* **Environment Entity**: Add an entity with **Static = unchecked**, **Grasp = checked**, Width = `25`, Height = `25`, placed slightly in front of the robot (e.g. Robot at `(200, 250)`, Body at `(235, 250)`).


```cpp
/*
 * Gripper End-Effector Payload Locking
 * Approaches a dynamic body, locks it via physics constraints,
 * drags it backwards, and releases it.
 */

const int PIN_GRIPPER = 5;
const int PIN_PWM_L   = 9;
const int PIN_DIR_L   = 7;
const int PIN_PWM_R   = 10;
const int PIN_DIR_R   = 4;

void drive(int speedL, int speedR) {
  digitalWrite(PIN_DIR_L, speedL < 0 ? HIGH : LOW);
  analogWrite(PIN_PWM_L, abs(speedL));
  digitalWrite(PIN_DIR_R, speedR < 0 ? HIGH : LOW);
  analogWrite(PIN_PWM_R, abs(speedR));
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_GRIPPER, OUTPUT);
  pinMode(PIN_PWM_L, OUTPUT);
  pinMode(PIN_DIR_L, OUTPUT);
  pinMode(PIN_PWM_R, OUTPUT);
  pinMode(PIN_DIR_R, OUTPUT);

  digitalWrite(PIN_GRIPPER, LOW);
  drive(0, 0);
  Serial.println(F("=== Gripper Payload Diagnostic ==="));
  delay(1000);
}

void loop() {
  // Step 1: Open gripper and inch forward to contact payload
  Serial.println(F("1. Opening gripper & approaching payload..."));
  digitalWrite(PIN_GRIPPER, LOW);
  drive(100, 100);
  delay(800);
  drive(0, 0);
  delay(500);

  // Step 2: Engage Gripper (Locks constraint in Matter.js)
  Serial.println(F("2. Engaging Gripper (Locking constraints)..."));
  digitalWrite(PIN_GRIPPER, HIGH);
  delay(1000);

  // Step 3: Reverse and haul payload
  Serial.println(F("3. Hauling payload backwards..."));
  drive(-120, -120);
  delay(2000);
  drive(0, 0);
  delay(500);

  // Step 4: Turn with payload
  Serial.println(F("4. Pivoting with captured payload..."));
  drive(120, -120);
  delay(1200);
  drive(0, 0);
  delay(500);

  // Step 5: Release payload
  Serial.println(F("5. Releasing payload..."));
  digitalWrite(PIN_GRIPPER, LOW);
  delay(1000);

  // Step 6: Back away
  Serial.println(F("6. Backing away from payload..."));
  drive(-100, -100);
  delay(1000);
  drive(0, 0);

  Serial.println(F("=== Cycle Complete. Waiting... ==="));
  delay(4000);
}
```

* **Expected Result**: When Pin 5 goes HIGH, a purple indicator arm connects the robot's gripper tip to the object, locks its position, and drags it along as the robot moves. Setting Pin 5 LOW frees the body.

---

### RGB Color Sensor (Multi-Channel Ground Sampling)

#### 1. Hardware Inspector Setup
* Add **RGB Color**:
  * Red Pin (`pinR`) = `14` (`A0`)
  * Green Pin (`pinG`) = `15` (`A1`)
  * Blue Pin (`pinB`) = `16` (`A2`)
  * Offset X = `25`, Offset Y = `0`, Angle = `0°`
* **Environment Setup**: Import a background map containing colored areas (Red `#FF0000`, Green `#00FF00`, Blue `#0000FF`, White, Black).


```cpp
/*
 * Tri-Channel RGB Color Sensor
 * Reads R, G, B reflectance values sampled from the environment map.
 */

const int PIN_R = A0; // Pin 14
const int PIN_G = A1; // Pin 15
const int PIN_B = A2; // Pin 16

void setup() {
  Serial.begin(115200);
  Serial.println(F("=== RGB Color Sensor Test ==="));
}

void loop() {
  int r = analogRead(PIN_R);
  int g = analogRead(PIN_G);
  int b = analogRead(PIN_B);

  Serial.print(F("R: ")); Serial.print(r);
  Serial.print(F(" | G: ")); Serial.print(g);
  Serial.print(F(" | B: ")); Serial.print(b);
  Serial.print(F(" -> Detected: "));

  // Classification logic based on dominant channel
  if (r < 200 && g < 200 && b < 200) {
    Serial.println(F("[ BLACK / VOID ]"));
  } else if (r > 800 && g > 800 && b > 800) {
    Serial.println(F("[ WHITE ]"));
  } else if (r > g + 150 && r > b + 150) {
    Serial.println(F("[ RED ]"));
  } else if (g > r + 150 && g > b + 150) {
    Serial.println(F("[ GREEN ]"));
  } else if (b > r + 150 && b > g + 150) {
    Serial.println(F("[ BLUE ]"));
  } else if (r > 600 && g > 600 && b < 400) {
    Serial.println(F("[ YELLOW ]"));
  } else {
    Serial.println(F("[ UNKNOWN / MIXED ]"));
  }

  delay(250);
}
```

* **Expected Result**: Moving the robot over different colored patches immediately updates the RGB readings and accurately categorizes the ground color.

---

### Full Integration Test (Autonomous Obstacle Avoidance + Payload Retrieval)

This sketch verifies all subsystems working simultaneously:
1. Navigates forward while polling the **Ultrasonic Sensor**.
2. Avoids static obstacles automatically.
3. Uses the **Gripper** to capture graspable bodies when in range.
4. Uses **IR** to confirm surface viability.

```cpp
/*
 * Complete Autonomous Robot System
 * Integration test combining Motors, Ultrasonic ToF, IR, and Gripper.
 */

// Motors
const int PIN_PWM_L = 9;
const int PIN_DIR_L = 7;
const int PIN_PWM_R = 10;
const int PIN_DIR_R = 4;

// Ultrasonic
const int PIN_TRIG = 3;
const int PIN_ECHO = 2;

// Gripper
const int PIN_GRIPPER = 5;

// IR Surface Sensor
const int PIN_IR = A0;

void setMotors(int left, int right) {
  digitalWrite(PIN_DIR_L, left < 0 ? HIGH : LOW);
  analogWrite(PIN_PWM_L, abs(left));
  digitalWrite(PIN_DIR_R, right < 0 ? HIGH : LOW);
  analogWrite(PIN_PWM_R, abs(right));
}

long getDistance() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long duration = pulseIn(PIN_ECHO, HIGH, 25000);
  return (duration == 0) ? 999 : (duration / 58);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_PWM_L, OUTPUT);
  pinMode(PIN_DIR_L, OUTPUT);
  pinMode(PIN_PWM_R, OUTPUT);
  pinMode(PIN_DIR_R, OUTPUT);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_GRIPPER, OUTPUT);

  digitalWrite(PIN_GRIPPER, LOW);
  Serial.println(F("=== Autonomous Navigation System Started ==="));
}

void loop() {
  long distance = getDistance();
  int groundVal = analogRead(PIN_IR);

  Serial.print(F("Dist: ")); Serial.print(distance);
  Serial.print(F("cm | Ground: ")); Serial.println(groundVal);

  if (distance < 20) {
    // Very close: Stop and attempt grasp or pivot
    Serial.println(F("<!> Object Detected in Gripper Range! Attaching..."));
    setMotors(0, 0);
    digitalWrite(PIN_GRIPPER, HIGH); // Lock target
    delay(500);

    // Pivot away with payload
    Serial.println(F("Pivoting with target..."));
    setMotors(-150, 150);
    delay(800);
  } else if (distance < 45) {
    // Approaching obstacle: Slow down and turn
    Serial.println(F("Obstacle warning. Steering Right..."));
    setMotors(120, 40);
  } else {
    // Path clear: Drive straight
    setMotors(160, 160);
  }

  delay(50);
}
```

---

### Quick Setup Checklist

| Peripheral | Pins (Uno) | Test # | Target Scene Item |
| :--- | :--- | :--- | :--- |
| **DC Motors** | `PWM: 9, 10` \| `DIR: 7, 4` | 1 | Open space in physics arena |
| **Ultrasonic** | `Trig: 3`, `Echo: 2` | 2 | Static/Dynamic box placed in path |
| **IR LED** | `Pin: 14 (A0)` | 3 | Background map with dark track/line |
| **Gripper** | `Pin: 5` | 4 | Dynamic Body (`isStatic: false`, `isGraspable: true`) |
| **RGB Sensor** | `R: 14`, `G: 15`, `B: 16` | 5 | Background image with colored zones |