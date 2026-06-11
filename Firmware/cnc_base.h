/**
 * =============================================================================
 *  cnc_base.h — Shared Motion Core
 * =============================================================================
 *
 *  Included by Pen_Firmware, Drill_Firmware, and Laser_Firmware.
 *  Contains:
 *    - Pin map (X/Y steppers, enable, limit switches)
 *    - Motion config variables
 *    - AccelStepper / MultiStepper objects
 *    - Serial parsing, telemetry, homing, soft-limit logic
 *    - G0/G1/G2/G3/G4/G90/G91/G92/G28 processing
 *    - $KEY=VALUE runtime config
 *
 *  Each mode firmware supplies its own:
 *    - Z-actuator pins and variables
 *    - handleToolOn(sValue) / handleToolOff() / handleToolSet(sValue)
 *    - setupTool() called from setup()
 *    - reportToolState(Serial) for telemetry
 *    - mode-specific $KEY handlers via processModeCfgKey(key, val) → bool
 *
 * =============================================================================
 */

#pragma once

#include <AccelStepper.h>
#include <MultiStepper.h>
#include <GCodeParser.h>

// ---------------------------------------------------------------------------
//  PIN MAP — XY motion (shared by all modes)
// ---------------------------------------------------------------------------
#define Y1_STEP_PIN    6
#define Y1_DIR_PIN     7
#define Y2_STEP_PIN    4
#define Y2_DIR_PIN     5
#define X_STEP_PIN     2
#define X_DIR_PIN      3
#define ENABLE_PIN     8   // Shared enable for all stepper drivers
#define X_MIN_PIN      19  // INPUT_PULLUP
#define Y_MIN_PIN      18  // INPUT_PULLUP

// ---------------------------------------------------------------------------
//  MOTION CONFIGURATION — runtime mutable via $KEY=VALUE
// ---------------------------------------------------------------------------
float motorStepsPerRev = 200.0;
float microsteps       = 16.0;
float leadScrewPitchMm = 8.0;

float stepsPerMmX = 0.0;
float stepsPerMmY = 0.0;

float currentFeedRate  = 1200.0;
float maxFeedrate      = 3000.0;
float minFeedrate      = 10.0;
float homingFeedrate   = 600.0;
float homingBackoffMm  = 2.0;

// ---------------------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------------------
bool isAbsoluteMode = true;
bool homingMode     = false;
bool clientConnected = false;
String inputBuffer  = "";

unsigned long lastTelemetryTime     = 0;
const unsigned long telemetryInterval = 500;

// ---------------------------------------------------------------------------
//  LIBRARY OBJECTS
// ---------------------------------------------------------------------------
AccelStepper stepperY1(AccelStepper::DRIVER, Y1_STEP_PIN, Y1_DIR_PIN);
AccelStepper stepperY2(AccelStepper::DRIVER, Y2_STEP_PIN, Y2_DIR_PIN);
AccelStepper stepperX (AccelStepper::DRIVER, X_STEP_PIN,  X_DIR_PIN);
MultiStepper steppers;
GCodeParser GCode = GCodeParser();

// ---------------------------------------------------------------------------
//  FORWARD DECLARATIONS (implemented in this header)
// ---------------------------------------------------------------------------
void recalcStepsPerMm();
void processLine(String rawCmd);
void processParsedGCode();
void processBaseCfgCommand(String cmd);
void reportPosition();
void reportTelemetry();
void moveLinear(float targetXMm, float targetYMm, float feedRate);
void moveArc(float targetXMm, float targetYMm, float iMm, float jMm, bool clockwise, float feedRate);
bool checkEStop();

// These must be defined by the mode firmware:
void setupTool();
void handleToolOn(int sValue);
void handleToolOff();
void handleToolSet(int sValue);
void reportToolState();          // prints " <key>:<val>" — no newline, used in telemetry
bool processModeCfgKey(String key, float val); // return true if key was handled

