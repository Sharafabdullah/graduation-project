# Critical Fixes — Firmware Motion/Safety, G-Code Pipeline, Image2GCode UX — Design Spec

**Date:** 2026-06-07
**Author:** Claude (senior architect)
**Status:** Draft for review — contains open design decisions that need a call before implementation plans are written

---

## Overview

Six issues were reported across the firmware and desktop app. They cluster into **three largely-independent subsystems**:

| Cluster | Issues | Subsystem |
|---|---|---|
| A. Motion & machine safety | #1 (Y-axis jitter), #2 (homing margins), #4 (firmware parity) | `Arduino Codes/CNC_Firmware/*`, `SerialContext.jsx`, `softLimits.js` |
| B. G-code generation/preview pipeline | #3 (outline broken), #5 (tracing quality / line width) | `gcodeCompiler.js`, `GCodePreview.jsx`, `useImageTracer.js`, tracer libs |
| C. Image2GCode UI/UX | #6 (layout, centering, outer box, margin overlay) | `Image2GCodePage.css`, `VectorEditor/*` |

Per the **Scope Check** in the writing-plans convention, these three clusters should become **three separate implementation plans** (each independently testable) once the open design decisions below are resolved. Cluster A is the highest priority — it's a physical-safety concern (machine could ram its limit switches). Cluster B's #3 is a one-line-class bug fix that should land first as a quick win. Cluster C is cosmetic/UX polish and lowest risk.

This document covers root-cause analysis (with file:line references) and proposed designs for all six issues, plus the open decisions that need your input before bite-sized plans can be written.

---

## Cluster A — Motion & Machine Safety

### Issue #1 — Y-axis dual-motor jitter

**Symptom:** "Are you sure the direction with two motors is actually both moving in the same direction, at the same speed at the same time? They seem to jitter."

**Root cause — TWO contributing factors found in `Arduino Codes/CNC_Firmware/cnc_base.h:235-326` (`moveLinear`)**

1. **Telemetry is now reported from inside the blocking motion loop** (lines 314-317):
   ```cpp
   if (millis() - lastTelemetryTime >= telemetryInterval) {
     reportTelemetry();
     lastTelemetryTime = millis();
   }
   ```
   `reportTelemetry()` performs ~10 `Serial.print()` calls. The old `Main_Firmware.ino` (baseline, see `git show HEAD:"Arduino Codes/Main_Firmware/Main_Firmware.ino"`) has **no such call inside the motion loop** — this is new code added during the multi-mode refactor. At 115200 baud, the hardware UART TX buffer on a Mega is 64 bytes; a `[TELEMETRY] ...` line is well over 64 bytes, so `Serial.print` **blocks** until buffer space frees up. That stalls the entire motion loop — including both `runSpeed()` calls — for potentially several milliseconds, **every 500 ms, during every move**. This produces a periodic, audible stutter — almost certainly the dominant cause of "they seem to jitter."

2. **Y1/Y2 phase drift from independent `AccelStepper` timers** (lines 308-313):
   ```cpp
   stepperY1.setSpeed(yMovingMin ? -vY : vY);
   stepperY2.setSpeed(yMovingMin ? -vY : vY);
   stepperY1.runSpeed();
   stepperY2.runSpeed();
   ```
   Each `AccelStepper` instance independently tracks its own `_lastStepTime` (via `micros()`) and decides whether to fire a step pulse on `runSpeed()`. Even with identical `setSpeed()` values, calling `runSpeed()` sequentially means Y2's decision is evaluated a few microseconds after Y1's — and `setSpeed()` is recomputed every loop iteration (re-deriving `_stepInterval` via floating point division), adding per-iteration variance. Over thousands of steps this drifts the two mirrored, mechanically-coupled motors out of phase, which — because they're rigidly linked through the gantry — manifests as binding/vibration ("jitter"). This existed in the old firmware too (the loop structure is identical), so it's a pre-existing latent issue, but factor (1) is new and likely makes it much more noticeable now.

