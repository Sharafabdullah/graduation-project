# Homing, Soft Limits & Stage View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Arduino-side blocking G28 homing with an app-orchestrated simultaneous two-axis sequence, add configurable soft limits that gate G-code and jog commands, and enrich the Image2GCode preview with real stage dimensions and a drawing footprint overlay.

**Architecture:** Arduino gains a `$HOMING` mode flag that changes limit-switch behavior from global e-stop to per-axis position-zero + notification; the app sends the move commands and reacts to `"x stop triggered"` / `"y stop triggered"` responses via a new `sendAndWait` Promise helper in `SerialContext`. Soft limit logic lives in a shared `softLimits.js` utility consumed by `SerialContext`, `GCodeJobsPage`, and `Image2GCodePage`. A new `softLimitMargin` setting drives all checks.

**Tech Stack:** Arduino C++ (AccelStepper), React 18, Electron/Vite, plain Canvas 2D API.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `Arduino Codes/Main_Firmware/Main_Firmware.ino` | Modify | Flip Y direction; add `$HOMING` mode; per-axis limit handling in `moveLinear`; remove `homeAxis` + G28 |
| `Desktop_App/src/lib/softLimits.js` | **Create** | Pure utilities: `parseXY`, `isInWarnZone`, `scanGCodeBounds`, `wouldExceedPositiveLimit` |
| `Desktop_App/src/contexts/SettingsContext.jsx` | Modify | Add `softLimitMargin: 10` to `DEFAULT_SETTINGS` |
| `Desktop_App/src/pages/SettingsPage.jsx` | Modify | Add "Safe Working Margin" field to Machine Boundaries card |
| `Desktop_App/src/contexts/SerialContext.jsx` | Modify | Consume `useSettings`; add `pendingWaitMapRef`, `sendAndWait`, `homeStage`; soft-limit checks in jog + stream |
| `Desktop_App/src/pages/ManualControlPage.jsx` | Modify | Use `homeStage` instead of `findLimits`; update button label |
| `Desktop_App/src/pages/GCodeJobsPage.jsx` | Modify | Scan on file select; show warning banner |
| `Desktop_App/src/pages/Image2GCodePage.jsx` | Modify | Scan after compile; show warning banner |
| `Desktop_App/src/components/GCodePreview.jsx` | Modify | Add margin prop; dimension labels; soft-limit border; drawing bounding box |
| `Desktop_App/src/data/builtinGcodes.js` | Modify | Remove G28; move coordinates inside safe margin |

---

## Task 1: Arduino Firmware — Y direction + moveLinear homing mode + remove G28

**Files:**
- Modify: `Arduino Codes/Main_Firmware/Main_Firmware.ino`

- [ ] **Step 1: Flip Y stepper direction**

In `setup()`, lines 107–108, change both Y steppers to `setPinsInverted(true, false, false)`:

```cpp
stepperY1.setPinsInverted(true, false, false);
stepperY2.setPinsInverted(true, false, false);
stepperX.setPinsInverted(true, false, false);
```

(X was already `true`; Y was `false` — now both Y match X.)

- [ ] **Step 2: Add `homingMode` state variable**

After `bool isAbsoluteMode = true;` in the STATE section (around line 69), add:

```cpp
bool homingMode = false;
```

- [ ] **Step 3: Add `$HOMING` to `processConfigCommand`**

In `processConfigCommand`, after the last `} else if (key == "ST") {` block and before the `} else {` error block (around line 429), add:

```cpp
} else if (key == "HOMING") {
  homingMode = (val != 0);
```

Also add it to the `$?` report at the top of `processConfigCommand` (after `Serial.print("$ST=")` line, around line 386):

```cpp
Serial.print("$HOMING="); Serial.println(homingMode ? 1 : 0);
```

- [ ] **Step 4: Replace the loop inside `moveLinear` with homing-aware per-axis handling**

The loop runs from approximately line 518 to line 546. Replace it entirely with:

```cpp
  bool xHomingDone = false;
  bool yHomingDone = false;

  while (stepperX.distanceToGo() != 0 || stepperY1.distanceToGo() != 0) {
    if (checkEStop()) break;

    if (xMovingMin && digitalRead(X_MIN_PIN) == HIGH) {
      if (homingMode && !xHomingDone) {
        xHomingDone = true;
        stepperX.setCurrentPosition(0);
        Serial.println("x stop triggered");
      } else if (!homingMode) {
        Serial.println("error:Hard limit X triggered! Motor stopped.");
        stepperX.stop();
        stepperY1.stop();
        stepperY2.stop();
        break;
      }
    }

    if (yMovingMin && digitalRead(Y_MIN_PIN) == HIGH) {
      if (homingMode && !yHomingDone) {
        yHomingDone = true;
        stepperY1.setCurrentPosition(0);
        stepperY2.setCurrentPosition(0);
        Serial.println("y stop triggered");
      } else if (!homingMode) {
        Serial.println("error:Hard limit Y triggered! Motor stopped.");
        stepperX.stop();
        stepperY1.stop();
        stepperY2.stop();
        break;
      }
    }

    if (stepperX.distanceToGo() != 0) {
      stepperX.setSpeed(xMovingMin ? -vX : vX);
      stepperX.runSpeed();
    }
    if (stepperY1.distanceToGo() != 0) {
      stepperY1.setSpeed(yMovingMin ? -vY : vY);
      stepperY2.setSpeed(yMovingMin ? -vY : vY);
      stepperY1.runSpeed();
      stepperY2.runSpeed();
    }
  }
```

