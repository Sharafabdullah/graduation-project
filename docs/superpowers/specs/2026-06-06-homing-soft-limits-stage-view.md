# Spec: App-Orchestrated Homing, Soft Limits, and Stage View

**Date:** 2026-06-06
**Status:** Approved

---

## Overview

Three connected changes:

1. **Homing redesign** — the app orchestrates a simultaneous two-axis homing sequence. Arduino only stops motors when limits fire and reports which axis stopped; position auto-zeroing happens in firmware.
2. **Soft limit enforcement** — configurable margin (stored in Settings) gates G-code commands near the positive edges; jog toward home is never gated since physical stops protect that direction.
3. **Image2GCode stage view** — GCodePreview gains dimension labels, a soft-limit border, and a drawing-bounds box so the user sees exactly where the compiled image falls on the physical stage.

Plus a cleanup: all built-in G-codes are updated to remove `G28` and ensure all drawing coordinates are within the safe working margin.

---

## 1. Arduino Firmware Changes

### 1.1 Y-axis direction flip

`stepperY1` and `stepperY2` currently move in the wrong direction relative to the coordinate system. Both get `setPinsInverted(true, false, false)` so that negative Y in G-code physically moves toward the Y stop. After this change, both stops are reached by moving in the negative direction on their respective axes.

The hard-limit guard in `moveLinear` for Y is updated to match:

```cpp
// Before (wrong):
if (!yMovingMin && digitalRead(Y_MIN_PIN) == HIGH)
// After (correct):
if (yMovingMin && digitalRead(Y_MIN_PIN) == HIGH)
```

### 1.2 `$HOMING` mode flag

A new `bool homingMode = false` variable. Toggled by two new config commands handled inside `processConfigCommand`:

- `$HOMING=1` — enable homing mode
- `$HOMING=0` — disable homing mode

**Normal mode** (`homingMode = false`): any limit trigger during `moveLinear` stops all motors and sends `error:Hard limit X/Y triggered!` — existing behavior, unchanged.

**Homing mode** (`homingMode = true`): when a limit fires, only that axis is stopped and its position is immediately zeroed:

```cpp
// X stop fires during homing:
stepperX.stop();
stepperX.setCurrentPosition(0);
Serial.println("x stop triggered");

// Y stop fires during homing:
stepperY1.stop(); stepperY2.stop();
stepperY1.setCurrentPosition(0); stepperY2.setCurrentPosition(0);
Serial.println("y stop triggered");
```

The loop continues running the other axis until it also stops. Once both `distanceToGo() == 0`, `moveLinear` returns and the firmware sends `ok` as normal.

### 1.3 Remove G28

The `case 28:` block inside `processParsedGCode` and the entire `homeAxis()` function are deleted. The firmware declaration for `homeAxis()` is also removed.

### 1.4 Physical hard limits still operative

`$HOMING=0` (sent by the app after every homing sequence completes) fully restores the normal limit behavior. The physical stops remain the last line of defense for all non-homing motion. Nothing in the changes disables or bypasses them outside of the explicit homing window.

---

## 2. Serial Protocol

### Arduino → App

| Line | When sent |
|---|---|
| `x stop triggered` | X limit fired during a `$HOMING=1` move; X position auto-zeroed |
| `y stop triggered` | Y limit fired during a `$HOMING=1` move; Y position auto-zeroed |

Both lines arrive before the closing `ok` of the homing G0 command, so `sendAndWait` captures them in the response array.

### App → Arduino

| Command | Effect |
|---|---|
| `$HOMING=1` | Enter homing mode |
| `$HOMING=0` | Exit homing mode, restore normal limit behavior |

Both go through the existing `processConfigCommand` handler. No new parsing infrastructure needed.

---

## 3. App — Homing Sequence (SerialContext)

### 3.1 `sendAndWait(cmd)` helper

A new private helper added to `SerialProvider`. Calls the existing `window.platform.send` and returns a `Promise<string[]>` that resolves with the command's full response array (all non-`ok` lines received before the closing `ok`).

Implementation: registers a one-shot entry in a `pendingWaitMap` keyed by command ID. The existing `handleData` ok-handler checks this map and resolves the matching Promise when `ok` arrives.

### 3.2 `homeStage()` async function

Replaces `findLimits()` in SerialContext. Exposed on the context value under the same key so all existing call sites (`ManualControlPage`, `DashboardPage`) work without changes.

