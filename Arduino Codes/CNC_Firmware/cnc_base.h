#pragma once

#include <AccelStepper.h>
#include <MultiStepper.h>
#include <Servo.h>
#include <GCodeParser.h>
#include <math.h>

// ─── Pin definitions ──────────────────────────────────────────────────────────
#define PIN_X_STEP   2
#define PIN_X_DIR    3
#define PIN_Y2_STEP  4
#define PIN_Y2_DIR   5
#define PIN_Y1_STEP  6
#define PIN_Y1_DIR   7
#define PIN_ENABLE   8
#define PIN_SERVO    9
#define PIN_Y_LIMIT  18  // INPUT_PULLUP — Y_MIN
#define PIN_X_LIMIT  19  // INPUT_PULLUP — X_MIN

// ─── Global config variables ─────────────────────────────────────────────────
int   stepsPerRev      = 200;
int   microsteps       = 16;
float leadScrewPitchMm = 8.0f;
float maxFeedrate      = 3000.0f;
float minFeedrate      = 10.0f;
float homingFeedrate   = 600.0f;
float homingBackoffMm  = 2.0f;
int   servoPenUp       = 75;
int   servoPenDown     = 30;
int   servoHome        = 75;
int   servoSettleMs    = 150;
float chordError       = 0.2f;   // arc interpolation chord-error tolerance (mm)
bool  homingMode       = false;
bool  isAbsoluteMode   = true;
float currentFeedRate  = 1000.0f;

// Derived steps/mm — recomputed whenever config changes via recomputeDerived()
float stepsPerMmX = (200.0f * 16.0f) / 8.0f;   // 400 steps/mm
float stepsPerMmY = (200.0f * 16.0f) / 8.0f;   // 400 steps/mm

// ─── Hardware objects ─────────────────────────────────────────────────────────
AccelStepper stepperX (AccelStepper::DRIVER, PIN_X_STEP,  PIN_X_DIR);
AccelStepper stepperY1(AccelStepper::DRIVER, PIN_Y1_STEP, PIN_Y1_DIR);
AccelStepper stepperY2(AccelStepper::DRIVER, PIN_Y2_STEP, PIN_Y2_DIR);
MultiStepper steppers;
Servo        servo;
GCodeParser  GCode;

// ─── ISR / E-stop flag ────────────────────────────────────────────────────────
volatile bool eStopFlag = false;

// ─── Telemetry timing ─────────────────────────────────────────────────────────
unsigned long lastTelemetryMs = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 500;

// ─── Serial input buffer ──────────────────────────────────────────────────────
String inputBuffer = "";

// ─── Current servo angle tracking ────────────────────────────────────────────
int currentServoAngle = 75;

// ─────────────────────────────────────────────────────────────────────────────
// Forward declarations
// ─────────────────────────────────────────────────────────────────────────────
void recomputeDerived();
void penUp();
void penDown();
void penHome();
bool checkEStop();
void moveLinear(float targetXMm, float targetYMm, float feedRate);
void moveArc(float endX, float endY, float offsetI, float offsetJ,
             bool clockwise, float feedRate);
void sendTelemetry();
void printConfig();
void printStatus();
void handleConfigSet(String line);
String stripComments(String line);
void processParsedGCode();
void processLine(String line);
void xLimitISR();
void yLimitISR();

// ─────────────────────────────────────────────────────────────────────────────
// Recompute derived values after any config change
// ─────────────────────────────────────────────────────────────────────────────
void recomputeDerived() {
  if (leadScrewPitchMm <= 0.0f) leadScrewPitchMm = 8.0f;
  if (stepsPerRev      <= 0)    stepsPerRev       = 200;
  if (microsteps       <= 0)    microsteps        = 16;

  stepsPerMmX = (float)(stepsPerRev * microsteps) / leadScrewPitchMm;
  stepsPerMmY = stepsPerMmX;

  if (minFeedrate <= 0.0f)           minFeedrate = 1.0f;
  if (maxFeedrate < minFeedrate)     maxFeedrate = minFeedrate;
  currentFeedRate = constrain(currentFeedRate, minFeedrate, maxFeedrate);

  float maxSpsX = (maxFeedrate / 60.0f) * stepsPerMmX;
  float maxSpsY = (maxFeedrate / 60.0f) * stepsPerMmY;

  stepperX.setMaxSpeed(maxSpsX);
  stepperY1.setMaxSpeed(maxSpsY);
  stepperY2.setMaxSpeed(maxSpsY);
  stepperX.setAcceleration(maxSpsX * 2.0f);
  stepperY1.setAcceleration(maxSpsY * 2.0f);
  stepperY2.setAcceleration(maxSpsY * 2.0f);
}