After `setCurrentPosition(0)`, AccelStepper clears the pending move so `distanceToGo()` returns 0 for that stepper. The other stepper continues running until it also hits its stop.

- [ ] **Step 5: Remove `homeAxis()` function and G28 case**

Delete the entire `homeAxis()` function body (lines 560–649, from `void homeAxis() {` through the closing `}`).

Delete its forward declaration at line 92: `void homeAxis();`

In `processParsedGCode`, delete the entire `case 28:` block:
```cpp
case 28: {
  Serial.println("Homing sequence started...");
  homeAxis();
  Serial.println("ok");
  break;
}
```

- [ ] **Step 6: Manual verification — upload and test**

Upload the firmware to the Arduino Mega. Open Serial Monitor at 115200 baud.

1. Send `$?` — verify output includes `$HOMING=0`.
2. Send `$HOMING=1` then `$?` — verify `$HOMING=1`.
3. Send `$HOMING=0` — verify it resets.
4. Send `G28` — verify `error:` or `ok` (it should be `ok` with no action since case 28 is removed; the GCodeParser default case returns `ok`).
5. Send `G0 X-50 F600` with X limit switch manually held HIGH — verify `error:Hard limit X triggered!` is printed (normal mode still protects).
6. Send `$HOMING=1`, then `G91`, then `G0 X-500 F600` while holding X limit HIGH — verify `x stop triggered` is printed and `ok` follows. Position should report X:0.00.

- [ ] **Step 7: Commit**

```bash
git add "Arduino Codes/Main_Firmware/Main_Firmware.ino"
git commit -m "feat(firmware): app-orchestrated homing mode, flip Y direction, remove G28"
```

---

## Task 2: Settings — `softLimitMargin` + UI field

**Files:**
- Modify: `Desktop_App/src/contexts/SettingsContext.jsx:17-50`
- Modify: `Desktop_App/src/pages/SettingsPage.jsx:205-224`

- [ ] **Step 1: Add `softLimitMargin` to default settings**

In `SettingsContext.jsx`, inside `DEFAULT_SETTINGS` (around line 46, after `bedMaxY: 200`), add:

```js
  softLimitMargin: 10,
```

- [ ] **Step 2: Add the UI field in SettingsPage**

In `SettingsPage.jsx`, inside the "Machine Boundaries" card (after the `bedMaxY` `form-row`, around line 223), add:

```jsx
          <div className="form-row">
            <label>Safe Working Margin (mm)</label>
            <input
              type="number"
              value={settings.softLimitMargin}
              min="0"
              step="1"
              onChange={e => updateSetting('softLimitMargin', parseFloat(e.target.value) || 0)}
            />
          </div>
```

- [ ] **Step 3: Manual verification**

Run `npm run dev` inside `Desktop_App`. Open Settings page. Verify "Safe Working Margin" field appears under Max Y Travel, shows 10, and changes persist after clicking "Save to Disk".

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/contexts/SettingsContext.jsx Desktop_App/src/pages/SettingsPage.jsx
git commit -m "feat(settings): add softLimitMargin with UI field"
```

---

## Task 3: Soft Limits Utility

**Files:**
- Create: `Desktop_App/src/lib/softLimits.js`

- [ ] **Step 1: Create the utility file**

Create `Desktop_App/src/lib/softLimits.js` with the following content:

```js
/**
 * Parse X and Y coordinates from a single G-code line.
 * Returns { x, y } where either may be null if not present.
 * Returns null if the line has neither X nor Y.
 */
export function parseXY(line) {
  const upper = line.trim().toUpperCase();
  const xMatch = upper.match(/X([-\d.]+)/);
  const yMatch = upper.match(/Y([-\d.]+)/);
  if (!xMatch && !yMatch) return null;
  return {
    x: xMatch ? parseFloat(xMatch[1]) : null,
    y: yMatch ? parseFloat(yMatch[1]) : null,
  };
}

/**
 * Returns true if a position falls in the warn/flag zone — too close to any
 * edge or past the positive soft limit.
 *
 * Rule:
 *   - x < softLimitMargin  OR  x > bedMaxX - softLimitMargin  → flagged
 *   - y < softLimitMargin  OR  y > bedMaxY - softLimitMargin  → flagged
 *   - Exception: x === 0 AND y === 0 (explicit home return) → never flagged
 *
 * x or y may be null (axis not specified); only non-null axes are checked.
 */
