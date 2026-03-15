/**
 * =============================================================================
 *  Main Firmware — G-Code Interpreter for 3-Axis CNC Plotter
 * =============================================================================
 *
 *  BOARD: Arduino Mega 2560
 *
 *  DESCRIPTION:
 *    This firmware acts as a custom G-code interpreter tailored for a 
 *    belt/lead-screw driven 2D plotter with a servo-actuated Z-axis (pen).
 *    It communicates via dual serial (from a desktop Electron app) and 
 *    processes commands linearly, moving motors synchronously using Bresenham's
 *    line algorithm.
 *
 *  FEATURES:
 *    - G0 / G1 : Linear Interpolation
 *    - G4      : Dwell / Pause
 *    - G28     : Homing Routine (using X_MIN and Y_MIN limit switches)
 *    - G90/G91 : Absolute / Relative Positioning
 *    - M3/M5   : Servo Pen Up/Down
 *    - M280    : Direct Servo Angle Control
 *    - Asynchronous Status Reporting (X:pos Y:pos)
 *
 *  HARDWARE PINOUT:
 *    X STEP = 2, X DIR = 3, X ENA = 4, X_MIN = 18
 *    Y STEP = 5, Y DIR = 6, Y ENA = 7, Y_MIN = 19
 *    Z SERVO = 9
 * What it LACKS (Areas for Future Improvement):
 * 1. Acceleration / Deceleration Profiles (Jerk)
 * Right now, if you tell the motors to move at 1000 mm/min, they instantly try to step at that exact speed. If the physical plotting platform is heavy, physics dictates that the sudden jolt could make the motors skip steps or stall. Professional firmwares calculate a mathematical "acceleration ramp" to smoothly speed up and slow down.
 * 
 * 2. Interrupt-Driven Stepping (Hardware Timers)
 * The current script uses delayMicroseconds() to pause between motor steps. This is a "blocking" function. This means that while a line is being drawn, the Arduino is basically deaf—it cannot process an Emergency Stop button or read the serial port until the movement finishes. GRBL uses hardware timer interrupts to pulse the motors in the background while simultaneously reading new instructions.
 * 
 * 3. Look-Ahead Planning
 * If your desktop app sends hundreds of tiny G1 commands to draw a circle, our firmware will draw a tiny line, stop, say "ok", receive the next line, start, draw, stop, say "ok", etc. This causes "stuttering". GRBL looks 15 to 20 lines ahead in the code and realizes it doesn't need to stop between lines, pushing through the curves smoothly.
 * 
 * 4. Real-time Limit Switch Polling (Hard Limits)
 * Currently, our firmware only looks at the Limit Switches during the Homing (G28) sequence. If your machine is happily drawing a G1 line and crashes into a wall, it won't realize it hit the limit switch.
 * 
 * 5. Circular Arcs (G2 / G3)
 * It only understands straight lines (G0/G1). If you have G-code with G2 or G3 curved arcs, it will ignore them. Your G-code generator on your computer has to convert curves into hundreds of tiny straight lines first.
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
//  MACHINE CONFIGURATION
// ---------------------------------------------------------------------------
// Define physical hardware properties here:
#define MOTOR_STEPS_PER_REV  200.0   // 1.8 degree NEMA 17 is 200
#define MICROSTEPS           16.0     // TB6600 driver microstepping 
#define LEAD_SCREW_PITCH_MM  8.0     // T8 lead screw moves 8mm per revolution

// Advanced Hardware Timings (Microseconds)
#define MIN_STEP_PULSE_US    5      // TB6600 requires > 2.2us, 5us is very safe for NEMA 17 drivers
#define DIR_SETUP_DELAY_US   5       // Time for the driver to register a direction change physically
#define MIN_LOOP_DELAY_US    50      // Absolute minimum delay between steps to prevent Arduino lockup

// Automatically calculate Steps per mm based on the constants above
float stepsPerMmX = (MOTOR_STEPS_PER_REV * MICROSTEPS) / LEAD_SCREW_PITCH_MM; 
float stepsPerMmY = (MOTOR_STEPS_PER_REV * MICROSTEPS) / LEAD_SCREW_PITCH_MM;

// Speeds
float currentFeedRate = 1200.0; // mm per minute default
#define MAX_FEEDRATE 3000.0
#define MIN_FEEDRATE 10.0
#define HOMING_FEEDRATE 600.0   // mm per minute
#define HOMING_BACKOFF_MM 2.0

// Servo Settings
#define SERVO_PEN_UP      75      // degrees (safe height)
#define SERVO_PEN_DOWN    30      // degrees (drawing height)
#define SERVO_HOME        90      // safe retract
#define SERVO_SETTLE_MS   150     // Ms to wait after servo move

// State
Servo penServo;
float currentX = 0.0;
float currentY = 0.0;
long currentStepsX = 0;
long currentStepsY = 0;
bool isAbsoluteMode = true;

int currentServoAngle = SERVO_HOME;

// ---------------------------------------------------------------------------
//  SETUP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(100); 

  // Pin modes
  pinMode(X_STEP_PIN, OUTPUT);
  pinMode(X_DIR_PIN, OUTPUT);
  pinMode(X_ENABLE_PIN, OUTPUT);
  pinMode(Y_STEP_PIN, OUTPUT);
  pinMode(Y_DIR_PIN, OUTPUT);
  pinMode(Y_ENABLE_PIN, OUTPUT);

  // Limit switches (using internal pullups, they trigger LOW to ground)
  pinMode(X_MIN_PIN, INPUT_PULLUP);
  pinMode(Y_MIN_PIN, INPUT_PULLUP);

  // Servo init
  penServo.attach(Z_SERVO_PIN);
  setServoAngle(SERVO_HOME);

  // Enable stepper drivers (TB6600 enabled when pin is LOW)
  digitalWrite(X_ENABLE_PIN, LOW);
  digitalWrite(Y_ENABLE_PIN, LOW);

  // Greet host app
  Serial.println("Mega 2560 CNC Controller v1.0 Ready.");
  reportPosition(); // Send initial 0,0
}

// ---------------------------------------------------------------------------
//  MAIN LOOP
// ---------------------------------------------------------------------------
String inputBuffer = "";

void loop() {
  // Read Serial
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        processGCode(inputBuffer);
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
    }
  }
}

// ---------------------------------------------------------------------------
//  G-CODE PARSER
// ---------------------------------------------------------------------------
void processGCode(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  
  if (cmd.length() == 0) return;
  
  // Ignore comments
  if (cmd.charAt(0) == ';' || cmd.charAt(0) == '(') {
    Serial.println("ok");
    return;
  }

  // --- Real-time / Override Commands ---
  if (cmd == "!" || cmd == "~" || cmd == "\x18") {
    // Basic placeholders for Grbl real-time commands 
    // Usually handled by interrupts, but app might send them
    Serial.println("ok");
    return;
  }

  // --- G Commands ---
  if (cmd.startsWith("G0") || cmd.startsWith("G1")) {
    // Linear move
    float targetX = currentX;
    float targetY = currentY;
    
    // Parse Feedrate
    float f = parseValue(cmd, 'F', currentFeedRate);
    if (f > 0) currentFeedRate = constrain(f, MIN_FEEDRATE, MAX_FEEDRATE);
    
    // Parse Coordinate Targets
    float valX = parseValue(cmd, 'X', -999999.0);
    float valY = parseValue(cmd, 'Y', -999999.0);
    
    if (isAbsoluteMode) {
      if (valX != -999999.0) targetX = valX;
      if (valY != -999999.0) targetY = valY;
    } else {
      // Relative mode
      if (valX != -999999.0) targetX += valX;
      if (valY != -999999.0) targetY += valY;
    }
    
    moveLinear(targetX, targetY, currentFeedRate);
    Serial.println("ok");
    return;
  }

  if (cmd.startsWith("G4")) {
    // Dwell
    int delayMs = (int)parseValue(cmd, 'P', 0.0);
    if (delayMs > 0) delay(delayMs);
    Serial.println("ok");
    return;
  }
  
  if (cmd.startsWith("G28")) {
    // Homing
    Serial.println("Homing sequence started...");
    homeAxis();
    Serial.println("ok");
    return;
  }
  
  if (cmd.startsWith("G90")) {
    isAbsoluteMode = true;
    Serial.println("ok");
    return;
  }
  
  if (cmd.startsWith("G91")) {
    isAbsoluteMode = false;
    Serial.println("ok");
    return;
  }

  // --- M Commands ---
  if (cmd.startsWith("M3")) {
    // Spindle On / Pen down (or to specific angle)
    int angle = (int)parseValue(cmd, 'S', SERVO_PEN_DOWN);
    setServoAngle(angle);
    Serial.println("ok");
    return;
  }
  
  if (cmd.startsWith("M5")) {
    // Spindle Off / Pen up
    setServoAngle(SERVO_PEN_UP);
    Serial.println("ok");
    return;
  }
  
  if (cmd.startsWith("M280")) {
    // Direct Servo
    int angle = (int)parseValue(cmd, 'S', currentServoAngle);
    setServoAngle(angle);
    Serial.println("ok");
    return;
  }
  
  // Settings / Settings Check
  if (cmd.startsWith("$")) {
    // Ignore internal GRBL config commands from Desktop app
    Serial.println("ok");
    return;
  }

  // Fallback for unhandled but syntactically fine commands to prevent lockups
  Serial.println("ok");
}

// ---------------------------------------------------------------------------
//  HELPER: Value Parsing
// ---------------------------------------------------------------------------
// Extracts the float following a char key in a string (e.g. 'X' in "G1 X10.5")
float parseValue(String cmd, char key, float defaultValue) {
  int startIndex = cmd.indexOf(key);
  if (startIndex == -1) return defaultValue;
  
  startIndex++; // Move past the letter
  int endIndex = startIndex;
  
  while (endIndex < cmd.length()) {
    char c = cmd.charAt(endIndex);
    if ((c >= '0' && c <= '9') || c == '.' || c == '-') {
      endIndex++;
    } else {
      break;
    }
  }
  
  if (endIndex == startIndex) return defaultValue;
  return cmd.substring(startIndex, endIndex).toFloat();
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
  Serial.print("X:");
  Serial.print(currentX, 2);
  Serial.print(" Y:");
  Serial.println(currentY, 2);
}

// ---------------------------------------------------------------------------
//  MOTION CONTROL (Bresenham Algorithm for Line Interpolation)
//  ---------------------------------------------------------------------------
void moveLinear(float targetX, float targetY, float feedRate) {
  // Use absolute step counters to prevent floating point drift
  long stepsTargetX  = round(targetX * stepsPerMmX);
  long stepsTargetY  = round(targetY * stepsPerMmY);
  
  long dx = stepsTargetX - currentStepsX;
  long dy = stepsTargetY - currentStepsY;
  
  int dirX = (dx > 0) ? HIGH : LOW;
  int dirY = (dy > 0) ? HIGH : LOW;
  
  dx = abs(dx);
  dy = abs(dy);
  
  digitalWrite(X_DIR_PIN, dirX);
  digitalWrite(Y_DIR_PIN, dirY);
  delayMicroseconds(DIR_SETUP_DELAY_US); // Direction setup time
  
  long over = 0;
  
  // Feedrate is mm/minute. Convert to step delay in microseconds.
  // We approximate feedrate simply by the dominant axis.
  long maxSteps = max(dx, dy);
  if (maxSteps == 0) return;
  
  // feedRate is mm/min. Convert to mm/sec.
  float mmPerSec = feedRate / 60.0;
  // Convert mm/sec to steps/sec (SPS) based on the longest axis
  float maxStepsPerMm = (dx >= dy) ? stepsPerMmX : stepsPerMmY;
  float targetSPS = mmPerSec * maxStepsPerMm;
  
  // Calculate microseconds per step
  unsigned long delayUs = 1000000.0 / targetSPS;
  if(delayUs < MIN_LOOP_DELAY_US) delayUs = MIN_LOOP_DELAY_US; // Hard hardware limit to prevent locking up
  
  if (dx > dy) {
    over = dx / 2;
    for (long i = 0; i < dx; i++) {
      triggerStep(X_STEP_PIN);
      currentStepsX += (dirX == HIGH) ? 1 : -1;
      over += dy;
      if (over >= dx) {
        over -= dx;
        triggerStep(Y_STEP_PIN);
        currentStepsY += (dirY == HIGH) ? 1 : -1;
      }
      delayMicroseconds(delayUs);
    }
  } else {
    over = dy / 2;
    for (long i = 0; i < dy; i++) {
      triggerStep(Y_STEP_PIN);
      over += dx;
      if (over >= dy) {
        over -= dy;
        triggerStep(X_STEP_PIN);
        currentStepsX += (dirX == HIGH) ? 1 : -1;
      }
      currentStepsY += (dirY == HIGH) ? 1 : -1;
      delayMicroseconds(delayUs);
    }
  }
  
  // Update theoretical position state explicitly to match steps
  currentX = (float)currentStepsX / stepsPerMmX;
  currentY = (float)currentStepsY / stepsPerMmY;
  reportPosition();
}

void triggerStep(int pin) {
  digitalWrite(pin, HIGH);
  delayMicroseconds(MIN_STEP_PULSE_US); // Minimum pulse width for TB6600
  digitalWrite(pin, LOW);
  // Remainder of delay is handled in moveLinear
}

// ---------------------------------------------------------------------------
//  HOMING ROUTINE
// ---------------------------------------------------------------------------
void homeAxis() {
  // Lift pen
  setServoAngle(SERVO_HOME);
  
  // Home speeds
  float sps = (HOMING_FEEDRATE / 60.0) * stepsPerMmX;
  unsigned long delayUs = 1000000.0 / sps;
  
  // --- Home X Axis ---
  // Move Negative X until switch goes LOW
  digitalWrite(X_DIR_PIN, LOW); // Assume LOW goes toward minimum
  delayMicroseconds(DIR_SETUP_DELAY_US);
  
  bool xHit = false;
  // Timeout safeguard, assume max travel 500mm
  long maxSearchSteps = (long)(500.0 * stepsPerMmX);
  
  for(long i=0; i<maxSearchSteps; i++) {
    if (digitalRead(X_MIN_PIN) == LOW) { xHit = true; break; }
    triggerStep(X_STEP_PIN);
    delayMicroseconds(delayUs);
  }
  
  if (xHit) {
    // Backoff positively
    digitalWrite(X_DIR_PIN, HIGH);
    delayMicroseconds(DIR_SETUP_DELAY_US);
    long backoffSteps = (long)(HOMING_BACKOFF_MM * stepsPerMmX);
    for(long i=0; i<backoffSteps; i++) {
      triggerStep(X_STEP_PIN);
      delayMicroseconds(delayUs);
    }
  }
  
  // --- Home Y Axis ---
  digitalWrite(Y_DIR_PIN, LOW);
  delayMicroseconds(DIR_SETUP_DELAY_US);
  
  bool yHit = false;
  long maxSearchStepsY = (long)(500.0 * stepsPerMmY);
  
  for(long i=0; i<maxSearchStepsY; i++) {
    if (digitalRead(Y_MIN_PIN) == LOW) { yHit = true; break; }
    triggerStep(Y_STEP_PIN);
    delayMicroseconds(delayUs);
  }
  
  if (yHit) {
    // Backoff positively
    digitalWrite(Y_DIR_PIN, HIGH);
    delayMicroseconds(DIR_SETUP_DELAY_US);
    long backoffSteps = (long)(HOMING_BACKOFF_MM * stepsPerMmY);
    for(long i=0; i<backoffSteps; i++) {
      triggerStep(Y_STEP_PIN);
      delayMicroseconds(delayUs);
    }
  }
  
  // Reset Coordinates
  currentStepsX = 0;
  currentStepsY = 0;
  currentX = 0.0;
  currentY = 0.0;
  Serial.print("Debug: Homing Complete (XHit:");
  Serial.print(xHit);
  Serial.print(" YHit:");
  Serial.print(yHit);
  Serial.println(")");
  reportPosition();
}
