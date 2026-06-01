/**
 * =============================================================================
 *  Main Firmware - G-Code Interpreter for 3-Axis CNC Plotter
 * =============================================================================
 *
 *  BOARD: Arduino Mega 2560
 *
 *  MERGED DESIGN:
 *    - Motion core uses AccelStepper + MultiStepper (upstream change)
 *    - Parsing core uses GCodeParser for G/M words (upstream change)
 *    - Runtime controls kept from local work:
 *      * $? / $KEY=VALUE configuration commands
 *      * ? machine status query
 *      * G92 work-origin command
 *      * M3/M5/M280 servo controls
 *
 * =============================================================================
 */

#include <Servo.h>
#include <AccelStepper.h>
#include <MultiStepper.h>
#include <GCodeParser.h>

// ---------------------------------------------------------------------------
//  PIN MAP
// ---------------------------------------------------------------------------
#define Y1_STEP_PIN    6
#define Y1_DIR_PIN     7

#define Y2_STEP_PIN    4
#define Y2_DIR_PIN     5

#define X_STEP_PIN     2
#define X_DIR_PIN      3

#define ENABLE_PIN     8 // Shared enable for all drivers

#define Z_SERVO_PIN    9
#define X_MIN_PIN      19
#define Y_MIN_PIN      18

// ---------------------------------------------------------------------------
//  MACHINE CONFIGURATION (runtime mutable via $ commands)
// ---------------------------------------------------------------------------
float motorStepsPerRev = 200.0;
float microsteps = 16.0;
float leadScrewPitchMm = 8.0;

float stepsPerMmX = 0.0;
float stepsPerMmY = 0.0;

float currentFeedRate = 1200.0;
float maxFeedrate = 3000.0;
float minFeedrate = 10.0;
float homingFeedrate = 600.0;
float homingBackoffMm = 2.0;

int servoPenUp = 75;
int servoPenDown = 30;
int servoHome = 75;
int servoSettleMs = 150;

// ---------------------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------------------
Servo penServo;
int currentServoAngle = 90;
bool isAbsoluteMode = true;
String inputBuffer = "";

// ---------------------------------------------------------------------------
//  LIBRARY OBJECTS
// ---------------------------------------------------------------------------
AccelStepper stepperY1(AccelStepper::DRIVER, Y1_STEP_PIN, Y1_DIR_PIN);
AccelStepper stepperY2(AccelStepper::DRIVER, Y2_STEP_PIN, Y2_DIR_PIN);
AccelStepper stepperX(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN);
MultiStepper steppers;
GCodeParser GCode = GCodeParser();

// ---------------------------------------------------------------------------
//  FUNCTION DECLARATIONS
// ---------------------------------------------------------------------------
void recalcStepsPerMm();
void processLine(String rawCmd);
void processParsedGCode();
void processConfigCommand(String cmd);
void setServoAngle(int angle);
void reportPosition();
void moveLinear(float targetXMm, float targetYMm, float feedRate);
void homeAxis();

// ---------------------------------------------------------------------------
//  SETUP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, LOW);

  pinMode(X_MIN_PIN, INPUT_PULLUP);
  pinMode(Y_MIN_PIN, INPUT_PULLUP);

  // Invert motor directions because they were moving backwards physically
  stepperY1.setPinsInverted(false, false, false);
  stepperY2.setPinsInverted(false, false, false);
  stepperX.setPinsInverted(true, false, false);

  penServo.attach(Z_SERVO_PIN);
  setServoAngle(servoHome);

  steppers.addStepper(stepperY1);
  steppers.addStepper(stepperX);
  steppers.addStepper(stepperY2); // Add X2 third so it's at index 2

  recalcStepsPerMm();

  Serial.println("Mega 2560 CNC Controller v2.0 Ready.");
  reportPosition();
}

