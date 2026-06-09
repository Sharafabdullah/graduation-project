# Design Spec: Per-Mode Theming, Mode Selector in Page Headers, Image2GCode Full-Width Layout

**Date:** 2026-06-09  
**Status:** Approved

---

## Overview

Three related UI improvements:

1. **Per-mode theming** — the app accent color and glow shift when the user switches between Pen, Drill, and Laser modes.
2. **Mode selector in page headers** — the `ModeSelector` widget moves out of its floating absolute position and into the right side of every page's header row, eliminating the overlap on the Console page.
3. **Image2GCode full-width columns** — the two-column layout (controls | preview) removes its own internal padding so the cards extend edge-to-edge within the page's standard 24 px outer padding.

---

## 1. Per-Mode Theming

### Mechanism

`ModeProvider` (`src/contexts/ModeContext.jsx`) adds a `useEffect` that writes `document.documentElement.dataset.mode = mode` whenever mode changes (and on initial mount). No JS per-variable mutation; all theme work stays in CSS.

`theme.css` gains two new `[data-mode]` selector blocks that override the accent-family CSS variables. The default `:root` block (blue, pen) is unchanged — pen mode is the baseline.

### Variables overridden per mode

| Variable | pen (default) | drill | laser |
|---|---|---|---|
| `--accent` | `#007ACC` | `#D4A017` | `#E04F5F` |
| `--accent-hover` | `#005F99` | `#B8860B` | `#C43D4C` |
| `--accent-active` | `#004A7F` | `#9A6F0A` | `#A83040` |
| `--accent-glow` | `rgba(0,122,204,0.25)` | `rgba(212,160,23,0.25)` | `rgba(224,79,95,0.25)` |
| `--accent-subtle` | `rgba(0,122,204,0.08)` | `rgba(212,160,23,0.08)` | `rgba(224,79,95,0.08)` |
| `--border-focus` | `#007ACC` | `#D4A017` | `#E04F5F` |

### Sidebar accent stripe

Add a `border-top: 3px solid var(--accent)` to `.sidebar` in `Sidebar.css`. This gives a subtle, persistent visual cue of the current mode without redesigning the sidebar layout. The 3px stripe transitions smoothly because `--accent` swaps instantly (CSS var swap) and the existing `var(--transition)` can optionally be added to `border-top-color`.

### What automatically themes

Everything that already uses `var(--accent)`:
- Active sidebar nav link highlight and border
- Focused input `border-color`
- Active tab underline (`.i2g-tab.active`, `.mode-btn.active`, etc.)
- Primary button background
- Scrollbar thumb hover
- `GCodePreview` path colors (via canvas — these read `--accent` at paint time)
- ModeSelector trigger border on hover

No component changes required for theming itself — the CSS variable cascade handles it.

---

## 2. Mode Selector in Page Headers

### Problem

`ModeSelector` is in a `div.mode-header-slot` absolutely positioned `top: 20px; right: 20px` inside `.app-content`. On the Console page, the page header already has a right-side toolbar (Clear Terminal, Export). The floating selector lands on top of those buttons.

### Solution

Remove the global floating slot. Render `ModeSelector` inline in each page's header.

**Files to change:**
- `src/App.jsx` — remove `<div className="mode-header-slot"><ModeSelector /></div>`
- `src/App.css` — remove `.mode-header-slot` rule
- All 6 page files — add `ModeSelector` to the right side of `page-header`

**Header structure for simple pages** (Dashboard, Manual, GCode, Image2GCode, Settings):

```jsx
<div className="page-header">
  <div className="page-header-left">
    <h1 className="page-title">…</h1>
    <p className="page-subtitle">…</p>
  </div>
  <ModeSelector />
</div>
```

`.page-header` gains `display: flex; align-items: flex-start; justify-content: space-between` in `components.css`. The existing `margin-bottom: 20px` is kept.

**ConsolePage** — already has a two-part header with a `console-toolbar` div on the right. `ModeSelector` is added as the last element in `.console-toolbar` (rightmost), after the Export button:

```jsx
<div className="console-toolbar">
  <button …>Clear Terminal</button>
  <button …>Export</button>
  <ModeSelector />
</div>
```

No structural change to ConsolePage's header layout — it already uses `justify-content: space-between`.

### Import

Each page imports `ModeSelector` from `'../components/ModeSelector'`. No prop drilling needed — `ModeSelector` reads `ModeContext` directly.

---

## 3. Image2GCode Full-Width Columns

### Problem

`.image-tab` applies `padding: 1rem` on all sides, shrinking the grid inside an already-padded `.page` (24 px). The controls and preview cards end up narrower than necessary.

### Fix

Remove `padding` from `.image-tab`. The cards (`image-tab-controls card`, `image-tab-preview card`) already have their own internal padding. The 1 rem `gap` between columns is preserved. The 24 px outer `.page` padding remains — consistent with all other pages.

Also bump the controls column from `280px` to `320px` to give sliders and labels more breathing room at the wider effective width.

**Resulting grid:** `grid-template-columns: 320px 1fr` with no extra outer padding — preview column fills all remaining space.

---

## Files Changed

| File | Change |
|---|---|
| `src/contexts/ModeContext.jsx` | Add `useEffect` to set `document.documentElement.dataset.mode` |
| `src/styles/theme.css` | Add `[data-mode="drill"]` and `[data-mode="laser"]` CSS blocks |
| `src/components/Sidebar.css` | Add `border-top: 3px solid var(--accent)` with transition |
| `src/App.jsx` | Remove `mode-header-slot` div and `ModeSelector` import |
| `src/App.css` | Remove `.mode-header-slot` rule |
| `src/styles/components.css` | Make `.page-header` flex with space-between |
| `src/pages/DashboardPage.jsx` | Add ModeSelector to header right |
| `src/pages/ManualControlPage.jsx` | Add ModeSelector to header right |
| `src/pages/GCodeJobsPage.jsx` | Add ModeSelector to header right |
| `src/pages/Image2GCodePage.jsx` | Add ModeSelector to header right |
| `src/pages/SettingsPage.jsx` | Add ModeSelector to header right |
| `src/pages/ConsolePage.jsx` | Add ModeSelector as last item in console-toolbar |
| `src/pages/Image2GCodePage.css` | Remove padding from `.image-tab`, bump controls column to 320px |

---

## Non-Goals

- No full palette redesign (background colors stay neutral dark for all modes)
- No per-mode page content changes (just theming)
- No new routing or context restructuring
