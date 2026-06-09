# Mode Theming & Layout Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply per-mode accent theming via CSS variables, move the ModeSelector widget into each page's header row, and make the Image2GCode two-column layout fill the full page width.

**Architecture:** Mode theming uses a `data-mode` attribute on `<html>` written by `ModeContext`, overriding CSS variable families in `theme.css` — no JS per-variable mutation, no component changes needed. The ModeSelector moves from a floating absolute slot in `App.jsx` into inline `page-header` markup in each of the six pages. The Image2GCode layout fix removes the redundant inner padding from `.image-tab`.

**Tech Stack:** React 18, CSS custom properties, Electron + Vite. No new dependencies. All verification is visual (no automated UI tests exist for this app).

---

## File Map

| File | Change |
|---|---|
| `Desktop_App/src/contexts/ModeContext.jsx` | Add `useEffect` to write `document.documentElement.dataset.mode` |
| `Desktop_App/src/styles/theme.css` | Add `[data-mode="drill"]` and `[data-mode="laser"]` variable blocks |
| `Desktop_App/src/components/Sidebar.css` | Add `border-top: 3px solid var(--accent)` + color transition to `.sidebar` |
| `Desktop_App/src/App.jsx` | Remove `<div className="mode-header-slot">` and its `ModeSelector` import |
| `Desktop_App/src/App.css` | Remove `.mode-header-slot` rule |
| `Desktop_App/src/styles/components.css` | Make `.page-header` flex with space-between |
| `Desktop_App/src/pages/DashboardPage.jsx` | Add `ModeSelector` to header right |
| `Desktop_App/src/pages/ManualControlPage.jsx` | Add `ModeSelector` to header right |
| `Desktop_App/src/pages/GCodeJobsPage.jsx` | Add `ModeSelector` to header right |
| `Desktop_App/src/pages/Image2GCodePage.jsx` | Add `ModeSelector` to header right |
| `Desktop_App/src/pages/SettingsPage.jsx` | Add `ModeSelector` to header right |
| `Desktop_App/src/pages/ConsolePage.jsx` | Add `ModeSelector` as last item in `.console-toolbar` |
| `Desktop_App/src/pages/Image2GCodePage.css` | Remove padding from `.image-tab`; bump column to `320px` |

---

## Task 1: Per-Mode CSS Theming

**Files:**
- Modify: `Desktop_App/src/contexts/ModeContext.jsx`
- Modify: `Desktop_App/src/styles/theme.css`
- Modify: `Desktop_App/src/components/Sidebar.css`

- [ ] **Step 1.1 — Wire `data-mode` attribute in ModeContext**

  In `Desktop_App/src/contexts/ModeContext.jsx`, add `useEffect` to the import list and add the effect inside `ModeProvider`, just before the `value` object definition:

  Change the import line from:
  ```js
  import React, { createContext, useContext, useState, useCallback } from 'react';
  ```
  to:
  ```js
  import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
  ```

  Inside `ModeProvider`, after the `markFirmwareUploaded` callback and before `const modeConfig = MODES[mode];`, add:
  ```js
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);
  ```

- [ ] **Step 1.2 — Add drill and laser theme blocks to theme.css**

  In `Desktop_App/src/styles/theme.css`, append the following after the closing `}` of the `:root` block (after line 49):

  ```css
  /* ── Drill mode (amber) ────────────────────────────────────────────────────── */
  [data-mode="drill"] {
    --accent:        #D4A017;
    --accent-hover:  #B8860B;
    --accent-active: #9A6F0A;
    --accent-glow:   rgba(212, 160, 23, 0.25);
    --accent-subtle: rgba(212, 160, 23, 0.08);
    --border-focus:  #D4A017;
  }

  /* ── Laser mode (red-coral) ────────────────────────────────────────────────── */
  [data-mode="laser"] {
    --accent:        #E04F5F;
    --accent-hover:  #C43D4C;
    --accent-active: #A83040;
    --accent-glow:   rgba(224, 79, 95, 0.25);
    --accent-subtle: rgba(224, 79, 95, 0.08);
    --border-focus:  #E04F5F;
  }
  ```

