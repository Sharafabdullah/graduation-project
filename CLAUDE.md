# Graduation Project — General-Purpose 3-Axis CNC Machine

A university capstone project: a 3-axis CNC "platform" (pen plotter / drawing machine) controlled by an
Arduino-based firmware and an Electron+React desktop application. The repo contains the firmware, the
desktop app, project documentation/reports, and planning docs.

## Repo Layout

- `Arduino Codes/Main_Firmware/` — Arduino firmware (`Main_Firmware.ino`) for the CNC controller:
  stepper motor control (X/Y/Z via step/dir), servo (pen up/down via `M280`), homing sequence,
  limit-switch handling, G-code command parsing (`G0/G1/G28/G90/G21/M3/M5/M280`, etc.).
- `Desktop_App/` — Electron + React + Vite desktop control application (see below).
- `Input Files/` — sample G-code and bitmap files used for testing the Image2GCode pipeline.
- `docs/superpowers/` — design specs (`specs/`) and implementation plans (`plans/`) written during
  feature work (dated `YYYY-MM-DD-<topic>`). Check here first for prior design decisions before
  proposing new architecture.
- `todo.md` — running list of planned features/fixes for future iterations ("rotations").
- Top-level `.docx`/`.pdf` files — university report drafts/submissions, not source code.

## Desktop App (`Desktop_App/`)

**Stack:** Electron 28, React 18, React Router 6, Vite 6, `serialport` (machine comms),
`fabric` v5 (vector canvas editor), `imagetracerjs` (raster→SVG tracing), `svg-path-parser`
(SVG path → point conversion for G-code compilation), `lucide-react` (icons).

**Run:** `npm run dev` (Vite only, browser — no `window.platform`/serial), `npm run electron:dev`
(Vite + Electron together), `npm run start` (build + run Electron).

### Process split

- `main.js` — Electron main process: creates the window, owns the `SerialPort` connection,
  exposes IPC handlers (`ipcMain.handle`) for serial I/O, file dialogs, settings persistence,
  G-code job storage (jobs are written to `<userData>/jobs/*.gcode`), and log saving.
- `preload.js` — `contextBridge` that exposes a `window.platform` API (send/connect/loadSettings/
  saveJob/getJobs/openJobsFolder/saveGCode/loadGCodeFile/etc.) to the renderer.
- `src/` — the React renderer app.

### Pages (`src/pages/`, routed in `App.jsx`)

- `DashboardPage` — connection status, machine state, jog/position overview.
- `ManualControlPage` — manual jog controls and direct G-code entry.
- `GCodeJobsPage` — three-tab file browser (Built-in / Loaded / History) + G-code preview +
  streaming controls (Start/Pause/Resume/Stop). "Loaded" jobs come from `JobsContext`
  (persisted to disk via `window.platform.saveJob`/`getJobs`); "History" comes from
  `SerialContext.jobHistory` and links to `/console?jobId=...` for filtered logs.
- `Image2GCodePage` — two-tab workspace: **Image to G-Code** (raster import → trace → SVG) and
  **Vector Drawer** (Fabric.js canvas), sharing a bottom bar (line width, Compile, G-Code
  preview, Save Job, Run Job). State lives in `Image2GCodeContext` so it survives navigation.
- `SettingsPage` — machine parameters (steps/rev, feedrates, servo angles, bed size, soft-limit
  margin, etc.), persisted via `window.platform.loadSettings`/`saveSettings`.
- `ConsolePage` — full serial console/log viewer with job-ID filtering via `?jobId=` query param.

### Contexts (`src/contexts/`) — global state, mounted above the router in `App.jsx`

- `SerialContext` — connection state, `selectedPort`, command queue (`sendAndWait`), G-code
  streaming (`startStreaming`/`pause`/`resume`/`stop`), homing sequence, soft-limit checks
  during streaming, `commandLog`/`consoleLog`, and `jobHistory` (start/end/duration/status,
  tagged with a `jobId` so console entries can be filtered per run).
- `SettingsContext` — machine configuration (`DEFAULT_SETTINGS` + persisted overrides).
- `JobsContext` — `loadedFiles` list for the G-Code Jobs "Loaded" tab; loads previously-saved
  jobs from disk on mount via `window.platform.getJobs()` so they persist across app restarts.
- `Image2GCodeContext` — Image2GCode page state (`previewSrc`, `tracedSVG`, `tracerOptions`,
  `compiledGCode`, `activeTab`, `lineWidth`, `multicolorMode`) so it survives tab navigation.

### Image2GCode pipeline (raster → vector → G-code)

1. `useImageTracer` hook decodes the image on the main thread (canvas + `getImageData`, since
   `Image`/DOM APIs aren't available in workers), then posts raw RGBA pixels to...
2. `tracerWorker.js` — runs `ImageTracer.imagedataToSVG()` (imagetracerjs) in a Web Worker and
   returns an SVG string. Tunable params: `numberofcolors`, `ltres`, `qtres`, `pathomit`,
   `blurradius` (exposed as sliders in `ImageToGCodeTab`).
3. The traced SVG can be sent to the **Vector Drawer** tab (`VectorEditor`, Fabric.js) for
   manual editing/finalizing, or compiled directly.
4. `gcodeCompiler.compileSVGToGCode()` (`src/lib/gcodeCompiler.js`) parses SVG path/shape
   elements (via `svg-path-parser`), flips Y (SVG grows down, machine grows up), and emits
   G0/G1 moves with `M280` pen-up/pen-down servo commands. `multicolorMode` groups paths by
   fill color and inserts `M0` pause commands between color groups so the user can swap pens.
5. `GCodePreview` renders a 2D top-down canvas view of the compiled toolpath (with bed
   boundary, soft-limit margin, and drawing bounding box overlays).

**Known issue (as of 2026-06):** the "skip background" logic (`isWhiteOrNone` in
`gcodeCompiler.js`) uses a hardcoded near-white brightness threshold, but imagetracerjs's
default color sampling (`colorsampling: 2`, grid-based) frequently produces background palette
colors that aren't near-white (e.g. `rgb(210,210,210)` for photo-lit scans), so the background
gets traced and drawn as a filled shape instead of being skipped. This needs an architectural
fix — see brainstorming/spec docs for the planned redesign.

### G-code execution & safety

- `softLimits.js` — `parseXY`, `isInWarnZone`, `scanGCodeBounds`, `wouldExceedPositiveLimit`:
  shared utilities for warning about/skipping moves that would exceed `bedMaxX/bedMaxY` minus
  `softLimitMargin`. Used by `SerialContext` (live skip during streaming), `GCodeJobsPage` and
  `Image2GCodePage` (pre-run bounds warnings), and `GCodePreview` (visual overlay).
- Homing is app-orchestrated (not firmware): the app drives the stage to the limit switches,
  learns the corner position, and computes safe travel bounds — see
  `docs/superpowers/specs/2026-06-06-homing-soft-limits-stage-view.md`.

## Conventions / Notes

- Design specs and implementation plans for non-trivial features go in
  `docs/superpowers/specs/` and `docs/superpowers/plans/` (dated, topic-named markdown).
- G-code job files are persisted under Electron's `userData/jobs/` directory (not in the repo)
  so they survive restarts and can be copied to other machines via the "Open Jobs Folder" button
  on the G-Code Jobs page.
- `todo.md` tracks longer-term feature ideas (multi-mode firmware, networking tab, large-image
  job splitting, per-mode theming) — check it for context on where the project is headed.