// Optional hooks called around G0 rapid moves (laser mode uses these to gate laser power)
// Pen/Drill provide empty implementations; Laser provides gating implementations.
void beforeG0() __attribute__((weak));
void afterG0()  __attribute__((weak));
void beforeG0() {}   // default: no-op
void afterG0()  {}   // default: no-op

// ---------------------------------------------------------------------------
//  GEOMETRY RECALCULATION
// ---------------------------------------------------------------------------
void recalcStepsPerMm() {
  if (leadScrewPitchMm <= 0.0) leadScrewPitchMm = 8.0;
  if (motorStepsPerRev <= 0.0) motorStepsPerRev  = 200.0;
  if (microsteps       <= 0.0) microsteps        = 16.0;

  stepsPerMmX = (motorStepsPerRev * microsteps) / leadScrewPitchMm;
  stepsPerMmY = stepsPerMmX;

  if (minFeedrate <= 0.0)             minFeedrate = 1.0;
  if (maxFeedrate < minFeedrate)      maxFeedrate = minFeedrate;
  currentFeedRate = constrain(currentFeedRate, minFeedrate, maxFeedrate);

  float maxSpsX = (maxFeedrate / 60.0) * stepsPerMmX;
  float maxSpsY = (maxFeedrate / 60.0) * stepsPerMmY;

  stepperY1.setMaxSpeed(maxSpsY);
  stepperY2.setMaxSpeed(maxSpsY);
  stepperX.setMaxSpeed(maxSpsX);

  stepperY1.setAcceleration(maxSpsY * 2.0);
  stepperY2.setAcceleration(maxSpsY * 2.0);
  stepperX.setAcceleration(maxSpsX * 2.0);
}

// ---------------------------------------------------------------------------
//  BASE SETUP — call from mode firmware's setup()
// ---------------------------------------------------------------------------
const char* currentFirmwareBanner = "";

void baseSetup(const char* firmwareBanner) {
  Serial.begin(115200);
  delay(100);

  currentFirmwareBanner = firmwareBanner;

  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, LOW);

  pinMode(X_MIN_PIN, INPUT_PULLUP);
  pinMode(Y_MIN_PIN, INPUT_PULLUP);

  stepperY1.setPinsInverted(true, false, false);
  stepperY2.setPinsInverted(true, false, false);
  stepperX.setPinsInverted(true, false, false);

  steppers.addStepper(stepperY1);
  steppers.addStepper(stepperX);
  steppers.addStepper(stepperY2);

  recalcStepsPerMm();
}

// ---------------------------------------------------------------------------
//  BASE LOOP — call from mode firmware's loop()
// ---------------------------------------------------------------------------
void baseLoop() {
  while (Serial.available() > 0) {
    if (!clientConnected) {
      clientConnected = true; // Connection established when client sends anything
      Serial.println(currentFirmwareBanner);
      reportPosition();
    }
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        processLine(inputBuffer);
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
    }
  }
  if (clientConnected && millis() - lastTelemetryTime >= telemetryInterval) {
    reportTelemetry();
    lastTelemetryTime = millis();
  }
}

