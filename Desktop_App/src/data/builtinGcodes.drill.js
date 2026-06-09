export const DRILL_GCODES = [
  {
    id: 'drill-points',
    name: '4-Point Drill Test',
    description: 'Drills 4 points in a 40x40mm square pattern to test plunge and dwell',
    category: 'calibration',
    mode: 'drill',
    content: `; ==========================================
; Drill 4 Points (40x40mm)
; Tests spindle start, dwell, and plunge.
; ==========================================
G90
M5
G4 P500

; Point 1
G0 X10 Y10 F1000
M3 S200
G4 P1000
M5
G4 P500

; Point 2
G0 X50 Y10 F1000
M3 S200
G4 P1000
M5
G4 P500

; Point 3
G0 X50 Y50 F1000
M3 S200
G4 P1000
M5
G4 P500

; Point 4
G0 X10 Y50 F1000
M3 S200
G4 P1000
M5
G4 P500

G0 X0 Y0 F1000
`,
  },
  {
    id: 'drill-pcb-demo',
    name: 'PCB Mount Holes Demo',
    description: 'Simulates drilling corner mounting holes for a standard PCB size',
    category: 'demo',
    mode: 'drill',
    content: `; ==========================================
; PCB Mount Holes Demo (60x40mm)
; ==========================================
G90
M5
G4 P500

G0 X5 Y5 F1000
M3 S255
G4 P800
M5
G4 P500

G0 X55 Y5 F1000
M3 S255
G4 P800
M5
G4 P500

G0 X55 Y35 F1000
M3 S255
G4 P800
M5
G4 P500

G0 X5 Y35 F1000
M3 S255
G4 P800
M5
G4 P500

G0 X0 Y0 F1000
`,
  }
];
