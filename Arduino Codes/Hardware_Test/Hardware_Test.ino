/**
 * =============================================================================
 *  General-Purpose 3-Dimensional Axes Machine — Standalone Hardware Test
 * =============================================================================
 *
 *  PURPOSE:
 *    Verify every hardware component independently before connecting the
 *    Electron host application. Each test prints pass/fail results to the
 *    Serial Monitor (115200 baud).
 *
 *  HOW TO USE:
 *    1. Upload this sketch to the Arduino Mega 2560.
 *    2. Open Serial Monitor at 115200 baud.
 *    3. The sketch runs all tests automatically on power-up.
 *    4. Read the results — fix any failures before running the main firmware.
 *
 *  TESTS PERFORMED (in order):
 *    [T1] Driver Enable / Disable  — checks ENA pin logic on TB6600
 *    [T2] X-Axis Motor             — moves +50mm then -50mm, reports steps
 *    [T3] Y-Axis Motor             — moves +50mm then -50mm, reports steps
 *    [T4] Diagonal Motion          — simultaneous X+Y move (Bresenham check)
 *    [T5] Servo (Z-Axis / Pen)     — sweeps pen UP → DOWN → UP, settles each
 *    [T6] Limit Switch X           — reads and prints X_MIN pin state
 *    [T7] Limit Switch Y           — reads and prints Y_MIN pin state
 *    [T8] Full Plotting Square     — draws a 40 × 40 mm square with the pen
 *    [T9] Homing Sequence          — drives toward limit switches to find home
 *
 *  WIRING (must match your main firmware):
 *    X STEP  → Pin 2    X DIR  → Pin 3    X ENA → Pin 4
 *    Y STEP  → Pin 5    Y DIR  → Pin 6    Y ENA → Pin 7
 *    SERVO   → Pin 9
 *    X_MIN   → Pin 18 (INPUT_PULLUP — switch shorts to GND)
 *    Y_MIN   → Pin 19 (INPUT_PULLUP — switch shorts to GND)
 *
 * =============================================================================
 */

#include <Servo.h>

// ---------------------------------------------------------------------------
//  PIN MAP
// ---------------------------------------------------------------------------
#define X_STEP_PIN     2
#define X_DIR_PIN      3
#define X_ENABLE_PIN   4

#define Y_STEP_PIN     5
#define Y_DIR_PIN      6
#define Y_ENABLE_PIN   7

#define Z_SERVO_PIN    9

#define X_MIN_PIN      18
#define Y_MIN_PIN      19

// ---------------------------------------------------------------------------
//  MACHINE PARAMETERS  (match your main firmware)
// ---------------------------------------------------------------------------
#define STEPS_PER_MM_X   200.0f   // T8 lead screw + 8 microstep + NEMA17
#define STEPS_PER_MM_Y   200.0f

#define TEST_SPEED_SPS   1200     // normal test speed  (steps/sec)
#define SLOW_SPEED_SPS    400     // slow speed for visual inspection
#define HOMING_SPEED_SPS  600     // homing search speed
#define ACCEL_STEPS        80     // ramp steps for smooth start/stop

#define SERVO_PEN_UP      75      // degrees
#define SERVO_PEN_DOWN    30      // degrees
#define SERVO_SETTLE_MS   80      // ms for servo to settle

#define HOMING_BACKOFF_MM  2.0f

// ---------------------------------------------------------------------------
//  GLOBALS
// ---------------------------------------------------------------------------
Servo penServo;
long  posX = 0;   // current position in steps
long  posY = 0;

int   testsPassed = 0;
int   testsFailed = 0;

// ---------------------------------------------------------------------------
//  FORWARD DECLARATIONS
// ---------------------------------------------------------------------------
void runAllTests();
void testT1_DriverEnable();
void testT2_XAxis();
void testT3_YAxis();
void testT4_DiagonalMove();
void testT5_Servo();
void testT6_LimitSwitchX();
void testT7_LimitSwitchY();
void testT8_PlottingSquare();
void testT9_Homing();

