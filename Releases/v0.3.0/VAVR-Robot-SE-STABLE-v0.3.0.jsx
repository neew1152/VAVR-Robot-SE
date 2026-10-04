import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square, RotateCcw, Monitor, Settings, Terminal, Crosshair, GripVertical, GripHorizontal } from 'lucide-react';
import Matter from 'matter-js';
import { 
  CPU, avrInstruction, 
  AVRTimer, timer0Config, timer1Config, timer2Config, 
  AVRUSART, usart0Config 
} from 'avr8js'; 

// --- INTEL HEX PARSER ---
function loadHex(source, target) {
  for (const line of source.split('\n')) {
    if (line[0] === ':' && line.substring(7, 9) === '00') {
      const bytes = parseInt(line.substring(1, 3), 16);
      const addr = parseInt(line.substring(3, 7), 16);
      for (let i = 0; i < bytes; i++) {
        target[addr + i] = parseInt(line.substring(9 + i * 2, 11 + i * 2), 16);
      }
    }
  }
}

// --- DEFAULT ROBOT CODE ---
const defaultCode = `// HARDWARE PINS
const int MOTOR_LEFT = 9;  // Port B, Bit 1
const int MOTOR_RIGHT = 10; // Port B, Bit 2

void setup() {
  Serial.begin(9600);
  pinMode(MOTOR_LEFT, OUTPUT);
  pinMode(MOTOR_RIGHT, OUTPUT);
  Serial.println("Robot Booted. Ready to drive.");
}

void loop() {
  Serial.println("Driving Forward...");
  digitalWrite(MOTOR_LEFT, HIGH);
  digitalWrite(MOTOR_RIGHT, HIGH);
  delay(1000);

  Serial.println("Stopping...");
  digitalWrite(MOTOR_LEFT, LOW);
  digitalWrite(MOTOR_RIGHT, LOW);
  delay(500);

  Serial.println("Turning Right...");
  digitalWrite(MOTOR_LEFT, HIGH);
  digitalWrite(MOTOR_RIGHT, LOW);
  delay(1000);
}`;