```
Step  Command                                 Wait for
────  ──────────────────────────────────────  ────────────────────────────
1     M5                                      ok   (pen up)
2     $HOMING=1                               ok   (enter homing mode)
3     G91                                     ok   (relative mode)
4     G0 X-500 Y-500 F{homingFeedrate}        ok   (both axes move simultaneously;
                                                    response must contain BOTH
                                                    "x stop triggered" and
                                                    "y stop triggered")
5     G0 X{backoff} Y{backoff} F{homingFeedrate}  ok   (back off both axes)
6     G90                                     ok   (absolute mode)
7     $HOMING=0                               ok   (exit homing mode)
8     G0 X{bedMaxX/2} Y{bedMaxY/2} F{maxFeedrate}  ok   (move to center)
```

`backoff` = `settings.homingBackoff` (default 2 mm).

**Error handling:** if step 4's response array is missing `"x stop triggered"` or `"y stop triggered"`, log a `homing_failed` event, set `machineState` to `'Error'`, and stop the sequence. The firmware will have sent `ok` regardless, so the machine is safe.

**machineState** is set to `'Homing'` at the start and `'Idle'` on completion. The existing `logEvent('homing_done', …)` call is kept.

### 3.3 Jog direction note

`jogWithIncrement` computes the projected target position before sending. Two different limits apply depending on direction:

- **Negative direction (left = X−, down = Y−):** soft floor at 0. Jog is allowed all the way to X=0 / Y=0 (the physical stops). No software block below 0 is needed because the physical stop handles it. This means the left and down buttons can drive the head directly to the stop corner.
- **Positive direction (right = X+, up = Y+):** soft ceiling at `bedMaxX − softLimitMargin` / `bedMaxY − softLimitMargin`. If projected target exceeds this, the jog command is not sent and a console warning is logged.

---

## 4. Settings — Soft Limit Margin

### 4.1 New setting

`softLimitMargin` (number, mm) is added to `DEFAULT_SETTINGS` with a default of `10`. It is saved/loaded alongside other settings. It is **not** pushed to the Arduino (it is a pure app-side guard).

### 4.2 SettingsPage

A new field is added to the existing "Machine Boundaries (Soft Limits)" card:

```
Safe Working Margin (mm)   [  10  ]
```

### 4.3 Soft limit rule

Two separate boundaries apply on each axis:

**Negative boundary (toward physical stop) — hard floor at 0:**
```
X ≥ 0    (stop is at X=0; physical hardware enforces this)
Y ≥ 0    (stop is at Y=0; physical hardware enforces this)
```

The app does not block movement here — the physical stop is the guard. Jog left and jog down can reach X=0 and Y=0 respectively.

**Positive boundary (away from stop, no physical guard) — soft ceiling:**
```
X ≤ bedMaxX − softLimitMargin
Y ≤ bedMaxY − softLimitMargin
```

This is purely software-enforced because no physical stop exists at the positive end.

**Flag zone for G-code validation (compile / load time):**
Any G0/G1 target where `X < softLimitMargin` OR `Y < softLimitMargin` OR `X > bedMaxX − softLimitMargin` OR `Y > bedMaxY − softLimitMargin` is flagged with a warning. This includes proximity to the stop edges, since a drawing that begins at X=1 mm is likely a mistake. The user can still run the job; the physical stops and stream-time skip handle it if they proceed.

**Home-return exception:** a command targeting exactly `X0 Y0` is never flagged.

### 4.4 Where the check runs

| Site | Direction | Behavior |
|---|---|---|
| `Image2GCodePage` compile | both | Scan all G0/G1 targets against flag zone. If any violate, show yellow warning banner. Compile/Run remain enabled. |
| `GCodeJobsPage` file load | both | Scan on load. If violations found, show a per-file warning badge. Run still enabled. |
| `SerialContext.sendNextGCodeLine` | both | Before sending each G0/G1 line, check target against flag zone. If out of range, log console warning and skip the line. |
| `jogWithIncrement` (positive X+, Y+) | positive only | If projected target exceeds `bedMax − softLimitMargin`, log warning and do not send. |
| `jogWithIncrement` (negative X−, Y−) | negative only | No software block — can jog all the way to physical stop at 0. |
| `goToPosition` | both | Check target against flag zone; if out of range, warn but still send (user explicitly typed coordinates). |