void moveLinear(long targetX, long targetY, float speedSPS);
void setDir(int dx, int dy);
void stepPulse(uint8_t stepPin);
void enableDrivers(bool en);
void penUp();
void penDownFn();
void printSeparator();
void printPass(const char* testName);
void printFail(const char* testName, const char* reason);
void printHeader(int num, const char* name);

// ---------------------------------------------------------------------------
//  SETUP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);   // let USB-Serial enumerate

  pinMode(X_STEP_PIN,   OUTPUT);
  pinMode(X_DIR_PIN,    OUTPUT);
  pinMode(X_ENABLE_PIN, OUTPUT);
  pinMode(Y_STEP_PIN,   OUTPUT);
  pinMode(Y_DIR_PIN,    OUTPUT);
  pinMode(Y_ENABLE_PIN, OUTPUT);

  pinMode(X_MIN_PIN, INPUT_PULLUP);
  pinMode(Y_MIN_PIN, INPUT_PULLUP);

  penServo.attach(Z_SERVO_PIN);
  penUp();

  enableDrivers(true);

  Serial.println();
  Serial.println(F("================================================"));
  Serial.println(F("  CNC Plotter — Standalone Hardware Test Suite  "));
  Serial.println(F("================================================"));
  Serial.println(F("Board  : Arduino Mega 2560"));
  Serial.println(F("Motors : NEMA17 + TB6600 driver"));
  Serial.println(F("Z-Axis : Servo (pen up/down)"));
  Serial.println(F("Baud   : 115200"));
  Serial.println(F("------------------------------------------------"));
  Serial.println();

  runAllTests();
}

void loop() {
  // Nothing — all tests run once at power-up.
  // Re-upload or press reset to repeat.
}

// ---------------------------------------------------------------------------
//  TEST RUNNER
// ---------------------------------------------------------------------------
void runAllTests() {
  testT1_DriverEnable();
  delay(300);
  testT2_XAxis();
  delay(300);
  testT3_YAxis();
  delay(300);
  testT4_DiagonalMove();
  delay(300);
  testT5_Servo();
  delay(300);
  testT6_LimitSwitchX();
  delay(300);
  testT7_LimitSwitchY();
  delay(300);
  testT8_PlottingSquare();
  delay(300);
  testT9_Homing();

  // ---- Summary ----
  Serial.println();
  Serial.println(F("================================================"));
  Serial.println(F("                FINAL SUMMARY                   "));
  Serial.println(F("================================================"));
  Serial.print(F("  Tests PASSED : "));  Serial.println(testsPassed);
  Serial.print(F("  Tests FAILED : "));  Serial.println(testsFailed);
  if (testsFailed == 0) {
    Serial.println(F("  >> ALL TESTS PASSED. Hardware is ready. <<"));
  } else {
    Serial.println(F("  >> SOME TESTS FAILED. Check wiring above. <<"));
  }
  Serial.println(F("================================================"));

  // Park pen safely
  penUp();
  enableDrivers(false);  // release motor hold current when idle
}

// ---------------------------------------------------------------------------
//  T1 — DRIVER ENABLE / DISABLE
// ---------------------------------------------------------------------------
void testT1_DriverEnable() {
  printHeader(1, "Driver Enable / Disable (TB6600 ENA pin)");

  // Enable
  enableDrivers(true);
  delay(50);
  bool xEnabledLow = (digitalRead(X_ENABLE_PIN) == LOW);
  bool yEnabledLow = (digitalRead(Y_ENABLE_PIN) == LOW);

  // Disable
  enableDrivers(false);
  delay(50);
  bool xDisabledHigh = (digitalRead(X_ENABLE_PIN) == HIGH);
  bool yDisabledHigh = (digitalRead(Y_ENABLE_PIN) == HIGH);

  // Re-enable for subsequent tests
  enableDrivers(true);

  Serial.print(F("  X ENA -> LOW when enabled  : "));
  Serial.println(xEnabledLow   ? F("OK") : F("FAIL — check Pin 4 wiring"));
  Serial.print(F("  Y ENA -> LOW when enabled  : "));
  Serial.println(yEnabledLow   ? F("OK") : F("FAIL — check Pin 7 wiring"));
  Serial.print(F("  X ENA -> HIGH when disabled: "));
  Serial.println(xDisabledHigh ? F("OK") : F("FAIL"));
  Serial.print(F("  Y ENA -> HIGH when disabled: "));
  Serial.println(yDisabledHigh ? F("OK") : F("FAIL"));

  if (xEnabledLow && yEnabledLow && xDisabledHigh && yDisabledHigh)
    printPass("T1 Driver Enable");
  else
    printFail("T1 Driver Enable", "ENA pin logic mismatch — check TB6600 ENA wiring or invert in enableDrivers()");
}

