# Graduation Project — General-Purpose 3-Axis CNC Machine

A university capstone project: a 3-axis CNC "platform" (pen plotter / drawing machine) controlled by an
Arduino-based firmware and an Electron+React desktop application. The repo contains the firmware, the
desktop app, project documentation/reports, and planning docs.

## Repo Layout

- `Arduino Codes/Main_Firmware/` — Arduino firmware (`Main_Firmware.ino`) for the CNC controller.
- `Arduino Codes/` — also contains several earlier test sketches (`Test_1`–`Test_6`, `Hardware_Test`,
  `Push_Buttons`, `Servo_Test`, `WASD`) used during hardware bring-up; not production code.
- `Desktop_App/` — Electron + React + Vite desktop control application (see below).
- `Input Files/` — sample G-code and bitmap files used for testing the Image2GCode pipeline.
- `docs/superpowers/specs/` — design spec docs written during feature work (dated `YYYY-MM-DD-<topic>`).
  Check here first for prior design decisions before proposing new architecture. Current specs:
  - `2026-06-06-homing-soft-limits-stage-view.md`
  - `2026-06-06-image2gcode-fixes-and-jobs.md`
  - `2026-06-06-image2gcode-redesign.md`
  - `2026-06-06-logging-redesign-design.md`
  - `2026-06-07-image2gcode-tracing-and-jobs-ux-design.md`
- `docs/superpowers/plans/` — full implementation plans (longer, more detailed) matching the specs above.
- `todo.md` — running list of planned features/fixes for future iterations ("rotations").
- Top-level `.docx`/`.pdf` files — university report drafts/submissions, not source code.

---

## Arduino Firmware (`Arduino Codes/Main_Firmware/Main_Firmware.ino`)

**Board:** Arduino Mega 2560  
**Libraries:** `AccelStepper`, `MultiStepper`, `Servo`, `GCodeParser`  
**Baud rate:** 115200

### Pin Map

| Signal        | Pin  |
|---------------|------|
| Y1 STEP       | 6    |
| Y1 DIR        | 7    |
| Y2 STEP       | 4    |
| Y2 DIR        | 5    |
| X STEP        | 2    |
| X DIR         | 3    |
| ENABLE (shared)| 8   |
| Z Servo (pen) | 9    |
| X limit switch (X_MIN) | 19 (INPUT_PULLUP) |
| Y limit switch (Y_MIN) | 18 (INPUT_PULLUP) |

> Y-axis uses **two physically mirrored steppers** (Y1 + Y2) that always move together.
> All three motor directions are **inverted in software** (`setPinsInverted(true, false, false)`)
> because the motors were wired backwards on the physical machine.

### Motion

- Uses `MultiStepper` to coordinate all three steppers together (`steppers.moveTo(positions[3])`).
- Feed rate is `mm/min`; firmware converts to steps/sec before driving `AccelStepper::runSpeed()`.
- `moveLinear(targetXMm, targetYMm, feedRate)` does proportional speed scaling per axis so both
  axes arrive at the same time (correct linear interpolation).
- Acceleration is set to `2 × maxSps` per axis.
- Steps/mm formula: `(stepsPerRev × microsteps) / leadScrewPitchMm` (default: 200 × 16 / 8 = 400 steps/mm).

### Telemetry

- Firmware autonomously sends a `[TELEMETRY] X:... Y:... State:... F:... Servo:... LimX:... LimY:...`
  line every **500 ms** (even during motion). The app parses these instead of polling with `?`.
- The `?` query command still works and returns a `X:... Y:...` + `State:...` block + `ok`.

### Supported G/M codes

| Code | Behaviour |
|------|-----------|
| `G0 X Y F` | Rapid move (same as G1, treated identically by firmware) |
| `G1 X Y F` | Linear move |
| `G4 P<ms>` | Dwell / wait |
| `G21` | mm mode (acknowledged, no internal effect — firmware is always mm) |
| `G28` | Home (acknowledged; actual homing is app-orchestrated, see below) |
| `G90` | Absolute positioning mode |
| `G91` | Relative positioning mode |
| `G92 X Y` | Set work origin (offsets stepper position counters) |
| `M0` | Pause — firmware does not implement this; the **app** pauses streaming when it encounters M0 |
| `M3 [S<angle>]` | Pen down (servo to `servoPenDown` or to explicit angle) |
| `M5` | Pen up (servo to `servoPenUp`) |
| `M280 [S<angle>]` | Set servo to explicit angle |
| `!` | Feed hold (acknowledged with `ok`; stoppage is handled app-side) |
| `~` | Cycle start/resume (acknowledged) |
| `\x18` | **Emergency stop** — immediately stops all motors, raises pen, clears buffer |
| `?` | Status query — returns position + state line |
| `$?` | Print all config values |
| `$KEY=VALUE` | Set a runtime config parameter (see below) |