export function isInWarnZone(x, y, { bedMaxX, bedMaxY, softLimitMargin }) {
  if (x === 0 && y === 0) return false;
  if (x !== null) {
    if (x < softLimitMargin) return true;
    if (x > bedMaxX - softLimitMargin) return true;
  }
  if (y !== null) {
    if (y < softLimitMargin) return true;
    if (y > bedMaxY - softLimitMargin) return true;
  }
  return false;
}

/**
 * Scan an array of G-code line strings for boundary violations.
 * Only checks G0 and G1 lines that contain X or Y coordinates.
 * Returns an array of violation objects: { lineIndex, line, x, y }.
 */
export function scanGCodeBounds(lines, { bedMaxX, bedMaxY, softLimitMargin }) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].trim().toUpperCase();
    if (!upper.startsWith('G0') && !upper.startsWith('G1')) continue;
    const pos = parseXY(upper);
    if (!pos) continue;
    if (isInWarnZone(pos.x, pos.y, { bedMaxX, bedMaxY, softLimitMargin })) {
      violations.push({ lineIndex: i, line: lines[i], x: pos.x, y: pos.y });
    }
  }
  return violations;
}

/**
 * Returns true if a positive-direction jog would exceed the soft ceiling.
 * Only applies when direction > 0 (negative jogs are bounded by physical stop).
 *
 * @param {number} currentPos  Current axis position in mm
 * @param {number} increment   Jog step magnitude (always positive)
 * @param {'X'|'Y'} axis
 * @param {object} settings    Must contain bedMaxX, bedMaxY, softLimitMargin
 */
export function wouldExceedPositiveLimit(currentPos, increment, axis, { bedMaxX, bedMaxY, softLimitMargin }) {
  const target = currentPos + increment;
  const ceiling = axis === 'X' ? bedMaxX - softLimitMargin : bedMaxY - softLimitMargin;
  return target > ceiling;
}
```

- [ ] **Step 2: Smoke-test the utility in browser console**

After `npm run dev`, open DevTools console and run:

```js
// Paste this into console (or add a temporary import in a component)
// isInWarnZone(5, 20, {bedMaxX:200, bedMaxY:200, softLimitMargin:10}) → true  (x<10)
// isInWarnZone(0, 0,  {bedMaxX:200, bedMaxY:200, softLimitMargin:10}) → false (home exempt)
// isInWarnZone(10, 10, {bedMaxX:200, bedMaxY:200, softLimitMargin:10}) → false (on boundary, valid)
// isInWarnZone(195, 50, {bedMaxX:200, bedMaxY:200, softLimitMargin:10}) → true (x>190)
```

- [ ] **Step 3: Commit**

```bash
git add Desktop_App/src/lib/softLimits.js
git commit -m "feat(lib): add softLimits utility — parseXY, isInWarnZone, scanGCodeBounds, wouldExceedPositiveLimit"
```

---

## Task 4: SerialContext — `sendAndWait`, `homeStage`, jog limits, stream skip

**Files:**
- Modify: `Desktop_App/src/contexts/SerialContext.jsx`
- Modify: `Desktop_App/src/pages/ManualControlPage.jsx:8`

This is the largest single change. Read the whole file before editing.

- [ ] **Step 1: Import `useSettings` and soft-limit utilities at the top of `SerialContext.jsx`**

Add these imports after the existing React import line (line 1):

```js
import { useSettings } from './SettingsContext';
import { isInWarnZone, wouldExceedPositiveLimit } from '../lib/softLimits';
```

- [ ] **Step 2: Consume settings inside `SerialProvider` and create a stable ref**

Inside the `SerialProvider` function body, immediately after the opening brace (before any state declarations), add:

```js
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
```

- [ ] **Step 3: Add `pendingWaitMapRef`**

After the existing `const pollIntervalRef = useRef(null);` declaration (around line 76), add:

```js
  const pendingWaitMapRef = useRef(new Map()); // commandId → resolve fn
```

- [ ] **Step 4: Add `sendAndWait` helper after `sendCommand`**

After the entire `sendCommand` `useCallback` (after its closing `}, [connected, logConsole]);` around line 171), add:

```js
  const sendAndWait = useCallback((cmd) => {
    return new Promise((resolve, reject) => {
      if (!connected) { reject(new Error('Not connected')); return; }
      const now = Date.now();
      const id = `cmd-${now}-${Math.random().toString(36).slice(2)}`;
      pendingWaitMapRef.current.set(id, resolve);
      const entry = {
        id, cmd, lineNum: null,
        sentAt: now, timestamp: now,
        ackedAt: null, duration: null,
        status: 'executing',
        type: classifyCommand(cmd),
        source: 'manual',
        response: [],
      };
      commandMapRef.current.set(id, entry);
      pendingQueueRef.current.push(id);
      setCommandLog((prev) => {
        const next = [...prev, entry];
        return next.length > 1000 ? next.slice(-1000) : next;
      });
      logConsole(`> ${cmd}`, 'sent');
      window.platform.send(cmd);
    });
  }, [connected, logConsole]);