// ---------------------------------------------------------------------------
//  EMERGENCY STOP CHECK
// ---------------------------------------------------------------------------
bool checkEStop() {
  if (Serial.available() > 0) {
    char c = Serial.peek();
    if (c == '\x18') {
      Serial.read();
      stepperY1.stop();
      stepperY2.stop();
      stepperX.stop();
      handleToolOff();
      homingMode = false;
      Serial.println("error:Emergency Stop triggered! Motor stopped.");
      inputBuffer = "";
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
//  POSITION / TELEMETRY REPORTING
// ---------------------------------------------------------------------------
void reportPosition() {
  float cx = (float)stepperX.currentPosition() / stepsPerMmX;
  float cy = (float)stepperY1.currentPosition() / stepsPerMmY;
  Serial.print("X:"); Serial.print(cx, 2);
  Serial.print(" Y:"); Serial.println(cy, 2);
}

void reportTelemetry() {
  float cx = (float)stepperX.currentPosition() / stepsPerMmX;
  float cy = (float)stepperY1.currentPosition() / stepsPerMmY;

  Serial.print("[TELEMETRY] X:"); Serial.print(cx, 2);
  Serial.print(" Y:"); Serial.print(cy, 2);
  Serial.print(" State:"); Serial.print(isAbsoluteMode ? "Abs" : "Rel");
  Serial.print(" F:"); Serial.print(currentFeedRate, 0);
  reportToolState();   // mode firmware appends e.g. " Servo:75" or " Laser:200"
  Serial.print(" LimX:"); Serial.print(digitalRead(X_MIN_PIN));
  Serial.print(" LimY:"); Serial.println(digitalRead(Y_MIN_PIN));
}

// ---------------------------------------------------------------------------
//  MOTION
// ---------------------------------------------------------------------------
void moveLinear(float targetXMm, float targetYMm, float feedRate) {
  long positions[3];
  positions[0] = round(targetYMm * stepsPerMmY); // Y1
  positions[1] = round(targetXMm * stepsPerMmX); // X
  positions[2] = positions[0];                   // Y2 mirrors Y1

  long currentXSteps = stepperX.currentPosition();
  long currentYSteps = stepperY1.currentPosition();

  long dxSteps = abs(positions[1] - currentXSteps);
  long dySteps = abs(positions[0] - currentYSteps);
  if (dxSteps == 0 && dySteps == 0) return;

  feedRate = constrain(feedRate, minFeedrate, maxFeedrate);
  float mmPerSec = feedRate / 60.0;
  if (mmPerSec <= 0.0) mmPerSec = 1.0;

  float dxMm = (float)dxSteps / stepsPerMmX;
  float dyMm = (float)dySteps / stepsPerMmY;
  float totalDistanceMm = sqrt(dxMm * dxMm + dyMm * dyMm);
  if (totalDistanceMm <= 0.0) return;

  float totalTimeSec = totalDistanceMm / mmPerSec;
  if (totalTimeSec <= 0.0) totalTimeSec = 0.001;

  float requiredSpsX = (float)dxSteps / totalTimeSec;
  float requiredSpsY = (float)dySteps / totalTimeSec;
  float vX = requiredSpsX > 1.0 ? requiredSpsX : 1.0;
  float vY = requiredSpsY > 1.0 ? requiredSpsY : 1.0;

  bool xMovingMin = positions[1] < currentXSteps;
  bool yMovingMin = positions[0] < currentYSteps;

  stepperX.moveTo(positions[1]);
  stepperY1.moveTo(positions[0]);
  stepperY2.moveTo(positions[2]);

  // Set cruise speed once, before the loop. AccelStepper::setSpeed() recomputes
  // _stepInterval via floating-point division on every call; calling it on every
  // loop iteration adds timing variance between the two mirrored Y steppers
  // (which are rigidly coupled through the gantry — drift between them shows up
  // as binding/jitter). The speed is constant for the whole linear move, so it
  // only needs to be set once here.
  stepperX.setSpeed(xMovingMin ? -vX : vX);
  stepperY1.setSpeed(yMovingMin ? -vY : vY);
  stepperY2.setSpeed(yMovingMin ? -vY : vY);

  bool xHomingDone = false;
  bool yHomingDone = false;

  while (stepperX.distanceToGo() != 0 || stepperY1.distanceToGo() != 0) {
    if (checkEStop()) break;

    if (xMovingMin && digitalRead(X_MIN_PIN) == HIGH) {
      if (homingMode && !xHomingDone) {
        xHomingDone = true;
        stepperX.setCurrentPosition(0);
        stepperX.setSpeed(0);
        Serial.println("x stop triggered");
      } else if (!homingMode) {
        Serial.println("error:Hard limit X triggered! Motor stopped.");
        stepperX.stop(); stepperY1.stop(); stepperY2.stop();
        break;
      }
    }
    if (yMovingMin && digitalRead(Y_MIN_PIN) == HIGH) {
      if (homingMode && !yHomingDone) {
        yHomingDone = true;
        stepperY1.setCurrentPosition(0);
        stepperY2.setCurrentPosition(0);
        stepperY1.setSpeed(0); stepperY2.setSpeed(0);
        Serial.println("y stop triggered");
      } else if (!homingMode) {
        Serial.println("error:Hard limit Y triggered! Motor stopped.");
        stepperX.stop(); stepperY1.stop(); stepperY2.stop();
        break;
      }
    }

    if (stepperX.distanceToGo() != 0) stepperX.runSpeed();
    if (stepperY1.distanceToGo() != 0) {
      stepperY1.runSpeed();
      stepperY2.runSpeed();
    }
    // NOTE: telemetry is intentionally NOT reported from inside this loop.
    // Serial.print() on AVR blocks once the ~64-byte hardware TX buffer fills,
    // and a full [TELEMETRY] line is longer than that buffer — so reporting
    // here stalled runSpeed() for both Y steppers for a few ms every 500 ms,
    // which presented as periodic motion jitter. reportPosition() below already
    // updates the app at the end of every line, and baseLoop() resumes
    // autonomous telemetry the instant the machine goes idle.
  }

  float maxSpsX = (maxFeedrate / 60.0) * stepsPerMmX;
  float maxSpsY = (maxFeedrate / 60.0) * stepsPerMmY;
  stepperY1.setMaxSpeed(maxSpsY); stepperY2.setMaxSpeed(maxSpsY);
  stepperX.setMaxSpeed(maxSpsX);

  reportPosition();
}

// ---------------------------------------------------------------------------
//  ARC INTERPOLATION (G2 / G3)
// ---------------------------------------------------------------------------
// AccelStepper has no native arc support, so we tessellate the arc into small
// linear chord segments and call moveLinear() for each one.
//
// Parameters (all in machine mm, absolute coordinates):
//   targetXMm / targetYMm : arc endpoint
//   iMm / jMm             : offset from arc START to arc CENTER
//   clockwise             : true = G2 (CW), false = G3 (CCW)
// ---------------------------------------------------------------------------
void moveArc(float targetXMm, float targetYMm, float iMm, float jMm, bool clockwise, float feedRate) {
  float startX = (float)stepperX.currentPosition()  / stepsPerMmX;
  float startY = (float)stepperY1.currentPosition() / stepsPerMmY;

  float cx = startX + iMm;   // absolute center X
  float cy = startY + jMm;   // absolute center Y

  float r = sqrt(iMm * iMm + jMm * jMm);
  if (r < 0.001) {
    // Degenerate arc — fall back to straight line
    moveLinear(targetXMm, targetYMm, feedRate);
    return;
  }

  float startAngle = atan2(startY  - cy, startX  - cx);
  float endAngle   = atan2(targetYMm - cy, targetXMm - cx);

  // Compute the signed angular sweep
  float sweep;
  if (clockwise) {
    sweep = endAngle - startAngle;
    if (sweep >= 0.0) sweep -= 2.0 * M_PI;   // ensure CW (negative)
  } else {
    sweep = endAngle - startAngle;
    if (sweep <= 0.0) sweep += 2.0 * M_PI;   // ensure CCW (positive)
  }

  // Segment size: chord length ~0.5 mm for smooth curves
  // Number of steps = |sweep| * r / chord_length, minimum 1
  const float CHORD_MM = 0.5;
  int steps = max(1, (int)(fabs(sweep) * r / CHORD_MM));

  for (int k = 1; k <= steps; k++) {
    if (checkEStop()) return;
    float angle = startAngle + sweep * ((float)k / (float)steps);
    float sx = cx + r * cos(angle);
    float sy = cy + r * sin(angle);
    // Snap the last step to the exact commanded endpoint to avoid accumulation error
    if (k == steps) { sx = targetXMm; sy = targetYMm; }
    moveLinear(sx, sy, feedRate);
  }
}

// ---------------------------------------------------------------------------
//  G-CODE PROCESSING
// ---------------------------------------------------------------------------
void processParsedGCode() {
  if (!GCode.HasWord('G') && !GCode.HasWord('M')) {
    Serial.println("ok");
    return;
  }

  if (GCode.HasWord('G')) {
    int gCommand = (int)GCode.GetWordValue('G');
    switch (gCommand) {
      case 0:
      case 1: {
        if (GCode.HasWord('F')) {
          float f = GCode.GetWordValue('F');
          if (f > 0.0) currentFeedRate = constrain(f, minFeedrate, maxFeedrate);
        }
        float targetX = (float)stepperX.currentPosition() / stepsPerMmX;
        float targetY = (float)stepperY1.currentPosition() / stepsPerMmY;
        if (isAbsoluteMode) {
          if (GCode.HasWord('X')) targetX = GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) targetY = GCode.GetWordValue('Y');
        } else {
          if (GCode.HasWord('X')) targetX += GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) targetY += GCode.GetWordValue('Y');
        }
        // G0 rapid moves: call beforeG0/afterG0 hooks so laser mode can gate power
        if (gCommand == 0) beforeG0();
        moveLinear(targetX, targetY, currentFeedRate);
        if (gCommand == 0) afterG0();
        Serial.println("ok");
        break;
      }
      case 2:
      case 3: {
        // G2 = clockwise arc, G3 = counter-clockwise arc
        // I/J = offset from current position to arc center
        if (GCode.HasWord('F')) {
          float f = GCode.GetWordValue('F');
          if (f > 0.0) currentFeedRate = constrain(f, minFeedrate, maxFeedrate);
        }
        float targetX = (float)stepperX.currentPosition()  / stepsPerMmX;
        float targetY = (float)stepperY1.currentPosition() / stepsPerMmY;
        if (isAbsoluteMode) {
          if (GCode.HasWord('X')) targetX = GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) targetY = GCode.GetWordValue('Y');
        } else {
          if (GCode.HasWord('X')) targetX += GCode.GetWordValue('X');
          if (GCode.HasWord('Y')) targetY += GCode.GetWordValue('Y');
        }
        float iOff = GCode.HasWord('I') ? GCode.GetWordValue('I') : 0.0;
        float jOff = GCode.HasWord('J') ? GCode.GetWordValue('J') : 0.0;
        moveArc(targetX, targetY, iOff, jOff, gCommand == 2, currentFeedRate);
        Serial.println("ok");
        break;
      }
      case 4: {
        if (GCode.HasWord('P')) {
          int delayMs = (int)GCode.GetWordValue('P');
          if (delayMs > 0) delay(delayMs);
        }
        Serial.println("ok");
        break;
      }
      case 21: Serial.println("ok"); break; // mm mode (always mm)
      case 28: Serial.println("ok"); break; // home (app-orchestrated)
      case 90: isAbsoluteMode = true;  Serial.println("ok"); break;
      case 91: isAbsoluteMode = false; Serial.println("ok"); break;
      case 92: {
        bool hasX = GCode.HasWord('X');
        bool hasY = GCode.HasWord('Y');
        if (!hasX && !hasY) {
          stepperY1.setCurrentPosition(0);
          stepperY2.setCurrentPosition(0);
          stepperX.setCurrentPosition(0);
        } else {
          if (hasX) {
            long xSteps = round(GCode.GetWordValue('X') * stepsPerMmX);
            stepperX.setCurrentPosition(xSteps);
          }
          if (hasY) {
            long ySteps = round(GCode.GetWordValue('Y') * stepsPerMmY);
            stepperY1.setCurrentPosition(ySteps);
            stepperY2.setCurrentPosition(ySteps);
          }
        }
        reportPosition();
        Serial.println("ok");
        break;
      }
      default: Serial.println("ok"); break;
    }
    return;
  }

  if (GCode.HasWord('M')) {
    int mCommand = (int)GCode.GetWordValue('M');
    int sValue = GCode.HasWord('S') ? (int)GCode.GetWordValue('S') : -1;
    switch (mCommand) {
      case 3:  handleToolOn(sValue);  Serial.println("ok"); break;
      case 4:  handleToolOn(sValue);  Serial.println("ok"); break; // dynamic — mode handles
      case 5:  handleToolOff();       Serial.println("ok"); break;
      case 280: handleToolSet(sValue); Serial.println("ok"); break;
      default: Serial.println("ok"); break;
    }
  }
}

