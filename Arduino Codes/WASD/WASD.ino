#define X_DIR 2
#define X_STEP 3

#define Y_DIR 4
#define Y_STEP 5

// === Motion Settings ===
const int stepsPerRev = 200;   // depends on motor (1.8° step = 200 steps/rev)
const int stepsPerMove = 400;  // number of steps per move
const int stepDelay = 800;     // µs delay between steps (lower = faster)

void setup() {
  pinMode(X_DIR, OUTPUT);
  pinMode(X_STEP, OUTPUT);
  pinMode(Y_DIR, OUTPUT);
  pinMode(Y_STEP, OUTPUT);

  Serial.begin(9600);
  Serial.println("XY Stage Ready ✅");
}

void loop() {
  if (Serial.available() > 0) {
    char cmd = Serial.read();  // read one character command

    switch (cmd) {
      case 'w':  // UP
        Serial.println("Moving FORWARD (Y+)");
        moveAxis(Y_DIR, Y_STEP, HIGH, stepsPerMove);
        break;

      case 's':  // DOWN
        Serial.println("Moving BACKWARD (Y-)");
        moveAxis(Y_DIR, Y_STEP, LOW, stepsPerMove);
        break;

      case 'd':  // RIGHT
        Serial.println("Moving RIGHT (X+)");
        moveAxis(X_DIR, X_STEP, HIGH, stepsPerMove);
        break;

      case 'a':  // LEFT
        Serial.println("Moving LEFT (X-)");
        moveAxis(X_DIR, X_STEP, LOW, stepsPerMove);
        break;

      default:
        Serial.println("Unknown Command");
        break;
    }
  }
}

// === Function to move one axis ===
void moveAxis(int dirPin, int stepPin, bool dir, int steps) {
  digitalWrite(dirPin, dir);
  for (int i = 0; i < steps; i++) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(stepDelay);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(stepDelay);
  }
}