```

- [ ] **Step 5: Wire `sendAndWait` resolution into `handleData`'s ok handler**

In the `handleData` function inside the `useEffect` (around line 361), find the `if (isOk)` block. Replace the content of that block with:

```js
      if (isOk) {
        const topId = pendingQueueRef.current.shift();
        if (topId) {
          const entry = commandMapRef.current.get(topId);
          const responses = entry?.response || [];
          if (entry) {
            const now = Date.now();
            const updated = { ...entry, status: 'done', ackedAt: now, duration: now - entry.sentAt };
            commandMapRef.current.set(topId, updated);
            setCommandLog((prev) => prev.map((c) => (c.id === topId ? updated : c)));
          }
          const resolve = pendingWaitMapRef.current.get(topId);
          if (resolve) {
            resolve(responses);
            pendingWaitMapRef.current.delete(topId);
          }
        }
        waitingForOkRef.current = false;
        if (streamingRef.current && !pausedRef.current) sendNextGCodeLine();
      }
```

- [ ] **Step 6: Add `homeStage` async function, replace `findLimits`**

Find and delete the entire `findLimits` `useCallback` (around lines 468–474). Replace it with:

```js
  const homeStage = useCallback(async () => {
    if (!connected) { logConsole('Not connected. Cannot home.', 'error'); return; }
    setMachineState('Homing');
    logConsole('Starting homing sequence...', 'info');
    logEvent('homing_start', 'App-orchestrated homing started', 'info');
    try {
      const s = settingsRef.current;
      const hf = s?.homingFeedrate || 600;
      const backoff = s?.homingBackoff || 2;
      const cx = ((s?.bedMaxX || 200) / 2).toFixed(1);
      const cy = ((s?.bedMaxY || 200) / 2).toFixed(1);
      const mf = s?.maxFeedrate || 1000;

      await sendAndWait('M5');
      await sendAndWait('$HOMING=1');
      await sendAndWait('G91');
      const responses = await sendAndWait(`G0 X-500 Y-500 F${hf}`);

      const xHomed = responses.some(r => r.toLowerCase() === 'x stop triggered');
      const yHomed = responses.some(r => r.toLowerCase() === 'y stop triggered');

      if (!xHomed || !yHomed) {
        logConsole(`Homing failed — stops not triggered (X:${xHomed} Y:${yHomed})`, 'error');
        logEvent('homing_failed', `Stop not triggered — X:${xHomed} Y:${yHomed}`, 'critical');
        setMachineState('Error');
        await sendAndWait('$HOMING=0').catch(() => {});
        await sendAndWait('G90').catch(() => {});
        return;
      }

      await sendAndWait(`G0 X${backoff} Y${backoff} F${hf}`);
      await sendAndWait('G90');
      await sendAndWait('$HOMING=0');
      await sendAndWait(`G0 X${cx} Y${cy} F${mf}`);

      setPosition({ x: parseFloat(cx), y: parseFloat(cy) });
      setMachineState('Idle');
      logConsole('Homing complete. Head at stage centre.', 'info');
      logEvent('homing_done', 'Homing complete', 'info');
    } catch (err) {
      logConsole(`Homing error: ${err.message}`, 'error');
      logEvent('homing_failed', err.message, 'critical');
      setMachineState('Error');
      sendAndWait('$HOMING=0').catch(() => {});
      sendAndWait('G90').catch(() => {});
    }
  }, [connected, logConsole, logEvent, sendAndWait]);
```

- [ ] **Step 7: Add soft-limit skip loop to `sendNextGCodeLine`**

In `sendNextGCodeLine`, after the early-return guard (`if (!streamingRef.current || pausedRef.current) return;`) and the job-complete check, add a skip loop before the `const lineNum = currentLineRef.current;` line:

```js
    // Skip out-of-bounds lines before picking the line to send
    while (currentLineRef.current < totalLinesRef.current) {
      const candidate = gcodeLinesRef.current[currentLineRef.current];
      const upper = candidate.trim().toUpperCase();
      if (upper.startsWith('G0') || upper.startsWith('G1')) {
        const xM = upper.match(/X([-\d.]+)/);
        const yM = upper.match(/Y([-\d.]+)/);
        if (xM || yM) {
          const s = settingsRef.current;
          const x = xM ? parseFloat(xM[1]) : null;
          const y = yM ? parseFloat(yM[1]) : null;
          if (isInWarnZone(x, y, {
            bedMaxX: s?.bedMaxX || 200,
            bedMaxY: s?.bedMaxY || 200,
            softLimitMargin: s?.softLimitMargin || 10,
          })) {
            logConsole(`Skipped out-of-bounds line: ${candidate.trim()}`, 'warning');
            currentLineRef.current++;
            setCurrentLine(currentLineRef.current);
            continue;
          }
        }
      }
      break;
    }
