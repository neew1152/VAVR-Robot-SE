import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square, RotateCcw, Monitor, Settings, Terminal, Crosshair, GripVertical, GripHorizontal, Download, Upload, RefreshCcw, FileUp, ImagePlus, Trash2 } from 'lucide-react';
import Matter from 'matter-js';
import { 
  CPU, avrInstruction, 
  AVRTimer, timer0Config, timer1Config, timer2Config, 
  AVRUSART, usart0Config 
} from 'avr8js'; 

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

const DEFAULT_CONFIG = {
  leftWidth: 45,
  editorHeight: 60,
  canvasHeight: 65,
  robotX: 200,
  robotY: 200,
  robotAngle: 0 
};

const getConfig = () => {
  try {
    const saved = localStorage.getItem('flawless-config');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) { console.error("Config load error", e); }
  return DEFAULT_CONFIG;
};

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
  const initConfig = getConfig();
  
  const[code, setCode] = useState(defaultCode);
  const[sysLogs, setSysLogs] = useState(['> System Ready. Loaded Saved Configuration.']);
  const[serialOutput, setSerialOutput] = useState("");
  
  const[isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false); 

  const setSimState = (state) => {
    setIsRunning(state);
    isRunningRef.current = state;
  };
  
  const[mapImage, setMapImage] = useState(null);
  const[leftWidth, setLeftWidth] = useState(initConfig.leftWidth);      
  const[editorHeight, setEditorHeight] = useState(initConfig.editorHeight); 
  const[canvasHeight, setCanvasHeight] = useState(initConfig.canvasHeight); 
  const[isDragging, setIsDragging] = useState(false);  
  
  const requestRef = useRef(null);
  const sysLogEndRef = useRef(null);
  const serialEndRef = useRef(null);
  
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const robotRef = useRef(null);
  const mouseConstraintRef = useRef(null); 

  useEffect(() => {
    const current = getConfig();
    const nextConfig = { ...current, leftWidth, editorHeight, canvasHeight };
    localStorage.setItem('flawless-config', JSON.stringify(nextConfig));
  },[leftWidth, editorHeight, canvasHeight]);

  useEffect(() => {
    sysLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  },[sysLogs]);

  useEffect(() => {
    serialEndRef.current?.scrollIntoView({ behavior: "smooth" });
  },[serialOutput]);

  const handleDragMain = (e) => {
    e.preventDefault();
    setIsDragging(true);
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

  const handleMapUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setMapImage(event.target.result);
      setSysLogs(prev =>[...prev, `> MAP LOADED: ${file.name} (Native Pixels, Centered)`]);
    };
    reader.readAsDataURL(file);
    e.target.value = null; 
  };

  const clearMap = () => {
    setMapImage(null);
    setSysLogs(prev =>[...prev, `> MAP CLEARED.`]);
  };

  const exportConfig = () => {
    const configData = localStorage.getItem('flawless-config') || JSON.stringify(DEFAULT_CONFIG);
    const blob = new Blob([configData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "flawless_layout.json";
    a.click();
    URL.revokeObjectURL(url);
    setSysLogs(prev =>[...prev, '> FILE EXPORTED: flawless_layout.json saved to computer.']);
  };

  const importConfig = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.leftWidth) setLeftWidth(parsed.leftWidth);
        if (parsed.editorHeight) setEditorHeight(parsed.editorHeight);
        if (parsed.canvasHeight) setCanvasHeight(parsed.canvasHeight);
        
        if (robotRef.current && parsed.robotX !== undefined) {
          Matter.Body.setPosition(robotRef.current, { x: parsed.robotX, y: parsed.robotY });
          Matter.Body.setAngle(robotRef.current, parsed.robotAngle);
          Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(robotRef.current, 0);
        }
        
        localStorage.setItem('flawless-config', JSON.stringify(parsed));
        setSysLogs(prev =>[...prev, '> FILE IMPORTED: Layout and Position updated successfully!']);
        e.target.value = null;
      } catch (err) {
        setSysLogs(prev =>[...prev, '> ERROR: Invalid Configuration File!']);
      }
    };
    reader.readAsText(file);
  };

  const restoreDefaults = () => {
    localStorage.removeItem('flawless-config');
    setLeftWidth(DEFAULT_CONFIG.leftWidth);
    setEditorHeight(DEFAULT_CONFIG.editorHeight);
    setCanvasHeight(DEFAULT_CONFIG.canvasHeight);
    
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: DEFAULT_CONFIG.robotX, y: DEFAULT_CONFIG.robotY });
      Matter.Body.setAngle(robotRef.current, DEFAULT_CONFIG.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(robotRef.current, 0);
    }
    setSysLogs(prev =>[...prev, '> CACHE CLEARED: Reverted to Factory Defaults.']);
  };

  // --- INITIALIZE PHYSICS ENGINE ---
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
        background: 'transparent'
      }
    });

    const initConf = getConfig();
    const robot = Matter.Bodies.rectangle(initConf.robotX, initConf.robotY, 50, 30, { 
      render: { fillStyle: '#3b82f6' },
      frictionAir: 0.1,
      inertia: Infinity,
      angle: initConf.robotAngle
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

      const current = getConfig();
      localStorage.setItem('flawless-config', JSON.stringify({
        ...current, robotX: r.position.x, robotY: r.position.y, robotAngle: r.angle
      }));
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

    const deg = (((initConf.robotAngle * (180 / Math.PI)) % 360) + 360) % 360;
    const inX = document.getElementById('input-x');
    const inY = document.getElementById('input-y');
    const inAngle = document.getElementById('input-angle');
    if (inX) inX.value = Math.round(initConf.robotX);
    if (inY) inY.value = Math.round(initConf.robotY);
    if (inAngle) inAngle.value = deg.toFixed(2);

    Matter.Render.run(render);

    let idleFrameId;
    const idleLoop = () => {
      if (!isRunningRef.current && engineRef.current) {
        Matter.Engine.update(engineRef.current, 16.666);
      }
      idleFrameId = requestAnimationFrame(idleLoop);
    };
    idleLoop();

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
      cancelAnimationFrame(idleFrameId);
      Matter.Render.stop(render);
      if (render.canvas) render.canvas.remove();
      Matter.Engine.clear(engine);
    };
  },[]);

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
    Matter.Body.setAngularVelocity(robotRef.current, 0); 
    
    const current = getConfig();
    localStorage.setItem('flawless-config', JSON.stringify({ ...current, robotX: x, robotY: y, robotAngle: angleRad }));
    setSysLogs(prev =>[...prev, `> Teleported Robot to[X:${Math.round(x)}, Y:${Math.round(y)}, Angle:${angleDeg}°]`]);
  };

  const stopSimulation = () => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    setSimState(false);
    
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
    
    const conf = getConfig();
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: conf.robotX, y: conf.robotY });
      Matter.Body.setAngle(robotRef.current, conf.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(robotRef.current, 0);
    }
    
    const hudPortb = document.getElementById('hud-portb');
    if (hudPortb) hudPortb.innerText = '00000000';

    const deg = (((conf.robotAngle * (180 / Math.PI)) % 360) + 360) % 360;
    const inX = document.getElementById('input-x');
    const inY = document.getElementById('input-y');
    const inAngle = document.getElementById('input-angle');
    if(inX) inX.value = Math.round(conf.robotX);
    if(inY) inY.value = Math.round(conf.robotY);
    if(inAngle) inAngle.value = deg.toFixed(2);
    
    setSysLogs(['> Hardware Reset. Robot returned to Saved Starting Position.']);
  };

  const bootVirtualCpu = (hexData, isOffline = false) => {
    try {
      // GHOST KILLER: Violently murder any pending loops before starting a new one
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }

      setSysLogs(prev =>[...prev, '> Flashing to Virtual Flash Memory...']);
      
      const program = new Uint16Array(16384);
      loadHex(hexData, new Uint8Array(program.buffer));
      
      const cpu = new CPU(program);
      const timer0 = new AVRTimer(cpu, timer0Config);
      const timer1 = new AVRTimer(cpu, timer1Config);
      const timer2 = new AVRTimer(cpu, timer2Config);
      const usart = new AVRUSART(cpu, usart0Config, 16e6);
      
      usart.onByteTransmit = (byte) => {
        const char = String.fromCharCode(byte);
        setSerialOutput(prev => prev + char);
      };
      
      setSimState(true);
      if (isOffline) {
        setSysLogs(prev =>[...prev, '> OFFLINE MODE: Running local .hex file (Code Editor ignored)']);
      }
      setSysLogs(prev =>[...prev, '> Virtual Arduino & Physics Engine RUNNING...']);
      
      const pin9El = document.getElementById('pin9-status');
      const pin10El = document.getElementById('pin10-status');
      const hudPortb = document.getElementById('hud-portb');

      const executeFrame = () => {
         if (!isRunningRef.current) return;

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

            Matter.Engine.update(engineRef.current, 16.666);

            requestRef.current = requestAnimationFrame(executeFrame);
         } catch (e) {
            setSysLogs(prev =>[...prev, '> FATAL ERROR: ' + e.message]);
            setSimState(false);
         }
      };
      
      requestRef.current = requestAnimationFrame(executeFrame);
    } catch (err) {
      setSysLogs(prev =>[...prev, '> CPU BOOT ERROR: ' + err.message]);
      setSimState(false);
    }
  };

  const runSimulationCloud = async () => {
    if (isRunningRef.current) return;
    
    // INSTANT LOCK: Prevents double-clicking the button while it fetches!
    setSimState(true); 
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
        setSimState(false); // UNLOCK on fail
        return;
      }
      bootVirtualCpu(data.hex, false);
    } catch (err) {
      setSysLogs(prev =>[...prev, '> CLOUD ERROR: ' + err.message]);
      setSimState(false); // UNLOCK on fail
    }
  };

  const runSimulationOffline = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    stopSimulation(); // Instantly kill current run
    setSerialOutput("");
    setSysLogs(['> Loading local .hex file...']);

    const reader = new FileReader();
    reader.onload = (event) => {
      bootVirtualCpu(event.target.result, true);
      e.target.value = null; 
    };
    reader.readAsText(file);
  };

  return (
    <div className={`flex h-screen w-screen p-2 gap-2 bg-neutral-900 font-sans text-gray-300 overflow-hidden ${isDragging ? 'select-none pointer-events-none' : ''}`}>
      
      <div style={{ width: `${leftWidth}%` }} className="flex flex-col gap-2 h-full pointer-events-auto relative">
        <div style={{ height: `${editorHeight}%` }} className="flex flex-col bg-neutral-800 rounded-lg overflow-hidden border border-neutral-700">
          <div className="bg-neutral-950 p-2 text-sm font-bold text-gray-300 flex justify-between items-center">
            <span>💻 Arduino C/C++ Editor</span>
            <label className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors border ${isRunning ? 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed' : 'bg-blue-900/40 hover:bg-blue-800/80 text-blue-300 border-blue-900 cursor-pointer'}`} title="Run Local .hex File (Offline Mode)">
               <FileUp size={12}/> Run Local .HEX
               <input type="file" accept=".hex" className="hidden" disabled={isRunning} onChange={runSimulationOffline} />
            </label>
          </div>
          <div className="flex-grow">
            <Editor height="100%" defaultLanguage="cpp" theme="vs-dark" value={code} onChange={(value) => setCode(value)} options={{ minimap: { enabled: false }, fontSize: 14 }} />
          </div>
        </div>

        <div onMouseDown={handleDragEditor} className="h-2 flex items-center justify-center cursor-row-resize group relative z-50">
          <div className="h-1 w-8 bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
            <GripHorizontal size={10} className="text-neutral-900 group-hover:text-white pointer-events-none" />
          </div>
        </div>

        <div className="flex-1 flex gap-2 overflow-hidden">
          <div className="flex-1 bg-neutral-950 rounded-lg border border-neutral-700 flex flex-col overflow-hidden">
             <div className="bg-neutral-900 p-2 text-xs font-bold text-gray-400 flex items-center gap-2 border-b border-neutral-700">
              <Settings size={14}/> SYSTEM CONSOLE
            </div>
            <div className="flex-grow p-2 font-mono text-xs text-gray-500 overflow-y-auto flex flex-col">
              {sysLogs.map((log, i) => <div key={i}>{log}</div>)}
              <div ref={sysLogEndRef} />
            </div>
          </div>
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

      <div onMouseDown={handleDragMain} className="w-2 flex items-center justify-center cursor-col-resize group pointer-events-auto relative z-50">
        <div className="w-1 h-8 bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
          <GripVertical size={10} className="text-neutral-900 group-hover:text-white pointer-events-none" />
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-2 h-full overflow-hidden pointer-events-auto relative">
        <div style={{ height: `${canvasHeight}%` }} className="flex flex-col bg-white rounded-lg border border-neutral-700 relative overflow-hidden">
          <div className="bg-neutral-200 p-2 text-sm font-bold text-black flex justify-between items-center z-10 shadow">
            <span>🏁 Simulation Field</span>
            <div className="flex gap-2">
               {mapImage && (
                 <button onClick={clearMap} className="flex items-center gap-1 text-xs bg-red-200 hover:bg-red-300 text-red-800 px-2 py-1 rounded transition-colors">
                   <Trash2 size={12}/> Clear Map
                 </button>
               )}
               <label className="flex items-center gap-1 text-xs bg-gray-300 hover:bg-gray-400 text-black px-2 py-1 rounded transition-colors cursor-pointer">
                 <ImagePlus size={12}/> Upload Map
                 <input type="file" accept="image/*" className="hidden" onChange={handleMapUpload} />
               </label>
            </div>
          </div>
          
          <div 
            className="flex-grow relative bg-[#e5e5e5]"
            style={{
               backgroundImage: mapImage ? `url(${mapImage})` : 'none',
               backgroundSize: 'auto',
               backgroundPosition: 'center',
               backgroundRepeat: 'no-repeat'
            }}
          >
             <div ref={sceneRef} className="absolute inset-0"></div>
          </div>
        </div>

        <div onMouseDown={handleDragCanvas} className="h-2 flex items-center justify-center cursor-row-resize group relative z-50">
          <div className="h-1 w-8 bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
            <GripHorizontal size={10} className="text-neutral-900 group-hover:text-white pointer-events-none" />
          </div>
        </div>

        <div className="flex-1 flex gap-2 overflow-hidden">
          <div className="flex-grow bg-neutral-800 rounded-lg border border-neutral-700 p-3 flex flex-col overflow-hidden">
            
            <div className="text-sm font-bold text-gray-300 mb-2 flex justify-between items-center border-b border-neutral-700 pb-2">
               <div className="flex items-center gap-2"><Settings size={16}/> Robot Workshop</div>
               <div className="flex gap-2">
                 <button onClick={restoreDefaults} className="flex items-center gap-1 text-[10px] bg-red-900/50 hover:bg-red-800/80 text-red-300 px-2 py-1 rounded transition-colors" title="Restore Default Settings">
                   <RefreshCcw size={10}/> Restore Default
                 </button>
                 <button onClick={exportConfig} className="flex items-center gap-1 text-[10px] bg-neutral-700 hover:bg-neutral-600 px-2 py-1 rounded transition-colors" title="Download Config File">
                   <Download size={10}/> Export Config
                 </button>
                 <label className="flex items-center gap-1 text-[10px] bg-neutral-700 hover:bg-neutral-600 px-2 py-1 rounded transition-colors cursor-pointer" title="Upload Config File">
                   <Upload size={10}/> Import Config
                   <input type="file" accept=".json" className="hidden" onChange={importConfig} />
                 </label>
               </div>
            </div>
            
            <div className="flex gap-4 h-full">
               <div className="flex-1 text-xs font-mono text-gray-400 font-bold bg-neutral-900 p-2 rounded overflow-hidden">
                 <p className="text-gray-500 mb-1">// PINS</p>
                 <ul className="list-none ml-1">
                   <li id="pin9-status" className="transition-colors duration-75">○ Motor L (Pin 9)</li>
                   <li id="pin10-status" className="transition-colors duration-75">○ Motor R (Pin 10)</li>
                   <li className="text-gray-600">○ Sonar (Pin 3)</li>
                 </ul>
               </div>

               <div className="flex-[2] bg-neutral-900 p-2 rounded flex flex-col gap-1">
                 <div className="text-[10px] font-mono font-bold text-gray-500 flex items-center gap-1 border-b border-neutral-800 pb-1">
                    <Crosshair size={12}/> ROBOT POSITION
                 </div>
                 
                 <div className="flex gap-4 h-full">
                   <div className="flex-1 flex flex-col justify-center text-xs text-green-400 font-mono border-r border-neutral-700 pr-4">
                     <div className="text-[10px] text-green-500 font-bold mb-1 tracking-widest">SYS_TELEMETRY</div>
                     <div className="flex justify-between"><span>PORTB:</span> <span id="hud-portb">00000000</span></div>
                     <div className="flex justify-between"><span>CUR_X:</span> <span id="hud-x">200</span></div>
                     <div className="flex justify-between"><span>CUR_Y:</span> <span id="hud-y">200</span></div>
                     <div className="flex justify-between"><span>ANGLE:</span> <span><span id="hud-angle">0.00</span>°</span></div>
                   </div>

                   <div className="flex-[1.5] flex flex-col justify-center">
                     <div className="text-[10px] text-gray-500 font-bold mb-1 tracking-widest">MANUAL POSE</div>
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
            </div>
          </div>

          <div className="w-1/3 bg-neutral-800 rounded-lg border border-neutral-700 p-2 flex flex-col justify-center gap-2">
            <button onClick={runSimulationCloud} disabled={isRunning} className={`flex items-center justify-center gap-2 py-2 px-2 rounded font-bold text-sm transition-colors ${isRunning ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
              <Play size={16} fill="currentColor" /> RUN (Cloud)
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