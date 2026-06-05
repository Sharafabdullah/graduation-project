# Logging & State Sync Redesign
**Date:** 2026-06-06
**Scope:** SerialContext, ConsolePage, GCodeJobsPage

---

## Problem Statement

The current app has a single flat `consoleLog` array where everything lands — raw serial I/O, system events, and command lifecycle — mixed together. There is no tracking of individual command state (sent → executing → done/error), no sync with actual Arduino state (position, servo angle, limit switches), and no structured way to filter or correlate events.

---

## Goals

1. Track every command's full lifecycle: sent → executing → done / error
2. Sync Arduino state (position, feedrate, servo, limits) from real `?` polling rather than optimistically
3. Give the G-Code Jobs preview visual status per line + hover tooltips
4. Give the Console page a 3-column diagnostic view with chronological scroll sync

---

## Data Model (SerialContext)

### 1. `consoleLog` (existing, minor changes)
Raw serial bytes in/out. Unchanged structure.
```js
{ id, message, type, timestamp }
// types: 'sent' | 'received' | 'info' | 'error'
```

### 2. `commandLog` (new)
One entry per sent command. Max 1000 entries (drop oldest).
```js
{
  id,           // uuid
  cmd,          // string — the command text
  lineNum,      // number | null — G-code file line index (null for manual/internal)
  sentAt,       // number — Date.now() when sent
  ackedAt,      // number | null — Date.now() when ok received
  duration,     // number | null — ackedAt - sentAt (ms)
  status,       // 'executing' | 'done' | 'error' | 'skipped'
  type,         // 'gcode' | 'control' | 'config' | 'query'
  source,       // 'stream' | 'manual' | 'internal'
  response,     // string[] — all lines received between send and ok/error
}
```

**Type classification:**
- `gcode` — starts with G or M (case-insensitive)
- `control` — `!`, `~`, `\x18`
- `config` — starts with `$`
- `query` — `?`

**Skipped entries:** blank lines and comment lines (`;`, `(`) get a `skipped` entry added at stream time without being sent.

### 3. `eventLog` (new)
System-level events. Max 500 entries.
```js
{
  id,         // uuid
  timestamp,  // number — Date.now()
  event,      // string — event key (see below)
  message,    // string — human-readable description
  level,      // 'info' | 'warning' | 'critical'
}
```

**Event keys and levels:**
| event | level | trigger |
|---|---|---|
| `connected` | info | successful connect |
| `disconnected` | critical | port closed / lost |
| `job_start` | info | startStreaming() called |
| `job_done` | info | last line acked |
| `job_stop` | warning | stopStreaming() called |
| `paused` | warning | pauseStreaming() called |
| `resumed` | info | resumeStreaming() called |
| `estop` | critical | \x18 sent |
| `homing_start` | info | G28 sent |
| `homing_done` | info | "Homing Complete" received |
| `error` | critical | `error:` prefix received from Arduino |

### 4. `arduinoState` (new)
Polled from `?` every 3s when connected. Skipped during streaming (too noisy).
```js
{
  positionMode: 'Abs' | 'Rel',  // from State:Abs/Rel
  feedRate: number,              // from F:
  servoAngle: number,            // from Servo:
  limX: boolean,                 // from LimX:
  limY: boolean,                 // from LimY:
}
```

Firmware `?` response (two lines + ok):
```
X:0.00 Y:0.00
State:Abs F:1200 Servo:75 LimX:0 LimY:0
ok
```
Both lines are parsed in the existing `handleData` handler.

### 5. Pending Command Queue (ref, not state)
`pendingQueueRef` — array of `commandId` strings, FIFO.

- On command sent → push `id` to queue
- On `ok` received → shift from queue, set that command's `status = 'done'`, set `ackedAt`, set `duration`, freeze `response[]`
- On `error:` received → shift from queue, set `status = 'error'`, append error text to `response[]`
- Any other received line → append to the `response[]` of the current front-of-queue command (the executing one)

Internal/polling commands (auto `?`) do NOT enter the `commandLog` or `pendingQueueRef`.

---

## G-Code Jobs Page

### Preview Line Status Colors

| Status | Visual |
|---|---|
| `queued` | Default text color, no decoration |
| `executing` | Amber/yellow background highlight, subtle pulse animation |
| `done` | Green text, slightly dimmed opacity |
| `error` | Red background |