- [ ] **Step 1.3 — Add mode accent stripe to sidebar**

  In `Desktop_App/src/components/Sidebar.css`, update the `.sidebar` rule to add a colored top border and a color transition:

  Change:
  ```css
  .sidebar {
    width: var(--sidebar-width);
    min-width: var(--sidebar-width);
    height: 100vh;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    transition: width 0.2s ease, min-width 0.2s ease;
    overflow: hidden;
    user-select: none;
  }
  ```
  to:
  ```css
  .sidebar {
    width: var(--sidebar-width);
    min-width: var(--sidebar-width);
    height: 100vh;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    border-top: 3px solid var(--accent);
    display: flex;
    flex-direction: column;
    transition: width 0.2s ease, min-width 0.2s ease, border-top-color 0.3s ease;
    overflow: hidden;
    user-select: none;
  }
  ```

- [ ] **Step 1.4 — Verify visually**

  Run `npm run electron:dev` from `Desktop_App/`. Switch modes via the ModeSelector dropdown (top-right of app). Verify:
  - Pen mode: accent is blue (`#007ACC`) — active nav link, focused inputs, primary buttons
  - Drill mode: accent shifts to amber (`#D4A017`) across the same elements
  - Laser mode: accent shifts to red/coral (`#E04F5F`)
  - Sidebar has a 3px top stripe matching the current mode color
  - Stripe transitions smoothly when switching modes

- [ ] **Step 1.5 — Commit**

  ```bash
  git add Desktop_App/src/contexts/ModeContext.jsx Desktop_App/src/styles/theme.css Desktop_App/src/components/Sidebar.css
  git commit -m "feat(theme): per-mode accent theming via data-mode CSS attribute"
  ```

---

## Task 2: Move ModeSelector Into Page Headers

**Files:**
- Modify: `Desktop_App/src/App.jsx`
- Modify: `Desktop_App/src/App.css`
- Modify: `Desktop_App/src/styles/components.css`
- Modify: `Desktop_App/src/pages/DashboardPage.jsx`
- Modify: `Desktop_App/src/pages/ManualControlPage.jsx`
- Modify: `Desktop_App/src/pages/GCodeJobsPage.jsx`
- Modify: `Desktop_App/src/pages/Image2GCodePage.jsx`
- Modify: `Desktop_App/src/pages/SettingsPage.jsx`
- Modify: `Desktop_App/src/pages/ConsolePage.jsx`

- [ ] **Step 2.1 — Remove the floating slot from App.jsx**

  In `Desktop_App/src/App.jsx`, remove the `ModeSelector` import and the `mode-header-slot` div.

  Remove this import line:
  ```js
  import ModeSelector from './components/ModeSelector';
  ```

  Inside `AppContent`, remove:
  ```jsx
  {/* Mode selector sits in the top-right corner on every page */}
  <div className="mode-header-slot">
    <ModeSelector />
  </div>
  ```

  The `AppContent` function body should now look like:
  ```jsx
  function AppContent() {
    const location = useLocation();
    const showDrawer = location.pathname !== '/console';

    return (
      <main className="app-content">
        <div className="page-wrapper" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/manual" element={<ManualControlPage />} />
            <Route path="/gcode" element={<GCodeJobsPage />} />
            <Route path="/image2gcode" element={<Image2GCodePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/console" element={<ConsolePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {showDrawer && <ConsoleDrawer />}
      </main>
    );
  }
  ```

- [ ] **Step 2.2 — Remove the floating slot CSS from App.css**

  In `Desktop_App/src/App.css`, remove the entire comment block and rule for `.mode-header-slot`:

  Remove:
  ```css
  /* ── Global page-header bar ─────────────────────────────────────────────────
     Each page renders a .page-header with h1.page-title on the left.
     We inject the ModeSelector into a .page-header-mode-slot absolutely
     positioned at the top-right of the content area. This keeps each page
     layout simple (no prop drilling) while ensuring the selector is always
     visible at the same position.
  ────────────────────────────────────────────────────────────────────────────── */
  .mode-header-slot {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 200;
  }
  ```