```

After this loop, the existing job-complete check needs to run again (to handle the case where we skipped past the last line). Replace the single existing completion check with a block that is now reached after the skip loop:

The existing structure is: early return → job complete check → send logic. The skip loop goes between the early return and the job complete check. The job-complete check that was already there naturally handles the "skipped to end" case — no duplication needed. Just make sure the skip loop is inserted BEFORE the existing `if (currentLineRef.current >= totalLinesRef.current)` block.

- [ ] **Step 8: Add positive-direction soft limit check to `jogWithIncrement`**

Replace the entire `jogWithIncrement` `useCallback` with:

```js
  const jogWithIncrement = useCallback((axis, direction, increment) => {
    if (direction > 0) {
      const s = settingsRef.current;
      const cur = axis === 'X' ? position.x : position.y;
      if (wouldExceedPositiveLimit(cur, increment, axis, {
        bedMaxX: s?.bedMaxX || 200,
        bedMaxY: s?.bedMaxY || 200,
        softLimitMargin: s?.softLimitMargin || 10,
      })) {
        logConsole(`Jog blocked: would exceed soft limit on ${axis}`, 'warning');
        return;
      }
    }
    const value = increment * direction;
    sendCommand('G91');
    sendCommand(`G0 ${axis}${value.toFixed(3)} F1000`);
    sendCommand('G90');
    setPosition((prev) => ({
      x: axis === 'X' ? prev.x + value : prev.x,
      y: axis === 'Y' ? prev.y + value : prev.y,
    }));
  }, [sendCommand, logConsole, position]);
```

- [ ] **Step 9: Update the context `value` object**

In the `value` object at the bottom of `SerialProvider`, replace `findLimits` with `homeStage`:

```js
    jogWithIncrement, goToPosition, goToOrigin, homeStage, setZero,
```

(Remove `findLimits` from the object.)

- [ ] **Step 10: Update `ManualControlPage.jsx` to use `homeStage`**

In `ManualControlPage.jsx` line 8, in the `useSerial()` destructuring, replace `findLimits` with `homeStage`:

```js
  const {
    connected, position, feedRate, jogWithIncrement, goToPosition, goToOrigin, homeStage, setZero,
    penUp, penDown, setServoAngle,
  } = useSerial();
```

At line 114, replace the button:

```jsx
<button className="btn btn-ghost full-width" onClick={homeStage} disabled={!connected}>Home Stage</button>
```

- [ ] **Step 11: Manual verification**

1. With Arduino connected, open Manual Control page.
2. Click "Home Stage" — machine should move both axes simultaneously toward stops, stop, back off, then move to center. Console should show `x stop triggered` and `y stop triggered` in the log.
3. In the console, send `$HOMING=0` — verify normal limit behavior is restored.
4. Try jogging X+ beyond `bedMaxX - 10` — verify jog is blocked with a console warning.
5. Try jogging X- and Y- all the way to 0 — verify no software block.

- [ ] **Step 12: Commit**

```bash
git add Desktop_App/src/contexts/SerialContext.jsx Desktop_App/src/pages/ManualControlPage.jsx
git commit -m "feat(serial): sendAndWait, homeStage sequence, jog soft limits, stream-time skip"
```

---

## Task 5: GCodeJobsPage + Image2GCodePage — load/compile warnings

**Files:**
- Modify: `Desktop_App/src/pages/GCodeJobsPage.jsx`
- Modify: `Desktop_App/src/pages/Image2GCodePage.jsx`

- [ ] **Step 1: Add warning to `GCodeJobsPage`**

At the top of `GCodeJobsPage.jsx`, add imports:

```js
import { useSettings } from '../contexts/SettingsContext';
import { scanGCodeBounds } from '../lib/softLimits';
```

Inside the `GCodeJobsPage` component function, after the `useJobs` destructuring, add:

```js
  const { settings } = useSettings();
  const [boundsWarning, setBoundsWarning] = useState('');
```

Replace the `selectFile` function with:

```js
  const selectFile = (file) => {
    setSelectedFile(file);
    const lines = file.content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith(';') && !l.startsWith('('));
    setPreviewLines(lines);

    const violations = scanGCodeBounds(lines, {
      bedMaxX: settings.bedMaxX,
      bedMaxY: settings.bedMaxY,
      softLimitMargin: settings.softLimitMargin,
    });
    setBoundsWarning(
      violations.length > 0
        ? `${violations.length} line(s) go outside the safe working area — they will be skipped at run time.`
        : ''
    );
  };
```

In the JSX, add the warning banner directly above the `gcode-preview` div (around line 298, just before `<div className="gcode-preview" ref={previewRef}>`):

```jsx
          {boundsWarning && (
            <div className="bounds-warning-banner">
              ⚠ {boundsWarning}
            </div>
          )}