// ─────────────────────────────────────────────────────────────────────────────
// Servo helpers
// ─────────────────────────────────────────────────────────────────────────────
void penDown() {
  servo.write(servoPenDown);
  currentServoAngle = servoPenDown;
  delay(servoSettleMs);
}

void penUp() {
  servo.write(servoPenUp);
  currentServoAngle = servoPenUp;
  delay(servoSettleMs);
}

void penHome() {
  servo.write(servoHome);
  currentServoAngle = servoHome;
  delay(servoSettleMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// E-stop check — call frequently during motion.
// Returns true if an E-stop was triggered.
// ─────────────────────────────────────────────────────────────────────────────
bool checkEStop() {
  // Also check for \x18 arriving mid-motion
  if (Serial.available() > 0 && Serial.peek() == '\x18') {
    Serial.read();
    eStopFlag = true;
  }
  if (eStopFlag) {
    stepperX.stop();
    stepperY1.stop();
    stepperY2.stop();
    penUp();
    Serial.println(F("error:Emergency stop"));
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Linear move — moves all axes simultaneously with proportional speed so
// both axes arrive at the same time (correct linear interpolation).
// ─────────────────────────────────────────────────────────────────────────────
void moveLinear(float targetXMm, float targetYMm, float feedRate) {
  feedRate = constrain(feedRate, minFeedrate, maxFeedrate);

  long targetXSteps  = (long)round(targetXMm * stepsPerMmX);
  long targetYSteps  = (long)round(targetYMm * stepsPerMmY);

  long dxSteps = abs(targetXSteps  - stepperX.currentPosition());
  long dySteps = abs(targetYSteps  - stepperY1.currentPosition());
  if (dxSteps == 0 && dySteps == 0) return;

  // Convert feed rate from mm/min → mm/s → steps/s for the actual move distance
  float mmPerSec    = feedRate / 60.0f;
  float dxMm        = (float)dxSteps / stepsPerMmX;
  float dyMm        = (float)dySteps / stepsPerMmY;
  float totalDistMm = sqrt(dxMm * dxMm + dyMm * dyMm);
  if (totalDistMm <= 0.0f) return;

  float totalTimeSec = totalDistMm / mmPerSec;
  if (totalTimeSec <= 0.0f) totalTimeSec = 0.001f;

  float vX = (dxSteps > 0) ? ((float)dxSteps / totalTimeSec) : 0.0f;
  float vY = (dySteps > 0) ? ((float)dySteps / totalTimeSec) : 0.0f;
  if (vX < 1.0f && dxSteps > 0) vX = 1.0f;
  if (vY < 1.0f && dySteps > 0) vY = 1.0f;

  bool xMovingNeg = (targetXSteps < stepperX.currentPosition());
  bool yMovingNeg = (targetYSteps < stepperY1.currentPosition());

  stepperX.moveTo(targetXSteps);
  stepperY1.moveTo(targetYSteps);
  stepperY2.moveTo(targetYSteps);

  // Set speed once before the loop — resetting every iteration would cause
  // timing variance between the two mirrored Y steppers.
  stepperX.setSpeed(xMovingNeg  ? -vX : vX);
  stepperY1.setSpeed(yMovingNeg ? -vY : vY);
  stepperY2.setSpeed(yMovingNeg ? -vY : vY);

  while (stepperX.distanceToGo() != 0 ||
         stepperY1.distanceToGo() != 0 ||
         stepperY2.distanceToGo() != 0) {
    if (checkEStop()) return;
    if (stepperX.distanceToGo()  != 0) stepperX.runSpeed();
    if (stepperY1.distanceToGo() != 0) {
      stepperY1.runSpeed();
      stepperY2.runSpeed();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arc move — interpolates a circular arc as a series of short linear segments.
// offsetI / offsetJ: centre relative to start point (G2/G3 IJ mode).
// clockwise: true = G2 (CW), false = G3 (CCW).
// ─────────────────────────────────────────────────────────────────────────────
void moveArc(float endX, float endY,
             float offsetI, float offsetJ,
             bool clockwise, float feedRate) {
  float startX = (float)stepperX.currentPosition()  / stepsPerMmX;
  float startY = (float)stepperY1.currentPosition() / stepsPerMmY;

  float cx = startX + offsetI;
  float cy = startY + offsetJ;
  float r  = sqrt(offsetI * offsetI + offsetJ * offsetJ);

  // Degenerate radius — fall back to linear move
  if (r < 0.01f) {
    moveLinear(endX, endY, feedRate);
    return;
  }

  float startAngle = atan2(startY - cy, startX - cx);
  float endAngle   = atan2(endY   - cy, endX   - cx);

  // Compute sweep angle in the correct rotational direction
  float sweep;
  if (clockwise) {
    sweep = startAngle - endAngle;
    if (sweep <= 0.0f) sweep += TWO_PI;
  } else {
    sweep = endAngle - startAngle;
    if (sweep <= 0.0f) sweep += TWO_PI;
  }
  // Full-circle case: start == end
  if (fabs(endX - startX) < 0.001f && fabs(endY - startY) < 0.001f) {
    sweep = TWO_PI;
  }

  // Compute angular step from chord-error tolerance:
  //   chord ≈ r * angStep  → angStep = 2 * acos(1 - chordError/r)
  float ratio   = 1.0f - chordError / r;
  float angStep = (ratio >= 1.0f) ? 0.00873f
                                  : 2.0f * acos(constrain(ratio, -1.0f, 1.0f));
  // Clamp: 0.5 deg min (0.00873 rad) to 15 deg max (0.2618 rad)
  angStep = constrain(angStep, 0.00873f, 0.2618f);

  int numSteps = (int)(sweep / angStep);

  for (int i = 1; i <= numSteps; i++) {
    if (checkEStop()) return;
    float angle = clockwise ? (startAngle - (float)i * angStep)
                            : (startAngle + (float)i * angStep);
    moveLinear(cx + r * cos(angle), cy + r * sin(angle), feedRate);
  }
  // Final segment to exact end point
  moveLinear(endX, endY, feedRate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry output — called every 500 ms from loop()
// ─────────────────────────────────────────────────────────────────────────────
void sendTelemetry() {
  float xMm = (float)stepperX.currentPosition()  / stepsPerMmX;
  float yMm = (float)stepperY1.currentPosition() / stepsPerMmY;

  const char* state = homingMode ? "Homing" : "Idle";

  int limX = (digitalRead(PIN_X_LIMIT) == LOW) ? 1 : 0;
  int limY = (digitalRead(PIN_Y_LIMIT) == LOW) ? 1 : 0;

  Serial.print(F("[TELEMETRY] X:"));
  Serial.print(xMm, 3);
  Serial.print(F(" Y:"));
  Serial.print(yMm, 3);
  Serial.print(F(" State:"));
  Serial.print(state);
  Serial.print(F(" F:"));
  Serial.print(currentFeedRate, 1);
  Serial.print(F(" Servo:"));
  Serial.print(currentServoAngle);
  Serial.print(F(" LimX:"));
  Serial.print(limX);
  Serial.print(F(" LimY:"));
  Serial.println(limY);
}

// ─────────────────────────────────────────────────────────────────────────────
// $? — print all config values, end with "ok"
// ─────────────────────────────────────────────────────────────────────────────
void printConfig() {
  Serial.print(F("$SPR="));   Serial.println(stepsPerRev);
  Serial.print(F("$MS="));    Serial.println(microsteps);
  Serial.print(F("$LP="));    Serial.println(leadScrewPitchMm, 3);
  Serial.print(F("$MF="));    Serial.println(maxFeedrate, 1);
  Serial.print(F("$MINF="));  Serial.println(minFeedrate, 1);
  Serial.print(F("$HF="));    Serial.println(homingFeedrate, 1);
  Serial.print(F("$HB="));    Serial.println(homingBackoffMm, 3);
  Serial.print(F("$SU="));    Serial.println(servoPenUp);
  Serial.print(F("$SD="));    Serial.println(servoPenDown);
  Serial.print(F("$SH="));    Serial.println(servoHome);
  Serial.print(F("$ST="));    Serial.println(servoSettleMs);
  Serial.print(F("$CE="));    Serial.println(chordError, 3);
  Serial.print(F("$HOMING=")); Serial.println(homingMode ? 1 : 0);
  Serial.println(F("ok"));
}

// ─────────────────────────────────────────────────────────────────────────────
// ? — status query
// ─────────────────────────────────────────────────────────────────────────────
void printStatus() {
  float xMm = (float)stepperX.currentPosition()  / stepsPerMmX;
  float yMm = (float)stepperY1.currentPosition() / stepsPerMmY;
  Serial.print(F("X:"));
  Serial.print(xMm, 3);
  Serial.print(F(" Y:"));
  Serial.println(yMm, 3);
  Serial.println(homingMode ? F("State:Homing") : F("State:Idle"));
  Serial.println(F("ok"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle $KEY=VALUE runtime config command
// ─────────────────────────────────────────────────────────────────────────────
void handleConfigSet(String line) {
  // line is "$KEY=VALUE"
  int eqIdx = line.indexOf('=');
  if (eqIdx < 0) {
    Serial.println(F("error:Invalid config syntax. Use $KEY=VALUE"));
    return;
  }
  String key   = line.substring(1, eqIdx);  // strip leading $
  String value = line.substring(eqIdx + 1);
  key.trim();
  value.trim();

  bool known = true;

  if (key.equalsIgnoreCase("SPR")) {
    stepsPerRev = value.toInt();
    recomputeDerived();
  } else if (key.equalsIgnoreCase("MS")) {
    microsteps = value.toInt();
    recomputeDerived();
  } else if (key.equalsIgnoreCase("LP")) {
    leadScrewPitchMm = value.toFloat();
    recomputeDerived();
  } else if (key.equalsIgnoreCase("MF")) {
    maxFeedrate = value.toFloat();
    recomputeDerived();
  } else if (key.equalsIgnoreCase("MINF")) {
    minFeedrate = value.toFloat();
    recomputeDerived();
  } else if (key.equalsIgnoreCase("HF")) {
    homingFeedrate = value.toFloat();
  } else if (key.equalsIgnoreCase("HB")) {
    homingBackoffMm = value.toFloat();
  } else if (key.equalsIgnoreCase("SU")) {
    servoPenUp = value.toInt();
  } else if (key.equalsIgnoreCase("SD")) {
    servoPenDown = value.toInt();
  } else if (key.equalsIgnoreCase("SH")) {
    servoHome = value.toInt();
  } else if (key.equalsIgnoreCase("ST")) {
    servoSettleMs = value.toInt();
  } else if (key.equalsIgnoreCase("HOMING")) {
    homingMode = (value.toInt() == 1);
    if (homingMode) eStopFlag = false;  // clear E-stop when entering homing mode
  } else if (key.equalsIgnoreCase("CE")) {
    chordError = constrain(value.toFloat(), 0.01f, 2.0f);
  } else {
    Serial.print(F("error:Unknown config key $"));
    Serial.println(key);
    known = false;
  }

  if (known) Serial.println(F("ok"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Strip inline G-code comments:
//   ; to end-of-line
//   (...) block comments
// ─────────────────────────────────────────────────────────────────────────────
String stripComments(String line) {
  int semiIdx = line.indexOf(';');
  if (semiIdx >= 0) line = line.substring(0, semiIdx);

  while (true) {
    int openIdx  = line.indexOf('(');
    int closeIdx = line.indexOf(')');
    if (openIdx < 0 || closeIdx <= openIdx) break;
    line = line.substring(0, openIdx) + line.substring(closeIdx + 1);
  }

  line.trim();
  return line;
}

// ─────────────────────────────────────────────────────────────────────────────
// Process a fully-parsed G/M code command (GCode object already populated)
// ─────────────────────────────────────────────────────────────────────────────
void processParsedGCode() {
  if (!GCode.HasWord('G') && !GCode.HasWord('M')) {
    Serial.println(F("ok"));
    return;
  }

  if (GCode.HasWord('G')) {
    int gCommand = (int)GCode.GetWordValue('G');

    switch (gCommand) {

      case 0:
      case 1: {
        if (GCode.HasWord('F')) {
          float f = GCode.GetWordValue('F');
          if (f > 0.0f) currentFeedRate = constrain(f, minFeedrate, maxFeedrate);
        }
        float tX = (float)stepperX.currentPosition()  / stepsPerMmX;
        float tY = (float)stepperY1.currentPosition() / stepsPerMmY;
        if (isAbsoluteMode) {
          if (GCode.HasWord('X')) tX = GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) tY = GCode.GetWordValue('Y');
        } else {
          if (GCode.HasWord('X')) tX += GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) tY += GCode.GetWordValue('Y');
        }
        moveLinear(tX, tY, currentFeedRate);
        Serial.println(F("ok"));
        break;
      }

      case 2:
      case 3: {
        if (GCode.HasWord('F')) {
          float f = GCode.GetWordValue('F');
          if (f > 0.0f) currentFeedRate = constrain(f, minFeedrate, maxFeedrate);
        }
        float sX = (float)stepperX.currentPosition()  / stepsPerMmX;
        float sY = (float)stepperY1.currentPosition() / stepsPerMmY;
        float eX = sX, eY = sY;
        float oI = 0.0f, oJ = 0.0f;

        if (isAbsoluteMode) {
          if (GCode.HasWord('X')) eX = GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) eY = GCode.GetWordValue('Y');
        } else {
          if (GCode.HasWord('X')) eX += GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) eY += GCode.GetWordValue('Y');
        }

        if (GCode.HasWord('R')) {
          float R  = GCode.GetWordValue('R');
          float dx = eX - sX, dy = eY - sY;
          float d  = sqrt(dx * dx + dy * dy);
          if (d < 0.001f || fabs(R) < d / 2.0f) {
            Serial.println(F("error:Invalid arc radius"));
            return;
          }
          float h    = sqrt(R * R - (d / 2.0f) * (d / 2.0f));
          float mx   = (sX + eX) / 2.0f;
          float my   = (sY + eY) / 2.0f;
          float px   = -dy / d;
          float py   =  dx / d;
          float sign = (gCommand == 2) ? 1.0f : -1.0f;
          if (R < 0.0f) sign = -sign;
          oI = mx + sign * h * px - sX;
          oJ = my + sign * h * py - sY;
        } else {
          if (GCode.HasWord('I')) oI = GCode.GetWordValue('I');
          if (GCode.HasWord('J')) oJ = GCode.GetWordValue('J');
        }

        moveArc(eX, eY, oI, oJ, gCommand == 2, currentFeedRate);
        Serial.println(F("ok"));
        break;
      }

      case 4: {
        if (GCode.HasWord('P')) {
          delay((unsigned long)GCode.GetWordValue('P'));
        }
        Serial.println(F("ok"));
        break;
      }

      case 21:
        // mm mode — firmware is always mm
        Serial.println(F("ok"));
        break;

      case 28:
        // Home acknowledged; actual homing is app-orchestrated
        Serial.println(F("ok"));
        break;

      case 90:
        isAbsoluteMode = true;
        Serial.println(F("ok"));
        break;

      case 91:
        isAbsoluteMode = false;
        Serial.println(F("ok"));
        break;

      case 92: {
        bool hasX = GCode.HasWord('X');
        bool hasY = GCode.HasWord('Y');
        if (!hasX && !hasY) {
          stepperX.setCurrentPosition(0);
          stepperY1.setCurrentPosition(0);
          stepperY2.setCurrentPosition(0);
        } else {
          if (hasX) {
            long xSteps = (long)round(GCode.GetWordValue('X') * stepsPerMmX);
            stepperX.setCurrentPosition(xSteps);
          }
          if (hasY) {
            long ySteps = (long)round(GCode.GetWordValue('Y') * stepsPerMmY);
            stepperY1.setCurrentPosition(ySteps);
            stepperY2.setCurrentPosition(ySteps);
          }
        }
        Serial.println(F("ok"));
        break;
      }

      default:
        Serial.print(F("error:Unsupported G"));
        Serial.println(gCommand);
        break;
    }
    return;
  }

  if (GCode.HasWord('M')) {
    int mCommand = (int)GCode.GetWordValue('M');

    switch (mCommand) {

      case 0:
        // Pause — app handles the streaming pause
        Serial.println(F("ok"));
        break;

      case 3:
        // Pen down; optional S angle
        if (GCode.HasWord('S')) {
          int angle = (int)GCode.GetWordValue('S');
          servo.write(angle);
          currentServoAngle = angle;
          delay(servoSettleMs);
        } else {
          penDown();
        }
        Serial.println(F("ok"));
        break;

      case 5:
        penUp();
        Serial.println(F("ok"));
        break;

      case 280:
        // Set servo to explicit angle
        if (GCode.HasWord('S')) {
          int angle = (int)GCode.GetWordValue('S');
          servo.write(angle);
          currentServoAngle = angle;
          delay(servoSettleMs);
        }
        Serial.println(F("ok"));
        break;

      default:
        Serial.print(F("error:Unsupported M"));
        Serial.println(mCommand);
        break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main G-code line processor
// ─────────────────────────────────────────────────────────────────────────────
void processLine(String line) {
  line.trim();
  if (line.length() == 0) return;

  // Emergency stop (\x18 = Ctrl-X)
  if (line.charAt(0) == '\x18') {
    eStopFlag = true;
    checkEStop();
    Serial.println(F("ok"));
    return;
  }

  // Feed hold
  if (line == "!") {
    Serial.println(F("ok"));
    return;
  }

  // Cycle start / resume
  if (line == "~") {
    Serial.println(F("ok"));
    return;
  }

  // Status query
  if (line == "?") {
    printStatus();
    return;
  }

  // Print all config
  if (line == "$?") {
    printConfig();
    return;
  }

  // Runtime config set: $KEY=VALUE
  if (line.charAt(0) == '$' && line.indexOf('=') > 0) {
    handleConfigSet(line);
    return;
  }

  // Strip comments before feeding to parser
  line = stripComments(line);
  if (line.length() == 0) {
    Serial.println(F("ok"));
    return;
  }

  // Feed cleaned line to GCodeParser
  for (int i = 0; i < (int)line.length(); i++) {
    GCode.AddCharToLine(line.charAt(i));
  }
  if (GCode.AddCharToLine('\n')) {
    GCode.ParseLine();
    processParsedGCode();
  } else {
    Serial.println(F("error:Parser line handling failed"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Limit switch ISRs (FALLING edge on INPUT_PULLUP pins)
// ─────────────────────────────────────────────────────────────────────────────
void xLimitISR() {
  if (homingMode) {
    stepperX.stop();
    Serial.println(F("x stop triggered"));
  } else {
    eStopFlag = true;
  }
}

void yLimitISR() {
  if (homingMode) {
    stepperY1.stop();
    stepperY2.stop();
    Serial.println(F("y stop triggered"));
  } else {
    eStopFlag = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arduino setup()
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  // Shared enable pin — active LOW (motors on)
  pinMode(PIN_ENABLE, OUTPUT);
  digitalWrite(PIN_ENABLE, LOW);

  // Limit switches — INPUT_PULLUP, trigger on FALLING
  pinMode(PIN_X_LIMIT, INPUT_PULLUP);
  pinMode(PIN_Y_LIMIT, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_X_LIMIT), xLimitISR, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_Y_LIMIT), yLimitISR, FALLING);

  // Stepper configuration
  // All directions inverted: motors were wired backwards on the physical machine.
  stepperX.setPinsInverted(true, false, false);
  stepperY1.setPinsInverted(true, false, false);
  stepperY2.setPinsInverted(true, false, false);

  // Compute derived speed/accel values from config defaults
  recomputeDerived();

  steppers.addStepper(stepperX);
  steppers.addStepper(stepperY1);
  steppers.addStepper(stepperY2);

  // Servo — home position on startup
  servo.attach(PIN_SERVO);
  servo.write(servoHome);
  currentServoAngle = servoHome;
  delay(servoSettleMs);

  Serial.println(F("CNC Firmware Ready"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Arduino loop()
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
  // Periodic telemetry
  unsigned long now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    sendTelemetry();
  }

  // Serial input — accumulate into inputBuffer, dispatch on newline
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\x18') {
      // Inline emergency stop: handle immediately even mid-line
      eStopFlag = true;
      checkEStop();
      inputBuffer = "";
    } else if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        processLine(inputBuffer);
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
    }
  }
}