function App() {
  const[code, setCode] = useState(defaultCode);
  const[sysLogs, setSysLogs] = useState(['> System Ready. Waiting for compilation...']);
  const[serialOutput, setSerialOutput] = useState("");
  const[isRunning, setIsRunning] = useState(false);
  
  // --- NATIVE RESIZER STATE ---
  const [leftWidth, setLeftWidth] = useState(45);      
  const [editorHeight, setEditorHeight] = useState(60); 
  const[canvasHeight, setCanvasHeight] = useState(65); 
  const[isDragging, setIsDragging] = useState(false);  
  
  const requestRef = useRef(null);
  const sysLogEndRef = useRef(null);
  const serialEndRef = useRef(null);
  
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const robotRef = useRef(null);
  const runnerRef = useRef(null); 
  const mouseConstraintRef = useRef(null); 

  useEffect(() => {
    sysLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  },[sysLogs]);

  useEffect(() => {
    serialEndRef.current?.scrollIntoView({ behavior: "smooth" });
  },[serialOutput]);

  // --- BULLETPROOF NATIVE DRAG HANDLERS ---
  const handleDragMain = (e) => {
    e.preventDefault();
    setIsDragging(true);
    // currentTarget ALWAYS locks onto the handle, never the child icon
    const container = e.currentTarget.parentElement; 
    const { left, width } = container.getBoundingClientRect();
    const onMouseMove = (ev) => {
      setLeftWidth(Math.max(20, Math.min(80, ((ev.clientX - left) / width) * 100)));
    };
    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleDragEditor = (e) => {
    e.preventDefault();
    setIsDragging(true);
    const container = e.currentTarget.parentElement;
    const { top, height } = container.getBoundingClientRect();
    const onMouseMove = (ev) => {
      setEditorHeight(Math.max(20, Math.min(80, ((ev.clientY - top) / height) * 100)));
    };
    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleDragCanvas = (e) => {
    e.preventDefault();
    setIsDragging(true);
    const container = e.currentTarget.parentElement;
    const { top, height } = container.getBoundingClientRect();
    const onMouseMove = (ev) => {
      setCanvasHeight(Math.max(20, Math.min(80, ((ev.clientY - top) / height) * 100)));
    };
    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  // --- INITIALIZE PHYSICS ENGINE & INTERACTIVITY ---
  useEffect(() => {
    if (!sceneRef.current) return;

    const oldCanvases = sceneRef.current.querySelectorAll('canvas');
    oldCanvases.forEach(c => c.remove());

    const engine = Matter.Engine.create();
    engine.world.gravity.y = 0; 
    engineRef.current = engine;

    const render = Matter.Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width: sceneRef.current.clientWidth,
        height: sceneRef.current.clientHeight,
        wireframes: false,
        background: '#e5e5e5'
      }
    });

    const robot = Matter.Bodies.rectangle(200, 200, 50, 30, { 
      render: { fillStyle: '#3b82f6' },
      frictionAir: 0.1,
      inertia: Infinity 
    });
    robotRef.current = robot;

    let walls =[
      Matter.Bodies.rectangle(render.options.width / 2, 0, render.options.width, 20, { isStatic: true }),
      Matter.Bodies.rectangle(render.options.width / 2, render.options.height, render.options.width, 20, { isStatic: true }),
      Matter.Bodies.rectangle(0, render.options.height / 2, 20, render.options.height, { isStatic: true }),
      Matter.Bodies.rectangle(render.options.width, render.options.height / 2, 20, render.options.height, { isStatic: true })
    ];

    const mouse = Matter.Mouse.create(render.canvas);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, render: { visible: false } }
    });
    mouseConstraintRef.current = mouseConstraint;
    render.mouse = mouse;

    Matter.World.add(engine.world,[robot, mouseConstraint, ...walls]);
    
    Matter.Events.on(mouseConstraint, 'enddrag', () => {
      if (!robotRef.current) return;
      const r = robotRef.current;
      const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360; 
      
      const inX = document.getElementById('input-x');
      const inY = document.getElementById('input-y');
      const inAngle = document.getElementById('input-angle');
      if (inX) inX.value = Math.round(r.position.x);
      if (inY) inY.value = Math.round(r.position.y);
      if (inAngle) inAngle.value = normalizedDeg.toFixed(2);
    });

    Matter.Events.on(engine, 'afterUpdate', () => {
      if (!robotRef.current) return;
      const r = robotRef.current;
      const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360; 
      
      const hudX = document.getElementById('hud-x');
      const hudY = document.getElementById('hud-y');
      const hudAngle = document.getElementById('hud-angle');
      if (hudX) hudX.innerText = Math.round(r.position.x);
      if (hudY) hudY.innerText = Math.round(r.position.y);
      if (hudAngle) hudAngle.innerText = normalizedDeg.toFixed(2);
    });

    document.getElementById('input-x').value = 200;
    document.getElementById('input-y').value = 200;
    document.getElementById('input-angle').value = 0;

    Matter.Render.run(render);
    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine); 
    runnerRef.current = runner;

    // --- DYNAMIC ARENA RESIZER ---
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (render.canvas && width > 0 && height > 0) {
          render.canvas.width = width;
          render.canvas.height = height;
          render.options.width = width;
          render.options.height = height;

          Matter.World.remove(engine.world, walls);
          walls =[
            Matter.Bodies.rectangle(width / 2, 0, width, 20, { isStatic: true }),
            Matter.Bodies.rectangle(width / 2, height, width, 20, { isStatic: true }),
            Matter.Bodies.rectangle(0, height / 2, 20, height, { isStatic: true }),
            Matter.Bodies.rectangle(width, height / 2, 20, height, { isStatic: true })
          ];
          Matter.World.add(engine.world, walls);
        }
      }
    });

    resizeObserver.observe(sceneRef.current);

    return () => {
      resizeObserver.disconnect();
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      if (render.canvas) render.canvas.remove();
      Matter.Engine.clear(engine);
    };
  },[]);

  // --- MANUAL PLACEMENT LOGIC ---
  const applyManualPose = () => {
    if (!robotRef.current) return;
    const inX = document.getElementById('input-x').value;
    const inY = document.getElementById('input-y').value;
    const inAngle = document.getElementById('input-angle').value;

    const x = inX !== "" ? parseFloat(inX) : robotRef.current.position.x;
    const y = inY !== "" ? parseFloat(inY) : robotRef.current.position.y;
    const angleDeg = inAngle !== "" ? parseFloat(inAngle) : (robotRef.current.angle * 180 / Math.PI);
    const angleRad = angleDeg * (Math.PI / 180);

    Matter.Body.setPosition(robotRef.current, { x, y });
    Matter.Body.setAngle(robotRef.current, angleRad);
    Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    
    setSysLogs(prev =>[...prev, `> Teleported Robot to[X:${Math.round(x)}, Y:${Math.round(y)}, Angle:${angleDeg}°]`]);
  };

  const stopSimulation = () => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    setIsRunning(false);
    
    const p9 = document.getElementById('pin9-status');
    const p10 = document.getElementById('pin10-status');
    if(p9) p9.style.color = '#9ca3af';
    if(p10) p10.style.color = '#9ca3af';

    if (robotRef.current) {
       Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }
    setSysLogs(prev =>[...prev, '> Simulation STOPPED.']);
  };

  const resetSimulation = () => {
    stopSimulation();
    setSerialOutput("");
    
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: 200, y: 200 });
      Matter.Body.setAngle(robotRef.current, 0);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }
    
    const hudPortb = document.getElementById('hud-portb');
    if (hudPortb) hudPortb.innerText = '00000000';

    const inX = document.getElementById('input-x');
    const inY = document.getElementById('input-y');
    const inAngle = document.getElementById('input-angle');
    if(inX) inX.value = 200;
    if(inY) inY.value = 200;
    if(inAngle) inAngle.value = 0;
    
    setSysLogs(['> System Reset. Memory and Physics flushed.']);
  };

  const runSimulation = async () => {
    if (isRunning) return;
    setSysLogs(['> Compiling code via Cloud Compiler...']);
    setSerialOutput("");
    
    try {
      const response = await fetch('https://hexi.wokwi.com/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch: code, board: "uno" })
      });
      const data = await response.json();
      
      if (!data.hex) {
        setSysLogs(prev =>[...prev, '> COMPILATION FAILED:', data.stderr || data.compilerErrors]);
        return;
      }
      
      setSysLogs(prev =>[...prev, '> Compilation Success! Flashing to Virtual Flash Memory...']);
      
      const program = new Uint16Array(16384);
      loadHex(data.hex, new Uint8Array(program.buffer));
      
      const cpu = new CPU(program);
      const timer0 = new AVRTimer(cpu, timer0Config);
      const timer1 = new AVRTimer(cpu, timer1Config);
      const timer2 = new AVRTimer(cpu, timer2Config);
      const usart = new AVRUSART(cpu, usart0Config, 16e6);
      
      usart.onByteTransmit = (byte) => {
        const char = String.fromCharCode(byte);
        setSerialOutput(prev => prev + char);
      };
      
      setIsRunning(true);
      setSysLogs(prev =>[...prev, '> Virtual Arduino & Physics Engine RUNNING...']);
      
      const pin9El = document.getElementById('pin9-status');
      const pin10El = document.getElementById('pin10-status');
      const hudPortb = document.getElementById('hud-portb');

      const executeFrame = () => {
         try {
            for (let i = 0; i < 266666; i++) {
              avrInstruction(cpu); 
              cpu.tick(); 
            }

            const portBState = cpu.data[0x25]; 
            const pin9High = (portBState & 2) !== 0; 
            const pin10High = (portBState & 4) !== 0; 

            if (pin9El) pin9El.style.color = pin9High ? '#4ade80' : '#9ca3af';
            if (pin10El) pin10El.style.color = pin10High ? '#4ade80' : '#9ca3af';
            if (hudPortb) hudPortb.innerText = portBState.toString(2).padStart(8, '0');

            const robot = robotRef.current;
            const mouseBody = mouseConstraintRef.current?.body;
            const isDraggingRobot = (mouseBody === robot);

            if (!isDraggingRobot) {
              const SPEED = 4; 
              const TURN_SPEED = 0.08; 

              if (pin9High && pin10High) {
                Matter.Body.setVelocity(robot, {
                  x: Math.cos(robot.angle) * SPEED,
                  y: Math.sin(robot.angle) * SPEED
                });
              } 
              else if (pin9High && !pin10High) {
                Matter.Body.setVelocity(robot, { x: 0, y: 0 });
                Matter.Body.setAngle(robot, robot.angle + TURN_SPEED); 
              }
              else if (!pin9High && pin10High) {
                Matter.Body.setVelocity(robot, { x: 0, y: 0 });
                Matter.Body.setAngle(robot, robot.angle - TURN_SPEED); 
              }
              else {
                Matter.Body.setVelocity(robot, { x: 0, y: 0 });
              }
            }

            requestRef.current = requestAnimationFrame(executeFrame);
         } catch (e) {
            setSysLogs(prev =>[...prev, '> FATAL ERROR: ' + e.message]);
            setIsRunning(false);
         }
      };
      
      requestRef.current = requestAnimationFrame(executeFrame);
      
    } catch (err) {
      setSysLogs(prev =>[...prev, '> SYSTEM ERROR: ' + err.message]);
      setIsRunning(false);
    }
  };

  return (
    <div className={`flex h-screen w-screen p-2 gap-2 bg-neutral-900 font-sans text-gray-300 overflow-hidden ${isDragging ? 'select-none pointer-events-none' : ''}`}>
      
      {/* --- LEFT SUPER-PANEL --- */}
      <div style={{ width: `${leftWidth}%` }} className="flex flex-col gap-2 h-full pointer-events-auto relative">
        
        {/* Editor Box */}
        <div style={{ height: `${editorHeight}%` }} className="flex flex-col bg-neutral-800 rounded-lg overflow-hidden border border-neutral-700">
          <div className="bg-neutral-950 p-2 text-sm font-bold text-gray-300 flex justify-between items-center">
            <span>💻 Arduino C/C++ Editor</span>
          </div>
          <div className="flex-grow">
            <Editor height="100%" defaultLanguage="cpp" theme="vs-dark" value={code} onChange={(value) => setCode(value)} options={{ minimap: { enabled: false }, fontSize: 14 }} />
          </div>
        </div>

        {/* EDITOR HORIZONTAL DRAG HANDLE */}
        <div onMouseDown={handleDragEditor} className="h-2 flex items-center justify-center cursor-row-resize group relative z-50">
          <div className="h-1 w-8 bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
            <GripHorizontal size={10} className="text-neutral-900 group-hover:text-white pointer-events-none" />
          </div>
        </div>

        {/* Logs Box (Split horizontally) */}
        <div className="flex-1 flex gap-2 overflow-hidden">
          {/* System Console */}
          <div className="flex-1 bg-neutral-950 rounded-lg border border-neutral-700 flex flex-col overflow-hidden">
             <div className="bg-neutral-900 p-2 text-xs font-bold text-gray-400 flex items-center gap-2 border-b border-neutral-700">
              <Settings size={14}/> SYSTEM CONSOLE
            </div>
            <div className="flex-grow p-2 font-mono text-xs text-gray-500 overflow-y-auto flex flex-col">
              {sysLogs.map((log, i) => <div key={i}>{log}</div>)}
              <div ref={sysLogEndRef} />
            </div>
          </div>

          {/* Serial Monitor */}
          <div className="flex-1 bg-neutral-950 rounded-lg border border-neutral-700 flex flex-col overflow-hidden">
             <div className="bg-neutral-900 p-2 text-xs font-bold text-gray-400 flex items-center gap-2 border-b border-neutral-700">
              <Terminal size={14}/> SERIAL MONITOR
            </div>
            <div className="flex-grow p-2 font-mono text-sm text-green-400 overflow-y-auto whitespace-pre-wrap">
              {serialOutput}
              <div ref={serialEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* --- CENTER VERTICAL DRAG HANDLE --- */}
      <div onMouseDown={handleDragMain} className="w-2 flex items-center justify-center cursor-col-resize group pointer-events-auto relative z-50">
        <div className="w-1 h-8 bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
          <GripVertical size={10} className="text-neutral-900 group-hover:text-white pointer-events-none" />
        </div>
      </div>

      {/* --- RIGHT SUPER-PANEL --- */}
      <div className="flex-1 flex flex-col gap-2 h-full overflow-hidden pointer-events-auto relative">
        
        {/* Simulation Canvas */}
        <div style={{ height: `${canvasHeight}%` }} className="flex flex-col bg-white rounded-lg border border-neutral-700 relative overflow-hidden">
          <div className="bg-neutral-200 p-2 text-sm font-bold text-black flex justify-between items-center z-10 shadow">
            <span>🏁 Simulation Field</span>
            <button className="text-xs bg-gray-300 hover:bg-gray-400 text-black px-2 py-1 rounded transition-colors">Upload Map</button>
          </div>
          
          <div className="flex-grow relative">
             <div ref={sceneRef} className="absolute inset-0"></div>
             
             {/* SYS TELEMETRY HUD */}
             <div className="absolute top-2 right-2 bg-black/90 text-green-400 font-mono text-xs p-3 rounded border border-green-900 shadow-[0_0_15px_rgba(74,222,128,0.2)] pointer-events-none z-50 flex flex-col gap-1 min-w-[160px]">
               <div className="text-green-500 font-bold border-b border-green-900 pb-1 mb-1 text-[10px] tracking-widest">SYS_TELEMETRY</div>
               <div className="flex justify-between"><span>PORTB:</span> <span id="hud-portb">00000000</span></div>
               <div className="flex justify-between"><span>POS_X:</span> <span id="hud-x">200</span></div>
               <div className="flex justify-between"><span>POS_Y:</span> <span id="hud-y">200</span></div>
               <div className="flex justify-between"><span>ANGLE:</span> <span><span id="hud-angle">0.00</span>°</span></div>
             </div>
          </div>
        </div>

        {/* CANVAS HORIZONTAL DRAG HANDLE */}
        <div onMouseDown={handleDragCanvas} className="h-2 flex items-center justify-center cursor-row-resize group relative z-50">
          <div className="h-1 w-8 bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
            <GripHorizontal size={10} className="text-neutral-900 group-hover:text-white pointer-events-none" />
          </div>
        </div>

        {/* Hardware & Controls */}
        <div className="flex-1 flex gap-2 overflow-hidden">
          <div className="flex-grow bg-neutral-800 rounded-lg border border-neutral-700 p-3 flex flex-col overflow-hidden">
            <div className="text-sm font-bold text-gray-300 mb-2 flex items-center gap-2"><Settings size={16}/> Robot Workshop</div>
            
            <div className="flex gap-4 h-full">
               <div className="flex-1 text-xs font-mono text-gray-400 font-bold bg-neutral-900 p-2 rounded overflow-hidden">
                 <p className="text-gray-500 mb-1">// PINS</p>
                 <ul className="list-none ml-1">
                   <li id="pin9-status" className="transition-colors duration-75">○ Motor L (Pin 9)</li>
                   <li id="pin10-status" className="transition-colors duration-75">○ Motor R (Pin 10)</li>
                   <li className="text-gray-600">○ Sonar (Pin 3)</li>
                 </ul>
               </div>

               <div className="flex-1 bg-neutral-900 p-2 rounded flex flex-col justify-between">
                 <div className="text-[10px] font-mono font-bold text-gray-500 flex items-center gap-1 mb-1">
                    <Crosshair size={12}/> MANUAL POSE
                 </div>
                 
                 <div className="grid grid-cols-2 gap-1 text-xs text-gray-400 font-mono">
                    <div className="flex items-center gap-1">
                       <span>X:</span>
                       <input id="input-x" type="number" className="w-full bg-neutral-950 border border-neutral-700 rounded px-1 text-green-400 focus:outline-none focus:border-green-500" />
                    </div>
                    <div className="flex items-center gap-1">
                       <span>Y:</span>
                       <input id="input-y" type="number" className="w-full bg-neutral-950 border border-neutral-700 rounded px-1 text-green-400 focus:outline-none focus:border-green-500" />
                    </div>
                    <div className="flex items-center gap-1 col-span-2">
                       <span>Ang:</span>
                       <input id="input-angle" type="number" className="w-full bg-neutral-950 border border-neutral-700 rounded px-1 text-green-400 focus:outline-none focus:border-green-500" />
                    </div>
                 </div>

                 <button onClick={applyManualPose} className="mt-1 w-full bg-neutral-700 hover:bg-neutral-600 text-white text-[10px] font-bold py-1 rounded transition-colors">
                    APPLY TELEPORT
                 </button>
               </div>
            </div>
          </div>

          <div className="w-1/3 bg-neutral-800 rounded-lg border border-neutral-700 p-2 flex flex-col justify-center gap-2">
            <button onClick={runSimulation} disabled={isRunning} className={`flex items-center justify-center gap-2 py-2 px-2 rounded font-bold text-sm transition-colors ${isRunning ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
              <Play size={16} fill="currentColor" /> RUN
            </button>
            <button onClick={stopSimulation} className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-2 rounded font-bold text-sm transition-colors">
              <Square size={16} fill="currentColor" /> STOP
            </button>
            <button onClick={resetSimulation} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white py-2 px-2 rounded font-bold text-sm transition-colors">
              <RotateCcw size={16} /> RESET
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;