- [ ] **Step 2.3 — Make `.page-header` a flex row in components.css**

  In `Desktop_App/src/styles/components.css`, update the `.page-header` rule:

  Change:
  ```css
  .page-header {
    margin-bottom: 20px;
  }
  ```
  to:
  ```css
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  ```

- [ ] **Step 2.4 — Update DashboardPage header**

  In `Desktop_App/src/pages/DashboardPage.jsx`, add the `ModeSelector` import at the top of the file (with the other imports):
  ```js
  import ModeSelector from '../components/ModeSelector';
  ```

  Then update the `page-header` block. Change:
  ```jsx
  <div className="page-header">
    <h1 className="page-title">Dashboard</h1>
    <p className="page-subtitle">Machine overview and quick controls</p>
  </div>
  ```
  to:
  ```jsx
  <div className="page-header">
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-subtitle">Machine overview and quick controls</p>
    </div>
    <ModeSelector />
  </div>
  ```

- [ ] **Step 2.5 — Update ManualControlPage header**

  In `Desktop_App/src/pages/ManualControlPage.jsx`, add the import:
  ```js
  import ModeSelector from '../components/ModeSelector';
  ```

  Change:
  ```jsx
  <div className="page-header">
    <h1 className="page-title">Manual Control</h1>
    <p className="page-subtitle">Jog the machine, set positions, and control the head</p>
  </div>
  ```
  to:
  ```jsx
  <div className="page-header">
    <div>
      <h1 className="page-title">Manual Control</h1>
      <p className="page-subtitle">Jog the machine, set positions, and control the head</p>
    </div>
    <ModeSelector />
  </div>
  ```

- [ ] **Step 2.6 — Update GCodeJobsPage header**

  In `Desktop_App/src/pages/GCodeJobsPage.jsx`, add the import:
  ```js
  import ModeSelector from '../components/ModeSelector';
  ```

  Change:
  ```jsx
  <div className="page-header">
    <h1 className="page-title">G-Code Jobs</h1>
    <p className="page-subtitle">Load, preview, and stream G-code files to the machine</p>
  </div>
  ```
  to:
  ```jsx
  <div className="page-header">
    <div>
      <h1 className="page-title">G-Code Jobs</h1>
      <p className="page-subtitle">Load, preview, and stream G-code files to the machine</p>
    </div>
    <ModeSelector />
  </div>
  ```

- [ ] **Step 2.7 — Update Image2GCodePage header**

  In `Desktop_App/src/pages/Image2GCodePage.jsx`, add the import (it already imports from `'../contexts/ModeContext'` but not the component):
  ```js
  import ModeSelector from '../components/ModeSelector';
  ```

  Change:
  ```jsx
  <div className="page-header">
    <h1 className="page-title">Image to G-Code</h1>
    <p className="page-subtitle">Trace images or draw vectors, then compile and run</p>
  </div>
  ```
  to:
  ```jsx
  <div className="page-header">
    <div>
      <h1 className="page-title">Image to G-Code</h1>
      <p className="page-subtitle">Trace images or draw vectors, then compile and run</p>
    </div>
    <ModeSelector />
  </div>
  ```

- [ ] **Step 2.8 — Update SettingsPage header**

  In `Desktop_App/src/pages/SettingsPage.jsx`, add the import:
  ```js
  import ModeSelector from '../components/ModeSelector';
  ```

  Change:
  ```jsx
  <div className="page-header">
    <h1 className="page-title">Machine Settings</h1>
    <p className="page-subtitle">Configure hardware parameters — applied to Arduino on save</p>
  </div>
  ```
  to:
  ```jsx
  <div className="page-header">
    <div>
      <h1 className="page-title">Machine Settings</h1>
      <p className="page-subtitle">Configure hardware parameters — applied to Arduino on save</p>
    </div>
    <ModeSelector />
  </div>
  ```

