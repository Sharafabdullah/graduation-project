#ifdef MODE_DRILL

/**
 * =============================================================================
 *  Drill_Firmware — G-Code Interpreter for CNC Drill / Spindle Mode
 * =============================================================================
 *
 *  BOARD:    Arduino Mega 2560
 *  LIBRARIES: AccelStepper, MultiStepper, Servo, GCodeParser
 *  BAUD:     115200
 *
 *  HARDWARE:
 *    Z-ACTUATOR: SG90 servo on pin 9 — raises/lowers the drill carriage
 *    SPINDLE:    DC motor via MOSFET/BTS7960 PWM on pin 10 (Timer2)
 *                Wiring: MOSFET gate → Arduino pin 10
 *                        Motor power → external 12V PSU (separate from Arduino)
 *                        Common GND between Arduino and motor driver
 *
 *  OPERATION:
 *    M3 [S<0-255>] — enable spindle at speed S (or $SS default), then plunge servo
 *    M5             — stop spindle, raise servo
 *    M280 [S<angle>]— set servo only (no spindle change)
 *
 *  RUNTIME CONFIG:
 *    $SU=<angle>   Servo raise angle     (default 75)
 *    $SD=<angle>   Servo plunge angle    (default 30)
 *    $SH=<angle>   Servo home angle      (default 75)
 *    $ST=<ms>      Servo settle delay    (default 200)
 *    $SS=<0-255>   Default spindle speed (default 180)
 *    $PD=<ms>      Post-plunge dwell     (default 500ms — let bit reach speed)
 *    (plus all base motion keys)
 *
 * =============================================================================
 */

#include <Servo.h>
#include "cnc_base.h"

// ---------------------------------------------------------------------------
//  DRILL-MODE PINS
// ---------------------------------------------------------------------------
#define Z_SERVO_PIN   9
#define SPINDLE_PIN   10   // PWM via analogWrite — Timer2 on Mega

// ---------------------------------------------------------------------------
//  DRILL-MODE CONFIG
// ---------------------------------------------------------------------------
int  servoRaiseAngle    = 75;
int  servoPluAngle      = 30;
int  servoHomeAngle     = 75;
int  servoSettleMs      = 200;
int  defaultSpindleSpeed = 180;  // 0-255 PWM duty
int  plungeDwellMs      = 500;   // dwell after plunge before motion

// ---------------------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------------------
Servo drillServo;
int   currentServoAngle  = 75;
int   currentSpindleSpeed = 0;
bool  spindleRunning      = false;

// ---------------------------------------------------------------------------
//  HELPERS
// ---------------------------------------------------------------------------
void setServoAngle(int angle) {
  angle = constrain(angle, 0, 180);
  drillServo.write(angle);
  currentServoAngle = angle;
  if (servoSettleMs > 0) delay(servoSettleMs);
}

void setSpindleSpeed(int speed) {
  speed = constrain(speed, 0, 255);
  analogWrite(SPINDLE_PIN, speed);
  currentSpindleSpeed = speed;
  spindleRunning = (speed > 0);
}

// ---------------------------------------------------------------------------
//  TOOL INTERFACE (required by cnc_base.h)
// ---------------------------------------------------------------------------
void setupTool() {
  pinMode(SPINDLE_PIN, OUTPUT);
  analogWrite(SPINDLE_PIN, 0);  // spindle off at boot

  drillServo.attach(Z_SERVO_PIN);
  setServoAngle(servoHomeAngle);
}

void handleToolOn(int sValue) {
  // 1. Start spindle
  int speed = (sValue >= 0) ? sValue : defaultSpindleSpeed;
  setSpindleSpeed(speed);
  // 2. Small delay to let spindle reach speed
  if (plungeDwellMs > 0) delay(plungeDwellMs);
  // 3. Plunge carriage
  setServoAngle(servoPluAngle);
}

void handleToolOff() {
  // 1. Raise carriage first (bit still spinning — safer)
  setServoAngle(servoRaiseAngle);
  // 2. Stop spindle
  setSpindleSpeed(0);
}

void handleToolSet(int sValue) {
  // M280: servo angle only, no spindle change
  if (sValue >= 0) setServoAngle(sValue);
}

void reportToolState() {
  Serial.print(" Servo:"); Serial.print(currentServoAngle);
  Serial.print(" Spindle:"); Serial.print(currentSpindleSpeed);
}

bool processModeCfgKey(String key, float val) {
  if      (key == "SU")  { servoRaiseAngle    = (int)val; return true; }
  else if (key == "SD")  { servoPluAngle      = (int)val; return true; }
  else if (key == "SH")  { servoHomeAngle     = (int)val; return true; }
  else if (key == "ST")  { servoSettleMs      = (int)val; return true; }
  else if (key == "SS")  { defaultSpindleSpeed = (int)val; return true; }
  else if (key == "PD")  { plungeDwellMs      = (int)val; return true; }
  return false;
}

// ---------------------------------------------------------------------------
//  ARDUINO ENTRY POINTS
// ---------------------------------------------------------------------------
void setup() {
  baseSetup("Mega 2560 CNC Controller — DRILL MODE v3.0 Ready.");
  setupTool();
}

void loop() {
  baseLoop();
}

#endif // MODE_DRILL
