/**
 * =============================================================================
 *  Servo Motor (SG90) G-Code Test for Arduino Uno
 * =============================================================================
 *
 *  PURPOSE:
 *    To test the SG90 servo motor using standard G-code commands sent over 
 *    the serial connection from the Desktop App.
 *
 *  WIRING (Arduino Uno):
 *    - Servo VCC (Red)   -> 5V
 *    - Servo GND (Brown) -> GND
 *    - Servo Signal (Orange) -> Digital Pin 9
 *
 *  SUPPORTED G-CODE COMMANDS:
 *    - M3 S<angle>    : Set servo to <angle> (0 to 180 degrees)
 *    - M5             : Move servo to HOME position (90 degrees defaults)
 *    - M280 P0 S<angle> : Direct servo command (Marlin style)
 *
 *  COMMUNICATION:
 *    - Default baud rate: 115200
 *    - Responds with "ok" to every completed command (required by Desktop App)
 *
 * =============================================================================
 */

#include <Servo.h>

#define SERVO_PIN      9
#define SERVO_HOME    90   // Middle position

Servo myServo;
int currentAngle = SERVO_HOME;

void setup() {
  // Start serial communication at 115200 baud
  Serial.begin(115200);

  // Attach servo and move to home position
  myServo.attach(SERVO_PIN);
  myServo.write(SERVO_HOME);
  
  // Wait a bit for serial to stabilize and servo to reach position
  delay(1000);
  
  // Send ready message
  Serial.println("SG90 Servo Test Ready");
  Serial.println("ok"); // Initial ok just in case
}

void loop() {
  // Check if a complete line has been received
  if (Serial.available()) {
    String commandLine = Serial.readStringUntil('\n');
    commandLine.trim(); // Remove leading/trailing whitespace
    
    if (commandLine.length() > 0) {
      processGCode(commandLine);
    }
  }
}

// -----------------------------------------------------------------------------
// G-Code Parsing and Execution
// -----------------------------------------------------------------------------
void processGCode(String cmd) {
  // Echo the received command for debugging
  Serial.print("Debug: Received '");
  Serial.print(cmd);
  Serial.println("'");
  
  cmd.toUpperCase();
  
  // Check for M5 (Spindle Off -> Home position)
  if (cmd.startsWith("M5")) {
    Serial.println("Debug: Executing M5 (Home)");
    setServoAngle(SERVO_HOME);
    Serial.println("ok");
    return;
  }
  
  // Check for M3 (Spindle On -> Set Angle)
  if (cmd.startsWith("M3")) {
    int angle = parseValue(cmd, 'S', currentAngle);
    Serial.print("Debug: Executing M3 with angle ");
    Serial.println(angle);
    setServoAngle(angle);
    Serial.println("ok");
    return;
  }
  
  // Check for M280 (Direct Servo Command: M280 P0 S<angle>)
  if (cmd.startsWith("M280")) {
    int angle = parseValue(cmd, 'S', currentAngle);
    Serial.print("Debug: Executing M280 with angle ");
    Serial.println(angle);
    setServoAngle(angle);
    Serial.println("ok");
    return;
  }
  
  // Check for G4 (Dwell / Pause)
  if (cmd.startsWith("G4")) {
    int delayMs = parseValue(cmd, 'P', 0);
    Serial.print("Debug: Dwelling for ");
    Serial.print(delayMs);
    Serial.println(" ms");
    if (delayMs > 0) {
      delay(delayMs);
    }
    Serial.println("ok");
    return;
  }
  
  // Ignore comments or empty lines, but ack them
  if (cmd.startsWith(";") || cmd.startsWith("(")) {
    Serial.println("Debug: Ignoring comment");
    Serial.println("ok");
    return;
  }

  // If command not recognized, just send 'ok' to keep streaming alive
  // Optionally, you can send "error: unknown command" 
  Serial.println("Debug: Unknown command");
  Serial.println("ok");
}

// -----------------------------------------------------------------------------
// Helper to extract numeric values from commands (e.g. S90)
// -----------------------------------------------------------------------------
int parseValue(String str, char key, int defaultValue) {
  int index = str.indexOf(key);
  if (index == -1) return defaultValue;
  
  // Find the end of the number
  int endIndex = index + 1;
  while (endIndex < str.length() && (isDigit(str[endIndex]) || str[endIndex] == '.' || str[endIndex] == '-')) {
    endIndex++;
  }
  
  String valStr = str.substring(index + 1, endIndex);
  return valStr.toInt();
}

// -----------------------------------------------------------------------------
// Motor Control
// -----------------------------------------------------------------------------
void setServoAngle(int targetAngle) {
  // Constrain to physical servo limits
  targetAngle = constrain(targetAngle, 0, 180);
  
  Serial.print("Debug: Moving servo physically to ");
  Serial.println(targetAngle);
  
  myServo.write(targetAngle);
  currentAngle = targetAngle;
  
  // Small delay to allow physical movement (optional)
  delay(15);
}