- [ ] **Step 2.9 — Update ConsolePage header**

  The Console page already has a two-part header with `justify-content: space-between` and a `console-toolbar` div on the right. Add `ModeSelector` as the **last** element inside `.console-toolbar`.

  In `Desktop_App/src/pages/ConsolePage.jsx`, add the import:
  ```js
  import ModeSelector from '../components/ModeSelector';
  ```

  Find the `console-toolbar` div (currently has Clear Terminal and Export buttons) and add `<ModeSelector />` after the Export button:
  ```jsx
  <div className="console-toolbar">
    <button className="btn btn-sm btn-ghost" onClick={clearConsole}>Clear Terminal</button>
    <button className="btn btn-sm btn-ghost" onClick={handleExport}>Export</button>
    <ModeSelector />
  </div>
  ```

- [ ] **Step 2.10 — Verify visually**

  With the app running (`npm run electron:dev` from `Desktop_App/`), navigate through all six pages. Verify:
  - ModeSelector appears in the top-right of every page header, aligned with the title row
  - On the Console page, ModeSelector is the rightmost item after Clear Terminal and Export — not overlapping anything
  - No floating selector is visible anywhere
  - The mode dropdown still opens correctly on all pages

- [ ] **Step 2.11 — Commit**

  ```bash
  git add Desktop_App/src/App.jsx Desktop_App/src/App.css Desktop_App/src/styles/components.css \
    Desktop_App/src/pages/DashboardPage.jsx Desktop_App/src/pages/ManualControlPage.jsx \
    Desktop_App/src/pages/GCodeJobsPage.jsx Desktop_App/src/pages/Image2GCodePage.jsx \
    Desktop_App/src/pages/SettingsPage.jsx Desktop_App/src/pages/ConsolePage.jsx
  git commit -m "feat(layout): move ModeSelector into each page header, remove floating slot"
  ```

---

## Task 3: Image2GCode Full-Width Columns

**Files:**
- Modify: `Desktop_App/src/pages/Image2GCodePage.css`

- [ ] **Step 3.1 — Remove inner padding and widen controls column**

  In `Desktop_App/src/pages/Image2GCodePage.css`, update the `.image-tab` rule.

  Change:
  ```css
  .image-tab {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 1rem;
    padding: 1rem;
    height: 100%;
    box-sizing: border-box;
  }
  ```
  to:
  ```css
  .image-tab {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1rem;
    padding: 0;
    height: 100%;
    box-sizing: border-box;
  }
  ```

- [ ] **Step 3.2 — Verify visually**

  Navigate to the Image to G-Code page (Upload & Transform tab). Verify:
  - The controls card (left column, 320px) and preview card (right column) span the full width of the page content area, flush against the 24px outer page padding
  - Sliders and labels in the controls column have more horizontal space than before
  - The preview column is visibly wider (fills remaining space)
  - All three preview boxes (Original, Threshold, Traced Vector) still render correctly

- [ ] **Step 3.3 — Commit**

  ```bash
  git add Desktop_App/src/pages/Image2GCodePage.css
  git commit -m "fix(i2g): remove inner tab padding so columns span full page width"
  ```

---

## Self-Review

**Spec coverage:**
- ✅ `data-mode` attribute written by ModeProvider → Task 1.1
- ✅ `[data-mode="drill"]` and `[data-mode="laser"]` CSS blocks → Task 1.2
- ✅ Sidebar accent stripe → Task 1.3
- ✅ Remove `mode-header-slot` from App.jsx + App.css → Tasks 2.1, 2.2
- ✅ `.page-header` flex layout → Task 2.3
- ✅ ModeSelector in all 5 simple pages → Tasks 2.4–2.8
- ✅ ModeSelector in ConsolePage toolbar → Task 2.9
- ✅ `.image-tab` padding removed, column widened → Task 3.1

**Placeholder scan:** No TBD, no "similar to above", all code blocks are complete.

**Type consistency:** `ModeSelector` component name used consistently across all 9 page/app steps. CSS class names `.page-header`, `.console-toolbar`, `.image-tab`, `.mode-header-slot` match the actual file content read during planning.