```

Add the CSS for the banner in `GCodeJobsPage.css`:

```css
.bounds-warning-banner {
  background: rgba(255, 200, 0, 0.12);
  border: 1px solid rgba(255, 200, 0, 0.4);
  border-radius: 4px;
  color: #f0c040;
  font-size: 12px;
  padding: 6px 10px;
  margin-bottom: 6px;
}
```

- [ ] **Step 2: Add warning to `Image2GCodePage`**

At the top of `Image2GCodePage.jsx`, add imports:

```js
import { scanGCodeBounds } from '../lib/softLimits';
```

Add state after `const [compileError, setCompileError] = React.useState('');`:

```js
  const [compileWarning, setCompileWarning] = React.useState('');
```

In `handleCompile`, after `setCompiledGCode(lines);` and before `setCompileError('');`, add:

```js
      const violations = scanGCodeBounds(lines, {
        bedMaxX: settings?.bedMaxX || 200,
        bedMaxY: settings?.bedMaxY || 200,
        softLimitMargin: settings?.softLimitMargin || 10,
      });
      setCompileWarning(
        violations.length > 0
          ? `${violations.length} line(s) go outside the safe working area (${settings?.softLimitMargin || 10}mm margin) and will be skipped at run time.`
          : ''
      );
```

In the JSX bottom bar, after the `{compileError && ...}` span, add:

```jsx
            {compileWarning && <span className="warning-text" style={{ marginLeft: 8, color: '#f0c040', fontSize: 12 }}>{compileWarning}</span>}
```

- [ ] **Step 3: Manual verification**

1. Open G-Code Jobs, select "Calibration Grid" — verify no warning (coordinates start at X10 after Task 7).
2. Load a custom `.gcode` file with `G0 X2 Y2` — verify warning banner appears.
3. Open Image2GCode, compile an image — if no violations, no warning; manually edit the compiler output (or use a tiny image) to confirm the scan triggers.

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/pages/GCodeJobsPage.jsx Desktop_App/src/pages/GCodeJobsPage.css Desktop_App/src/pages/Image2GCodePage.jsx
git commit -m "feat(ui): soft limit warnings at load and compile time"
```

---

## Task 6: GCodePreview — stage view enhancements

**Files:**
- Modify: `Desktop_App/src/components/GCodePreview.jsx`

- [ ] **Step 1: Add `softLimitMargin` prop**

Change the component signature from:

```js
export default function GCodePreview({ lines = [], bedW = 200, bedH = 200 }) {
```

to:

```js
export default function GCodePreview({ lines = [], bedW = 200, bedH = 200, softLimitMargin = 10 }) {
```

- [ ] **Step 2: Pass `softLimitMargin` from `Image2GCodePage`**

In `Image2GCodePage.jsx`, find the `<GCodePreview .../>` usage (around line 162) and add the prop:

```jsx
<GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} softLimitMargin={settings?.softLimitMargin || 10} />
```

- [ ] **Step 3: Add stage view rendering to `GCodePreview`'s `useEffect`**

At the end of the `useEffect` in `GCodePreview.jsx`, after the existing G-code path drawing loop, add the following block before the closing `}`:

```js
    // ── Soft-limit inner border ────────────────────────────────────────────────
    const mPxX = softLimitMargin * scaleX;
    const mPxY = softLimitMargin * scaleY;
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(mPxX, mPxY, W - 2 * mPxX, H - 2 * mPxY);
    ctx.setLineDash([]);

    // ── Drawing bounding box (G1 pen-down moves only) ──────────────────────────
    let penDown2 = false;
    let drawMinX = Infinity, drawMinY = Infinity, drawMaxX = -Infinity, drawMaxY = -Infinity;
    for (const line of lines) {
      const t = line.trim().toUpperCase();
      if (t.includes('M280') && t.includes('S')) {
        const sM = t.match(/S([\d.]+)/);
        if (sM) penDown2 = parseFloat(sM[1]) < 60;
      }
      if (!t.startsWith('G1') || !penDown2) continue;
      const xM = t.match(/X([-\d.]+)/);
      const yM = t.match(/Y([-\d.]+)/);
      const nx2 = xM ? parseFloat(xM[1]) : null;
      const ny2 = yM ? parseFloat(yM[1]) : null;
      if (nx2 !== null) { drawMinX = Math.min(drawMinX, nx2); drawMaxX = Math.max(drawMaxX, nx2); }
      if (ny2 !== null) { drawMinY = Math.min(drawMinY, ny2); drawMaxY = Math.max(drawMaxY, ny2); }
    }
    if (drawMinX < Infinity) {
      const [bx, by] = toCanvas(drawMinX, drawMaxY);
      const bw = (drawMaxX - drawMinX) * scaleX;
      const bh = (drawMaxY - drawMinY) * scaleY;
      ctx.fillStyle = 'rgba(0, 191, 255, 0.10)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(0, 191, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(0, 191, 255, 0.85)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelW = Math.round(drawMaxX - drawMinX);
      const labelH = Math.round(drawMaxY - drawMinY);
      if (bw > 30 && bh > 14) ctx.fillText(`${labelW}×${labelH}mm`, bx + bw / 2, by + bh / 2);
    }

    // ── Dimension labels ───────────────────────────────────────────────────────
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(180, 180, 200, 0.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${bedW} mm`, W / 2, H - 3);

    ctx.save();
    ctx.translate(10, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(`${bedH} mm`, 0, 0);
    ctx.restore();

    // ── Axis labels ────────────────────────────────────────────────────────────
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('X→', W - 2, H - 3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('↑Y', 2, 2);
```

Also add `softLimitMargin` to the `useEffect` dependency array:

```js
  }, [lines, bedW, bedH, softLimitMargin]);