### Runtime config keys (`$KEY=VALUE`)

| Key | Default | Description |
|-----|---------|-------------|
| `$SPR` | 200 | Steps per revolution |
| `$MS` | 16 | Microstep divisor |
| `$LP` | 8.0 | Lead screw pitch (mm) |
| `$MF` | 3000 | Max feedrate (mm/min) |
| `$MINF` | 10 | Min feedrate (mm/min) |
| `$HF` | 600 | Homing feedrate (mm/min) |
| `$HB` | 2.0 | Homing backoff distance (mm) |
| `$SU` | 75 | Servo pen-up angle |
| `$SD` | 30 | Servo pen-down angle |
| `$SH` | 75 | Servo home/rest angle |
| `$ST` | 150 | Servo settle delay (ms) |
| `$HOMING` | 0 | Enable/disable homing mode (1=on). In homing mode limit switches trigger `x stop triggered` / `y stop triggered` messages instead of hard-stop errors. |

### Homing protocol (app-orchestrated)

1. App sends `$HOMING=1` to enable homing mode.
2. App sends `G91` then `G0 X-500 Y-500 F<homingFeedrate>` (a large negative move).
3. Firmware drives to the limit switches; on trigger it resets that axis to position 0 and
   prints `x stop triggered` / `y stop triggered`.
4. App waits for both stop messages in the response array.
5. App sends `G0 X<backoff> Y<backoff>` (backs off from switches), `G90`, `$HOMING=0`,
   then moves head to stage centre (`bedMaxX/2, bedMaxY/2`).
6. App sets its own `position` state to the centre coordinates.
7. If either stop is never triggered, the app reports an error and sends `$HOMING=0` / `G90` cleanup.

---

## Desktop App (`Desktop_App/`)

**Stack:** Electron 28, React 18, React Router 6 (HashRouter), Vite 6,
`serialport` v12 (machine comms), `fabric` v5 (vector canvas editor),
`imagetracerjs` v1.2.6 (raster→SVG tracing), `svg-path-parser` (SVG path → G-code),
`lucide-react` (icons).

### Run commands (from `Desktop_App/`)

```bash
npm run dev            # Vite dev server only (browser, no serial/Electron)
npm run electron:dev   # Vite + Electron together (full app, hot reload)
npm run start          # vite build then launch Electron (production-like)
npm run electron       # Launch Electron against last build (no rebuild)
```

> **Note:** `npm run dev` runs in the browser where `window.platform` is `undefined`.
> All serial and file-system features require `npm run electron:dev` or `npm run start`.

### Process split

#### `main.js` (Electron main process)

- Creates a 1360×820 window (min 1100×700), dark `#1E1E1E` background.
- Loads Vite dev server (`http://localhost:5173`) in dev mode; `dist/index.html` in production.
- Owns the single `SerialPort` instance; all serial I/O goes through IPC.
- Persists settings to `<userData>/machine-settings.json`.
- Persists G-code jobs to `<userData>/jobs/*.gcode` (auto-creates the `jobs` dir on startup).
- **IPC channels exposed:**
  - `serial:list-ports` → `SerialPort.list()` → `[{ path, manufacturer, vendorId }]`
  - `serial:connect` `{ portPath, baudRate }` → opens port with `ReadlineParser`; pushes data via `serial:data` event, status via `serial:status` event
  - `serial:disconnect` → closes port
  - `serial:send` `data` → writes `data + '\n'`, then drains
  - `file:load-gcode` → open-file dialog (`.gcode`, `.nc`, `.ngc`, `.txt`) → `{ name, path, content, size, lines }`
  - `file:save-log` `content` → save-file dialog → writes text file
  - `file:save-gcode` `lines[]` → save-file dialog → writes joined lines
  - `file:save-job` `name, lines[]` → saves to `<userData>/jobs/<sanitized>-<timestamp>.gcode`
  - `file:get-jobs` → scans `jobs/` dir, returns `[{ name, path, content, size, lines }]`
  - `file:open-jobs-folder` → `shell.openPath(jobsDir)`
  - `settings:load` → reads JSON from `machine-settings.json`, returns parsed object or null
  - `settings:save` `settings` → writes JSON

