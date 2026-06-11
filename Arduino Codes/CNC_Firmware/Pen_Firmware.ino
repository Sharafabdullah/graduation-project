#ifdef MODE_PEN

/**
 * =============================================================================
 *  Pen_Firmware — G-Code Interpreter for CNC Pen Plotter Mode
 * =============================================================================
 *
 *  BOARD:    Arduino Mega 2560
 *  LIBRARIES: AccelStepper, MultiStepper, Servo, GCodeParser
 *  BAUD:     115200
 *
 *  Z-ACTUATOR: SG90/MG90 hobby servo on pin 9
 *    M3 [S<angle>] — pen down (servo to servoPenDown or explicit angle)
 *    M5             — pen up   (servo to servoPenUp)
 *    M280 [S<angle>]— set servo to explicit angle
 *
 *  RUNTIME CONFIG:
 *    $SU=<angle>   Servo pen-up angle   (default 75)
 *    $SD=<angle>   Servo pen-down angle (default 30)
 *    $SH=<angle>   Servo home/rest angle(default 75)
 *    $ST=<ms>      Servo settle delay   (default 150)
 *    (plus all base motion keys: $MS, $SPR, $LP, $MF, $MINF, $HF, $HB, $HOMING)
 *
 * =============================================================================
 */

#include <Servo.h>
#include "cnc_base.h"

// ---------------------------------------------------------------------------
//  PEN-MODE PIN
// ---------------------------------------------------------------------------
#define Z_SERVO_PIN  9

// ---------------------------------------------------------------------------
//  PEN-MODE CONFIG
// ---------------------------------------------------------------------------
int servoPenUp   = 75;
int servoPenDown = 30;
int servoHome    = 75;
int servoSettleMs = 150;

// ---------------------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------------------
Servo penServo;
int   currentServoAngle = 90;

// ---------------------------------------------------------------------------
//  TOOL INTERFACE (required by cnc_base.h)
// ---------------------------------------------------------------------------
void setupTool() {
  penServo.attach(Z_SERVO_PIN);
  setServoAngle(servoHome);
}

void setServoAngle(int angle) {
  angle = constrain(angle, 0, 180);
  penServo.write(angle);
  currentServoAngle = angle;
  if (servoSettleMs > 0) delay(servoSettleMs);
}

void handleToolOn(int sValue) {
  int angle = (sValue >= 0) ? sValue : servoPenDown;
  setServoAngle(angle);
}

void handleToolOff() {
  setServoAngle(servoPenUp);
}

void handleToolSet(int sValue) {
  if (sValue >= 0) setServoAngle(sValue);
}

void reportToolState() {
  Serial.print(" Servo:"); Serial.print(currentServoAngle);
}

bool processModeCfgKey(String key, float val) {
  if      (key == "SU") { servoPenUp    = (int)val; return true; }
  else if (key == "SD") { servoPenDown  = (int)val; return true; }
  else if (key == "SH") { servoHome     = (int)val; return true; }
  else if (key == "ST") { servoSettleMs = (int)val; return true; }
  return false;
}

// ---------------------------------------------------------------------------
//  ARDUINO ENTRY POINTS
// ---------------------------------------------------------------------------
void setup() {
  baseSetup("Mega 2560 CNC Controller — PEN MODE v3.0 Ready.");
  setupTool();
}

void loop() {
  baseLoop();
}

#endif // MODE_PEN