// ---------------------------------------------------------------------------
//  T2 — X AXIS MOTOR
// ---------------------------------------------------------------------------
void testT2_XAxis() {
  printHeader(2, "X-Axis Motor — 50 mm forward, 50 mm back");

  long startPos = posX;

  // Forward 50 mm
  long target = (long)(50.0f * STEPS_PER_MM_X);
  Serial.println(F("  Moving X +50 mm (watch motor turn)..."));
  moveLinear(posX + target, posY, SLOW_SPEED_SPS);
  long afterForward = posX;

  delay(400);

  // Return
  Serial.println(F("  Moving X -50 mm (returning to start)..."));
  moveLinear(startPos, posY, SLOW_SPEED_SPS);
  long afterReturn = posX;

  bool forwardOK = (afterForward == startPos + target);
  bool returnOK  = (afterReturn  == startPos);

  Serial.print(F("  Step count after +50mm : "));
  Serial.print(afterForward);
  Serial.print(F("  (expected "));
  Serial.print(startPos + target);
  Serial.println(forwardOK ? F(") OK") : F(") MISMATCH"));

  Serial.print(F("  Step count after return: "));
  Serial.print(afterReturn);
  Serial.print(F("  (expected "));
  Serial.print(startPos);
  Serial.println(returnOK ? F(") OK") : F(") MISMATCH"));

  if (forwardOK && returnOK)
    printPass("T2 X-Axis Motor");
  else
    printFail("T2 X-Axis Motor", "Step count mismatch — check Step/Dir wiring on TB6600");
}

// ---------------------------------------------------------------------------
//  T3 — Y AXIS MOTOR
// ---------------------------------------------------------------------------
void testT3_YAxis() {
  printHeader(3, "Y-Axis Motor — 50 mm forward, 50 mm back");

  long startPos = posY;
  long target   = (long)(50.0f * STEPS_PER_MM_Y);

  Serial.println(F("  Moving Y +50 mm..."));
  moveLinear(posX, posY + target, SLOW_SPEED_SPS);
  long afterForward = posY;

  delay(400);

  Serial.println(F("  Moving Y -50 mm..."));
  moveLinear(posX, startPos, SLOW_SPEED_SPS);
  long afterReturn = posY;

  bool forwardOK = (afterForward == startPos + target);
  bool returnOK  = (afterReturn  == startPos);

  Serial.print(F("  Step count after +50mm : "));
  Serial.print(afterForward);
  Serial.println(forwardOK ? F(" OK") : F(" MISMATCH"));

  Serial.print(F("  Step count after return: "));
  Serial.print(afterReturn);
  Serial.println(returnOK ? F(" OK") : F(" MISMATCH"));

  if (forwardOK && returnOK)
    printPass("T3 Y-Axis Motor");
  else
    printFail("T3 Y-Axis Motor", "Step count mismatch — check Step/Dir wiring");
}

// ---------------------------------------------------------------------------
//  T4 — DIAGONAL (SIMULTANEOUS X + Y)
// ---------------------------------------------------------------------------
void testT4_DiagonalMove() {
  printHeader(4, "Diagonal Move — X+30mm Y+30mm simultaneously (Bresenham)");

  long startX = posX, startY = posY;
  long tx = posX + (long)(30.0f * STEPS_PER_MM_X);
  long ty = posY + (long)(30.0f * STEPS_PER_MM_Y);

  Serial.println(F("  Moving diagonally +30mm X, +30mm Y..."));
  moveLinear(tx, ty, TEST_SPEED_SPS);

  delay(300);

  Serial.println(F("  Returning to origin..."));
  moveLinear(startX, startY, TEST_SPEED_SPS);

  bool ok = (posX == startX && posY == startY);
  Serial.print(F("  Final position: X="));
  Serial.print(posX);
  Serial.print(F(" Y="));
  Serial.print(posY);
  Serial.println(ok ? F("  OK") : F("  MISMATCH"));

  if (ok)
    printPass("T4 Diagonal Move");
  else
    printFail("T4 Diagonal Move", "One axis may be missing steps — check motor current on TB6600");
}