Note: `previewLines` is already filtered (blanks and comments removed before streaming starts), so every displayed line maps to exactly one of these four statuses. The `skipped` status exists in `commandLog` for the Command Queue column only, not in the preview.

Line status is derived by matching `previewLines[i]` index to `commandLog` entries where `source === 'stream'` and `lineNum === i`.

### Hover Tooltip
Shown on any line with status `executing`, `done`, or `error`. Positioned above the line, dismissed on mouse-leave.

```
┌──────────────────────────────┐
│ G0 X50.000 Y25.000 F1200    │
│ Sent:     14:32:11.042       │
│ Acked:    14:32:11.891       │  ← "Pending…" if still executing
│ Duration: 849ms              │  ← omitted if still executing
│ Response: X:50.00 Y:25.00   │  ← omitted if response[] is empty
└──────────────────────────────┘
```

### Navigation Buttons
Visible only during streaming. Fixed at top-right of the preview panel.

- **"↑ Executing"** — scrolls to the line with `status === 'executing'` using `scrollIntoView({ behavior: 'smooth', block: 'center' })`
- **"↑ Last Done"** — scrolls to the last line with `status === 'done'`

Buttons are disabled (grayed) when their target doesn't exist (e.g., no executing line when paused).

---

## Console Page

### Layout
3-column equal-width layout. Input row spans full width at the bottom.

```
┌──────────────────┬──────────────────────┬──────────────────┐
│  Serial Terminal │   Command Queue       │   Event Log      │
│──────────────────│──────────────────────│──────────────────│
│  [scrollable]    │   [scrollable]        │   [scrollable]   │
│──────────────────│──────────────────────│──────────────────│
│  filters         │   filters             │   filters        │
├──────────────────┴──────────────────────┴──────────────────┤
│  [input field]                                    [Send]    │
└────────────────────────────────────────────────────────────┘
```

### Column: Serial Terminal (left)
- Source: `consoleLog`
- Filters: show/hide `ok` responses, show/hide `Debug:` lines (existing)
- Color: sent=blue, received=green, info=gray, error=red

### Column: Command Queue (center)
- Source: `commandLog`
- Each row shows: timestamp, command text, status badge, duration (if done)
- **Status badge colors:** yellow=executing, green=done, red=error, gray=skipped
- **Left border tint by type:** blue=gcode, orange=control, purple=config, gray=query
- **Filters:** type (all / gcode / control / config / query), status (all / executing / done / error)
- Hover shows same tooltip as G-Code preview

### Column: Event Log (right)
- Source: `eventLog`
- Each row: icon + timestamp + message
- **Level colors:** info=muted, warning=amber, critical=red
- **Filter:** level (all / info / warning / critical)

### Scroll Sync
Each column exposes a ref to its scrollable container and a `getTimestampAtScrollTop()` function (finds the topmost visible entry's timestamp by checking `getBoundingClientRect`).

`onScroll` handler on each column:
1. Read timestamp of topmost visible entry
2. Store in shared `cursorTimestampRef`
3. Call `scrollToTimestamp(ts)` on the other two columns
4. `scrollToTimestamp` finds the nearest entry with `timestamp <= ts` and calls `scrollIntoView({ block: 'start' })`
5. Entire handler debounced at 50ms to prevent feedback loops

---

## Files Changed

| File | Change |
|---|---|
| `src/contexts/SerialContext.jsx` | Add `commandLog`, `eventLog`, `arduinoState`; pending queue ref; auto-poll `?`; classify and log all commands |
| `src/pages/GCodeJobsPage.jsx` | Derive line status from `commandLog`; hover tooltip; nav buttons |
| `src/pages/GCodeJobsPage.css` | Status colors, tooltip styles, nav button styles |
| `src/pages/ConsolePage.jsx` | Full redesign: 3-column layout, scroll sync, column filters |
| `src/pages/ConsolePage.css` | 3-column layout, command queue styles, event log styles |

---

## Constraints

- Internal auto-poll `?` commands are NOT logged to `commandLog` or `consoleLog` (silent)
- `commandLog` capped at 1000 entries, `eventLog` at 500 (prevent memory growth on long jobs)
- Scroll sync is read-only: it never mutates data, only calls DOM scroll APIs
- No changes to `main.js` or `preload.js` — IPC layer is sufficient as-is