// ---------------------------------------------------------------------------
//  COMMAND DISPATCH
// ---------------------------------------------------------------------------
void processLine(String rawCmd) {
  String cmd = rawCmd;
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.length() == 0) return;

  if (cmd.charAt(0) == ';' || cmd.charAt(0) == '(') {
    Serial.println("ok");
    return;
  }
  if (cmd == "\x18") {
    stepperY1.stop(); stepperY2.stop(); stepperX.stop();
    handleToolOff();
    homingMode = false;
    Serial.println("error:Emergency Stop triggered! Motor stopped.");
    return;
  }
  if (cmd == "!" || cmd == "~") { Serial.println("ok"); return; }

  if (cmd == "?") {
    reportPosition();
    Serial.print("State:"); Serial.print(isAbsoluteMode ? "Abs" : "Rel");
    Serial.print(" F:"); Serial.print(currentFeedRate, 0);
    reportToolState();
    Serial.print(" LimX:"); Serial.print(digitalRead(X_MIN_PIN));
    Serial.print(" LimY:"); Serial.println(digitalRead(Y_MIN_PIN));
    Serial.println("ok");
    return;
  }

  if (cmd.startsWith("$")) {
    processBaseCfgCommand(cmd);
    return;
  }

  for (int i = 0; i < cmd.length(); i++) GCode.AddCharToLine(cmd.charAt(i));
  if (GCode.AddCharToLine('\n')) {
    GCode.ParseLine();
    processParsedGCode();
  } else {
    Serial.println("error:Parser line handling failed");
  }
}