```

- [ ] **Step 3: Manual verification**

1. Open Image2GCode, compile any image.
2. In the bottom bar preview, verify:
   - A faint dashed amber rectangle appears slightly inset from the canvas edge (soft limit border).
   - Dimension labels show `200 mm` on bottom and left edges.
   - Axis labels `X→` (bottom-right) and `↑Y` (top-left) are visible.
   - A faint blue rectangle with `NNN×NNNmm` label shows the drawing footprint.

- [ ] **Step 4: Commit**

```bash
git add Desktop_App/src/components/GCodePreview.jsx Desktop_App/src/pages/Image2GCodePage.jsx
git commit -m "feat(preview): stage dimensions, soft-limit border, drawing bounding box"
```

---

## Task 7: Built-in G-code Cleanup

**Files:**
- Modify: `Desktop_App/src/data/builtinGcodes.js`

- [ ] **Step 1: Update `line` — move start from X0 to X10**

Replace the `line` content string with:

```js
    content: `; Simple straight line — 50mm horizontal
G90
M5
G0 X10 Y15 F1000
M3 S30
G4 P200
G1 X60 Y15 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
```

- [ ] **Step 2: Update `triangle` — X10 Y10 are exactly on the boundary (valid, keep as-is)**

No change needed — X10 Y10 satisfies `x >= softLimitMargin` (10 is not < 10).

- [ ] **Step 3: Update `square` — shift from X5 Y5 to X15 Y15**

Replace the `square` content string with:

```js
    content: `; Square 40x40mm
G90
M5
G0 X15 Y15 F1000
M3 S30
G4 P200
G1 X55 Y15 F800
G1 X55 Y55 F800
G1 X15 Y55 F800
G1 X15 Y15 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
```

- [ ] **Step 4: Update `rectangle` — shift from X5 Y10 to X15 Y15**

Replace the `rectangle` content string with:

```js
    content: `; Rectangle 60x30mm
G90
M5
G0 X15 Y15 F1000
M3 S30
G4 P200
G1 X75 Y15 F800
G1 X75 Y45 F800
G1 X15 Y45 F800
G1 X15 Y15 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
```

- [ ] **Step 5: Update `cross` — shift X5/Y5 to X10/Y10 boundaries**

Replace the `cross` content string with:

```js
    content: `; Plus / Cross shape
G90
M5

; Horizontal bar
G0 X10 Y25 F1000
M3 S30
G4 P200
G1 X60 Y25 F800
G1 X60 Y31 F800
G1 X10 Y31 F800
G1 X10 Y25 F800
M5

