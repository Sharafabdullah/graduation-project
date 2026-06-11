const slidesData = [
    {
        "id": "slide1",
        "type": "title",
        "title": "General-Purpose 3D Axes Machine",
        "subtitle": "CPE 591: Graduation Project I Report",
        "logo": "assets/image7.png",
        "authors": [
            "Rasheed Al Khaleel",
            "Ameen Jaradat",
            "Sharaf Al-Makahleh",
            "Shahed Saadeh"
        ],
        "supervisors": [
            "Dr. Anas Bsoul"
        ],
        "department": "Department of Computer Engineering | Faculty of Computer & IT"
    },
    {
        "id": "slide2",
        "type": "section_header",
        "title": "Project Abstract",
        "content": "Designing a highly precise, three-dimensional Cartesian motion platform with an open-source engineering stack."
    },
    {
        "id": "slide3",
        "type": "technological_landscape",
        "title": "Technological Landscape & Gap",
        "columns": [
            {
                "title": "The Fabrication Gap",
                "content": "Modern desktop tools are often limited to single-function operations and closed ecosystems. Belt-driven systems prioritize speed over the rigidity required for industrial tasks."
            },
            {
                "title": "The Control Challenge",
                "content": "Commercial CNC controllers are \"black box\" solutions. This project bridges the gap by building a transparent, programmable platform from the ground up, optimized for custom algorithms."
            }
        ]
    },
    {
        "id": "slide4",
        "type": "grid_icons",
        "title": "Modular Applications",
        "items": [
            { "icon": "fa-graduation-cap", "title": "Education", "content": "Practical platform for motion control and mechatronics learning." },
            { "icon": "fa-pen-nib", "title": "CNC Plotting", "content": "Precise technical sketches and printed patterns via pen attachments." },
            { "icon": "fa-image", "title": "Engraving", "content": "Image-based surface variations using custom bitmap algorithms." },
            { "icon": "fa-magnifying-glass-chart", "title": "Inspection", "content": "Automated surface scanning and consistent repeated measurements." }
        ]
    },
    {
        "id": "slide5",
        "type": "two_column_image",
        "title": "System Architecture",
        "bullets": [
            "<strong>Master (PC):</strong> Runs the Electron App for path planning, image processing, and G-code generation.",
            "<strong>Slave (Arduino):</strong> Handles real-time signal generation for motors using interrupt-driven logic.",
            "<strong>Drivers:</strong> Industrial TB6600 drivers isolate the logic from high-current motor loads."
        ],
        "image": "assets/image9.png"
    },
    {
        "id": "slide6",
        "type": "feature_list",
        "title": "App Functionality",
        "description": "The developed host application works as the centralized command center, featuring a modular interface for seamless control.",
        "features": [
            { "num": "1", "title": "Connection Management", "text": "Initiates Serial Port communication. Allows users to select ports (e.g., COM1) and configure baud rates (115200 bps)." },
            { "num": "2", "title": "Manual Jog Control", "text": "Facilitates calibration. Users can define step sizes (e.g., 0.1mm) and issue direct movement commands." },
            { "num": "3", "title": "G-Code Streaming", "text": "Loads and parses .gcode files. Features a Job Progress tracker and playback controls (Start, Pause, Resume)." },
            { "num": "4", "title": "Machine Settings", "text": "Direct configuration of hardware parameters like Steps/mm. Allows software adaptation without reflashing." },
            { "num": "5", "title": "Real-Time Status & Console", "text": "Functions as a diagnostic tool. Displays raw handshake messages and updates coordinates (X, Y, Z)." }
        ]
    },
    {
        "id": "slide7",
        "type": "grid_icons",
        "title": "Software Stack: Electron",
        "items": [
            { "icon": "fa-laptop-code", "title": "Cross-Platform", "content": "Runs on Windows, macOS, or Linux (Raspberry Pi), ensuring the machine remains \"General-Purpose.\"" },
            { "icon": "fa-node-js", "title": "Node.js Access", "content": "Utilizes the built-in Node.js runtime to access serial ports for direct hardware communication." },
            { "icon": "fa-microchip", "title": "Async Control", "content": "Uses Web Workers to handle heavy image processing without blocking the real-time serial stream." }
        ]
    },
    {
        "id": "slide8",
        "type": "bleed_image",
        "title": "How the System Works",
        "content_blocks": [
            { "heading": "X & Y Axis (Planar Motion)", "list": ["Controlled motion along X, Y, and Z axes.", "X axis handles forward/backward movement.", "Y axis enables full 2D motion in the XY plane."] },
            { "heading": "Z Axis (Vertical Control)", "list": ["Servo motor mounted above the stage for vertical movement.", "Controls height of the toolhead.", "Combined X, Y, Z movements for precise positioning."] }
        ],
        "image": "assets/image12.png"
    },
    {
        "id": "slide9",
        "type": "image_gallery",
        "title": "Mechanical Components",
        "items": [
            { "image": "assets/image8.png", "title": "T8 Lead Screws", "text": "High positional accuracy and torque conversion." },
            { "image": "assets/image6.png", "title": "Linear Rails", "text": "Hardened steel guides for smooth, straight movement." },
            { "image": "assets/image11.jpeg", "title": "Flexible Couplers", "text": "Vibration reduction and misalignment compensation." }
        ]
    },
    {
        "id": "slide10",
        "type": "two_column_image",
        "title": "Electrical & Drive Systems",
        "bullets": [
            "<strong>NEMA 17 Steppers:</strong> 200 steps/rev for precise angular displacement control.",
            "<strong>TB6600 Drivers:</strong> Provides up to 4.0A current control and microstep isolation.",
            "<strong>DC Power Supply:</strong> Stable 12V/24V integration ensures peak performance."
        ],
        "image": "assets/image10.jpeg"
    },
    {
        "id": "slide11",
        "type": "two_column_image",
        "title": "Embedded Firmware Logic",
        "bullets": [
             "<strong>Interrupt-Driven:</strong> Microsecond-level pulse timing for stepper motors.",
             "<strong>Direct Serial:</strong> Buffered communication with the host via handshake protocol.",
             "<strong>Multi-Axis:</strong> Synchronized motion using hardware timers."
        ],
        "image": "assets/image9.png",
        "subtitle": "ATmega2560 Implementation"
    },
    {
        "id": "slide12",
        "type": "technological_landscape",
        "title": "Challenges & Solutions",
        "columns": [
            {
                "title": "Hardware Challenges",
                "content": "<strong>Vibration:</strong> Solved via flexible couplers and a rigid frame.<br><strong>Alignment:</strong> Solved via careful manual calibration and pillow blocks."
            },
            {
                "title": "Software Challenges",
                "content": "<strong>Non-Deterministic Timing:</strong> Electron (JS) cannot handle microsecond pulses.<br><strong>Solution:</strong> Offload all timing-critical execution to the ATmega2560 hardware timers."
            }
        ]
    },
    {
        "id": "slide13",
        "type": "grid_icons",
        "title": "Professional Practice",
        "items": [
            { "icon": "fa-dollar-sign", "title": "Economic", "content": "Budget-friendly components reduce entry barriers for digital fabrication technologies." },
            { "icon": "fa-leaf", "title": "Sustainability", "content": "Repurposable modular toolheads minimize electronic and mechanical waste." },
            { "icon": "fa-users", "title": "Social Impact", "content": "Provides a low-cost, open-source alternative to expensive industrial CNC machines." }
        ]
    },
    {
        "id": "slide14",
        "type": "title",
        "title": "Questions?",
        "subtitle": "Thank you for your attention.",
        "authors": [],
        "department": "Jordan University of Science and Technology | 2024"
    }
];