// ---------------------------------------------------------------------------
//  BASE CONFIG COMMANDS ($KEY=VALUE)
// ---------------------------------------------------------------------------
void processBaseCfgCommand(String cmd) {
  if (cmd == "$?") {
    Serial.print("$SPR=");    Serial.println(motorStepsPerRev, 0);
    Serial.print("$MS=");     Serial.println(microsteps, 0);
    Serial.print("$LP=");     Serial.println(leadScrewPitchMm, 3);
    Serial.print("$STEPS_MM="); Serial.println(stepsPerMmX, 3);
    Serial.print("$MF=");     Serial.println(maxFeedrate, 0);
    Serial.print("$MINF=");   Serial.println(minFeedrate, 0);
    Serial.print("$HF=");     Serial.println(homingFeedrate, 0);
    Serial.print("$HB=");     Serial.println(homingBackoffMm, 3);
    Serial.print("$HOMING="); Serial.println(homingMode ? 1 : 0);
    Serial.println("ok");
    return;
  }

  int eqIdx = cmd.indexOf('=');
  if (eqIdx == -1) {
    Serial.println("error:Invalid config syntax. Use $KEY=VALUE");
    return;
  }
  String key = cmd.substring(1, eqIdx);
  float val  = cmd.substring(eqIdx + 1).toFloat();

  // Let the mode firmware handle its own keys first
  if (processModeCfgKey(key, val)) {
    Serial.println("ok");
    return;
  }

  if      (key == "MS")     { microsteps = val;        recalcStepsPerMm(); }
  else if (key == "SPR")    { motorStepsPerRev = val;  recalcStepsPerMm(); }
  else if (key == "LP")     { leadScrewPitchMm = val;  recalcStepsPerMm(); }
  else if (key == "MF")     { maxFeedrate = val;       recalcStepsPerMm(); }
  else if (key == "MINF")   { minFeedrate = val;       recalcStepsPerMm(); }
  else if (key == "HF")     { homingFeedrate = val; }
  else if (key == "HB")     { homingBackoffMm = val; }
  else if (key == "HOMING") { homingMode = (val != 0); }
  else {
    Serial.print("error:Unknown config key: ");
    Serial.println(key);
    return;
  }
  Serial.println("ok");
}