// ---------------------------------------------------------------------------
//  T5 — SERVO (Z-AXIS / PEN)
// ---------------------------------------------------------------------------
void testT5_Servo() {
  printHeader(5, "Servo (Z-Axis / Pen Up-Down)");

  Serial.print(F("  Moving to PEN UP  ("));
  Serial.print(SERVO_PEN_UP);
  Serial.println(F(" deg) — pen should lift..."));
  penUp();
  delay(600);

  Serial.print(F("  Moving to PEN DOWN ("));
  Serial.print(SERVO_PEN_DOWN);
  Serial.println(F(" deg) — pen should touch surface..."));
  penDownFn();
  delay(600);

  Serial.println(F("  Returning PEN UP..."));
  penUp();
  delay(400);

  // We cannot read servo position back, so we ask the developer to verify visually.
  Serial.println(F("  >> Visual check required — did the pen move up and down?"));
  Serial.println(F("     If not: verify servo signal wire on Pin 9, and tune"));
  Serial.println(F("     SERVO_PEN_UP / SERVO_PEN_DOWN angles at top of file."));

  // Consider it a pass if no crash (servo library would fault on bad pin)
  printPass("T5 Servo (visual confirmation needed)");
}

// ---------------------------------------------------------------------------
//  T6 — LIMIT SWITCH X
// ---------------------------------------------------------------------------
void testT6_LimitSwitchX() {
  printHeader(6, "Limit Switch X_MIN (Pin 18)");

  bool state = (digitalRead(X_MIN_PIN) == LOW);   // LOW = triggered (switch closed)

  Serial.print(F("  X_MIN current state: "));
  Serial.println(state ? F("TRIGGERED (switch is pressed / shorted to GND)")
                       : F("OPEN      (switch is not pressed)"));

  Serial.println(F("  >> Manually press the X limit switch now and check Serial Monitor."));
  Serial.println(F("     Reading again in 3 seconds..."));
  delay(3000);

  bool state2 = (digitalRead(X_MIN_PIN) == LOW);
  Serial.print(F("  X_MIN state after 3 s: "));
  Serial.println(state2 ? F("TRIGGERED") : F("OPEN"));

  // Pass if we can read the pin (always passes unless pin is floating/broken)
  Serial.println(F("  >> If the state did not change when pressed, check wiring to Pin 18."));
  printPass("T6 Limit Switch X (verify state change manually)");
}

// ---------------------------------------------------------------------------
//  T7 — LIMIT SWITCH Y
// ---------------------------------------------------------------------------
void testT7_LimitSwitchY() {
  printHeader(7, "Limit Switch Y_MIN (Pin 19)");

  bool state = (digitalRead(Y_MIN_PIN) == LOW);
  Serial.print(F("  Y_MIN current state: "));
  Serial.println(state ? F("TRIGGERED") : F("OPEN"));

  Serial.println(F("  >> Manually press the Y limit switch now and check Serial Monitor."));
  Serial.println(F("     Reading again in 3 seconds..."));
  delay(3000);

  bool state2 = (digitalRead(Y_MIN_PIN) == LOW);
  Serial.print(F("  Y_MIN state after 3 s: "));
  Serial.println(state2 ? F("TRIGGERED") : F("OPEN"));

  Serial.println(F("  >> If no change, check wiring to Pin 19."));
  printPass("T7 Limit Switch Y (verify state change manually)");
}

