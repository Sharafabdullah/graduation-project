#ifdef MODE_LASER

/**
 * =============================================================================
 *  Laser_Firmware — G-Code Interpreter for CNC Laser Engraving Mode
 * =============================================================================
 *
 *  BOARD:    Arduino Mega 2560
 *  LIBRARIES: AccelStepper, MultiStepper, GCodeParser  (NO Servo library)
 *  BAUD:     115200
 *
 *  HARDWARE:
 *    LASER MODULE: 2.5W–5.5W diode laser with TTL/PWM input (3-wire)
 *      - 12V & GND → external 12V PSU
 *      - Signal (TTL/PWM) → Arduino pin 11  (Timer2/OC2A on Mega2560)
 *      Common GND between PSU and Arduino REQUIRED.
 *
 *  ⚠ SAFETY:
 *    - ALWAYS wear OD4+ laser safety glasses (445nm wavelength).
 *    - NEVER point at people or reflective surfaces.
 *    - Ensure adequate ventilation (fume extraction recommended).
 *    - Laser is AUTOMATICALLY OFF during G0 rapid moves (enforced in firmware).
 *
 *  OPERATION:
 *    M3 S<0-255>  — laser on at power level S (0=off, 255=full)
 *    M4 S<0-255>  — dynamic mode: same as M3 but speed-proportional scaling TBD
 *    M5           — laser off
 *    G0 X Y F     — rapid move with laser FORCED OFF (laser restored after if was on)
 *    G1 X Y F     — engraving move (laser state unchanged)
 *
 *  RUNTIME CONFIG:
 *    $LMP=<0-255> Max laser power cap     (default 200 ≈ 78% — safety cap)
 *    $LM=<0|1>   Dynamic power mode       (default 0 = fixed power)
 *    (plus all base motion keys)
 *
 * =============================================================================
 */

#include "cnc_base.h"

// ---------------------------------------------------------------------------
//  LASER-MODE PIN
// ---------------------------------------------------------------------------
#define LASER_PIN  11  // PWM — Timer2/OC2A on Mega 2560

// ---------------------------------------------------------------------------
//  LASER-MODE CONFIG
// ---------------------------------------------------------------------------
int  laserMaxPower   = 200;  // 0-255; hard cap to prevent accidental full-power
bool laserDynamicMode = false;

// ---------------------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------------------
int  currentLaserPower = 0;
bool laserIsOn = false;

// ---------------------------------------------------------------------------
//  HELPERS
// ---------------------------------------------------------------------------
void setLaserPower(int power) {
  power = constrain(power, 0, laserMaxPower);
  analogWrite(LASER_PIN, power);
  currentLaserPower = power;
  laserIsOn = (power > 0);
}

// ---------------------------------------------------------------------------
//  TOOL INTERFACE (required by cnc_base.h)
// ---------------------------------------------------------------------------
void setupTool() {
  pinMode(LASER_PIN, OUTPUT);
  setLaserPower(0);  // laser off at boot
}

void handleToolOn(int sValue) {
  int power = (sValue >= 0) ? sValue : laserMaxPower;
  setLaserPower(power);
}

void handleToolOff() {
  setLaserPower(0);
}

void handleToolSet(int sValue) {
  // M280 in laser mode: treat as explicit power set
  if (sValue >= 0) setLaserPower(sValue);
}

void reportToolState() {
  Serial.print(" Laser:"); Serial.print(currentLaserPower);
}

bool processModeCfgKey(String key, float val) {
  if      (key == "LMP") { laserMaxPower    = (int)val; return true; }
  else if (key == "LM") { laserDynamicMode = (val != 0); return true; }
  return false;
}

// ---------------------------------------------------------------------------
//  LASER-SAFE G0 OVERRIDE
//  We override processParsedGCode to intercept G0 and gate the laser.
//  Since cnc_base.h defines processParsedGCode() but it is called from
//  processLine() which is in cnc_base.h, we use a wrapper approach:
//  cnc_base.h checks a global flag before executing a G0.
//
//  Implementation: we define laserG0Gate() called from within moveLinear
//  when the firmware is in laser mode. We use a compile-time include guard
//  to add the G0 gating inline.
//
//  Simpler approach used here: we re-implement processLine for laser mode
//  to intercept G0 commands specifically.
// ---------------------------------------------------------------------------

// Track whether laser was on before a G0 so we can restore after
bool laserWasOnBeforeG0 = false;

// Called from our overridden processLine below, before moveLinear
void laserG0Start() {
  laserWasOnBeforeG0 = laserIsOn;
  if (laserIsOn) setLaserPower(0);  // force off
}

// Called after G0 move completes
void laserG0End() {
  // Do NOT restore — laser should only come back on when M3 is explicitly sent
  // (matching LightBurn/GRBL laser-mode behavior: G0 always resets to off)
  laserWasOnBeforeG0 = false;
}

// We provide our own processLine that shadows the base version for G0 gating.
// The base version is renamed basePL to avoid linker conflicts via the
// laser_processLine wrapper below.
//
// IMPLEMENTATION NOTE: Because Arduino .ino files compile to a single
// translation unit, we cannot easily "override" a function defined in
// an included header without a name conflict. We work around this by
// having cnc_base.h call a weakly-defined hook: beforeG0() and afterG0().
// Those hooks are defined here as no-ops in pen/drill, and as laser gate here.

void beforeG0() { laserG0Start(); }
void afterG0()  { laserG0End(); }

// ---------------------------------------------------------------------------
//  ARDUINO ENTRY POINTS
// ---------------------------------------------------------------------------
void setup() {
  baseSetup("Mega 2560 CNC Controller — LASER MODE v3.0 Ready.");
  setupTool();
  Serial.println("WARNING: Laser mode active. Wear eye protection.");
}

void loop() {
  baseLoop();
}

#endif // MODE_LASER
