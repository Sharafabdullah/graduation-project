export const LASER_GCODES = [
  {
    id: 'laser-square',
    name: 'Laser Square (20x20mm)',
    description: 'Engrave a simple 20x20mm square outline',
    category: 'shapes',
    mode: 'laser',
    content: `; ==========================================
; Laser Square (20x20)
; ==========================================
G90
M5
G4 P500

G0 X10 Y10 F1000
M3 S200
G1 X30 Y10 F400
G1 X30 Y30 F400
G1 X10 Y30 F400
G1 X10 Y10 F400
M5
G0 X0 Y0 F1000
`,
  },
  {
    id: 'laser-grid',
    name: 'Laser Calibration Grid',
    description: '10x10mm grid for 30x30mm area to check focus and burn width',
    category: 'calibration',
    mode: 'laser',
    content: `; ==========================================
; Laser Calibration Grid
; ==========================================
G90
M5
G4 P500

; Horizontal Lines
G0 X10 Y10 F1000
M3 S150
G1 X40 Y10 F400
M5

G0 X10 Y20 F1000
M3 S150
G1 X40 Y20 F400
M5

G0 X10 Y30 F1000
M3 S150
G1 X40 Y30 F400
M5

G0 X10 Y40 F1000
M3 S150
G1 X40 Y40 F400
M5

; Vertical Lines
G0 X10 Y10 F1000
M3 S150
G1 X10 Y40 F400
M5

G0 X20 Y10 F1000
M3 S150
G1 X20 Y40 F400
M5

G0 X30 Y10 F1000
M3 S150
G1 X30 Y40 F400
M5

G0 X40 Y10 F1000
M3 S150
G1 X40 Y40 F400
M5

G0 X0 Y0 F1000
`,
  }
];