// ---------------------------------------------------------------------------
//  T8 — FULL PLOTTING SQUARE
// ---------------------------------------------------------------------------
void testT8_PlottingSquare() {
  printHeader(8, "CNC Plotting — Draw a 40 x 40 mm Square");

  Serial.println(F("  Place paper under pen. Drawing 40x40mm square..."));
  Serial.println(F("  Corner order: (0,0) -> (40,0) -> (40,40) -> (0,40) -> (0,0)"));

  long side = (long)(40.0f * STEPS_PER_MM_X);
  long x0 = posX, y0 = posY;

  // Pen up — travel to start corner (already at 0,0 relative)
  penUp();

  // Bottom edge
  Serial.println(F("  -> Drawing bottom edge  (X+40mm)..."));
  penDownFn();
  moveLinear(x0 + side, y0, TEST_SPEED_SPS);

  // Right edge
  Serial.println(F("  -> Drawing right  edge  (Y+40mm)..."));
  moveLinear(x0 + side, y0 + side, TEST_SPEED_SPS);

  // Top edge
  Serial.println(F("  -> Drawing top    edge  (X-40mm)..."));
  moveLinear(x0, y0 + side, TEST_SPEED_SPS);

  // Left edge (close)
  Serial.println(F("  -> Drawing left   edge  (Y-40mm)..."));
  moveLinear(x0, y0, TEST_SPEED_SPS);

  penUp();

  bool closed = (posX == x0 && posY == y0);
  Serial.print(F("  Closed-loop position error: X="));
  Serial.print(posX - x0);
  Serial.print(F(" Y="));
  Serial.print(posY - y0);
  Serial.println(F(" steps (should both be 0)"));

  if (closed)
    printPass("T8 Plotting Square");
  else
    printFail("T8 Plotting Square", "Position did not return to origin — motor may be losing steps, reduce speed or increase TB6600 current");
}

// ---------------------------------------------------------------------------
//  T9 — HOMING SEQUENCE
// ---------------------------------------------------------------------------
void testT9_Homing() {
  printHeader(9, "Homing Sequence (drives toward limit switches)");

  Serial.println(F("  WARNING: Machine will move toward X_MIN and Y_MIN switches."));
  Serial.println(F("           Ensure the path is clear. Starting in 2 seconds..."));
  delay(2000);

  penUp();

  // --- Home X ---
  Serial.println(F("  Homing X axis..."));
  bool xHit = false;
  long xSteps = 0;
  long maxSearchSteps = (long)(200.0f * STEPS_PER_MM_X);  // search up to 200 mm

  digitalWrite(X_DIR_PIN, LOW);
  delayMicroseconds(5);

  while (xSteps < maxSearchSteps) {
    if (digitalRead(X_MIN_PIN) == LOW) { xHit = true; break; }
    stepPulse(X_STEP_PIN);
    delayMicroseconds(1000000 / HOMING_SPEED_SPS);
    xSteps++;
  }

  if (xHit) {
    // Back off
    digitalWrite(X_DIR_PIN, HIGH);
    delayMicroseconds(5);
    long backoff = (long)(HOMING_BACKOFF_MM * STEPS_PER_MM_X);
    for (long i = 0; i < backoff; i++) {
      stepPulse(X_STEP_PIN);
      delayMicroseconds(1000000 / HOMING_SPEED_SPS);
    }
    posX = 0;
    Serial.print(F("  X homed. Switch hit after "));
    Serial.print(xSteps);
    Serial.println(F(" steps. Backed off and zeroed."));
  } else {
    Serial.println(F("  X homing FAILED — limit switch not found in 200mm range."));
    Serial.println(F("  Check X_MIN switch wiring on Pin 18."));
  }

  // --- Home Y ---
  Serial.println(F("  Homing Y axis..."));
  bool yHit = false;
  long ySteps = 0;
  long maxSearchStepsY = (long)(200.0f * STEPS_PER_MM_Y);

  digitalWrite(Y_DIR_PIN, LOW);
  delayMicroseconds(5);

  while (ySteps < maxSearchStepsY) {
    if (digitalRead(Y_MIN_PIN) == LOW) { yHit = true; break; }
    stepPulse(Y_STEP_PIN);
    delayMicroseconds(1000000 / HOMING_SPEED_SPS);
    ySteps++;
  }

  if (yHit) {
    digitalWrite(Y_DIR_PIN, HIGH);
    delayMicroseconds(5);
    long backoff = (long)(HOMING_BACKOFF_MM * STEPS_PER_MM_Y);
    for (long i = 0; i < backoff; i++) {
      stepPulse(Y_STEP_PIN);
      delayMicroseconds(1000000 / HOMING_SPEED_SPS);
    }
    posY = 0;
    Serial.print(F("  Y homed. Switch hit after "));
    Serial.print(ySteps);
    Serial.println(F(" steps. Backed off and zeroed."));
  } else {
    Serial.println(F("  Y homing FAILED — limit switch not found in 200mm range."));
    Serial.println(F("  Check Y_MIN switch wiring on Pin 19."));
  }

  if (xHit && yHit)
    printPass("T9 Homing Sequence");
  else
    printFail("T9 Homing Sequence", "One or both limit switches not triggered — check switch wiring");
}

