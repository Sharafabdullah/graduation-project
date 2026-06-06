# Image2GCode Fixes, State Persistence & Job History

**Date:** 2026-06-06  
**Status:** Approved

---

## Problem Statement

Six distinct issues exist in the current Desktop App:

1. Uploading an image in Image2GCode throws `"image not defined"` — a DOM API used inside a web worker.
2. Image2GCode page state (uploaded image, traced SVG, options, compiled G-code) is lost when navigating away.
3. Port selection in Dashboard resets to `-- Select Port --` on every page navigation.
4. No way to push a compiled Image2GCode job directly to the G-Code Jobs "Loaded" tab.
5. No job history in G-Code Jobs page.
6. No way to filter the Console log by a specific job run.

---

## Architecture Overview

Three new React contexts are added and two existing ones are extended. No new npm dependencies.

```
App
├── SerialProvider       (extended: selectedPort, currentJobId, jobId tagging on logs)
├── JobsProvider         (new: loadedFiles, jobHistory, addLoadedFile, addJobHistory)
├── Image2GCodeProvider  (new: previewSrc, tracedSVG, tracerOptions, compiledGCode, activeTab, lineWidth)
├── SettingsProvider     (unchanged)
└── Router → pages
```

---

## Section 1: Worker Bug Fix

### Root Cause

`tracerWorker.js` receives a base64 data URL and passes it to `ImageTracer.imageToSVG()`. That function internally calls `new Image()` to decode the URL — a DOM API unavailable in web workers. This throws `ReferenceError: Image is not defined`.

### Fix

Move image decoding to the main thread inside `useImageTracer.js`:

1. Create a temporary `<canvas>`, set its dimensions to the image's natural size.
2. Draw the data URL onto the canvas using a standard `Image` object (available in the main thread).
3. Call `canvas.getContext('2d').getImageData(0, 0, w, h)` to extract raw RGBA pixel data.
4. Post `{ width, height, data: imageData.data }` to the worker.

In `tracerWorker.js`, reconstruct the `ImageData` object and call `ImageTracer.fromImageData(imgData, options, callback)` — the imagetracerjs API that accepts raw pixel data with no DOM dependency.

**Files changed:** `src/hooks/useImageTracer.js`, `src/workers/tracerWorker.js`

---

## Section 2: State Persistence

### 2a — Image2GCodeContext

**New file:** `src/contexts/Image2GCodeContext.jsx`

State owned:

| Field | Type | Description |
|---|---|---|
| `previewSrc` | string\|null | Base64 data URL of uploaded image |
| `tracedSVG` | string\|null | Raw SVG string from tracer |
| `tracerOptions` | object | `{ numberofcolors, ltres, qtres, pathomit }` |
| `compiledGCode` | string[] | Lines of compiled G-code |
| `activeTab` | `'image'\|'drawer'` | Which tab is active |
| `lineWidth` | number | mm value for compile |

`ImageToGCodeTab` reads `previewSrc`, `tracedSVG`, `tracerOptions` from context instead of `useState`. All setter calls go through context setters.

`Image2GCodePage` reads `compiledGCode`, `activeTab`, `lineWidth`, `tracedSVG`, `injectedSVG` from context.

The context is mounted above the Router so it outlives page navigation.

### 2b — Port Selection in SerialContext

`SerialContext` gains two new fields:
- `selectedPort: string` (default `''`)
- `setSelectedPort: (port: string) => void`

`DashboardPage` removes its local `const [selectedPort, setSelectedPort] = useState('')` and reads these from `useSerial()` instead. The selected port is now preserved across navigation.

**Files changed:** `src/contexts/SerialContext.jsx`, `src/contexts/Image2GCodeContext.jsx` (new), `src/pages/DashboardPage.jsx`, `src/pages/tabs/ImageToGCodeTab.jsx`, `src/pages/Image2GCodePage.jsx`, `src/App.jsx` (wrap with providers)

---

## Section 3: Jobs Context & "Send to Jobs"

### JobsContext

**New file:** `src/contexts/JobsContext.jsx`

State owned:

```js
loadedFiles: []          // { name, content, path, size, lines }
jobHistory:  []          // { id, name, startedAt, endedAt, duration, status, jobId }
```

Exposed actions:
- `addLoadedFile(file)` — deduplicates by `path`, appends to list
- `removeLoadedFile(path)` — removes by path
- `addJobHistory(entry)` — appends; capped at 100 entries
- `clearJobHistory()` — empties the list

`GCodeJobsPage` migrates its `const [loadedFiles, setLoadedFiles] = useState([])` to `useJobs()`. The "Load" button calls `addLoadedFile`. The "×" remove button calls `removeLoadedFile`.

