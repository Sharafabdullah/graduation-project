; ==========================================
; SG90 Servo Complex Demo
; Demonstrates smooth sweeping, staircase
; patterns, and variable speed routines.
; ==========================================

; --- 1. Initialization ---
M3 S90     ; Move to center home position
G4 P1000   ; Wait 1 second to ensure it's centered

; --- 2. The Slow Sweep (0 -> 180 -> 0) ---
; Moving in 10-degree increments with 100ms pauses
; to simulate a slower, controlled sweeping motion.
M3 S80
G4 P100
M3 S70
G4 P100
M3 S60
G4 P100
M3 S50
G4 P100
M3 S40
G4 P100
M3 S30
G4 P100
M3 S20
G4 P100
M3 S10
G4 P100
M3 S0      ; Hit bottom limit
G4 P500    ; Pause at limit

M3 S10
G4 P100
M3 S20
G4 P100
M3 S30
G4 P100
M3 S40
G4 P100
M3 S50
G4 P100
M3 S60
G4 P100
M3 S70
G4 P100
M3 S80
G4 P100
M3 S90
G4 P100
M3 S100
G4 P100
M3 S110
G4 P100
M3 S120
G4 P100
M3 S130
G4 P100
M3 S140
G4 P100
M3 S150
G4 P100
M3 S160
G4 P100
M3 S170
G4 P100
M3 S180     ; Hit top limit
G4 P500     ; Pause at limit

M3 S170
G4 P100
M3 S160
G4 P100
M3 S150
G4 P100
M3 S140
G4 P100
M3 S130
G4 P100
M3 S120
G4 P100
M3 S110
G4 P100
M3 S100
G4 P100
M3 S90      ; Back to center
G4 P1000    ; Pause before next routine

; --- 3. The Staircase (Large Steps) ---
; Moving in large 45-degree chunks
M3 S135     
G4 P800     
M3 S180     
G4 P800     
M3 S135     
G4 P800     
M3 S90      
G4 P800     
M3 S45      
G4 P800     
M3 S0       
G4 P800     
M3 S45      
G4 P800     
M3 S90      
G4 P1000    ; End staircase

; --- 4. The Morse Code / Twitch ---
; Simulating rapid small movements (jitter or twitching)
M3 S85
G4 P150
M3 S95
G4 P150
M3 S85
G4 P150
M3 S95
G4 P150
M3 S85
G4 P150
M3 S95
G4 P500     ; longer pause
M3 S70
G4 P150
M3 S110
G4 P150
M3 S70
G4 P150
M3 S110
G4 P1000

; --- 5. Return Home ---
M5         ; Use the Spindle Off command to cleanly return to 90 degrees
G4 P1000
