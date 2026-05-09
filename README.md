# 🤖 Virtual AVR Robot Simulation Environment

**VAVR-Robot-SE** is a browser-based, deterministic robotics simulation environment that allows users to write and execute Arduino (C/C++) code on a virtual ATmega328P microcontroller connected to a 2D physics engine.

## 📖 Background
This project was built to replace the aging [C/C++ Robot Simulator v.130715](https://krumonrobot.blogspot.com/). 

The legacy software, built on .NET Framework 3.5, suffered from critical architectural flaws:
* **Frame-Dependent Physics:** The old simulator tied physical execution to the rendering frame rate. If the computer was under heavy load or the simulator window was minimized, the simulation would yield unstable, non-deterministic results (glitches).
* **Memory Leaks:** The legacy .NET infrastructure was prone to random memory leaks, causing complex code to silently fail or crash the software.

**VAVR-Robot-SE** solves these issues by completely decoupling the hardware logic from the visual rendering. It ensures that the virtual robot will perform exactly the same way, every single time, regardless of screen refresh rates or computer CPU load.

## ⚙️ How It Works
The simulator acts as a bridge between a cycle-accurate CPU emulator and a rigid-body physics engine:

* **The Brain (`avr8js`)**: Emulates the ATmega328P CPU. It executes compiled `.hex` machine code with cycle-accurate precision, managing Timers, PWM (via OCR registers), ADC channels, and Digital I/O.
* **The World (`matter-js`)**: Manages the 2D physics, collisions, and raycasting.
* **The Bridge**: The React application intercepts CPU memory addresses. For example, it translates motor PWM signals into physical velocity forces in `matter-js`, and translates physical raycasts (Sonar/IR) or map pixel-color readings back into virtual voltages for the ADC.
* **The Compiler**: Uses the Wokwi Cloud Compiler API to translate user-written Arduino C/C++ code into `.hex` binaries on the fly.

## ✨ Key Features
* 🏗️ **Customizable Robot Build:** Equip a custom chassis with DC Motors, Sonar, IR Sensors, Analog IMU (Compass), Active Buzzers, Grabbers, and 16x2 LCDs.
* 📦 **Dynamic Arena Lab:** Place static walls, pickable props, and import custom floor maps (for IR line-tracking).
* 🕰️ **Legacy "Krumon v.130715" Mode:** A native compatibility layer that invisibly injects a C-library into the compiler, allowing legacy curriculum code to run flawlessly in the modern environment.
* 📊 **Live Telemetry & Serial Monitor:** Real-time feedback of virtual CPU pins (PORTB), spatial coordinates, and standard Serial output.
* 💾 **Offline Execution:** Flash pre-compiled `.hex` files directly into the virtual CPU without needing an internet connection.

---

## ⚠️ Known Issues & Unsolved Limitations

As an evolving emulation environment, there are a few acknowledged bugs and intentional architectural limitations:

### The "Time Travel" Problem
Attempting to add a "Fast Forward" or "Time Travel" feature to speed up the simulation has been abandoned. 
* **The Cause:** The simulator relies on a strict "time lock" between the CPU and the Physics engine (exactly 150,000 CPU cycles per 16.666ms physics step). 
* Speeding up the CPU causes the robot to outpace the physics engine (sensors go "blind" before the world updates). 
* Speeding up the physics engine causes "tunnelling" (the robot teleports through walls before collision detection catches it). 
* Running both faster on the browser's single JavaScript thread causes the browser to throttle the tab, destroying the deterministic stability this project was built to achieve. 

### The `executeFrame` Bug
There is a known bug residing within the core `executeFrame` loop synchronization. It is currently acknowledged but left as-is, as resolving it requires a substantial refactor of how `requestAnimationFrame` hands off cycles to the `avr8js` CPU.

### Virtual OLED Display
The virtual `128x64 OLED` display component is currently broken/unsupported. While the UI element exists, the I2C graphic translation from the virtual AVR to the DOM is not functioning. Stick to the `16x2 LCD` for visual string debugging.