#### `preload.js` (context bridge)

Exposes `window.platform` with these methods:
- `listPorts()`, `connect(portPath, baudRate)`, `disconnect()`, `send(data)`
- `loadGCodeFile()`, `saveLog(content)`, `saveGCode(lines)`, `saveJob(name, lines)`, `getJobs()`, `openJobsFolder()`
- `loadSettings()`, `saveSettings(settings)`
- `onData(callback)` → returns unsubscribe fn (registers `serial:data` IPC listener)
- `onStatus(callback)` → returns unsubscribe fn (registers `serial:status` IPC listener)

#### `src/main.jsx` (React renderer entry)

Provider order (outer to inner, so inner can consume outer):
`SettingsProvider → SerialProvider → JobsProvider → Image2GCodeProvider → App`

Uses `HashRouter` (required for Electron file:// loading in production builds).

---

### Routing (`src/App.jsx`)

App layout: `<Sidebar>` + `<AppContent>` (flex row).

`AppContent` includes a `<ConsoleDrawer>` slide-up panel on all pages **except** `/console` (avoids
redundancy). Routes:

| Path | Component |
|------|-----------|
| `/` | `DashboardPage` |
| `/manual` | `ManualControlPage` |
| `/gcode` | `GCodeJobsPage` |
| `/image2gcode` | `Image2GCodePage` |
| `/settings` | `SettingsPage` |
| `/console` | `ConsolePage` |
| `*` | Redirect to `/` |

---

### Pages (`src/pages/`)

#### `DashboardPage`
- Shows connection status, machine state (`Idle`, `Homing`, `Streaming`, `Paused`, `Error`),
  live X/Y position (from telemetry), feed rate, servo angle, and limit-switch states.
- Provides connect/disconnect UI: port selector (refreshed via `refreshPorts`), baud rate dropdown,
  Connect / Disconnect buttons.
- Shows **Homing** button (calls `homeStage()` on `SerialContext`).
- Quick-action buttons: Go to Origin, Set Zero, Pen Up, Pen Down.

#### `ManualControlPage`
- Jog controls: arrow-key-style buttons for X+/X−/Y+/Y− with selectable step sizes (0.1/1/5/10 mm).
- `jogWithIncrement(axis, direction, increment)` is called on click; soft-limit check happens before sending.
- Direct G-code input field (send any raw command).
- Current position display.

#### `GCodeJobsPage`
Three-tab layout:
1. **Built-in** — predefined patterns from `src/data/builtinGcodes.js` (shapes, calibration, demo).
   Categories: `shapes`, `calibration`, `demo`.
2. **Loaded** — user-imported jobs from `JobsContext` (persisted across restarts). "Load File" button
   calls `window.platform.loadGCodeFile()` then adds to context. "Delete" removes from context (not disk).
3. **History** — completed/stopped run records from `SerialContext.jobHistory` with link to
   `/console?jobId=...` for per-run filtered logs.

Common bottom bar: G-code preview (`GCodePreview` canvas), streaming controls (Start/Pause/Resume/Stop),
bounds warning banner if soft-limits would be exceeded. "Save Job" saves compiled gcode to userData/jobs
via `window.platform.saveJob()`.

#### `Image2GCodePage`
Two-tab workspace:
1. **Image to G-Code tab** (`ImageToGCodeTab`) — raster image import, tracer parameter sliders,
   binarize checkbox, preview of traced SVG. "Send to Vector Editor" button passes traced SVG to the
   second tab.
2. **Vector Drawer tab** (`VectorDrawerTab`) — wraps `VectorEditor` (Fabric.js canvas).

Shared bottom bar (both tabs): line width slider, Compile button, G-code preview, Save Job, Run Job.
State lives in `Image2GCodeContext` (survives tab navigation).

#### `SettingsPage`
Editable form for all `DEFAULT_SETTINGS` fields. "Save Settings" persists to disk. "Apply to Arduino"
sends `$KEY=VALUE` commands via `SettingsContext.applyToArduino(sendCommand)`:
`$MS`, `$SPR`, `$LP`, `$MF`, `$HF`, `$HB`, `$SU`, `$SD`, `$SH`, `$ST`.

#### `ConsolePage`
Full-height serial log viewer. Features:
- Three log tabs: **Console** (timestamped serial I/O), **Commands** (per-command with duration/status),
  **Events** (structured events with levels info/warning/critical).
- Job-ID filtering via `?jobId=<uuid>` query param (linked from History tab).
- "Clear" and "Export Log" (calls `window.platform.saveLog()`).
- Color-coded log entries: sent (blue), received (green), error (red), telemetry (dim), info (grey), warning (yellow).

#### `ConsoleDrawer` (component, not a page)
Collapsed slide-up panel visible on all pages except `/console`. Shows the last few console lines.
Clicking it opens the full `ConsolePage`.

---

### Contexts (`src/contexts/`)

#### `SerialContext.jsx` — the most complex context

**State exposed:**
- `connected`, `portPath`, `ports` — connection state
- `selectedPort`, `setSelectedPort` — UI-controlled port selection
- `position { x, y }` — current machine position (mm), updated from telemetry
- `feedRate`, `spindleSpeed`, `machineState` — machine status
- `arduinoState { positionMode, feedRate, servoAngle, limX, limY }` — parsed from telemetry/? query
- `streaming`, `paused`, `currentLine`, `totalLines` — streaming progress
- `consoleLog`, `commandLog`, `eventLog` — three separate log arrays (capped at 500/1000/500 entries)
- `jobHistory` — array of `{ id, name, startedAt, endedAt, duration, status, jobId }` (capped at 100)

**Key methods exposed:**
- `refreshPorts()` — calls `window.platform.listPorts()`
- `connect(port, baudRate)` / `disconnect()`
- `sendCommand(cmd)` — fire-and-forget; logs to commandLog with status tracking
- `sendAndWait(cmd)` → Promise resolving with `response[]` array — used for homing sequence
- `startStreaming(lines, jobName)` / `pauseStreaming()` / `resumeStreaming()` / `stopStreaming()`
- `jogWithIncrement(axis, direction, increment)` — applies soft-limit check before sending
- `goToPosition(x, y)` — warns if in soft-limit zone
- `homeStage()` — full async homing sequence (see Homing protocol above)
- `goToOrigin()` — `G90; G0 X0 Y0`
- `setZero()` — `G92 X0 Y0`
- `penUp()` / `penDown()` / `setServoAngle(angle)`
- `logConsole(msg, type)` / `logEvent(event, msg, level)` / `clearConsole()`

**Command tracking internals:**
- `pendingQueueRef` — FIFO queue of command IDs waiting for `ok`
- `commandMapRef` — Map of id → command entry (mutated in-place for performance)
- `pendingWaitMapRef` — Map of id → `{ resolve, reject }` for `sendAndWait` promises
- Each incoming line: if `ok`, pops front of queue, marks done, resolves any waiter, calls `sendNextGCodeLine` if streaming
- If `error:...`, pops front of queue, marks error, rejects any waiter
- `[TELEMETRY]` lines are parsed for position/state and logged as `telemetry` type (not shown in command log)

**Streaming mechanics:**
- Streaming is purely app-side: one G-code line is sent at a time, next line sent only after `ok` received.
- Soft-limit check happens **before** each line is sent; out-of-bounds G0/G1 moves are **skipped** (logged as warning).
- `M0` in G-code auto-pauses streaming (for multi-color pen swap).
- Stop sends `\x18` (emergency stop) to Arduino to immediately halt motion.

#### `SettingsContext.jsx`

Loads settings on mount from `window.platform.loadSettings()`, merges with `DEFAULT_SETTINGS`.
Computes `stepsPerMm = (stepsPerRev × microsteps) / leadScrewPitchMm`.

**`DEFAULT_SETTINGS`:**
```js
{
  stepsPerRev: 200, microsteps: 16, leadScrewPitchMm: 8.0,
  maxFeedrate: 3000, minFeedrate: 10, homingFeedrate: 600, homingBackoff: 2.0,
  servoPenUp: 75, servoPenDown: 30, servoHome: 90, servoSettleMs: 150,
  minStepPulseUs: 5, dirSetupDelayUs: 5, minLoopDelayUs: 50,
  enableLimitSwitchX: true, enableLimitSwitchY: true,
  defaultBaudRate: '115200',
  bedMaxX: 200, bedMaxY: 200, softLimitMargin: 10,
}
```

#### `JobsContext.jsx`

Loads all saved jobs from disk via `window.platform.getJobs()` on mount.
Exposes `loadedFiles` array and add/remove helpers. Used by the "Loaded" tab in `GCodeJobsPage`.

#### `Image2GCodeContext.jsx`

Holds `Image2GCodePage` state across tab navigation:
`previewSrc`, `tracedSVG`, `tracerOptions`, `compiledGCode`, `activeTab`, `lineWidth`, `multicolorMode`.

---

### Components (`src/components/`)

#### `Sidebar.jsx` / `Sidebar.css`

Collapsible left sidebar (240px expanded, 64px collapsed — CSS vars `--sidebar-width` / `--sidebar-collapsed`).
Navigation links to all six pages with `lucide-react` icons and active state highlighting.

#### `ConsoleDrawer.jsx` / `ConsoleDrawer.css`

Slide-up drawer (collapsed by default). Shows last N console entries. Click to expand, or navigate to
`/console` for the full view.

#### `GCodePreview.jsx` / `GCodePreview.css`

2D top-down canvas preview of a G-code toolpath. Draws:
- Bed boundary rectangle (grey outline)
- Soft-limit margin zone (shaded red border)
- Drawing bounding box (blue overlay)
- Toolpath: rapid moves (grey dashed), draw moves (black solid), pen-up positions (small circles)

Takes props: `lines` (G-code string array), `bedMaxX`, `bedMaxY`, `softLimitMargin`.

#### `Dialog.jsx` / `Dialog.css`

Simple modal dialog. Supports `mode="confirm"` (with Confirm + Cancel buttons) and `mode="info"`.

#### `VectorEditor/VectorEditor.jsx` + `ToolPalette.jsx`

Fabric.js canvas with bed-boundary overlay (dashed rect, `excludeFromExport: true`).

**Tools available:** `select`, `pen` (freehand), `rect`, `circle`, `line`, `text`.

**`useImperativeHandle` API:**
- `toSVG()` — exports canvas SVG (bed boundary excluded)
- `loadSVG(svgString)` — loads and scales SVG into the canvas (used when "Send to Vector Editor" is clicked)

**Delete:**
- `Delete`/`Backspace` key deletes selected object(s)
- "Delete All" button triggers a confirmation `Dialog` then clears all non-excluded objects

**Injected SVG:** When `injectedSVG` prop changes, clears user objects and loads the new SVG centred and scaled to 90% of bed width.

---

### Lib (`src/lib/`)

#### `gcodeCompiler.js`

`compileSVGToGCode(svgString, settings)` — main export.

**Settings:** `{ maxFeedrate, servoPenDown, servoPenUp, bedH, multicolorMode }`

**Pipeline:**
1. Parses SVG DOM with `DOMParser` (browser API — renderer process only).
2. Extracts `<path>`, `<rect>`, `<ellipse>`, `<circle>`, `<line>` elements.
3. Applies composed parent transforms (`matrix`, `translate`, `scale`) per element.
4. Converts paths using `svg-path-parser` (`parseSVG` + `makeAbsolute`).
   - Bezier curves (`C`/`Q`) are **approximated as straight lines to endpoint** (adequate for pen plotter).
5. Flips Y: `machineY = bedH - svgY` (SVG Y grows down; machine Y grows up).
6. Emits header: `G21 ; mm units`, `G90 ; absolute positioning`, `F<maxFeedrate>`, `M280 P0 S<servoPenUp>`.
7. For each path: `G0` to start (pen up), then `M280 S<servoPenDown>` + `G1` sequence, `M280 S<servoPenUp>` at end.
8. In `multicolorMode`: groups paths by `fill` color, inserts `M0 ; Change pen to color: <color>` between groups.
9. Returns home: `G0 X0 Y0`.
10. Returns `lines[]` array.

**Known issue (as of 2026-06):** The `isWhiteOrNone` check in `gcodeCompiler.js` uses a hardcoded
near-white brightness threshold (`r > 250 && g > 250 && b > 250`). A separate, better implementation
exists in `colorMatch.js` (`isBackgroundColor` with `sampleCornerColor`), but the compiler still uses
the old inline function. The `colorMatch.js` module is a newer, more robust replacement that should
eventually replace the inline function.

#### `softLimits.js`

- `parseXY(line)` — extracts `{ x, y }` from a G-code line string (either may be null).
- `isInWarnZone(x, y, { bedMaxX, bedMaxY, softLimitMargin })` — true if position is within `softLimitMargin` mm of any edge. Exception: `(0, 0)` is never flagged (explicit home return).
- `scanGCodeBounds(lines, settings)` — scans a whole job's G0/G1 lines and returns an array of violation objects `{ lineIndex, line, x, y }`.
- `wouldExceedPositiveLimit(currentPos, increment, axis, settings)` — used by jog controls to block
  moves that would exceed `bedMaxX/Y - softLimitMargin`.

#### `colorMatch.js`

- `parseRgbColor(colorStr)` → `{ r, g, b }` or `null`
- `colorDistance(a, b)` → Euclidean RGB distance
- `isWhiteOrNone(colorStr)` → strict white check (exact `rgb(255,255,255)` / `#fff` / `#ffffff`)
- `isBackgroundColor(colorStr, backgroundColor)` → distance-based check against a sampled background color (threshold: 60). Falls back to `isWhiteOrNone` if no background given.

#### `imageBinarize.js`

- `binarizeImageData(imageData, threshold)` — converts `ImageData` to B&W using luminance (`0.299R + 0.587G + 0.114B`). Returns a new `{ width, height, data }` object.
- `sampleCornerColor(imageData, marginRatio)` — averages pixel color at the four corners (within a 2% margin). Used to detect/sample the image background color for `isBackgroundColor`.

#### `bezier.js`

- `tessellateQuadratic(p0, p1, p2, steps=8)` — subdivides a quadratic Bezier into `steps` line segments.
- `tessellateCubic(p0, p1, p2, p3, steps=8)` — subdivides a cubic Bezier.
  These exist for future use; the current `gcodeCompiler.js` still approximates beziers as straight lines to endpoint.

---

### Hooks (`src/hooks/`)

#### `useImageTracer.js`

Manages a `tracerWorker.js` Web Worker lifecycle.

**API:** `{ trace(base64DataUrl, options), result, loading, error }`

**Flow:**
1. Creates worker on mount, tears it down on unmount.
2. `trace()` decodes the image **on the main thread** (using `Image` + `canvas.getImageData`) since
   workers can't access DOM APIs. Transfers raw RGBA buffer to worker via `postMessage` with `Transferable`.
3. Worker calls `ImageTracer.imagedataToSVG()` and posts back `{ svg }` or `{ error }`.
4. `result` is set to the SVG string on success.

**Default tracer options:** `{ numberofcolors: 2, colorquantcycles: 1, ltres: 1, qtres: 1, pathomit: 8, blurradius: 0 }`
(All overridable via the `options` argument.)

---

### Workers (`src/workers/`)

#### `tracerWorker.js`

Runs `imagetracerjs` in a Web Worker. Receives `{ width, height, buffer, options }`, constructs
an `ImageData`-like object, calls `ImageTracer.imagedataToSVG()`, and posts back `{ svg }` or `{ error }`.

---

### Data (`src/data/`)

#### `builtinGcodes.js`

`BUILTIN_GCODES` array — hardcoded G-code programs that ship with the app. Each entry:
`{ id, name, description, category, content }`.

Categories and entries:
- **shapes:** `line`, `triangle`, `square`, `rectangle`, `cross`
- **calibration:** `calibration-grid` (50×50mm, 10mm spacing), `test-square` (40×40mm),
  `pen-test` (head lift dot row), `diagonal-test` (X-cross diagonal accuracy)
- **demo:** `the-house` (walls/roof/door/window), `spiral` (expanding square spiral)

Helper functions: `getBuiltinById(id)`, `getBuiltinsByCategory(category)`, `builtinToFile(builtin)`
(converts to same shape as a loaded file: `{ name, path: "builtin:<id>", content, size, lines, builtin: true }`).

---

### Styles (`src/styles/`)

#### `theme.css`

Imported globally in `main.jsx`. Contains CSS variables (design tokens), reset, base typography,
scrollbar styling, and keyframe animations (`pulse`, `fadeIn`, `slideIn`).

Key CSS variables:
```css
--bg-primary: #1E1E1E;   --bg-secondary: #252526;  --bg-sidebar: #1B1B1B;
--accent: #007ACC;        --accent-hover: #005F99;   --accent-glow: rgba(0,122,204,0.25);
--text-primary: #E0E0E0; --text-secondary: #A0A0A0;
--success: #4EC9B0;       --danger: #F14C4C;          --warning: #CCA700;
--font: 'Inter', system-ui; --font-mono: 'Cascadia Code', 'Fira Code', monospace;
--sidebar-width: 240px;   --sidebar-collapsed: 64px;
--radius: 8px;             --transition: 150ms ease;
```

#### `components.css`

Reusable component classes: `.btn`, `.btn-primary`, `.btn-danger`, `.btn-secondary`, `.btn-ghost`,
`.card`, `.badge`, `.input`, `.tag`, form layouts, etc. Consumed throughout the app without inline styles.

---

### Tests (`src/lib/*.test.mjs`)

Unit tests using Node's built-in test runner (`node --test`):
- `bezier.test.mjs` — tests `tessellateQuadratic` and `tessellateCubic` point counts and boundary values.
- `colorMatch.test.mjs` — tests `parseRgbColor`, `colorDistance`, `isWhiteOrNone`, `isBackgroundColor`.
- `imageBinarize.test.mjs` — tests `binarizeImageData` (pure black/white output) and `sampleCornerColor`.

Run with: `node --test src/lib/bezier.test.mjs` etc. (no test runner configured in `package.json`).

---

## Image2GCode Pipeline (raster → vector → G-code)

```
[Image file (bitmap/PNG/JPG)]
        ↓  (optional) imageBinarize.js  — threshold + corner sampling
[ImageData (RGBA)]
        ↓  useImageTracer → main thread decodes image → transfers buffer to tracerWorker
[tracerWorker.js]  →  imagetracerjs.imagedataToSVG()
        ↓
[SVG string]
        ↓  (optional) VectorEditor (Fabric.js) — manual edit/finalize
[edited SVG]
        ↓  gcodeCompiler.compileSVGToGCode(svgString, settings)
[G-code lines[]]
        ↓  GCodePreview — visual canvas preview
        ↓  SerialContext.startStreaming() → send to machine
```

**Tracer tuning parameters** (exposed as sliders in `ImageToGCodeTab`):
- `numberofcolors` — palette size (default 2 for B&W)
- `ltres` — line tracing error threshold
- `qtres` — quadratic spline error threshold
- `pathomit` — omit paths shorter than N pixels
- `blurradius` — pre-blur radius before tracing

**Known issue (as of 2026-06):** `isWhiteOrNone` in `gcodeCompiler.js` uses a hardcoded
near-white RGB threshold that doesn't catch imagetracerjs's grid-sampled background colors
(e.g. `rgb(210,210,210)`). The planned fix is to use `sampleCornerColor` + `isBackgroundColor`
from `colorMatch.js` (distance-based) instead. See specs for the planned redesign.

---

## G-code Execution & Safety

- **Soft limits** are enforced in two layers:
  1. **Pre-run:** `scanGCodeBounds()` warns before streaming starts (shown as a banner in the UI).
  2. **Live:** `isInWarnZone()` check in `sendNextGCodeLine()` skips any out-of-bounds G0/G1 lines during streaming.
- **Jog protection:** `wouldExceedPositiveLimit()` blocks positive-direction jogs that would exceed the ceiling.
- **Emergency stop:** `\x18` is sent to Arduino on `stopStreaming()` and on abnormal disconnect.
- **Hard limits** are also enforced in firmware: if a limit switch triggers outside homing mode, firmware
  stops all motors and sends an error.

---

## Conventions / Notes

- Design specs and implementation plans for non-trivial features go in
  `docs/superpowers/specs/` and `docs/superpowers/plans/` (dated, topic-named markdown).
- G-code job files are persisted under Electron's `userData/jobs/` directory (not in the repo)
  so they survive restarts and can be copied to other machines via the "Open Jobs Folder" button
  on the G-Code Jobs page.
- `todo.md` tracks longer-term feature ideas: multi-mode firmware (Pen/Drill/Laser), networking tab,
  large-image job splitting, per-mode theming, improved homing UX — check it for context on where
  the project is headed.
- `window.platform` is `undefined` in the Vite-only browser dev mode. Guard with `typeof window.platform !== 'undefined'`
  if writing code that needs to work in both environments.
- The app uses `HashRouter` (not `BrowserRouter`) so Electron can serve from `file://` in production.
- Streaming uses a simple "send one, wait for ok" protocol (not a line-buffer/window approach). This
  keeps things reliable but limits throughput on very fast moves.
- The `commandLog` in `SerialContext` tracks every command with its full lifecycle
  (sent → acked/errored, duration in ms, response lines, source: `manual` vs `stream`).
  This is the data source for the Commands tab in `ConsolePage`.
