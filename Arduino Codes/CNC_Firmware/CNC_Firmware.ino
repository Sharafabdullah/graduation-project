// ---------------------------------------------------------------------------
//  CNC FIRMWARE - Unified Entry Point for Pen, Drill, and Laser Modes
// ---------------------------------------------------------------------------
//  Uncomment EXACTLY ONE of the modes below before compiling/uploading:

#define MODE_PEN
// #define MODE_DRILL
// #define MODE_LASER

// Standard libraries included at sketch level for Arduino IDE dependency discovery
#include <AccelStepper.h>
#include <MultiStepper.h>
#include <GCodeParser.h>
#include <Servo.h>
