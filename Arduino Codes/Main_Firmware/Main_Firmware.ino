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
//  MACHINE CONFIGURATION (Runtime-mutable via $ commands from Desktop App)
// ---------------------------------------------------------------------------
// Motor hardware defaults (mutable at runtime)
float motorStepsPerRev  = 200.0;   // 1.8 degree NEMA 17
float microsteps        = 16.0;    // TB6600 driver microstepping
float leadScrewPitchMm  = 8.0;     // T8 lead screw: 8mm per revolution

// Advanced Hardware Timings (Microseconds) — mutable
int minStepPulseUs   = 5;       // TB6600 requires > 2.2us
int dirSetupDelayUs  = 5;       // Direction change settle time
int minLoopDelayUs   = 50;      // Min delay between steps

// Automatically calculate Steps per mm
float stepsPerMmX;
float stepsPerMmY;

void recalcStepsPerMm() {
  stepsPerMmX = (motorStepsPerRev * microsteps) / leadScrewPitchMm;
  stepsPerMmY = (motorStepsPerRev * microsteps) / leadScrewPitchMm;
}

// Speeds — mutable
float currentFeedRate = 1200.0;
float maxFeedrate     = 3000.0;
float minFeedrate     = 10.0;
float homingFeedrate  = 600.0;
float homingBackoffMm = 2.0;

// Servo Settings — mutable
int servoPenUp    = 75;   // degrees (safe height)
int servoPenDown  = 30;   // degrees (drawing height)
int servoHome     = 90;   // safe retract
int servoSettleMs = 150;  // ms to wait after servo move

// State
Servo penServo;
float currentX = 0.0;
float currentY = 0.0;
long currentStepsX = 0;
long currentStepsY = 0;
bool isAbsoluteMode = true;

int currentServoAngle = 90;

// ---------------------------------------------------------------------------
//  SETUP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(100); 

  // Calculate steps/mm from defaults
  recalcStepsPerMm();
  currentServoAngle = servoHome;

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
  setServoAngle(servoHome);

  // Enable stepper drivers (TB6600 enabled when pin is LOW)
  digitalWrite(X_ENABLE_PIN, LOW);
  digitalWrite(Y_ENABLE_PIN, LOW);

  // Greet host app
  Serial.println("Mega 2560 CNC Controller v2.0 Ready.");
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
    if (f > 0) currentFeedRate = constrain(f, minFeedrate, maxFeedrate);
    
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

  // --- G92: Set Work Origin ---
  if (cmd.startsWith("G92")) {
    float valX = parseValue(cmd, 'X', -999999.0);
    float valY = parseValue(cmd, 'Y', -999999.0);
    if (valX != -999999.0) { currentX = valX; currentStepsX = round(valX * stepsPerMmX); }
    if (valY != -999999.0) { currentY = valY; currentStepsY = round(valY * stepsPerMmY); }
    // If no axes specified, zero both
    if (valX == -999999.0 && valY == -999999.0) {
      currentX = 0; currentY = 0; currentStepsX = 0; currentStepsY = 0;
    }
    reportPosition();
    Serial.println("ok");
    return;
  }

  // --- M Commands ---
  if (cmd.startsWith("M3")) {
    int angle = (int)parseValue(cmd, 'S', servoPenDown);
    setServoAngle(angle);
    Serial.println("ok");
    return;
  }
  
  if (cmd.startsWith("M5")) {
    setServoAngle(servoPenUp);
    Serial.println("ok");
    return;
  }
  
  if (cmd.startsWith("M280")) {
    int angle = (int)parseValue(cmd, 'S', currentServoAngle);
    setServoAngle(angle);
    Serial.println("ok");
    return;
  }

  // --- ? Quick Status Query ---
  if (cmd == "?") {
    reportPosition();
    Serial.print("State:");
    Serial.print(isAbsoluteMode ? "Abs" : "Rel");
    Serial.print(" F:");
    Serial.print(currentFeedRate, 0);
    Serial.print(" Servo:");
    Serial.println(currentServoAngle);
    Serial.println("ok");
    return;
  }

  // --- $ Runtime Configuration Commands ---
  if (cmd.startsWith("$")) {
    processConfigCommand(cmd);
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
  delay(servoSettleMs);
}

void reportPosition() {
  Serial.print("X:");
  Serial.print(currentX, 2);
  Serial.print(" Y:");
  Serial.println(currentY, 2);
}

