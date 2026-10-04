# Virtual AVR Robot Simulation Environment

![Software-Preview.png](https://github.com/user-attachments/assets/44c462e3-ea62-43a2-b2ec-73a2fabbc6fa)

**Note: The most stable build is v0.7.5**

**VAVR-Robot-SE** is a cycle-accurate, browser-based robotics simulator that bridges low-level ATmega328P microcontroller firmware execution with real-time 2D rigid-body kinematics and physics.

## Architecture

The simulator coordinates low-level microcontroller cycles, 2D physics integration, and UI rendering within a continuous browser animation loop.

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Viewport                       │
│     ┌───────────────────────┐     ┌───────────────────┐     │
│     │   Monaco Code Editor  │     │   Render Viewport │     │
│     └──────────┬────────────┘     └─────────▲─────────┘     │
└────────────────┼────────────────────────────┼───────────────┘
                 │ (Raw C++ Sketch)           │ (Bodies & Beams)
                 ▼                            │
┌─────────────────────────────────┐           │
│   External Cross-Compiler       │           │
│   (avr-gcc / avr-objcopy)       │           │
└────────────────┬────────────────┘           │
                 │ (Intel HEX Format)         │
                 ▼                            │
┌─────────────────────────────────────────────┴───────────────┐
│               Simulation Loop (requestAnimationFrame)       │
│                                                             │
│   ┌─────────────────────┐       ┌───────────────────────┐   │
│   │   Virtual AVR CPU   │       │   Matter.js Engine    │   │
│   │     (16 MHz Clock)  │       │     (Rigid Bodies)    │   │
│   │                     │       │                       │   │
│   │ • 150k Cycles/Frame │       │ • Chassis Dynamics    │   │
│   │ • Timers / ADC      │◄─────►│ • Sensor Raycasting   │   │
│   │ • Register Poll     │       │ • Gripper Constraints │   │
│   └─────────────────────┘       └───────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Execution Pipeline

Every visual frame rendered by the browser (~16.66 ms) executes a multi-step synchronization cycle:

1. **Optical & ADC Pre-Sample**:
   The simulator reads the robot's coordinates $(x, y)$ and transforms the relative offsets of any mounted optical sensors. It extracts the luminance data of the underlying pixel map using an offscreen canvas buffer, then injects 10-bit conversions directly into the ADC registers (`0x78` / `0x79`).

2. **AVR Instruction Slicing**:
   The CPU runs an execution slice of up to **150,000 instructions per frame** (approximating real-time AVR speeds):
   * Timers (`Timer0`, `Timer1`, `Timer2`) advance their tick counts.
   * Interrupt vectors are triggered when counter registers match compare registers.
   * `USART0` serial output transmits byte-by-byte into the UART ring buffer.

3. **Time-of-Flight (ToF) Simulation**:
   Every 64 AVR cycles, the emulator inspects ultrasonic trigger pins. If a rising edge is flagged, it raycasts against the Matter.js scene geometry. The computed intersection distance is transformed into microsecond echo lengths ($T_{\text{echo}} = \text{distance} \times 58\,\mu\text{s} \times 16\,\text{cycles/}\mu\text{s}$). An external pin-high state is applied to the configured echo pin during the calculated cycle window.

4. **Kinematic Actuator Integration**:
   After the instruction slice, hardware register states are parsed:
   * PWM registers derive directional drive forces.
   * Forces and torques are transformed into global coordinate deltas ($\Delta X, \Delta Y, \Delta \theta$) and applied to the robot's physical body via `Matter.Body.setVelocity` and `Matter.Body.setAngle`.

5. **Physics Update & Canvas Pass**:
   The Matter.js physics engine steps forward (`Matter.Engine.update(16.66ms)`), resolving collisions and constraints. Custom canvas draw routines then render sensor beams, chassis grids, and active gripper links on top of the physical bodies.

## Background
This project replaces the aging [C/C++ Robot Simulator v.130715](https://krumonrobot.blogspot.com/). 

The legacy software, built on .NET Framework 3.5, suffered from critical architectural flaws:
* **Frame-Dependent Physics:** The old simulator tied physical execution to the rendering frame rate. If the computer was under heavy load or the simulator window was minimized, the simulation would yield unstable, non-deterministic results (glitches).
* **Memory Leaks:** The legacy .NET infrastructure was prone to random memory leaks, causing complex code to silently fail or crash the software.


## Features

### Interactive Firmware Development
* **Integrated Monaco Editor**: Multi-tab code editor with C++/Arduino syntax highlighting, real-time code switching, tab creation, and local persistence.
* **Remote Cross-Compilation Pipeline**: Dispatches sketch code to a headless `avr-gcc` build endpoint (`http://localhost:8080/build`), returning assembled Intel HEX machine binaries.
* **Instruction-Level Virtual CPU**: Leverages `avr8js` to interpret AVR assembly instructions directly in the browser with hardware timer, USART, and ADC parity.
* **Live Telemetry & Serial Console**: Emulated full-duplex UART console operating at 115200 baud, featuring framing check validation and instant log output.

### 2D Kinematics & Physics Engine
* **Rigid-Body Physics**: Powered by `matter-js`, providing collision detection, restitution, friction, and mass distribution.
* **Interactive Drag-and-Drop**: Real-time manipulation of the robot chassis and scene entities via an integrated `MouseConstraint`.
* **Dynamic Scene Entities**: Configurable arena containing static barriers (walls, ramps) and non-static dynamic objects with graspable properties.
* **Custom Environment Maps**: Import image assets (PNG, JPEG) directly into the viewport to serve as custom arenas, maze walls, or high-contrast tracks for line-following algorithms.

### Workspace & Project Management
* **Dual Persistence Layer**: Automatically synchronizes editor state, robot hardware layout, and arena configurations to browser `localStorage`.
* **Project Bundling (.zip Export/Import)**: Packages all sketch tabs, active background tracks, and hardware configuration into a single portable zip archive using `JSZip`.
* **Hardware Config Import/Export**: Export/import hardware definitions as standalone `.json` configurations.
* **Pose Injections**: Force override real-time chassis positions ($X$, $Y$) and orientation ($\text{Yaw}$) directly through the Odometry control panel.

## 3. Hardware Emulation & Peripherals

The simulated ATmega328P architecture maps virtual I/O pins directly to its standard register memory:
* **Port B (`0x23`–`0x25`)**: Digital Pins `8` to `13`
* **Port C (`0x26`–`0x28`)**: Analog Input Pins `A0` to `A5` (Digital `14` to `19`)
* **Port D (`0x29`–`0x2B`)**: Digital Pins `0` to `7`

```
                          ATmega328P
                       ┌───────v───────┐
    (RESET) PC6 / D19 ─┤ 1          28 ├─ PC5 / A5 / D19 (SCL)
      (RXD) PD0 / D00 ─┤ 2          27 ├─ PC4 / A4 / D18 (SDA)
      (TXD) PD1 / D01 ─┤ 3          26 ├─ PC3 / A3 / D17
     (INT0) PD2 / D02 ─┤ 4          25 ├─ PC2 / A2 / D16
     (INT1) PD3 / D03 ─┤ 5          24 ├─ PC1 / A1 / D15
   (XCK/T0) PD4 / D04 ─┤ 6          23 ├─ PC0 / A0 / D14
                  VCC ─┤ 7          22 ├─ GND
                  GND ─┤ 8          21 ├─ AREF
   (XTAL1)  PB6 / D20 ─┤ 9          20 ├─ AVCC
   (XTAL2)  PB7 / D21 ─┤ 10         19 ├─ PB5 / D13 (SCK)
   (T1/OC0B)PD5 / D05 ─┤ 11         18 ├─ PB4 / D12 (MISO)
 (AIN0/OC0A)PD6 / D06 ─┤ 12         17 ├─ PB3 / D11 (MOSI / OC2A)
     (AIN1) PD7 / D07 ─┤ 13         16 ├─ PB2 / D10 (SS / OC1B)
    (ICP1)  PB0 / D08 ─┤ 14         15 ├─ PB1 / D09 (OC1A)
                       └───────────────┘
```

### Hardware Components

```
                ▲ +X (Heading)
                │
         ┌──────┴──────┐
   [ToF] │     (0,0)   │ [Gripper]
         │      ┌─┐    │
   [IR]  │      └─┘    │  [IR]
   ──────┼─────────────┼──────► +Y
 [Motor] │   CHASSIS   │ [Motor]
         └─────────────┘
```

#### 1. Differential Actuation (DC Motors)
* **Configuration**: Speed PWM Pin, Direction Digital Pin, $(X, Y)$ relative offset, and orientation offset angle.
* **Control Register Integration**: Directly decodes PWM duty cycles through timer output compare registers:
  * Pin 3: `OCR2B` (`0xB4`)
  * Pin 5: `OCR0B` (`0x48`)
  * Pin 6: `OCR0A` (`0x47`)
  * Pin 9: `OCR1A` (`0x88`)
  * Pin 10: `OCR1B` (`0x8A`)
  * Pin 11: `OCR2A` (`0xB3`)
* **Kinematics Calculation**:
  $$\text{Power} = \frac{\text{PWM}}{255.0} \times (\text{Direction} == \text{HIGH} \,?\, -1 : 1)$$
  $$F_x = \cos(\theta_{\text{offset}}) \cdot \text{Power}, \quad F_y = \sin(\theta_{\text{offset}}) \cdot \text{Power}$$
  $$\tau = (X_{\text{offset}} \cdot F_y - Y_{\text{offset}} \cdot F_x) \times 0.0032$$

#### 2. Distance Measurement (Ultrasonic Sensor - HC-SR04)
* **Configuration**: Trigger Pin, Echo Pin, maximum range (mm), mounting coordinates, and emission angle.
* **Operational Cycle**:
  1. Microcontroller drives the trigger pin `HIGH` for $>10\,\mu\text{s}$.
  2. The simulator detects the bitmask transition in Port B, C, or D registers.
  3. A multi-step raycast query executes against the physics world up to `maxRange`.
  4. The engine schedules a timed pulse on the designated `EchoPin` via `setExternalPin`:
     $$\text{Echo Delay} = \text{Distance (cm)} \times 58\,\mu\text{s} \times 16\,\text{cycles/}\mu\text{s}$$

#### 3. Optical Line Reflection Sensor (IR LEDs & Photodiodes)
* **Configuration**: Direct Pin mapping (`A0`–`A5` or digital), mounting offsets, and beam spread characteristics.
* **Reflectance Detection Pipeline**:
  * Calculates global coordinates:
    $$x_{\text{world}} = x_{\text{robot}} + X_{\text{offset}} \cos(\theta) - Y_{\text{offset}} \sin(\theta)$$
    $$y_{\text{world}} = y_{\text{robot}} + X_{\text{offset}} \sin(\theta) + Y_{\text{offset}} \cos(\theta)$$
  * Samples the 32-bit RGBA pixel from the environment surface bitmap.
  * Derives perceived relative luminance using ITU-R BT.601 coefficients:
    $$Y = 0.299R + 0.587G + 0.114B$$
  * Maps luminance directly to the ADC conversion register array (`0`–`1023` range):
    $$\text{ADC Value} = \text{clamp}\left(0, 1023, \left\lfloor\frac{Y}{255} \times 1023\right\rfloor\right)$$

#### 4. End-Effector Mechanics (Gripper Mechanism)
* **Configuration**: Digital Activation Pin, chassis mounting offset, and orientation.
* **Grasp Resolution Logic**:
  * When the control pin state evaluates to `HIGH`, the system projects an interaction bounding box ($20\times20$ px) forward along the tool tip's center axis.
  * Queries `Matter.Query.region()` targeting unanchored bodies flagged with `{ isGraspable: true }`.
  * Instantiates a dual-constraint rigid link between the robot chassis and the target body:
    1. Tip constraint: Anchors relative coordinate centers with maximal stiffness (`stiffness = 1.0`).
    2. Base constraint: Locks relative orientation angle and arrests uncontrolled rotation.
  * Normalizes captured body mass to `0.0001` to eliminate inertia-induced chassis instability during movement.
  * Releasing the pin (`LOW`) destroys the constraints and restores original physical properties (mass and collision groups).