// ---------------------------------------------------------------------------
//  MAIN LOOP
// ---------------------------------------------------------------------------
void loop() {
  while (Serial.available() > 0) {
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
}

// ---------------------------------------------------------------------------
//  GEOMETRY + SPEED RECALCULATION
// ---------------------------------------------------------------------------
void recalcStepsPerMm() {
  if (leadScrewPitchMm <= 0.0) {
    leadScrewPitchMm = 8.0;
  }
  if (motorStepsPerRev <= 0.0) {
    motorStepsPerRev = 200.0;
  }
  if (microsteps <= 0.0) {
    microsteps = 16.0;
  }

  stepsPerMmX = (motorStepsPerRev * microsteps) / leadScrewPitchMm;
  stepsPerMmY = (motorStepsPerRev * microsteps) / leadScrewPitchMm;

  if (minFeedrate <= 0.0) minFeedrate = 1.0;
  if (maxFeedrate < minFeedrate) maxFeedrate = minFeedrate;
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
//  RAW COMMAND DISPATCH
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
    stepperY1.stop();
    stepperY2.stop();
    stepperX.stop();
    penServo.write(servoPenUp);
    currentServoAngle = servoPenUp;
    Serial.println("error:Emergency Stop triggered! Motor stopped.");
    return;
  }
  if (cmd == "!" || cmd == "~") {
    Serial.println("ok");
    return;
  }

  if (cmd == "?") {
    reportPosition();
    Serial.print("State:");
    Serial.print(isAbsoluteMode ? "Abs" : "Rel");
    Serial.print(" F:");
    Serial.print(currentFeedRate, 0);
    Serial.print(" Servo:");
    Serial.print(currentServoAngle);
    Serial.print(" LimX:");
    Serial.print(digitalRead(X_MIN_PIN));
    Serial.print(" LimY:");
    Serial.println(digitalRead(Y_MIN_PIN));
    Serial.println("ok");
    return;
  }

  if (cmd.startsWith("$")) {
    processConfigCommand(cmd);
    return;
  }

  for (int i = 0; i < cmd.length(); i++) {
    GCode.AddCharToLine(cmd.charAt(i));
  }

  if (GCode.AddCharToLine('\n')) {
    GCode.ParseLine();
    processParsedGCode();
  } else {
    Serial.println("error:Parser line handling failed");
  }
}