// ---------------------------------------------------------------------------
//  RUNTIME CONFIGURATION PARSER ($ commands from Desktop App)
// ---------------------------------------------------------------------------
void processConfigCommand(String cmd) {
  if (cmd == "$?") {
    // Report all current settings as key-value pairs
    Serial.print("$SPR="); Serial.println(motorStepsPerRev, 0);
    Serial.print("$MS="); Serial.println(microsteps, 0);
    Serial.print("$LP="); Serial.println(leadScrewPitchMm, 1);
    Serial.print("$STEPS_MM="); Serial.println(stepsPerMmX, 1);
    Serial.print("$MF="); Serial.println(maxFeedrate, 0);
    Serial.print("$HF="); Serial.println(homingFeedrate, 0);
    Serial.print("$HB="); Serial.println(homingBackoffMm, 1);
    Serial.print("$SU="); Serial.println(servoPenUp);
    Serial.print("$SD="); Serial.println(servoPenDown);
    Serial.print("$SH="); Serial.println(servoHome);
    Serial.print("$ST="); Serial.println(servoSettleMs);
    Serial.println("ok");
    return;
  }

  // Parse $KEY=VALUE format
  int eqIdx = cmd.indexOf('=');
  if (eqIdx == -1) {
    Serial.println("error:Invalid config syntax. Use $KEY=VALUE");
    return;
  }

  String key = cmd.substring(1, eqIdx);  // Strip leading $
  float val = cmd.substring(eqIdx + 1).toFloat();

  if (key == "MS") {
    microsteps = val;
    recalcStepsPerMm();
    Serial.print("Debug: Microsteps="); Serial.print(microsteps, 0);
    Serial.print(" StepsPerMm="); Serial.println(stepsPerMmX, 1);
  } else if (key == "SPR") {
    motorStepsPerRev = val;
    recalcStepsPerMm();
    Serial.print("Debug: StepsPerRev="); Serial.println(motorStepsPerRev, 0);
  } else if (key == "LP") {
    leadScrewPitchMm = val;
    recalcStepsPerMm();
    Serial.print("Debug: LeadScrewPitch="); Serial.println(leadScrewPitchMm, 1);
  } else if (key == "MF") {
    maxFeedrate = val;
    Serial.print("Debug: MaxFeedrate="); Serial.println(maxFeedrate, 0);
  } else if (key == "HF") {
    homingFeedrate = val;
    Serial.print("Debug: HomingFeedrate="); Serial.println(homingFeedrate, 0);
  } else if (key == "HB") {
    homingBackoffMm = val;
    Serial.print("Debug: HomingBackoff="); Serial.println(homingBackoffMm, 1);
  } else if (key == "SU") {
    servoPenUp = (int)val;
    Serial.print("Debug: ServoPenUp="); Serial.println(servoPenUp);
  } else if (key == "SD") {
    servoPenDown = (int)val;
    Serial.print("Debug: ServoPenDown="); Serial.println(servoPenDown);
  } else if (key == "SH") {
    servoHome = (int)val;
    Serial.print("Debug: ServoHome="); Serial.println(servoHome);
  } else if (key == "ST") {
    servoSettleMs = (int)val;
    Serial.print("Debug: ServoSettleMs="); Serial.println(servoSettleMs);
  } else {
    Serial.print("error:Unknown config key: ");
    Serial.println(key);
    return;
  }

  Serial.println("ok");
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
  delayMicroseconds(dirSetupDelayUs); // Direction setup time
  
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
  if(delayUs < (unsigned long)minLoopDelayUs) delayUs = minLoopDelayUs; // Hard hardware limit
  
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
  delayMicroseconds(minStepPulseUs); // Minimum pulse width for TB6600
  digitalWrite(pin, LOW);
  // Remainder of delay is handled in moveLinear
}

// ---------------------------------------------------------------------------
//  HOMING ROUTINE
// ---------------------------------------------------------------------------
void homeAxis() {
  // Lift pen
  setServoAngle(servoHome);
  
  // Home speeds
  float sps = (homingFeedrate / 60.0) * stepsPerMmX;
  unsigned long delayUs = 1000000.0 / sps;
  
  // --- Home X Axis ---
  digitalWrite(X_DIR_PIN, LOW);
  delayMicroseconds(dirSetupDelayUs);
  
  bool xHit = false;
  long maxSearchSteps = (long)(500.0 * stepsPerMmX);
  
  for(long i=0; i<maxSearchSteps; i++) {
    if (digitalRead(X_MIN_PIN) == LOW) { xHit = true; break; }
    triggerStep(X_STEP_PIN);
    delayMicroseconds(delayUs);
  }
  
  if (xHit) {
    digitalWrite(X_DIR_PIN, HIGH);
    delayMicroseconds(dirSetupDelayUs);
    long backoffSteps = (long)(homingBackoffMm * stepsPerMmX);
    for(long i=0; i<backoffSteps; i++) {
      triggerStep(X_STEP_PIN);
      delayMicroseconds(delayUs);
    }
  }
  
  // --- Home Y Axis ---
  digitalWrite(Y_DIR_PIN, LOW);
  delayMicroseconds(dirSetupDelayUs);
  
  bool yHit = false;
  long maxSearchStepsY = (long)(500.0 * stepsPerMmY);
  
  for(long i=0; i<maxSearchStepsY; i++) {
    if (digitalRead(Y_MIN_PIN) == LOW) { yHit = true; break; }
    triggerStep(Y_STEP_PIN);
    delayMicroseconds(delayUs);
  }
  
  if (yHit) {
    digitalWrite(Y_DIR_PIN, HIGH);
    delayMicroseconds(dirSetupDelayUs);
    long backoffSteps = (long)(homingBackoffMm * stepsPerMmY);
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
