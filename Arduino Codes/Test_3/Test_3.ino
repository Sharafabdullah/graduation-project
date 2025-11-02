#include <Stepper.h>

#include <AccelStepper.h>

// Define motor interface type
#define DRIVER_INTERFACE 1   // 1 = driver mode (step + dir)

// Define pins
#define STEP_PIN 2
#define DIR_PIN 3

// Create stepper instance
AccelStepper stepper(DRIVER_INTERFACE, STEP_PIN, DIR_PIN);

void setup() {
  stepper.setMaxSpeed(1000);    // steps per second
  stepper.setAcceleration(500); // steps per second^2
}

void loop() {
  // Move forward 2000 steps
  stepper.moveTo(2000);
  while (stepper.distanceToGo() != 0) {
    stepper.run();
  }

  delay(1000); // pause 1 sec

  // Move backward to position 0
  stepper.moveTo(0);
  while (stepper.distanceToGo() != 0) {
    stepper.run();
  }

  delay(1000); // pause 1 sec
}
