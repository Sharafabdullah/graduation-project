; ==========================================
; Main Firmware Demo - The House
; Demonstrates X, Y linear interpolation 
; and Z-axis servo pen lifting.
; ==========================================

; --- 1. Initialization ---
G90        ; Absolute positioning
M5         ; Pen UP (safe height)
G4 P500    ; Brief pause to let servo move

; --- 2. Move to Start Point ---
G0 X20 Y20 F2000 ; Fast traverse to starting corner

; --- 3. Start Drawing (The Walls) ---
M3 S30     ; Pen DOWN
G4 P200    ; Pause to let ink settle
G1 X20 Y60 F1200 ; Left wall (moves Y up)
G1 X60 Y60       ; Top wall (moves X right)
G1 X60 Y20       ; Right wall (moves Y down)
G1 X20 Y20       ; Bottom wall (moves X left)

; --- 4. The Roof ---
M5         ; Pen UP
G4 P200
G0 X20 Y60 F2000 ; Move to top-left of square
M3 S30     ; Pen DOWN
G4 P200
G1 X40 Y80 F1000 ; Diagonal up to peak (moves X right and Y up)
G1 X60 Y60       ; Diagonal down to top-right (moves X right and Y down)

; --- 5. The Door ---
M5         ; Pen UP
G4 P200
G0 X35 Y20 F2000 ; Move to bottom center-left
M3 S30     ; Pen DOWN
G4 P200
G1 X35 Y35 F1200 ; Door left frame
G1 X45 Y35       ; Door top
G1 X45 Y20       ; Door right frame

; --- 6. The Window ---
M5         ; Pen UP 
G4 P200
G0 X25 Y45 F2000
M3 S30     ; Pen DOWN
G4 P200
G1 X25 Y55
G1 X35 Y55
G1 X35 Y45
G1 X25 Y45

; --- 7. End Sequence ---
M5         ; Pen UP
G4 P500    ; Pause
G0 X0 Y0 F2000   ; Return to origin (Optional: Use G28 if switches are installed)
