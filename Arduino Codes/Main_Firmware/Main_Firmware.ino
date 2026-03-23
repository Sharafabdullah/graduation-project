/**
 * =============================================================================
 *  Main Firmware — G-Code Interpreter for 3-Axis CNC Plotter
 * =============================================================================
 *
 *  BOARD: Arduino Mega 2560
 *
 *  DESCRIPTION:
 *    Refactored using AccelStepper and GCodeParser to run efficiently without
 *    Arduino String object fragmentation and blocking loops.
 *
 *  FEATURES:
 *    - G0 / G1 : Linear Interpolation (via MultiStepper)
 *    - G4      : Dwell / Pause
 *    - G28     : Homing Routine (using native limit switches inside run loops)
 *    - G90/G91 : Absolute / Relative Positioning
 *    - M3/M5   : Servo Pen Up/Down
 *    - M280    : Direct Servo Angle Control
 *
 *  HARDWARE PINOUT:
 *    X STEP = 2, X DIR = 3, X ENA = 4, X_MIN = 18
 *    Y STEP = 5, Y DIR = 6, Y ENA = 7, Y_MIN = 19
 *    Z SERVO = 9
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
//  MACHINE CONFIGURATION
// ---------------------------------------------------------------------------
#define MOTOR_STEPS_PER_REV  200.0   // 1.8 degree NEMA 17 is 200
#define MICROSTEPS           16.0     // TB6600 driver microstepping 
#define LEAD_SCREW_PITCH_MM  8.0     // T8 lead screw moves 8mm per revolution

// Automatically calculate Steps per mm
float stepsPerMmX = (MOTOR_STEPS_PER_REV * MICROSTEPS) / LEAD_SCREW_PITCH_MM; 
float stepsPerMmY = (MOTOR_STEPS_PER_REV * MICROSTEPS) / LEAD_SCREW_PITCH_MM;

// Speeds
float currentFeedRate = 1200.0; // mm/minute default
#define MAX_FEEDRATE 3000.0
#define MIN_FEEDRATE 10.0
#define HOMING_FEEDRATE 600.0   // mm/minute
#define HOMING_BACKOFF_MM 2.0

// Servo Settings
#define SERVO_PEN_UP      75      // degrees (safe height)
#define SERVO_PEN_DOWN    30      // degrees (drawing height)
#define SERVO_HOME        90      // safe retract
#define SERVO_SETTLE_MS   150     // Ms to wait after servo move

// State
Servo penServo;
int currentServoAngle = SERVO_HOME;
bool isAbsoluteMode = true;

// ---------------------------------------------------------------------------
//  LIBRARY INSTANTIATIONS
// ---------------------------------------------------------------------------
// We use the AccelStepper::DRIVER paradigm (1 pin for step, 1 pin for direction)
AccelStepper stepperX(AccelStepper::DRIVER, X_STEP_PIN, X_DIR_PIN);
AccelStepper stepperY(AccelStepper::DRIVER, Y_STEP_PIN, Y_DIR_PIN);
MultiStepper steppers; // Coordinates X and Y moves so they arrive at the exact same time

GCodeParser GCode = GCodeParser();

// ---------------------------------------------------------------------------
//  SETUP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(100); 

  // Enable steppers (TB6600 enabled when pin is LOW)
  pinMode(X_ENABLE_PIN, OUTPUT);
  pinMode(Y_ENABLE_PIN, OUTPUT);
  digitalWrite(X_ENABLE_PIN, LOW);
  digitalWrite(Y_ENABLE_PIN, LOW);

  // Limit switches (internally pulled up)
  pinMode(X_MIN_PIN, INPUT_PULLUP);
  pinMode(Y_MIN_PIN, INPUT_PULLUP);

  // Servo init
  penServo.attach(Z_SERVO_PIN);
  setServoAngle(SERVO_HOME);

  // Stepper Configurations
  float maxSpsX = (MAX_FEEDRATE / 60.0) * stepsPerMmX;
  float maxSpsY = (MAX_FEEDRATE / 60.0) * stepsPerMmY;
  
  stepperX.setMaxSpeed(maxSpsX);
  stepperY.setMaxSpeed(maxSpsY);

  // Acceleration is used during homing independently
  stepperX.setAcceleration(maxSpsX * 2.0); 
  stepperY.setAcceleration(maxSpsY * 2.0); 

  steppers.addStepper(stepperX);
  steppers.addStepper(stepperY);

  Serial.println("Mega 2560 CNC Controller v2.0 Ready.");
  reportPosition(); // Send initial 0,0
}

// ---------------------------------------------------------------------------
//  MAIN LOOP
// ---------------------------------------------------------------------------
void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (GCode.AddCharToLine(c)) {
      GCode.ParseLine();
      processParsedGCode();
    }
  }
}

// ---------------------------------------------------------------------------
//  G-CODE PROCESSING
// ---------------------------------------------------------------------------
void processParsedGCode() {
  // If no G/M commands found, just return 'ok'
  if (!GCode.HasWord('G') && !GCode.HasWord('M')) {
    Serial.println("ok");
    return;
  }

  // Handle G-codes
  if (GCode.HasWord('G')) {
    int gCommand = (int)GCode.GetWordValue('G');

    switch(gCommand) {
      case 0:
      case 1: { // Linear interpolation
        if (GCode.HasWord('F')) {
          float f = GCode.GetWordValue('F');
          if (f > 0) currentFeedRate = constrain(f, MIN_FEEDRATE, MAX_FEEDRATE);
        }

        // Get current theoretical positions in mm
        float targetX = (float)stepperX.currentPosition() / stepsPerMmX;
        float targetY = (float)stepperY.currentPosition() / stepsPerMmY;

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
      case 4: { // Dwell
        if (GCode.HasWord('P')) {
          int delayMs = (int)GCode.GetWordValue('P');
          if (delayMs > 0) delay(delayMs);
        }
        Serial.println("ok");
        break;
      }
      case 28: { // Homing
        Serial.println("Homing sequence started...");
        homeAxis();
        Serial.println("ok");
        break;
      }
      case 90: { // Absolute positioning
        isAbsoluteMode = true;
        Serial.println("ok");
        break;
      }
      case 91: { // Relative positioning
        isAbsoluteMode = false;
        Serial.println("ok");
        break;
      }
      default: {
        Serial.println("ok");
        break;
      }
    }
  } 
  // Handle M-codes
  else if (GCode.HasWord('M')) {
    int mCommand = (int)GCode.GetWordValue('M');
    
    switch(mCommand) {
      case 3: { // Spindle On / Pen Down
        int angle = SERVO_PEN_DOWN;
        if (GCode.HasWord('S')) angle = (int)GCode.GetWordValue('S');
        setServoAngle(angle);
        Serial.println("ok");
        break;
      }
      case 5: { // Spindle Off / Pen Up
        setServoAngle(SERVO_PEN_UP);
        Serial.println("ok");
        break;
      }
      case 280: { // Direct Servo Angle
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
//  MACHINE ROUTINES
// ---------------------------------------------------------------------------

void setServoAngle(int angle) {
  angle = constrain(angle, 0, 180);
  penServo.write(angle);
  currentServoAngle = angle;
  delay(SERVO_SETTLE_MS);
}

void reportPosition() {
  float cx = (float)stepperX.currentPosition() / stepsPerMmX;
  float cy = (float)stepperY.currentPosition() / stepsPerMmY;
  Serial.print("X:");
  Serial.print(cx, 2);
  Serial.print(" Y:");
  Serial.println(cy, 2);
}

// ---------------------------------------------------------------------------
//  MOTION CONTROL
// ---------------------------------------------------------------------------
void moveLinear(float targetXMm, float targetYMm, float feedRate) {
  long positions[2];
  positions[0] = round(targetXMm * stepsPerMmX);
  positions[1] = round(targetYMm * stepsPerMmY);

  long currentXSteps = stepperX.currentPosition();
  long currentYSteps = stepperY.currentPosition();
  
  long dxSteps = abs(positions[0] - currentXSteps);
  long dySteps = abs(positions[1] - currentYSteps);
  
  if (dxSteps == 0 && dySteps == 0) return;

  // Convert feedrate (mm/min) to mm/sec
  float mmPerSec = feedRate / 60.0;

  // Calculate total straight line distance in mm (hypotenuse)
  float dxMm = (float)dxSteps / stepsPerMmX;
  float dyMm = (float)dySteps / stepsPerMmY;
  float totalDistanceMm = sqrt((dxMm * dxMm) + (dyMm * dyMm));

  if (totalDistanceMm > 0) {
    float totalTimeSec = totalDistanceMm / mmPerSec;
    
    // Scale the stepper max speeds proportionally 
    // so they both accomplish their steps in exactly `totalTimeSec`
    float requiredSpsX = (float)dxSteps / totalTimeSec;
    float requiredSpsY = (float)dySteps / totalTimeSec;

    // Set Max Speed (min 1 step/sec to avoid division by zero crashes internally)
    stepperX.setMaxSpeed(requiredSpsX > 0 ? requiredSpsX : 1.0);
    stepperY.setMaxSpeed(requiredSpsY > 0 ? requiredSpsY : 1.0);
  }

  // Assign the target positions array to the MultiStepper coordinator
  steppers.moveTo(positions);
  
  // This blocks the loop and moves them simultaneously at the set constant speeds
  steppers.runSpeedToPosition();

  // Restore the absolute max speeds for non-coordinated tasks if needed
  float maxSpsX = (MAX_FEEDRATE / 60.0) * stepsPerMmX;
  float maxSpsY = (MAX_FEEDRATE / 60.0) * stepsPerMmY;
  stepperX.setMaxSpeed(maxSpsX);
  stepperY.setMaxSpeed(maxSpsY);

  reportPosition();
}

// ---------------------------------------------------------------------------
//  HOMING ROUTINE
// ---------------------------------------------------------------------------
void homeAxis() {
  setServoAngle(SERVO_HOME);
  
  float homeSpsX = (HOMING_FEEDRATE / 60.0) * stepsPerMmX;
  float homeSpsY = (HOMING_FEEDRATE / 60.0) * stepsPerMmY;
  
  stepperX.setMaxSpeed(homeSpsX);
  stepperY.setMaxSpeed(homeSpsY);

  // --- Home X Axis ---
  bool xHit = false;
  long maxSearchX = (long)(-500.0 * stepsPerMmX); 
  
  stepperX.setCurrentPosition(0);
  stepperX.moveTo(maxSearchX);
  
  while (stepperX.distanceToGo() != 0) {
    if (digitalRead(X_MIN_PIN) == LOW) { 
      xHit = true; 
      stepperX.stop(); // Stops with acceleration
      stepperX.runToPosition(); // Ensure it finishes slowing down, though usually immediate at homing speeds
      break; 
    }
    stepperX.run();
  }
  
  if (xHit) {
    // Backoff
    stepperX.setCurrentPosition(0); 
    long backoffStepsX = (long)(HOMING_BACKOFF_MM * stepsPerMmX);
    stepperX.runToNewPosition(backoffStepsX);
  }

  // --- Home Y Axis ---
  bool yHit = false;
  long maxSearchY = (long)(-500.0 * stepsPerMmY); 
  
  stepperY.setCurrentPosition(0);
  stepperY.moveTo(maxSearchY);
  
  while (stepperY.distanceToGo() != 0) {
    if (digitalRead(Y_MIN_PIN) == LOW) { 
      yHit = true; 
      stepperY.stop();
      stepperY.runToPosition(); 
      break; 
    }
    stepperY.run();
  }
  
  if (yHit) {
    // Backoff
    stepperY.setCurrentPosition(0); 
    long backoffStepsY = (long)(HOMING_BACKOFF_MM * stepsPerMmY);
    stepperY.runToNewPosition(backoffStepsY);
  }

  // Reset absolute zero to current switch-backed-off position
  stepperX.setCurrentPosition(0);
  stepperY.setCurrentPosition(0);

  // Restore max speeds
  stepperX.setMaxSpeed((MAX_FEEDRATE / 60.0) * stepsPerMmX);
  stepperY.setMaxSpeed((MAX_FEEDRATE / 60.0) * stepsPerMmY);

  Serial.print("Debug: Homing Complete (XHit:");
  Serial.print(xHit);
  Serial.print(" YHit:");
  Serial.print(yHit);
  Serial.println(")");
  reportPosition();
}