**Proposed design — staged fix, lowest-risk first:**

- **Step A (do first, near-zero risk):** Make telemetry non-blocking during motion. Before printing, check `Serial.availableForWrite() >= EXPECTED_TELEMETRY_LEN` and skip the cycle if there isn't enough room — telemetry is periodic, the next 500 ms tick will catch up. This alone should eliminate the periodic stutter, since `Serial.print` will never block inside `moveLinear`'s loop.
- **Step B (do second, low risk):** Hoist `setSpeed()` calls for Y1/Y2 (and X) out of the `while` loop — they don't change for the duration of a linear move (`vX`/`vY` are constant), so calling them once before the loop removes per-iteration floating-point overhead and timing variance between the two Y steppers.
- **Step C (only if jitter persists after A+B — higher effort, higher payoff):** Replace the second `AccelStepper` instance for Y2 with **direct hardware shadow-stepping** — drive Y2's STEP/DIR pins with raw `digitalWrite()` calls synchronized to Y1's actual step events (AccelStepper's `runSpeed()` returns `true` exactly when it fires a step):
  ```cpp
  stepperY1.setSpeed(yMovingMin ? -vY : vY);
  digitalWrite(Y2_DIR_PIN, yMovingMin ? !invertedDirHigh : invertedDirHigh);
  if (stepperY1.runSpeed()) {            // Y1 just fired a step pulse
    digitalWrite(Y2_STEP_PIN, HIGH);
    delayMicroseconds(minStepPulseUs);
    digitalWrite(Y2_STEP_PIN, LOW);
  }
  ```
  This guarantees Y1 and Y2 receive the *exact same step pulse* at the *exact same instant* (bound only by code-execution overhead, not by two independent timers), eliminating drift entirely. It's more invasive (removes `stepperY2` from `AccelStepper`/`MultiStepper` bookkeeping, needs careful handling of `currentPosition()`/homing-reset code at lines 293-295 which currently calls `stepperY2.setCurrentPosition(0)`).

**Recommendation:** Implement A+B first and have you test on the physical machine — they're cheap, safe, and directly address the newest, most likely cause. Only invest in C if jitter is still present.

**Open decision:** Do you want to test A+B on hardware before we commit to C, or go straight for the more thorough C? (C is more work but is the only approach that *guarantees* zero phase drift.)

---

### Issue #2 — Homing margin / soft-limit redesign

**Symptom (your words, condensed):** "Press homing → moves until both switches trigger → retreats by the margin value → should **never, ever** cross that margin value again. Manual controls or any command that would cross it should be **rejected**, not just warned."

**Current bugs found:**

1. **`isInWarnZone` exempts `(0, 0)`** (`Desktop_App/src/lib/softLimits.js:29`):
   ```js
   if ((x === null || x === 0) && (y === null || y === 0)) return false;
   ```
   But `(0, 0)` in machine coordinates is **the limit-switch position itself** — the single most dangerous point on the machine. This exception was presumably added to avoid flagging "go to home" as a violation, but it does the opposite of what's needed.

2. **`goToOrigin()` drives straight at the switches** (`SerialContext.jsx:668-672`):
   ```js
   const goToOrigin = useCallback(() => {
     sendCommand('G90');
     sendCommand('G0 X0 Y0 F1000');   // ← machine-zero == limit switch position
     ...
   ```

3. **Soft-limit checks only warn, never reject**, and only exist in some paths:
   - Streaming (`SerialContext.jsx:236-243`) *skips* (with a warning) out-of-bounds `G0`/`G1` lines — acceptable for streaming (better to skip a line than crash a job), but doesn't stop the rest of the job from continuing toward danger.
   - `goToPosition()` (`SerialContext.jsx:606-618`) only **logs a warning** then sends the move anyway.
   - `jogWithIncrement()` (`SerialContext.jsx:586-602`) calls `wouldExceedPositiveLimit`, which — as the name says — **only checks the positive ceiling** (`bedMax - softLimitMargin`). It has no concept of a negative-direction floor near the switches, so jogging toward `(0,0)` is completely unchecked.

4. **Two disconnected margin concepts exist**: `homingBackoff` (firmware-side retreat distance after hitting a switch, default 2 mm — `SettingsContext.jsx` `DEFAULT_SETTINGS`) vs. `softLimitMargin` (app-side "warn zone" near *all four* bed edges, default 10 mm). Your description maps directly onto `homingBackoff`: *that* is "the margin value" the machine retreats by and should never cross again. `softLimitMargin` is a separate, broader "stay away from the edges" concept used for drawing-bounds warnings. They serve different purposes and **should stay distinct**, but right now neither is enforced as a hard floor near the switches.

**What "machine coordinates" mean here:** When a switch triggers during homing, firmware does `stepperX/Y1/Y2.setCurrentPosition(0)` (`cnc_base.h:281, 293-294`) — so **machine `(0,0)` is defined as the physical switch position**. The app then commands `G0 X<backoff> Y<backoff>` to retreat (per the Homing protocol in CLAUDE.md), so immediately after homing the head sits at machine position `(homingBackoff, homingBackoff)`. *That* is the safe floor — going below it in either axis risks re-triggering the switches (or worse, grinding past them if a switch has already been tripped and ignored).

**Proposed design:**

1. **Track a `homed` boolean and the machine-absolute floor in `SerialContext`.** Set `homed = true` at the end of a successful `homeStage()`; reset to `false` on disconnect, on emergency-stop, and before a new homing pass begins. The floor is simply `(homingBackoff, homingBackoff)` in machine coordinates — no new setting needed.

2. **Replace the warn-only `isInWarnZone` lower-bound logic with a hard-floor check, and make it authoritative once `homed === true`.** Concretely, add a new helper to `softLimits.js`:
   ```js
   export function violatesSafeFloor(x, y, homingBackoff) {
     if (x !== null && x < homingBackoff) return true;
     if (y !== null && y < homingBackoff) return true;
     return false;
   }
   ```
   Remove the `(0,0)` exception entirely — `(0,0)` should now be flagged as a floor violation (it *is* the switch position).

3. **Centralize enforcement in one place and make it reject, not warn**, for every command path that can move the machine:
   - `jogWithIncrement` — check **both** directions: positive jogs against the existing ceiling (`wouldExceedPositiveLimit`, keep as-is for the ceiling), negative jogs against `violatesSafeFloor`. **Block and refuse to send** the command (current behavior already blocks positive-ceiling jogs — extend the same pattern to the floor).
   - `goToPosition(x, y)` — **reject** (don't send) if `violatesSafeFloor(x, y, homingBackoff)` is true while `homed`. Change the existing "Warning: ... is in the soft-limit zone" log to "Rejected: target (x, y) would cross the home-safety margin" and return early without sending `G0`.
   - `goToOrigin()` — **redefine "origin" to mean the safe retreat point, not machine-zero.** Change it to `G0 X<homingBackoff> Y<homingBackoff>` (or, better, route it through the same `goToPosition` floor-check so it can never regress if `homingBackoff` changes). Update the button label/log message accordingly (e.g., "Returning to safe home position").
   - Streaming (`sendNextGCodeLine`) — keep "skip with warning" for ceiling violations (current behavior — acceptable for a long job), but for **floor violations specifically**, escalate to **stop the job outright** with an error-level log (crossing the floor is a collision risk, not a "stay inside the drawing area" nicety — skipping one line and continuing could still walk the head into the switches on the next line).
   - `setZero()` (`G92 X0 Y0`) — leave as-is functionally (it only redefines the *work* origin, a logical offset; it does not move the machine). However, note for the implementer: all the above floor/ceiling checks must operate on **machine-absolute coordinates**, not work coordinates — `G92` offsets must be tracked and subtracted back out before checking against the floor/ceiling, otherwise a user could set a work-zero near the switches and then issue "safe-looking" work-coordinate moves that are actually unsafe in machine space. (Check whether `SerialContext` currently tracks the `G92` offset at all — if not, this needs to be added as part of this fix, since without it floor-checking work-relative commands is unreliable.)

4. **Surface the new floor visually**, mirroring the existing soft-limit-margin shading in `GCodePreview.jsx` — add a second shaded/hatched band near the origin corner sized to `homingBackoff`, distinct in color from the `softLimitMargin` band, so the operator can see both boundaries (this dovetails with the Cluster C ask for a margin overlay in the vector editor too — see Issue #6).

**Open decisions:**
- Should the floor check apply **before** the first homing pass too (i.e., before `homed` is ever `true`)? My recommendation: **no** — before homing, the firmware's step counters are not zeroed at a known physical reference, so "machine coordinate 0" is meaningless and any floor check would be operating on garbage. The UI should instead simply make it clear that jogging/G0 is "best effort" pre-homing (perhaps disable "Go to Position"/"Go to Origin" until `homed` is true — only raw jog stays available for bring-up). Confirm this matches your intent.
- Should a **floor violation during streaming** abort the whole job (my recommendation above) or just skip-and-warn like ceiling violations currently do? Aborting is safer but could be more disruptive to a long multicolor job mid-run.

---

### Issue #4 — Firmware parity (`Main_Firmware.ino` vs. `CNC_Firmware/*`) & app coordination

**Verdict: functionally equivalent, with one cleanup item.**

I diffed the motion core (`moveLinear`, `checkEStop`, G-code dispatch, homing-trigger logic) between the old monolithic `Main_Firmware.ino` (`git show HEAD:"Arduino Codes/Main_Firmware/Main_Firmware.ino"`) and the new `cnc_base.h` + mode-file split (`Pen_Firmware.ino`, `Drill_Firmware.ino`, `Laser_Firmware.ino`, `CNC_Firmware.ino`). The translation is faithful — no behavioral edge cases were dropped. The deliberate additions (per-mode `setupTool/handleToolOn/handleToolOff/handleToolSet/reportToolState/processModeCfgKey` interface, `[TELEMETRY]` autonomous reporting, client-handshake banner deferral) are clean extensions of the original design, not regressions. (Telemetry's *placement* inside the motion loop is the issue raised in #1 above — that's the only behavioral wrinkle the refactor introduced.)

**One real bug found — `$LP` / `$LMP` config-key collision (cosmetic/confusing, not functionally broken):**

- `Laser_Firmware.ino:32` doc comment claims: `$LP=<0-255>  Max laser power cap`
- But `$LP` is **already claimed** by `cnc_base.h` for `leadScrewPitchMm` (see CLAUDE.md runtime-config table)
- The actual `processModeCfgKey` in `Laser_Firmware.ino:94-98` checks for `"LMP"`/`"LM"`, **not** `"LP"` — so there is no real collision in the running code
- `SettingsContext.jsx:88-138` has **leftover scratch-work**: it pushes a stale `$LPW=${settings.laserMaxPower}` command (dead — firmware doesn't recognize `LPW`) AND the corrected `$LMP=${settings.laserMaxPower}` / `$LM=...` commands, with inline comments documenting the author's own back-and-forth ("Oh wait, firmware expects LP for max power... Let's use $LMP instead")

**Proposed fix (small, mechanical):**
1. In `SettingsContext.jsx`, delete the dead `commands.push(\`$LPW=...\`)` line and the scratch-work comments — keep only the `$LMP`/`$LM` pushes.
2. In `Laser_Firmware.ino:32`, fix the doc comment from `$LP=<0-255> Max laser power cap` to `$LMP=<0-255> Max laser power cap`.

This is purely a documentation/dead-code cleanup — the live `$LMP`/`$LM` commands already match between app and firmware, so nothing is currently broken for the user.

**Coordination with the desktop app — confirmed working end-to-end:**
- Mode-switch → settings page "Apply to Arduino" → `$KEY=VALUE` commands all match firmware `processModeCfgKey`/`processCfgKey` handlers per mode (`Pen_Firmware.ino:81-87`, `Drill_Firmware.ino:118-126`, `Laser_Firmware.ino:94-98` — verified key-by-key against `applyToArduino` in `SettingsContext.jsx`)
- Firmware-flashing pipeline (`main.js` `firmware:upload` IPC handler, avrdude path resolution, `Desktop_App/firmware/<mode>.hex` lookup) is implemented and will correctly report a clear error pointing at `Desktop_App/firmware/README.md` if the `.hex` files aren't present yet — **this is by design** (hex files must be compiled/placed manually per the README), not a bug.

No further action needed for #4 beyond the small `$LPW`/doc-comment cleanup above.

---

## Cluster B — G-Code Generation & Preview Pipeline

### Issue #3 — G-code Outline tab broken (FULLY ROOT-CAUSED — quick fix)

**Root cause:** `GCodePreview.jsx:43-48` only recognizes the **legacy** pen command for tracking pen-up/down state:
```js
if (trimmed.includes('M280') && trimmed.includes('S')) {
  const sMatch = trimmed.match(/S([\d.]+)/);
  if (sMatch) {
    const angle = parseFloat(sMatch[1]);
    penDown = angle < 60;
  }
}
```
But `gcodeCompiler.js` was changed (uncommitted, lines 202/208/212/220) to emit the **mode-agnostic** `M3` (tool on) / `M5` (tool off) convention — matching the multi-mode firmware refactor and matching every built-in G-code program (`builtinGcodes.js` uses `M3 S30` / `M5` exclusively, confirmed via grep — 20+ occurrences, zero `M280`). Since the compiler **never emits `M280` anymore**, `penDown` never flips to `true`, so the preview draws nothing but rapid-move dashes — the outline silently fails to render any drawn strokes. This is a one-file, mechanical fix.

**Proposed fix:**
```js
if (trimmed.startsWith('M3')) {
  penDown = true;
} else if (trimmed.startsWith('M5')) {
  penDown = false;
} else if (trimmed.includes('M280') && trimmed.includes('S')) {
  // Legacy fallback for hand-written/older G-code files that still use M280
  const sMatch = trimmed.match(/S([\d.]+)/);
  if (sMatch) penDown = parseFloat(sMatch[1]) < 60;
}
```
Keeping the `M280` branch as a fallback costs nothing and preserves compatibility with any older saved jobs that might still contain it. `M4` (laser dynamic mode, per `Laser_Firmware.ino:26`) should also be treated as "tool on" for forward-compatibility with laser-mode previews — add `trimmed.startsWith('M4')` alongside `M3`.

This should be the very first task landed — it's isolated, low-risk, and immediately un-breaks a feature that "was working in the last commit."

---

### Issue #5 — Import & Trace quality / "line width" handling

**Current state:** `useImageTracer.js` wraps `imagetracerjs` v1.2.6 in a Web Worker (`tracerWorker.js`), called from `ImageToGCodeTab.jsx` with tunable parameters (`numberofcolors`, `ltres`, `qtres`, `pathomit`, `blurradius`).

**Research findings (web search, 4 queries completed):**
- `imagetracerjs` is **unmaintained** (last meaningful update years ago) and its core tracing algorithm produces **polygon approximations**, not true smooth bezier curves — this is very likely *also* contributing to the "isn't great" quality complaint (separately from the #3 preview bug), since jagged polygon paths translate into jagged G-code toolpaths even after the compiler's bezier-tessellation step (`bezier.js` exists but, per CLAUDE.md, the compiler still approximates curves as straight lines to the endpoint).
- **`esm-potrace-wasm`** is the strongest replacement candidate: a modern, maintained, ESM/WASM build of the well-established Potrace algorithm, used in production by the open-source "SVGcode" raster-to-vector app. Potrace produces clean, genuinely smooth bezier-curve SVG paths (true curve fitting, not polygon approximation) — directly addressing your "draw smoothed curved lines" requirement. Electron 28 supports ESM, so integration is feasible (would replace the worker's `imagetracerjs` call with a call into the WASM module; the worker-based architecture in `useImageTracer.js` can largely be kept).
- `vtracer` (Rust/WASM) is more sophisticated (full-color vectorization) but has a heavier integration burden and a less mature JS story.
- `AutoTrace` has a useful "centerline" tracing mode (ideal for pen plotters — traces the *center* of a stroke rather than its outline) but has no maintained JS/WASM binding; would require a native binary + IPC bridge, which is a much larger undertaking.

**"Line width" handling — no off-the-shelf solution exists.** Currently the compiler treats every traced/drawn path as a single zero-width centerline stroke. To make the pen's physical line width meaningful (so the app can decide whether to draw a shape as one pass, or as N parallel offset passes to fill a wider stroke/area), a **custom parallel-offset-stroke generator** is needed — there is no dominant JS library for "fill-aware hatching for pen plotters" (the closest prior art is in Inkscape extensions like "Hatchfill" / "eggbot" plugins, which are Python, not portable).

**Proposed design:**
1. **Replace `imagetracerjs` with `esm-potrace-wasm`** for single/dual-color tracing — this directly improves curve quality (addressing both "isn't great" and "smoothed curved lines"). The `useImageTracer.js`/`tracerWorker.js` worker plumbing stays largely intact; only the actual trace call changes.
2. **Implement line-width-aware stroke generation in the compiler**, gated by the existing `lineWidth` setting (already wired through `Image2GCodeContext` → bottom bar slider): for closed/filled shapes whose stroke width should be wider than one pen pass, generate N parallel offset paths spaced at `lineWidth` apart (a basic inset/outset polygon-offset algorithm — e.g., using a small custom implementation or a geometry library such as `polygon-offset` / `clipper-lib` for robust offsetting) rather than drawing the outline once. For simple thin strokes (line width ≈ pen tip width), keep the current single-pass behavior.
3. Centerline tracing (closer to "draw what a human would draw with a pen," per AutoTrace's approach) is the *ideal* long-term direction for a pen plotter, but given the integration cost (native binary + IPC), I'd treat it as a stretch goal/future rotation rather than part of this fix — Potrace + line-width-aware stroking gets you most of the quality improvement with much less risk.

**Open decisions:**
- Confirm you want to proceed with **`esm-potrace-wasm`** as the tracer replacement (vs. staying on `imagetracerjs` and only fixing parameters/defaults — which would be a smaller, lower-quality-ceiling change).
- For line-width handling: should multi-pass offset strokes be the default for *all* shapes above a width threshold, or an opt-in toggle (e.g., a "Fill wide strokes" checkbox) so users can choose single-pass speed vs. multi-pass solid fill? My recommendation is **opt-in** — multi-pass roughly multiplies job time by the number of passes, and not every drawing needs solid fills.

---

## Cluster C — Image2GCode UI/UX

### Issue #6 — Layout, centering, outer box, margin overlay

**(a) "Should span the page"** — `Image2GCodePage.jsx:139` wraps everything in `<div className="page i2g-page">`. `.page` (in `components.css`) sets `padding: 24px; height: 100%; overflow-y: auto;`, while `.i2g-page` (`Image2GCodePage.css:1-4`) layers `display: flex; flex-direction: column; height: 100%;` on top. The combination of a **scrolling parent** (`overflow-y: auto`) with **percentage-height flex children** (`.i2g-tab-body { flex: 1; min-height: 0; }`, `.i2g-layout { flex: 1; min-height: 0; }`) is exactly the kind of nesting that causes inconsistent height resolution in Chromium/Electron — children can end up shorter than the available viewport, leaving dead space, or the page scrolls when it shouldn't. **Proposed fix:** give `.i2g-page` `overflow: hidden` (it manages its own internal scroll regions per-tab already) so the outer `.page` scroll never engages, and audit the `flex: 1; min-height: 0` chain down to the canvas/preview containers to ensure each link fills its parent. This needs to be visually verified in the running app (`npm run electron:dev`) — CSS flex height bugs are notoriously hard to fully diagnose from source alone.

**(b) "Drawing canvas isn't centered"** — confirmed: `VectorEditor.css:60-63`:
```css
.canvas-wrap {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  ...
}
```
**Proposed fix:** change both to `center`:
```css
.canvas-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  ...
}
```

**(c) "Weird outline"** — likely a visual side-effect of (a)/(b) combined with the canvas's own border (`VectorEditor.css` canvas/wrap borders) rendering against an off-center, possibly-clipped layout. Once (a) and (b) are fixed, re-inspect visually; if a stray border/outline persists, it's most likely the `.canvas-wrap { border: 1px solid var(--border-color); }` (line 58) interacting oddly with the bed-boundary `excludeFromExport` rect drawn *inside* the Fabric canvas — these are two separate visual frames that may appear to "double up." Recommend removing the wrapper's CSS border once the canvas is centered and relying solely on the in-canvas dashed bed-boundary rect for the visual frame (single source of truth, scales correctly with zoom/pan, unlike a CSS border).

**(d) "Outer box appears when image is traced into the drawer"** — root cause: `VectorEditor.jsx:101-107`'s SVG-injection handler groups **every** element from the traced SVG indiscriminately:
```js
fabric.loadSVGFromString(injectedSVG, (objects, options) => {
  const group = fabric.util.groupSVGElements(objects, options);
  group.scaleToWidth(...);
  ...
  canvas.add(group);
```
`imagetracerjs` (and Potrace-style tracers generally) commonly emit a full-canvas background rectangle as the first/bottom path, colored to match the sampled background. CLAUDE.md already documents that `colorMatch.js` provides `isBackgroundColor`/`sampleCornerColor` for exactly this kind of filtering, but **the compiler uses it while the editor's injection path does not** — so the background rect rides along into the canvas as a visible "outer box." **Proposed fix:** before grouping, filter out elements whose `fill` matches the sampled/known background color using the existing `isBackgroundColor` helper (the `Image2GCodeContext` already stores `backgroundColor`, sampled during tracing — thread it through as a prop to `VectorEditor`/`VectorDrawerTab` and use it in the injection `useEffect`):
```js
fabric.loadSVGFromString(injectedSVG, (objects, options) => {
  const filtered = objects.filter(o => !isBackgroundColor(o.fill, backgroundColor));
  const group = fabric.util.groupSVGElements(filtered, options);
  ...
```

**(e) "Canvas should have a dashed line showing safe margins, even before going to G-code outline"** — `GCodePreview.jsx` already draws a soft-limit-margin shaded zone; `VectorEditor` currently only draws the bed-boundary rect (`VectorEditor.jsx:58-69`, dashed, `excludeFromExport: true`) with no margin indicator. **Proposed fix:** add a second `excludeFromExport` rect inset by `softLimitMargin` (and, per the Issue #2 redesign, a third one for the `homingBackoff` floor near the origin corner — these can share the same visual language as the updated `GCodePreview`). Use a visually distinct dash pattern/color from the bed-boundary rect so the two are not confused (e.g., bed boundary = grey `[4,4]` dash per current code; margin zone = amber/red `[2,2]` dash, semi-transparent fill).

**Recommendation:** Because all of (a)–(e) are visual/CSS/canvas-rendering issues, this cluster **must** be verified by running `npm run electron:dev` and visually inspecting the Image2GCode page (per CLAUDE.md's "test UI changes in-browser before claiming completion" guidance) — source-level review can identify the *causes* but not confirm the *fixes look right*. Plan this cluster's tasks to end with an explicit "launch app, navigate to /image2gcode, screenshot/verify each of (a)-(e)" step.

---

## Summary of File-Level Changes (for plan-writing reference)

| Issue | Files to modify |
|---|---|
| #1 | `Arduino Codes/CNC_Firmware/cnc_base.h` (telemetry guard, hoist `setSpeed`, optionally Y2 shadow-stepping + pin defines) |
| #2 | `Desktop_App/src/lib/softLimits.js` (new `violatesSafeFloor`, remove `(0,0)` exception), `Desktop_App/src/contexts/SerialContext.jsx` (`homed` state, reject-not-warn in `jogWithIncrement`/`goToPosition`/`goToOrigin`/`sendNextGCodeLine`, G92-offset tracking), `Desktop_App/src/components/GCodePreview.jsx` (floor overlay) |
| #3 | `Desktop_App/src/components/GCodePreview.jsx` (pen-state detection, lines 43-48) |
| #4 | `Desktop_App/src/contexts/SettingsContext.jsx` (remove dead `$LPW` push + scratch comments), `Arduino Codes/CNC_Firmware/Laser_Firmware.ino` (doc-comment fix, line 32) |
| #5 | `Desktop_App/package.json` (swap `imagetracerjs` → `esm-potrace-wasm`), `Desktop_App/src/hooks/useImageTracer.js`, `Desktop_App/src/workers/tracerWorker.js`, `Desktop_App/src/lib/gcodeCompiler.js` (line-width-aware stroke generation, new offset-geometry dependency) |
| #6 | `Desktop_App/src/pages/Image2GCodePage.css` (layout/overflow), `Desktop_App/src/components/VectorEditor/VectorEditor.css` (centering, border), `Desktop_App/src/components/VectorEditor/VectorEditor.jsx` (background-path filtering on injection, margin/floor overlay rects), `Desktop_App/src/pages/tabs/VectorDrawerTab.jsx` (thread `backgroundColor`/settings through) |

---

## Open Decisions Needing Your Input Before Implementation Plans Are Written

1. **#1:** Test the low-risk telemetry+setSpeed fix (Steps A+B) on hardware first, or commit straight to the more invasive Y2 shadow-stepping rewrite (Step C)?
2. **#2:** Should floor-violation during streaming **abort the job** (my recommendation) or **skip-and-warn** like ceiling violations? And confirm: floor enforcement should be inactive until `homed === true` (since pre-homing machine coordinates are meaningless)?
3. **#5:** Approve replacing `imagetracerjs` with `esm-potrace-wasm`? And should multi-pass line-width fill be **opt-in** (checkbox, my recommendation) or **automatic** based on a width threshold?

---

## Suggested Sequencing

1. **Land #3 first** (one file, ~10 lines, immediately restores a regressed feature).
2. **Land #4 cleanup** alongside #3 (small, mechanical, no design decisions pending).
3. **Cluster A (#1, #2)** next — physical safety, but needs your answers to decisions 1-2 above before a bite-sized plan can be written with concrete code.
4. **Cluster C (#6)** — independent of the others, can be planned/executed in parallel with Cluster A once decision-free (no open questions on this cluster).
5. **Cluster B / #5** last — needs decision 3, and is the largest scope (new dependency, new geometry code) so benefits from the codebase being otherwise stable first.

Each cluster should become its own `docs/superpowers/plans/2026-06-07-<cluster-name>.md` bite-sized implementation plan once the relevant open decisions are resolved.
