# CNC Firmware — Pre-compiled Hex Files

This directory contains pre-compiled firmware `.hex` files for each operating mode.
These are uploaded directly to the Arduino Mega 2560 from the Platform Control app
when the user switches modes.

## Files

| File | Mode | Description |
|------|------|-------------|
| `pen.hex` | Pen Plotter | SG90 servo Z-axis, M3/M5 pen up/down |
| `drill.hex` | Drill/Spindle | Servo carriage + PWM spindle (pin 10) |
| `laser.hex` | Laser Engraver | PWM laser (pin 11), G0 laser-off gate |

## avrdude

`avrdude.exe` and `avrdude.conf` from the Arduino IDE distribution are required
to flash these files. The app resolves them from the following locations (in order):

1. `Desktop_App/firmware/avrdude/avrdude.exe` (bundled — recommended)
2. Arduino IDE installation at `%LOCALAPPDATA%\Arduino15\packages\arduino\tools\avrdude\`
3. `avrdude` on the system `PATH`

## Compiling from Source

Source for all modes lives in a single folder: `Arduino Codes/CNC_Firmware/`.
- `CNC_Firmware.ino` — Entry point sketch
- `Pen_Firmware.ino` — Pen mode source
- `Drill_Firmware.ino` — Drill mode source
- `Laser_Firmware.ino` — Laser mode source
- `cnc_base.h` — Shared motion core (no duplication)

To compile a specific mode:
1. Open `Arduino Codes/CNC_Firmware/CNC_Firmware.ino` in the Arduino IDE.
2. In `CNC_Firmware.ino`, uncomment the line for the mode you want to compile and comment out the other modes:
   ```cpp
   #define MODE_PEN
   // #define MODE_DRILL
   // #define MODE_LASER
   ```
3. Select **Arduino Mega 2560** as your target board.
4. Use **Sketch → Export compiled binary**.
5. Copy the resulting `CNC_Firmware.ino.mega.hex` from the `CNC_Firmware` directory to this folder, and rename it to `pen.hex`, `drill.hex`, or `laser.hex` depending on the compiled mode.

## Upload Command (manual / reference)

```bat
avrdude.exe -C avrdude.conf -v -p atmega2560 -c wiring ^
  -P COM3 -b 115200 ^
  -D -U flash:w:pen.hex:i
```

Replace `COM3` with your actual port and `pen.hex` with the target file.
