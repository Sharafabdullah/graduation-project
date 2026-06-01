// Built-in G-code files that ship with the app.
// Each has a name, description, category, and content.

export const BUILTIN_GCODES = [
  // ── Basic Shapes ────────────────────────────────────────────────────────────
  {
    id: 'line',
    name: 'Straight Line',
    description: 'Draw a 50mm horizontal line from origin',
    category: 'shapes',
    content: `; Simple straight line — 50mm horizontal
G90
M5
G0 X0 Y10 F1000
M3 S30
G4 P200
G1 X50 Y10 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
  },
  {
    id: 'triangle',
    name: 'Triangle',
    description: 'Equilateral-ish triangle — tests diagonal motion in both directions',
    category: 'shapes',
    content: `; Triangle
G90
M5
G0 X10 Y10 F1000
M3 S30
G4 P200
G1 X50 Y10 F800
G1 X30 Y44 F800
G1 X10 Y10 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
  },
  {
    id: 'square',
    name: 'Square',
    description: 'Simple 40×40mm square from a corner origin',
    category: 'shapes',
    content: `; Square 40x40mm
G90
M5
G0 X5 Y5 F1000
M3 S30
G4 P200
G1 X45 Y5 F800
G1 X45 Y45 F800
G1 X5 Y45 F800
G1 X5 Y5 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
  },
  {
    id: 'rectangle',
    name: 'Rectangle',
    description: '60×30mm landscape rectangle',
    category: 'shapes',
    content: `; Rectangle 60x30mm
G90
M5
G0 X5 Y10 F1000
M3 S30
G4 P200
G1 X65 Y10 F800
G1 X65 Y40 F800
G1 X5 Y40 F800
G1 X5 Y10 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
  },
  {
    id: 'cross',
    name: 'Plus / Cross',
    description: 'A centered cross shape — tests axis transitions',
    category: 'shapes',
    content: `; Plus / Cross shape
G90
M5

; Horizontal bar
G0 X5 Y22 F1000
M3 S30
G4 P200
G1 X55 Y22 F800
G1 X55 Y28 F800
G1 X5 Y28 F800
G1 X5 Y22 F800
M5

; Vertical bar
G4 P200
G0 X22 Y5 F1000
M3 S30
G4 P200
G1 X28 Y5 F800
G1 X28 Y55 F800
G1 X22 Y55 F800
G1 X22 Y5 F800
M5
G4 P300
G0 X0 Y0 F1000
`,
  },

  {
    id: 'calibration-grid',
    name: 'Calibration Grid',
    description: '50×50mm grid with 10mm spacing — verify steps/mm accuracy',
    category: 'calibration',
    content: `; ==========================================
; Calibration Grid 50x50mm, 10mm spacing
; Use this to verify steps/mm settings.
; Expected result: perfectly square grid.
; ==========================================
G90
M5
G28
G4 P500

; Vertical lines (X = 0 to 50, spaced 10mm)
G0 X0 Y0 F1000
M3 S30
G4 P200
G1 Y50 F800
M5
G4 P200

G0 X10 Y0 F1000
M3 S30
G4 P200
G1 Y50 F800
M5
G4 P200

G0 X20 Y0 F1000
M3 S30
G4 P200
G1 Y50 F800
M5
G4 P200

G0 X30 Y0 F1000
M3 S30
G4 P200
G1 Y50 F800
M5
G4 P200

G0 X40 Y0 F1000
M3 S30
G4 P200
G1 Y50 F800
M5
G4 P200

G0 X50 Y0 F1000
M3 S30
G4 P200
G1 Y50 F800
M5
G4 P200

; Horizontal lines (Y = 0 to 50, spaced 10mm)
G0 X0 Y0 F1000
M3 S30
G4 P200
G1 X50 F800
M5
G4 P200

G0 X0 Y10 F1000
M3 S30
G4 P200
G1 X50 F800
M5
G4 P200

G0 X0 Y20 F1000
M3 S30
G4 P200
G1 X50 F800
M5
G4 P200

G0 X0 Y30 F1000
M3 S30
G4 P200
G1 X50 F800
M5
G4 P200

G0 X0 Y40 F1000
M3 S30
G4 P200
G1 X50 F800
M5
G4 P200

G0 X0 Y50 F1000
M3 S30
G4 P200
G1 X50 F800
M5
G4 P500

G0 X0 Y0 F1000
`,
  },
  {
    id: 'test-square',
    name: 'Test Square 40×40mm',
    description: 'Simple filled border square — quick connection and motion test',
    category: 'calibration',
    content: `; ==========================================
; Test Square 40x40mm
; Quick motion and pen test.
; ==========================================
G90
M5
G4 P300

G0 X5 Y5 F1000
M3 S30
G4 P200

G1 X45 Y5 F800
G1 X45 Y45 F800
G1 X5 Y45 F800
G1 X5 Y5 F800

M5
G4 P300
G0 X0 Y0 F1000
`,
  },
  {
    id: 'pen-test',
    name: 'Head Lift Test',
    description: 'Alternating dots to verify servo head up/down is working correctly',
    category: 'calibration',
    content: `; ==========================================
; Pen Lift / Servo Test
; Draws dots in a row to verify servo.
; ==========================================
G90
M5
G4 P500

; Dot 1
G0 X10 Y20 F1000
M3 S30
G4 P400
M5
G4 P300

; Dot 2
G0 X20 Y20 F1000
M3 S30
G4 P400
M5
G4 P300

; Dot 3
G0 X30 Y20 F1000
M3 S30
G4 P400
M5
G4 P300

; Dot 4
G0 X40 Y20 F1000
M3 S30
G4 P400
M5
G4 P300

; Dot 5
G0 X50 Y20 F1000
M3 S30
G4 P400
M5
G4 P500

G0 X0 Y0 F1000
`,
  },
  {
    id: 'the-house',
    name: 'The House (Demo)',
    description: 'Classic demo drawing — house with walls, roof, door, and window',
    category: 'demo',
    content: `; ==========================================
; The House Demo
; Classic firmware demo drawing.
; ==========================================
G90
M5
G4 P500

; Move to Start
G0 X20 Y20 F1000

; Walls
M3 S30
G4 P200
G1 X20 Y60 F800
G1 X60 Y60 F800
G1 X60 Y20 F800
G1 X20 Y20 F800

; Roof
M5
G4 P200
G0 X20 Y60 F1000
M3 S30
G4 P200
G1 X40 Y80 F1000
G1 X60 Y60 F800

; Door
M5
G4 P200
G0 X35 Y20 F1000
M3 S30
G4 P200
G1 X35 Y35 F800
G1 X45 Y35 F800
G1 X45 Y20 F800

; Window
M5
G4 P200
G0 X25 Y45 F1000
M3 S30
G4 P200
G1 X25 Y55 F800
G1 X35 Y55 F800
G1 X35 Y45 F800
G1 X25 Y45 F800

; End
M5
G4 P500
G0 X0 Y0 F1000
`,
  },
  {
    id: 'spiral',
    name: 'Spiral Approximation',
    description: 'Multi-pass expanding square spiral — tests continuous motion and feed rates',
    category: 'demo',
    content: `; ==========================================
; Expanding Square Spiral
; Tests continuous motion and speed.
; ==========================================
G90
M5
G0 X25 Y25 F1000
M3 S30
G4 P200

G1 X26 Y25 F800
G1 X26 Y24 F800
G1 X24 Y24 F800
G1 X24 Y26 F800
G1 X27 Y26 F800
G1 X27 Y23 F800
G1 X23 Y23 F800
G1 X23 Y28 F800
G1 X29 Y28 F800
G1 X29 Y22 F800
G1 X22 Y22 F800
G1 X22 Y30 F800
G1 X31 Y30 F800
G1 X31 Y21 F800
G1 X21 Y21 F800
G1 X21 Y32 F800
G1 X33 Y32 F800
G1 X33 Y20 F800
G1 X20 Y20 F800
G1 X20 Y34 F800
G1 X35 Y34 F800
G1 X35 Y19 F800
G1 X19 Y19 F800
G1 X19 Y36 F800
G1 X37 Y36 F800
G1 X37 Y18 F800
G1 X18 Y18 F800
G1 X18 Y38 F800
G1 X39 Y38 F800
G1 X39 Y17 F800
G1 X17 Y17 F800
G1 X17 Y40 F800
G1 X41 Y40 F800
G1 X41 Y16 F800
G1 X16 Y16 F800

M5
G4 P400
G0 X0 Y0 F1000
`,
  },
  {
    id: 'diagonal-test',
    name: 'Diagonal Accuracy Test',
    description: 'X shapes and diagonals — checks Bresenham interpolation accuracy',
    category: 'calibration',
    content: `; ==========================================
; Diagonal Accuracy Test
; Checks X and Y motion synchronization.
; ==========================================
G90
M5

; Large X cross
G0 X5 Y5 F1000
M3 S30
G4 P200
G1 X55 Y55 F800
M5

G4 P200
G0 X55 Y5 F1000
M3 S30
G4 P200
G1 X5 Y55 F800
M5

; Border square
G4 P200
G0 X5 Y5 F1000
M3 S30
G4 P200
G1 X55 Y5 F800
G1 X55 Y55 F800
G1 X5 Y55 F800
G1 X5 Y5 F800
M5

; Center dot
G4 P200
G0 X30 Y30 F1000
M3 S30
G4 P500
M5
G4 P400
G0 X0 Y0 F1000
`,
  },
];

export function getBuiltinById(id) {
  return BUILTIN_GCODES.find(f => f.id === id);
}

export function getBuiltinsByCategory(category) {
  return BUILTIN_GCODES.filter(f => f.category === category);
}

// Convert a builtin entry to the same shape as a loaded file
export function builtinToFile(builtin) {
  const lines = builtin.content.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith(';'));
  return {
    name: builtin.name,
    path: `builtin:${builtin.id}`,
    content: builtin.content,
    size: new TextEncoder().encode(builtin.content).length,
    lines: lines.length,
    builtin: true,
    description: builtin.description,
    category: builtin.category,
  };
}