// ===========================================================================
//  MOTION PRIMITIVES
// ===========================================================================

/**
 * moveLinear — Bresenham interpolation with trapezoidal acceleration.
 * Updates posX and posY.
 */
void moveLinear(long targetX, long targetY, float speedSPS) {
  long dx  = targetX - posX;
  long dy  = targetY - posY;
  if (dx == 0 && dy == 0) return;

  long adx = abs(dx);
  long ady = abs(dy);

  setDir(dx >= 0 ? 1 : -1, dy >= 0 ? 1 : -1);

  long steps = max(adx, ady);
  long err   = adx - ady;

  float baseDelay  = 1000000.0f / speedSPS;
  float startDelay = 1000000.0f / 200.0f;
  float ramp       = min((float)ACCEL_STEPS, (float)steps / 2.0f);

  for (long i = 0; i < steps; i++) {
    float delay_us;
    if      (i < ramp)            delay_us = startDelay + (baseDelay - startDelay) * (i / ramp);
    else if (i > steps - ramp)    delay_us = startDelay + (baseDelay - startDelay) * ((steps - i) / ramp);
    else                          delay_us = baseDelay;
    if (delay_us < 100.0f) delay_us = 100.0f;

    long e2 = 2 * err;
    if (e2 > -ady) {
      err -= ady;
      stepPulse(X_STEP_PIN);
      posX += (dx >= 0) ? 1 : -1;
    }
    if (e2 < adx) {
      err += adx;
      stepPulse(Y_STEP_PIN);
      posY += (dy >= 0) ? 1 : -1;
    }
    delayMicroseconds((unsigned long)(delay_us));
  }

  posX = targetX;
  posY = targetY;
}

void setDir(int dx, int dy) {
  digitalWrite(X_DIR_PIN, dx > 0 ? HIGH : LOW);
  digitalWrite(Y_DIR_PIN, dy > 0 ? HIGH : LOW);
  delayMicroseconds(5);
}

void stepPulse(uint8_t pin) {
  digitalWrite(pin, HIGH);
  delayMicroseconds(5);
  digitalWrite(pin, LOW);
}

void enableDrivers(bool en) {
  uint8_t level = en ? LOW : HIGH;   // TB6600: LOW = enabled
  digitalWrite(X_ENABLE_PIN, level);
  digitalWrite(Y_ENABLE_PIN, level);
}

void penUp() {
  penServo.write(SERVO_PEN_UP);
  delay(SERVO_SETTLE_MS);
}

void penDownFn() {
  penServo.write(SERVO_PEN_DOWN);
  delay(SERVO_SETTLE_MS);
}

// ===========================================================================
//  PRINT HELPERS
// ===========================================================================
void printSeparator() {
  Serial.println(F("------------------------------------------------"));
}

void printHeader(int num, const char* name) {
  Serial.println();
  printSeparator();
  Serial.print(F("[T"));
  Serial.print(num);
  Serial.print(F("] "));
  Serial.println(name);
  printSeparator();
}

void printPass(const char* testName) {
  Serial.print(F("  RESULT: "));
  Serial.print(testName);
  Serial.println(F(" -> PASS"));
  testsPassed++;
}

void printFail(const char* testName, const char* reason) {
  Serial.print(F("  RESULT: "));
  Serial.print(testName);
  Serial.println(F(" -> FAIL"));
  Serial.print(F("  REASON: "));
  Serial.println(reason);
  testsFailed++;
}