// ---------------------------------------------------------------------------
//  G-CODE PROCESSING (via GCodeParser)
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

        moveLinear(targetX, targetY, currentFeedRate);
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

      case 28: {
        Serial.println("Homing sequence started...");
        homeAxis();
        Serial.println("ok");
        break;
      }

      case 90: {
        isAbsoluteMode = true;
        Serial.println("ok");
        break;
      }

      case 91: {
        isAbsoluteMode = false;
        Serial.println("ok");
        break;
      }

      case 92: {
        bool hasX = GCode.HasWord('X');
        bool hasY = GCode.HasWord('Y');

        if (!hasX && !hasY) {
          stepperY1.setCurrentPosition(0);
          stepperY2.setCurrentPosition(0);
          stepperX.setCurrentPosition(0);
        } else {
          if (hasX) {
            float xVal = GCode.GetWordValue('X');
            long xSteps = round(xVal * stepsPerMmX);
            stepperX.setCurrentPosition(xSteps);
          }
          if (hasY) {
            float yVal = GCode.GetWordValue('Y');
            long ySteps = round(yVal * stepsPerMmY);
            stepperY1.setCurrentPosition(ySteps);
            stepperY2.setCurrentPosition(ySteps);
          }
        }

        reportPosition();
        Serial.println("ok");
        break;
      }

      default: {
        Serial.println("ok");
        break;
      }
    }
    return;
  }

  if (GCode.HasWord('M')) {
    int mCommand = (int)GCode.GetWordValue('M');

    switch (mCommand) {
      case 3: {
        int angle = servoPenDown;
        if (GCode.HasWord('S')) angle = (int)GCode.GetWordValue('S');
        setServoAngle(angle);
        Serial.println("ok");
        break;
      }

      case 5: {
        setServoAngle(servoPenUp);
        Serial.println("ok");
        break;
      }

      case 280: {
        int angle = currentServoAngle;
        if (GCode.HasWord('S')) angle = (int)GCode.GetWordValue('S');
        setServoAngle(angle);
        Serial.println("ok");
        break;
      }

      default: {
        Serial.println("ok");
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
//  RUNTIME CONFIGURATION COMMANDS
// ---------------------------------------------------------------------------
void processConfigCommand(String cmd) {
  if (cmd == "$?") {
    Serial.print("$SPR="); Serial.println(motorStepsPerRev, 0);
    Serial.print("$MS="); Serial.println(microsteps, 0);
    Serial.print("$LP="); Serial.println(leadScrewPitchMm, 3);
    Serial.print("$STEPS_MM="); Serial.println(stepsPerMmX, 3);
    Serial.print("$MF="); Serial.println(maxFeedrate, 0);
    Serial.print("$MINF="); Serial.println(minFeedrate, 0);
    Serial.print("$HF="); Serial.println(homingFeedrate, 0);
    Serial.print("$HB="); Serial.println(homingBackoffMm, 3);
    Serial.print("$SU="); Serial.println(servoPenUp);
    Serial.print("$SD="); Serial.println(servoPenDown);
    Serial.print("$SH="); Serial.println(servoHome);
    Serial.print("$ST="); Serial.println(servoSettleMs);
    Serial.println("ok");
    return;
  }

  int eqIdx = cmd.indexOf('=');
  if (eqIdx == -1) {
    Serial.println("error:Invalid config syntax. Use $KEY=VALUE");
    return;
  }

  String key = cmd.substring(1, eqIdx);
  float val = cmd.substring(eqIdx + 1).toFloat();

  if (key == "MS") {
    microsteps = val;
    recalcStepsPerMm();
  } else if (key == "SPR") {
    motorStepsPerRev = val;
    recalcStepsPerMm();
  } else if (key == "LP") {
    leadScrewPitchMm = val;
    recalcStepsPerMm();
  } else if (key == "MF") {
    maxFeedrate = val;
    recalcStepsPerMm();
  } else if (key == "MINF") {
    minFeedrate = val;
    recalcStepsPerMm();
  } else if (key == "HF") {
    homingFeedrate = val;
  } else if (key == "HB") {
    homingBackoffMm = val;
  } else if (key == "SU") {
    servoPenUp = (int)val;
  } else if (key == "SD") {
    servoPenDown = (int)val;
  } else if (key == "SH") {
    servoHome = (int)val;
  } else if (key == "ST") {
    servoSettleMs = (int)val;
  } else {
    Serial.print("error:Unknown config key: ");
    Serial.println(key);
    return;
  }

  Serial.println("ok");
}

// ---------------------------------------------------------------------------
//  MACHINE ROUTINES
// ---------------------------------------------------------------------------
void setServoAngle(int angle) {
  angle = constrain(angle, 0, 180);
  penServo.write(angle);
  currentServoAngle = angle;
  if (servoSettleMs > 0) {
    delay(servoSettleMs);
  }
}

void reportPosition() {
  float cx = (float)stepperX.currentPosition() / stepsPerMmX;
  float cy = (float)stepperY1.currentPosition() / stepsPerMmY;

  Serial.print("X:");
  Serial.print(cx, 2);
  Serial.print(" Y:");
  Serial.println(cy, 2);
}

// ---------------------------------------------------------------------------
//  MOTION CONTROL
// ---------------------------------------------------------------------------

bool checkEStop() {
  if (Serial.available() > 0) {
    char c = Serial.peek();
    if (c == '\x18') {
      Serial.read(); // Consume the \x18
      stepperY1.stop();
      stepperY2.stop();
      stepperX.stop();
      penServo.write(servoPenUp);
      currentServoAngle = servoPenUp;
      Serial.println("error:Emergency Stop triggered! Motor stopped.");
      inputBuffer = "";
      return true;
    }
  }
  return false;
}

void moveLinear(float targetXMm, float targetYMm, float feedRate) {
  long positions[3];
  positions[0] = round(targetYMm * stepsPerMmY); // Y1
  positions[1] = round(targetXMm * stepsPerMmX); // X
  positions[2] = positions[0]; // Y2 exactly mirrors Y1

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
  float totalDistanceMm = sqrt((dxMm * dxMm) + (dyMm * dyMm));
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

  while (stepperX.distanceToGo() != 0 || stepperY1.distanceToGo() != 0) {
    if (checkEStop()) break;

    if (xMovingMin && digitalRead(X_MIN_PIN) == HIGH) {
      Serial.println("error:Hard limit X triggered! Motor stopped.");
      stepperX.stop();
      stepperY1.stop();
      stepperY2.stop();
      break;
    }
    if (!yMovingMin && digitalRead(Y_MIN_PIN) == HIGH) {
      Serial.println("error:Hard limit Y triggered! Motor stopped.");
      stepperX.stop();
      stepperY1.stop();
      stepperY2.stop();
      break;
    }

    if (stepperX.distanceToGo() != 0) {
      stepperX.setSpeed(xMovingMin ? -vX : vX);
      stepperX.runSpeed();
    }
    if (stepperY1.distanceToGo() != 0) {
      stepperY1.setSpeed(yMovingMin ? -vY : vY);
      stepperY2.setSpeed(yMovingMin ? -vY : vY);
      stepperY1.runSpeed();
      stepperY2.runSpeed();
    }
  }

  float maxSpsX = (maxFeedrate / 60.0) * stepsPerMmX;
  float maxSpsY = (maxFeedrate / 60.0) * stepsPerMmY;
  stepperY1.setMaxSpeed(maxSpsY);
  stepperY2.setMaxSpeed(maxSpsY);
  stepperX.setMaxSpeed(maxSpsX);

  reportPosition();
}

// ---------------------------------------------------------------------------
//  HOMING ROUTINE
// ---------------------------------------------------------------------------
void homeAxis() {
  setServoAngle(servoHome);

  float homeSpsX = (homingFeedrate / 60.0) * stepsPerMmX;
  float homeSpsY = (homingFeedrate / 60.0) * stepsPerMmY;
  if (homeSpsX < 1.0) homeSpsX = 1.0;
  if (homeSpsY < 1.0) homeSpsY = 1.0;

  stepperY1.setMaxSpeed(homeSpsY);
  stepperY2.setMaxSpeed(homeSpsY);
  stepperX.setMaxSpeed(homeSpsX);

  bool xHit = false;
  long maxSearchX = (long)(-500.0 * stepsPerMmX);
  stepperX.setCurrentPosition(0);
  stepperX.moveTo(maxSearchX);

  while (stepperX.distanceToGo() != 0) {
    if (checkEStop()) return;
    if (digitalRead(X_MIN_PIN) == HIGH) {
      xHit = true;
      stepperX.stop();
      while (stepperX.distanceToGo() != 0) {
        if (checkEStop()) return;
        stepperX.run();
      }
      break;
    }
    stepperX.run();
  }

  if (xHit) {
    stepperX.setCurrentPosition(0);
    long backoffStepsX = (long)(homingBackoffMm * stepsPerMmX);
    stepperX.moveTo(backoffStepsX);
    while (stepperX.distanceToGo() != 0) {
      if (checkEStop()) return;
      stepperX.run();
    }
  }

  bool yHit = false;
  long maxSearchY = (long)(500.0 * stepsPerMmY);
  stepperY1.setCurrentPosition(0);
  stepperY2.setCurrentPosition(0);
  stepperY1.moveTo(maxSearchY);
  stepperY2.moveTo(maxSearchY);

  while (stepperY1.distanceToGo() != 0 || stepperY2.distanceToGo() != 0) {
    if (checkEStop()) return;
    if (digitalRead(Y_MIN_PIN) == HIGH) {
      yHit = true;
      stepperY1.stop();
      stepperY2.stop();
      while (stepperY1.distanceToGo() != 0 || stepperY2.distanceToGo() != 0) {
        if (checkEStop()) return;
        stepperY1.run();
        stepperY2.run();
      }
      break;
    }
    stepperY1.run();
    stepperY2.run();
  }

  if (yHit) {
    stepperY1.setCurrentPosition(0);
    stepperY2.setCurrentPosition(0);
    long backoffStepsY = (long)(-homingBackoffMm * stepsPerMmY);
    stepperY1.moveTo(backoffStepsY);
    stepperY2.moveTo(backoffStepsY);
    while (stepperY1.distanceToGo() != 0 || stepperY2.distanceToGo() != 0) {
      if (checkEStop()) return;
      stepperY1.run();
      stepperY2.run();
    }
  }

  stepperY1.setCurrentPosition(0);
  stepperY2.setCurrentPosition(0);
  stepperX.setCurrentPosition(0);
  recalcStepsPerMm();

  Serial.print("Debug: Homing Complete (XHit:");
  Serial.print(xHit);
  Serial.print(" YHit:");
  Serial.print(yHit);
  Serial.println(")");
  reportPosition();
}
