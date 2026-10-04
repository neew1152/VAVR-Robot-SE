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

const getPinState = (cpu, pin) => {
  let portAddr, bit;
  if (pin >= 0 && pin <= 7) {
    portAddr = 0x2B; 
    bit = pin;
  } else if (pin >= 8 && pin <= 13) {
    portAddr = 0x25; 
    bit = pin - 8;
  } else if (pin >= 14 && pin <= 19) {
    portAddr = 0x28; 
    bit = pin - 14;
  } else {
    return false;
  }
  return (cpu.data[portAddr] & (1 << bit)) !== 0;
};

const DEFAULT_CONFIG = {
  leftWidth: 45,
  editorHeight: 60,
  canvasHeight: 65,
  robotX: 200,
  robotY: 200,
  robotAngle: 0,
  baudRate: "9600",
  pinMotorL: 9,
  pinMotorR: 10,
  pinSonarTrig: 3,
  pinSonarEcho: 2
};

const getConfig = () => {
  try {
    const saved = localStorage.getItem('flawless-config');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) { console.error("Config load error", e); }
  return DEFAULT_CONFIG;
};

const defaultCode = `// HARDWARE PINS
int MOTOR_LEFT = 9;  
int MOTOR_RIGHT = 10; 

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
  const[baudRate, setBaudRate] = useState(initConfig.baudRate || "9600");
  
  const [editorTheme, setEditorTheme] = useState('vs-dark');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setEditorTheme(mediaQuery.matches ? 'vs-dark' : 'light');
    const handleChange = (e) => setEditorTheme(e.matches ? 'vs-dark' : 'light');
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  const[pinMotorL, setPinMotorL] = useState(initConfig.pinMotorL || 9);
  const[pinMotorR, setPinMotorR] = useState(initConfig.pinMotorR || 10);
  const[pinSonarTrig, setPinSonarTrig] = useState(initConfig.pinSonarTrig || 3);
  const[pinSonarEcho, setPinSonarEcho] = useState(initConfig.pinSonarEcho || 2);
  
  const[isRunning, setIsRunning] = useState(false);
  
  const isRunningRef = useRef(false); 
  const baudRateRef = useRef(baudRate); 
  const pinsRef = useRef({ L: pinMotorL, R: pinMotorR, Trig: pinSonarTrig, Echo: pinSonarEcho });

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

  useEffect(() => { baudRateRef.current = baudRate; },[baudRate]);
  useEffect(() => { pinsRef.current = { L: pinMotorL, R: pinMotorR, Trig: pinSonarTrig, Echo: pinSonarEcho }; },[pinMotorL, pinMotorR, pinSonarTrig, pinSonarEcho]);

  useEffect(() => {
    const current = getConfig();
    const nextConfig = { ...current, leftWidth, editorHeight, canvasHeight, baudRate, pinMotorL, pinMotorR, pinSonarTrig, pinSonarEcho };
    localStorage.setItem('flawless-config', JSON.stringify(nextConfig));
  },[leftWidth, editorHeight, canvasHeight, baudRate, pinMotorL, pinMotorR, pinSonarTrig, pinSonarEcho]);

  useEffect(() => { sysLogEndRef.current?.scrollIntoView({ behavior: "smooth" }); },[sysLogs]);
  useEffect(() => { serialEndRef.current?.scrollIntoView({ behavior: "smooth" }); },[serialOutput]);

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
      setSysLogs(prev =>[...prev, `> MAP LOADED: ${file.name}`]);
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
        if (parsed.baudRate) setBaudRate(parsed.baudRate);
        if (parsed.pinMotorL) setPinMotorL(parsed.pinMotorL);
        if (parsed.pinMotorR) setPinMotorR(parsed.pinMotorR);
        if (parsed.pinSonarTrig) setPinSonarTrig(parsed.pinSonarTrig);
        if (parsed.pinSonarEcho) setPinSonarEcho(parsed.pinSonarEcho);
        
        if (robotRef.current && parsed.robotX !== undefined) {
          Matter.Body.setPosition(robotRef.current, { x: parsed.robotX, y: parsed.robotY });
          Matter.Body.setAngle(robotRef.current, parsed.robotAngle);
          Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(robotRef.current, 0);
        }
        
        localStorage.setItem('flawless-config', JSON.stringify(parsed));
        setSysLogs(prev =>[...prev, '> FILE IMPORTED: Layout and Hardware updated successfully!']);
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
    setBaudRate(DEFAULT_CONFIG.baudRate);
    setPinMotorL(DEFAULT_CONFIG.pinMotorL);
    setPinMotorR(DEFAULT_CONFIG.pinMotorR);
    setPinSonarTrig(DEFAULT_CONFIG.pinSonarTrig);
    setPinSonarEcho(DEFAULT_CONFIG.pinSonarEcho);
    
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: DEFAULT_CONFIG.robotX, y: DEFAULT_CONFIG.robotY });
      Matter.Body.setAngle(robotRef.current, DEFAULT_CONFIG.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(robotRef.current, 0);
    }
    setSysLogs(prev =>[...prev, '> CACHE CLEARED: Reverted to Factory Defaults.']);
  };

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
    
    const pinL = document.getElementById('pinL-status');
    const pinR = document.getElementById('pinR-status');
    if(pinL) pinL.className = "transition-colors duration-75 text-gray-400 dark:text-gray-600";
    if(pinR) pinR.className = "transition-colors duration-75 text-gray-400 dark:text-gray-600";

    if (robotRef.current) {
       Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }
    setSysLogs(prev =>[...prev, '> Simulation STOPPED.']);
  };

  const resetSimulation = () => {
    stopSimulation();
    
    const serialEl = document.getElementById('serial-console');
    if (serialEl) serialEl.textContent = "";
    
    const conf = getConfig();
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: conf.robotX, y: conf.robotY });
      Matter.Body.setAngle(robotRef.current, conf.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(robotRef.current, 0);
    }
    
    const hudMotorL = document.getElementById('hud-motorL');
    const hudMotorR = document.getElementById('hud-motorR');
    if (hudMotorL) { hudMotorL.innerText = 'OFF'; hudMotorL.className = 'text-gray-500'; }
    if (hudMotorR) { hudMotorR.innerText = 'OFF'; hudMotorR.className = 'text-gray-500'; }

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
      
      let serialBuffer = "";
      usart.onByteTransmit = (byte) => {
        if (byte === 13) return; 
        
        const u2x0 = (cpu.data[0xC0] & 2) ? 8 : 16; 
        const ubrr = cpu.data[0xC4] | (cpu.data[0xC5] << 8); 
        const actualBaud = Math.round(16000000 / (u2x0 * (ubrr + 1))); 
        
        const uiBaud = parseInt(baudRateRef.current, 10);
        const mismatchRatio = Math.abs(actualBaud - uiBaud) / uiBaud;

        if (mismatchRatio > 0.05) {
           serialBuffer += "";
        } else {
           serialBuffer += String.fromCharCode(byte);
        }
      };
      
      setSimState(true);
      if (isOffline) {
        setSysLogs(prev =>[...prev, '> OFFLINE MODE: Running local .hex file (Code Editor ignored)']);
      }
      setSysLogs(prev =>[...prev, '> Virtual Arduino & Physics Engine RUNNING...']);
      
      const pinLEl = document.getElementById('pinL-status');
      const pinREl = document.getElementById('pinR-status');
      const hudMotorL = document.getElementById('hud-motorL');
      const hudMotorR = document.getElementById('hud-motorR');
      const serialEl = document.getElementById('serial-console');

      const executeFrame = () => {
         if (!isRunningRef.current) return;

         try {
            for (let i = 0; i < 150000; i++) {
              avrInstruction(cpu); 
              cpu.tick(); 
            }

            if (serialBuffer.length > 0 && serialEl) {
               serialEl.textContent += serialBuffer;
               serialEl.scrollTop = serialEl.scrollHeight; 
               serialBuffer = "";
            }

            const pinLHigh = getPinState(cpu, pinsRef.current.L);
            const pinRHigh = getPinState(cpu, pinsRef.current.R);

            // DYNAMIC THEME CLASS TOGGLING FOR PINS
            if (pinLEl) pinLEl.className = pinLHigh ? "transition-colors duration-75 text-green-600 dark:text-green-400 font-bold" : "transition-colors duration-75 text-gray-400 dark:text-gray-600";
            if (pinREl) pinREl.className = pinRHigh ? "transition-colors duration-75 text-green-600 dark:text-green-400 font-bold" : "transition-colors duration-75 text-gray-400 dark:text-gray-600";
            
            if (hudMotorL) {
               hudMotorL.innerText = pinLHigh ? 'ON ' : 'OFF';
               hudMotorL.className = pinLHigh ? 'text-green-600 dark:text-green-400 font-bold' : 'text-gray-500';
            }
            if (hudMotorR) {
               hudMotorR.innerText = pinRHigh ? 'ON ' : 'OFF';
               hudMotorR.className = pinRHigh ? 'text-green-600 dark:text-green-400 font-bold' : 'text-gray-500';
            }

            const robot = robotRef.current;
            const mouseBody = mouseConstraintRef.current?.body;
            const isDraggingRobot = (mouseBody === robot);

            if (!isDraggingRobot) {
              const SPEED = 4; 
              const TURN_SPEED = 0.08; 

              if (pinLHigh && pinRHigh) {
                Matter.Body.setVelocity(robot, {
                  x: Math.cos(robot.angle) * SPEED,
                  y: Math.sin(robot.angle) * SPEED
                });
              } 
              else if (pinLHigh && !pinRHigh) {
                Matter.Body.setVelocity(robot, { x: 0, y: 0 });
                Matter.Body.setAngle(robot, robot.angle + TURN_SPEED); 
              }
              else if (!pinLHigh && pinRHigh) {
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
    
    setSimState(true); 
    setSysLogs(['> Compiling code via Cloud Compiler...']);
    
    const serialEl = document.getElementById('serial-console');
    if (serialEl) serialEl.textContent = "";
    
    try {
      const response = await fetch('https://hexi.wokwi.com/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch: code, board: "uno" })
      });
      const data = await response.json();
      
      if (!data.hex) {
        setSysLogs(prev =>[...prev, '> COMPILATION FAILED:', data.stderr || data.compilerErrors]);
        setSimState(false);
        return;
      }
      bootVirtualCpu(data.hex, false);
    } catch (err) {
      setSysLogs(prev =>[...prev, '> CLOUD ERROR: ' + err.message]);
      setSimState(false); 
    }
  };

  const runSimulationOffline = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    stopSimulation(); 
    const serialEl = document.getElementById('serial-console');
    if (serialEl) serialEl.textContent = "";
    
    setSysLogs(['> Loading local .hex file...']);

    const reader = new FileReader();
    reader.onload = (event) => {
      bootVirtualCpu(event.target.result, true);
      e.target.value = null; 
    };
    reader.readAsText(file);
  };

  const renderPinOptions = () => {
    const options =[];
    for(let i = 2; i <= 19; i++) {
       const label = i < 14 ? `D${i}` : `A${i-14}`;
       options.push(<option key={i} value={i}>{label}</option>);
    }
    return options;
  };

  return (
    <div className={`flex h-screen w-screen p-2 gap-2 bg-gray-100 dark:bg-neutral-900 font-sans text-gray-800 dark:text-gray-300 overflow-hidden ${isDragging ? 'select-none pointer-events-none' : ''}`}>
      
      <div style={{ width: `${leftWidth}%` }} className="flex flex-col gap-2 h-full pointer-events-auto relative">
        <div style={{ height: `${editorHeight}%` }} className="flex flex-col bg-white dark:bg-neutral-800 rounded-lg overflow-hidden border border-gray-300 dark:border-neutral-700 shadow-sm">
          <div className="bg-gray-100 dark:bg-neutral-950 p-2 text-sm font-bold text-gray-800 dark:text-gray-300 flex justify-between items-center border-b border-gray-300 dark:border-neutral-700">
            <span>💻 Monaco Editor</span>
            <label className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors border ${isRunning ? 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500 border-gray-300 dark:border-gray-600 cursor-not-allowed' : 'bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-800/80 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-900 cursor-pointer'}`} title="Run Local .hex File (Offline Mode)">
               <FileUp size={12}/> Run Local .HEX
               <input type="file" accept=".hex" className="hidden" disabled={isRunning} onChange={runSimulationOffline} />
            </label>
          </div>
          <div className="flex-grow">
            <Editor height="100%" defaultLanguage="cpp" theme={editorTheme} value={code} onChange={(value) => setCode(value)} options={{ minimap: { enabled: false }, fontSize: 14 }} />
          </div>
        </div>

        <div onMouseDown={handleDragEditor} className="h-2 flex items-center justify-center cursor-row-resize group relative z-50">
          <div className="h-1 w-8 bg-gray-300 dark:bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
            <GripHorizontal size={10} className="text-gray-500 dark:text-neutral-900 group-hover:text-white pointer-events-none" />
          </div>
        </div>

        <div className="flex-1 flex gap-2 overflow-hidden">
          <div className="flex-1 bg-gray-50 dark:bg-neutral-950 rounded-lg border border-gray-300 dark:border-neutral-700 flex flex-col overflow-hidden shadow-sm">
             <div className="bg-gray-200 dark:bg-neutral-900 p-2 text-xs font-bold text-gray-600 dark:text-gray-400 flex items-center gap-2 border-b border-gray-300 dark:border-neutral-700">
              <Settings size={14}/> SYSTEM CONSOLE
            </div>
            <div className="flex-grow p-2 font-mono text-xs text-gray-600 dark:text-gray-500 overflow-y-auto flex flex-col">
              {sysLogs.map((log, i) => <div key={i}>{log}</div>)}
              <div ref={sysLogEndRef} />
            </div>
          </div>
          
          <div className="flex-1 bg-gray-50 dark:bg-neutral-950 rounded-lg border border-gray-300 dark:border-neutral-700 flex flex-col overflow-hidden shadow-sm">
             <div className="bg-gray-200 dark:bg-neutral-900 p-2 text-xs font-bold text-gray-600 dark:text-gray-400 flex items-center justify-between border-b border-gray-300 dark:border-neutral-700">
                <div className="flex items-center gap-2">
                  <Terminal size={14}/> SERIAL MONITOR
                </div>
                <select 
                  className="bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 text-green-700 dark:text-green-400 rounded outline-none focus:border-green-500 cursor-pointer"
                  value={baudRate}
                  onChange={(e) => setBaudRate(e.target.value)}
                >
                  <option value="300">300 baud</option>
                  <option value="1200">1200 baud</option>
                  <option value="2400">2400 baud</option>
                  <option value="4800">4800 baud</option>
                  <option value="9600">9600 baud</option>
                  <option value="19200">19200 baud</option>
                  <option value="38400">38400 baud</option>
                  <option value="57600">57600 baud</option>
                  <option value="115200">115200 baud</option>
                </select>
            </div>
            <div id="serial-console" className="flex-grow p-2 font-mono text-sm text-green-700 dark:text-green-400 overflow-y-auto whitespace-pre-wrap"></div>
          </div>
        </div>
      </div>

      <div onMouseDown={handleDragMain} className="w-2 flex items-center justify-center cursor-col-resize group pointer-events-auto relative z-50">
        <div className="w-1 h-8 bg-gray-300 dark:bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
          <GripVertical size={10} className="text-gray-500 dark:text-neutral-900 group-hover:text-white pointer-events-none" />
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-2 h-full overflow-hidden pointer-events-auto relative">
        <div style={{ height: `${canvasHeight}%` }} className="flex flex-col bg-white rounded-lg border border-gray-300 dark:border-neutral-700 relative overflow-hidden shadow-sm">
          <div className="bg-gray-200 dark:bg-neutral-200 p-2 text-sm font-bold text-black flex justify-between items-center z-10 shadow">
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
          <div className="h-1 w-8 bg-gray-300 dark:bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
            <GripHorizontal size={10} className="text-gray-500 dark:text-neutral-900 group-hover:text-white pointer-events-none" />
          </div>
        </div>

        <div className="flex-1 flex gap-2 overflow-hidden">
          <div className="flex-grow bg-white dark:bg-neutral-800 rounded-lg border border-gray-300 dark:border-neutral-700 p-3 flex flex-col overflow-hidden shadow-sm">
            
            <div className="text-sm font-bold text-gray-800 dark:text-gray-300 mb-2 flex justify-between items-center border-b border-gray-200 dark:border-neutral-700 pb-2">
               <div className="flex items-center gap-2"><Settings size={16}/> Robot Customization Lab</div>
               <div className="flex gap-2">
                 <button onClick={restoreDefaults} className="flex items-center gap-1 text-[10px] bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800/80 text-red-700 dark:text-red-300 px-2 py-1 rounded transition-colors" title="Restore Default Settings">
                   <RefreshCcw size={10}/> Restore Default
                 </button>
                 <button onClick={exportConfig} className="flex items-center gap-1 text-[10px] bg-gray-200 dark:bg-neutral-700 hover:bg-gray-300 dark:hover:bg-neutral-600 text-gray-800 dark:text-white px-2 py-1 rounded transition-colors" title="Download Config File">
                   <Download size={10}/> Export Config
                 </button>
                 <label className="flex items-center gap-1 text-[10px] bg-gray-200 dark:bg-neutral-700 hover:bg-gray-300 dark:hover:bg-neutral-600 text-gray-800 dark:text-white px-2 py-1 rounded transition-colors cursor-pointer" title="Upload Config File">
                   <Upload size={10}/> Import Config
                   <input type="file" accept=".json" className="hidden" onChange={importConfig} />
                 </label>
               </div>
            </div>
            
            <div className="flex gap-4 h-full">
               
               <div className="flex-[1.2] text-[11px] font-mono font-bold bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-transparent p-2 rounded overflow-y-auto">
                 <p className="text-gray-500 mb-1">// HARDWARE WIRING</p>
                 <ul className="list-none ml-1 flex flex-col gap-1 text-gray-600 dark:text-gray-400">
                   <li className="flex justify-between items-center">
                     <span id="pinL-status" className="transition-colors duration-75">○ Motor L</span>
                     <select value={pinMotorL} onChange={(e) => setPinMotorL(Number(e.target.value))} className="bg-white dark:bg-neutral-950 text-green-700 dark:text-green-400 border border-gray-300 dark:border-neutral-700 rounded w-12 outline-none">
                       {renderPinOptions()}
                     </select>
                   </li>
                   <li className="flex justify-between items-center">
                     <span id="pinR-status" className="transition-colors duration-75">○ Motor R</span>
                     <select value={pinMotorR} onChange={(e) => setPinMotorR(Number(e.target.value))} className="bg-white dark:bg-neutral-950 text-green-700 dark:text-green-400 border border-gray-300 dark:border-neutral-700 rounded w-12 outline-none">
                       {renderPinOptions()}
                     </select>
                   </li>
                   <li className="flex justify-between items-center">
                     <span className="text-gray-400 dark:text-gray-600">○ Sonar Trig</span>
                     <select value={pinSonarTrig} onChange={(e) => setPinSonarTrig(Number(e.target.value))} className="bg-white dark:bg-neutral-950 text-gray-500 border border-gray-300 dark:border-neutral-700 rounded w-12 outline-none">
                       {renderPinOptions()}
                     </select>
                   </li>
                   <li className="flex justify-between items-center">
                     <span className="text-gray-400 dark:text-gray-600">○ Sonar Echo</span>
                     <select value={pinSonarEcho} onChange={(e) => setPinSonarEcho(Number(e.target.value))} className="bg-white dark:bg-neutral-950 text-gray-500 border border-gray-300 dark:border-neutral-700 rounded w-12 outline-none">
                       {renderPinOptions()}
                     </select>
                   </li>
                 </ul>
               </div>

               <div className="flex-[2] bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-transparent p-2 rounded flex flex-col gap-1">
                 <div className="text-[10px] font-mono font-bold text-gray-500 flex items-center gap-1 border-b border-gray-200 dark:border-neutral-800 pb-1">
                    <Crosshair size={12}/> ROBOT POSITION
                 </div>
                 
                 <div className="flex gap-4 h-full pt-1">
                   
                   <div className="flex-1 flex flex-col justify-center text-xs text-gray-600 dark:text-gray-400 font-mono border-r border-gray-300 dark:border-neutral-700 pr-4">
                     <div className="text-[10px] text-green-600 dark:text-green-500 font-bold mb-1 tracking-widest">SYS_TELEMETRY</div>
                     <div className="flex justify-between"><span>M_LEFT:</span> <span id="hud-motorL" className="text-gray-500">OFF</span></div>
                     <div className="flex justify-between"><span>M_RIGHT:</span> <span id="hud-motorR" className="text-gray-500">OFF</span></div>
                     <div className="flex justify-between mt-1 pt-1 border-t border-gray-200 dark:border-neutral-800 text-green-700 dark:text-green-400"><span>CUR_X:</span> <span id="hud-x">200</span></div>
                     <div className="flex justify-between text-green-700 dark:text-green-400"><span>CUR_Y:</span> <span id="hud-y">200</span></div>
                     <div className="flex justify-between text-green-700 dark:text-green-400"><span>ANGLE:</span> <span><span id="hud-angle">0.00</span>°</span></div>
                   </div>

                   <div className="flex-[1.5] flex flex-col justify-center">
                     <div className="text-[10px] text-gray-500 font-bold mb-1 tracking-widest">MANUAL POSE</div>
                     <div className="grid grid-cols-2 gap-1 text-xs text-gray-600 dark:text-gray-400 font-mono">
                        <div className="flex items-center gap-1">
                           <span>X:</span>
                           <input id="input-x" type="number" className="w-full bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 text-green-700 dark:text-green-400 focus:outline-none focus:border-green-500" />
                        </div>
                        <div className="flex items-center gap-1">
                           <span>Y:</span>
                           <input id="input-y" type="number" className="w-full bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 text-green-700 dark:text-green-400 focus:outline-none focus:border-green-500" />
                        </div>
                        <div className="flex items-center gap-1 col-span-2">
                           <span>Ang:</span>
                           <input id="input-angle" type="number" className="w-full bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 text-green-700 dark:text-green-400 focus:outline-none focus:border-green-500" />
                        </div>
                     </div>
                     <button onClick={applyManualPose} className="mt-1 w-full bg-gray-300 dark:bg-neutral-700 hover:bg-gray-400 dark:hover:bg-neutral-600 text-gray-800 dark:text-white text-[10px] font-bold py-1 rounded transition-colors">
                        APPLY TELEPORT
                     </button>
                   </div>
                 </div>
               </div>
            </div>
          </div>

          <div className="w-1/3 bg-gray-50 dark:bg-neutral-800 rounded-lg border border-gray-300 dark:border-neutral-700 p-2 flex flex-col justify-center gap-2 shadow-sm">
            <button onClick={runSimulationCloud} disabled={isRunning} className={`flex items-center justify-center gap-2 py-2 px-2 rounded font-bold text-sm transition-colors ${isRunning ? 'bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'}`}>
              <Play size={16} fill="currentColor" /> RUN (Cloud)
            </button>
            <button onClick={stopSimulation} className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 text-white py-2 px-2 rounded font-bold text-sm transition-colors">
              <Square size={16} fill="currentColor" /> STOP
            </button>
            <button onClick={resetSimulation} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-2 px-2 rounded font-bold text-sm transition-colors">
              <RotateCcw size={16} /> RESET
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;