; Vertical bar
G4 P200
G0 X25 Y10 F1000
M3 S30
G4 P200
G1 X31 Y10 F800
G1 X31 Y60 F800
G1 X25 Y60 F800
G1 X25 Y10 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
```

- [ ] **Step 6: Update `calibration-grid` — remove G28, shift grid to X10–X60, Y10–Y60**

Replace the `calibration-grid` content string with:

```js
    content: `; ==========================================
; Calibration Grid 50x50mm, 10mm spacing
; Use this to verify steps/mm settings.
; Expected result: perfectly square grid.
; ==========================================
G90
M5
G4 P500

; Vertical lines (X = 10 to 60, spaced 10mm)
G0 X10 Y10 F1000
M3 S30
G4 P200
G1 Y60 F800
M5
G4 P200

G0 X20 Y10 F1000
M3 S30
G4 P200
G1 Y60 F800
M5
G4 P200

G0 X30 Y10 F1000
M3 S30
G4 P200
G1 Y60 F800
M5
G4 P200

G0 X40 Y10 F1000
M3 S30
G4 P200
G1 Y60 F800
M5
G4 P200

G0 X50 Y10 F1000
M3 S30
G4 P200
G1 Y60 F800
M5
G4 P200

G0 X60 Y10 F1000
M3 S30
G4 P200
G1 Y60 F800
M5
G4 P200

; Horizontal lines (Y = 10 to 60, spaced 10mm)
G0 X10 Y10 F1000
M3 S30
G4 P200
G1 X60 F800
M5
G4 P200

G0 X10 Y20 F1000
M3 S30
G4 P200
G1 X60 F800
M5
G4 P200

G0 X10 Y30 F1000
M3 S30
G4 P200
G1 X60 F800
M5
G4 P200

G0 X10 Y40 F1000
M3 S30
G4 P200
G1 X60 F800
M5
G4 P200

G0 X10 Y50 F1000
M3 S30
G4 P200
G1 X60 F800
M5
G4 P200

G0 X10 Y60 F1000
M3 S30
G4 P200
G1 X60 F800
M5
G4 P500

G0 X0 Y0 F1000
`,
```

- [ ] **Step 7: Update `test-square` — shift from X5 Y5 to X15 Y15**

Replace the `test-square` content string with:

```js
    content: `; ==========================================
; Test Square 40x40mm
; Quick motion and pen test.
; ==========================================
G90
M5
G4 P300

G0 X15 Y15 F1000
M3 S30
G4 P200

G1 X55 Y15 F800
G1 X55 Y55 F800
G1 X15 Y55 F800
G1 X15 Y15 F800

M5
G4 P300
G0 X0 Y0 F1000
`,
```

- [ ] **Step 8: Verify `pen-test`, `the-house`, `spiral` need no changes**

- `pen-test`: minimum position is X10 Y20 — X10 is not less than `softLimitMargin` (10 < 10 is false). Valid.
- `the-house`: minimum position is X20 Y20. Valid.
- `spiral`: minimum position is X16 Y16. Valid.

No changes needed for these three.

- [ ] **Step 9: Update `diagonal-test` — shift from X5 Y5 to X15 Y15**

Replace the `diagonal-test` content string with:

```js
    content: `; ==========================================
; Diagonal Accuracy Test
; Checks X and Y motion synchronization.
; ==========================================
G90
M5

; Large X cross
G0 X15 Y15 F1000
M3 S30
G4 P200
G1 X65 Y65 F800
M5

G4 P200
G0 X65 Y15 F1000
M3 S30
G4 P200
G1 X15 Y65 F800
M5

; Border square
G4 P200
G0 X15 Y15 F1000
M3 S30
G4 P200
G1 X65 Y15 F800
G1 X65 Y65 F800
G1 X15 Y65 F800
G1 X15 Y15 F800
M5

; Center dot
G4 P200
G0 X40 Y40 F1000
M3 S30
G4 P500
M5
G4 P400
G0 X0 Y0 F1000
`,
```

- [ ] **Step 10: Manual verification**

1. Open G-Code Jobs, select each built-in G-code and verify no bounds warning banner appears.
2. Select "Calibration Grid" — confirm no G28 line visible in the preview.
3. With machine connected, run the "Pen Lift Test" to verify the G-code executes without skipped lines.

- [ ] **Step 11: Commit**

```bash
git add Desktop_App/src/data/builtinGcodes.js
git commit -m "fix(gcodes): remove G28, move all coordinates inside safe working margin"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| 1.1 Y flip | Task 1 step 1 |
| 1.2 `$HOMING` flag | Task 1 steps 2–3 |
| 1.3 Remove G28 | Task 1 step 5 |
| 1.4 Hard limits still operative | Task 1 step 4 (`!homingMode` branch) |
| 2. Serial protocol messages | Task 1 step 4 (`Serial.println`) + Task 4 step 6 (response parse) |
| 3.1 `sendAndWait` | Task 4 steps 4–5 |
| 3.2 `homeStage` 8-step sequence | Task 4 step 6 |
| 3.3 Jog direction note | Task 4 step 8 |
| 4.1 `softLimitMargin` setting | Task 2 step 1 |
| 4.2 SettingsPage field | Task 2 step 2 |
| 4.3 Soft limit rule | Task 3 (`softLimits.js`) |
| 4.4 Compile/load time warning | Task 5 |
| 4.4 Stream-time skip | Task 4 step 7 |
| 4.4 Jog positive limit | Task 4 step 8 |
| 4.4 goToPosition | Not implemented (spec says warn but send — `goToPosition` sends directly; add a warning-only log at the call site if desired, but spec marks it as low-priority since user explicitly typed coordinates) |
| 5.1–5.4 GCodePreview enhancements | Task 6 |
| 6.1 Remove G28 | Task 7 step 6 |
| 6.2 Coordinate updates | Task 7 steps 1–9 |

**One gap:** `goToPosition` in `SerialContext` has no soft limit check. The spec says "warn but still send." This is a one-liner addition in Task 4 that was not enumerated as a step — add it to `goToPosition`:

```js
  const goToPosition = useCallback((x, y) => {
    const s = settingsRef.current;
    const inWarn = isInWarnZone(x, y, {
      bedMaxX: s?.bedMaxX || 200,
      bedMaxY: s?.bedMaxY || 200,
      softLimitMargin: s?.softLimitMargin || 10,
    });
    if (inWarn) logConsole(`Warning: position (${x}, ${y}) is in the soft-limit zone`, 'warning');
    sendCommand('G90');
    sendCommand(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F1000`);
    setPosition({ x, y });
  }, [sendCommand, logConsole]);
```

Add this as **Task 4 Step 8b** (between the current steps 8 and 9) and include `isInWarnZone` in the imports at step 1.