---

## 5. Image2GCode — Stage View Enhancements (GCodePreview)

The existing `GCodePreview` canvas already correctly scales G-code coordinates to bed dimensions. The following are added:

### 5.1 Dimension labels
- Bottom edge: `{bedW} mm` centered
- Left edge: `{bedH} mm` rotated 90°

### 5.2 Axis indicators
- Small `X→` label at bottom-right corner
- Small `↑Y` label at top-left corner

### 5.3 Soft-limit inner border
- A faint dashed rectangle inset by `softLimitMargin` pixels (scaled) from each edge
- Color: `rgba(255, 200, 0, 0.25)` — subtle amber, does not dominate the drawing

### 5.4 Drawing bounding box
- After G-code is compiled, compute the min/max X and Y of all G1 targets
- Draw a subtle colored rectangle (e.g. `rgba(0, 191, 255, 0.15)`) showing the drawing's footprint on the stage
- A small text label inside shows the bounding dimensions: e.g. `48 × 32 mm`

All additions are rendered in the existing `useEffect` that already draws the G-code paths.

---

## 6. Built-in G-Code Updates

### 6.1 Remove G28
- `calibration-grid`: remove the `G28` and `G4 P500` lines following it.

### 6.2 Move drawing coordinates inside safe margin
All G0/G1 targets must satisfy `X ≥ softLimitMargin` and `Y ≥ softLimitMargin` using the default margin of 10 mm. Any coordinate currently below 10 mm is bumped up. Coordinates at or above 10 mm are left as-is. `G0 X0 Y0` end-of-job returns are kept (home-return exemption).

Affected G-codes and their required changes:

| G-code | Issue | Fix |
|---|---|---|
| `line` | `G0 X0 Y10` — X0 violates margin | Start at `X10 Y15`, draw to `X60 Y15` |
| `square` | `G0 X5 Y5` — both axes below margin | Shift to `X15 Y15`, corners at `X55 Y55` |
| `rectangle` | `G0 X5 Y10` — X5 below margin | Shift to `X15 Y15`, corners at `X75 Y45` |
| `cross` | `G0 X5 Y22` and `G0 X22 Y5` — X5 and Y5 below margin | Horizontal bar: X range 10→60, Y range 25→31. Vertical bar: X range 25→31, Y range 10→60 |
| `calibration-grid` | `G28` present; `G0 X0 Y0` start | Remove G28; start grid at `X10 Y10` |
| `test-square` | `G0 X5 Y5` — both below margin | Shift to `X15 Y15`, corners at `X55 Y55` |
| `pen-test` | `G0 X10 Y20` — X10 is on exact boundary (valid, leave) | No change needed |
| `spiral` | Outer vertices reach X16 Y16 (≥ 10 mm, valid) | No change; final `G0 X0 Y0` kept |
| `diagonal-test` | `G0 X5 Y5` — both below margin | Shift to `X15 Y15`, outer corner `X65 Y65` |
| `the-house` | `G0 X20 Y20` — valid; all other coords ≥ 20 mm | No change |

---

## 7. Files Changed

| File | Change |
|---|---|
| `Arduino Codes/Main_Firmware/Main_Firmware.ino` | Flip Y direction; add `$HOMING` flag; update `moveLinear` per-axis homing behavior; remove `homeAxis()` and `G28 case` |
| `Desktop_App/src/contexts/SerialContext.jsx` | Add `sendAndWait`; replace `findLimits` with `homeStage`; add jog soft-limit check; add stream-time soft-limit skip |
| `Desktop_App/src/contexts/SettingsContext.jsx` | Add `softLimitMargin: 10` to `DEFAULT_SETTINGS` |
| `Desktop_App/src/pages/SettingsPage.jsx` | Add "Safe Working Margin" field to Machine Boundaries card |
| `Desktop_App/src/pages/GCodeJobsPage.jsx` | Add violation scan + warning badge on file load |
| `Desktop_App/src/pages/Image2GCodePage.jsx` | Add violation scan + warning banner after compile |
| `Desktop_App/src/components/GCodePreview.jsx` | Add dimension labels, axis indicators, soft-limit border, drawing bounding box |
| `Desktop_App/src/data/builtinGcodes.js` | Remove G28; update out-of-bounds coordinates |