### "Send to Jobs" Button

`Image2GCodePage` bottom bar gets a new button **"Send to Jobs"** (between "Save .gcode" and "Run Job"), disabled when `compiledGCode.length === 0`.

On click:
1. Calls `addLoadedFile({ name: 'Image Job', content: compiledGCode.join('\n'), path: 'image2gcode:' + Date.now(), size: compiledGCode.join('\n').length, lines: compiledGCode.length })`
2. Navigates to `/gcode` via `useNavigate()`

**Files changed:** `src/contexts/JobsContext.jsx` (new), `src/pages/GCodeJobsPage.jsx`, `src/pages/Image2GCodePage.jsx`, `src/App.jsx`

---

## Section 4: Job History & Console Filter

### Job ID Tracking in SerialContext

When `startStreaming` is called:
- Generate `const jobId = crypto.randomUUID()`
- Store as `currentJobId` in SerialContext state
- Store job start metadata: `{ jobId, name: currentJobName, startedAt: Date.now() }` in a ref

Every `setConsoleLog` append includes `jobId: currentJobId` on each new entry.

When streaming ends (`job_done`) or is stopped:
- Calculate `duration = Date.now() - startedAt`
- Call `addJobHistory({ id: jobId, name: jobName, startedAt, endedAt: Date.now(), duration, status: 'completed'|'stopped', jobId })`
- Reset `currentJobId` to `null`

`SerialContext` receives `addJobHistory` via a context ref injection pattern: `JobsContext` exposes a stable `addJobHistoryRef` that `SerialProvider` can call without a circular import. Alternatively, `SerialContext` holds `jobHistory` directly and `JobsContext` reads it — simpler. **Decision: keep `jobHistory` in `SerialContext`** alongside streaming state (it's all job-domain), and have `JobsContext` own only `loadedFiles`. This avoids the circular dependency entirely.

Revised ownership:

| Context | Owns |
|---|---|
| SerialContext | `selectedPort`, `currentJobId`, `jobHistory`, streaming state |
| JobsContext | `loadedFiles` only |
| Image2GCodeContext | All Image2GCode page state |

### G-Code Jobs Page — History Tab

A third tab **"History"** is added to the file browser panel (alongside Built-in / Loaded).

Each history entry shows:
- Job name (e.g. `square.gcode`, `Image Job`)
- Start timestamp (formatted `HH:MM:SS`)
- Duration (e.g. `1m 23s`)
- Status pill: `Completed` (green) or `Stopped` (orange)
- **"View Log"** button → navigates to `/console?jobId=<id>`

### Console Page — Job Filter

A new **"Job"** filter dropdown is added to the Serial Terminal column header (alongside the existing ok/Debug toggles).

Options: `All Jobs | <job name> (HH:MM:SS) | …` — populated from `jobHistory` in SerialContext.

When a job is selected, `filteredConsole` additionally requires `entry.jobId === selectedJobFilter`.

The Console page reads `useSearchParams()` on mount; if `?jobId=xxx` is present, it pre-selects that job in the dropdown.

**Files changed:** `src/contexts/SerialContext.jsx`, `src/pages/GCodeJobsPage.jsx`, `src/pages/ConsolePage.jsx`

---

## File Change Summary

| File | Change |
|---|---|
| `src/hooks/useImageTracer.js` | Main-thread canvas decode before posting to worker |
| `src/workers/tracerWorker.js` | Use `ImageTracer.fromImageData` instead of `imageToSVG` |
| `src/contexts/Image2GCodeContext.jsx` | New context |
| `src/contexts/JobsContext.jsx` | New context (loadedFiles) |
| `src/contexts/SerialContext.jsx` | Add selectedPort, currentJobId, jobHistory, jobId on log entries |
| `src/pages/Image2GCodePage.jsx` | Read from Image2GCodeContext, add "Send to Jobs" button |
| `src/pages/tabs/ImageToGCodeTab.jsx` | Read/write from Image2GCodeContext |
| `src/pages/DashboardPage.jsx` | Read selectedPort from SerialContext |
| `src/pages/GCodeJobsPage.jsx` | Read loadedFiles from JobsContext, add History tab |
| `src/pages/ConsolePage.jsx` | Add job filter dropdown + URL param pre-selection |
| `src/App.jsx` | Wrap providers: JobsProvider, Image2GCodeProvider |

---

## Out of Scope

- Persistent storage across app restarts (localStorage / electron-store)
- Vector editor (VectorDrawerTab) structural changes — it already works; persistence fix in Image2GCodeContext restores the injectedSVG on return
- Console page layout changes beyond the new filter dropdown
