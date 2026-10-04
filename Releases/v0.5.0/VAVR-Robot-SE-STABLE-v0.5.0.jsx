import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square, RotateCcw, Monitor, Settings, Terminal, Crosshair, GripVertical, GripHorizontal, Download, Upload, RefreshCcw, FileUp, ImagePlus, Trash2, Wrench, PlusCircle, X } from 'lucide-react';
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
  if (pin >= 0 && pin <= 7) { portAddr = 0x2B; bit = pin; } 
  else if (pin >= 8 && pin <= 13) { portAddr = 0x25; bit = pin - 8; } 
  else if (pin >= 14 && pin <= 19) { portAddr = 0x28; bit = pin - 14; } 
  else { return false; }
  return (cpu.data[portAddr] & (1 << bit)) !== 0;
};

const generateId = () => Math.random().toString(36).substr(2, 9);

const TYPE_TAGS = {
  dc_motor: 'DC MOTOR',
  imu: 'IMU',
  ir_sensor: 'IR SENSOR',
  servo: 'SERVO',
  sonar: 'SONAR'
};

const DEFAULT_CONFIG = {
  leftWidth: 45,
  editorHeight: 60,
  canvasHeight: 65,
  robotX: 200,
  robotY: 200,
  robotAngle: 0,
  baudRate: "9600",
  robotBuild: {
    chassisW: 50,
    chassisH: 30, 
    parts:[
      { id: generateId(), type: 'dc_motor', name: 'Front Left', pin: 9, offsetX: 15, offsetY: -18, angle: 0 },
      { id: generateId(), type: 'dc_motor', name: 'Back Left', pin: 9, offsetX: -15, offsetY: -18, angle: 0 },
      { id: generateId(), type: 'dc_motor', name: 'Front Right', pin: 10, offsetX: 15, offsetY: 18, angle: 0 },
      { id: generateId(), type: 'dc_motor', name: 'Back Right', pin: 10, offsetX: -15, offsetY: 18, angle: 0 },
      { id: generateId(), type: 'sonar', name: 'Front Sonar', pinTrig: 3, pinEcho: 2, offsetX: 25, offsetY: 0, angle: 0 }
    ]
  }
};

const getConfig = () => {
  try {
    const saved = localStorage.getItem('flawless-config');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {}
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
  const[sysLogs, setSysLogs] = useState(['> System Ready. Sandbox Environment Loaded.']);
  const[serialOutput, setSerialOutput] = useState("");
  const[baudRate, setBaudRate] = useState(initConfig.baudRate || "9600");
  
  const[offlineHexCode, setOfflineHexCode] = useState(null);
  const[offlineHexName, setOfflineHexName] = useState("");

  const[editorTheme, setEditorTheme] = useState('vs-dark');
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setEditorTheme(mediaQuery.matches ? 'vs-dark' : 'light');
    const handleChange = (e) => setEditorTheme(e.matches ? 'vs-dark' : 'light');
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', handleChange);
    else mediaQuery.addListener(handleChange);
    return () => {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', handleChange);
      else mediaQuery.removeListener(handleChange);
    };
  },[]);

  const[robotBuild, setRobotBuild] = useState(initConfig.robotBuild || DEFAULT_CONFIG.robotBuild);
  const[newPartType, setNewPartType] = useState('dc_motor'); 
  
  const[isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false); 
  const baudRateRef = useRef(baudRate); 
  const buildRef = useRef(robotBuild); 

  const setSimState = (state) => { setIsRunning(state); isRunningRef.current = state; };
  
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
  useEffect(() => { buildRef.current = robotBuild; },[robotBuild]);

  useEffect(() => {
    const current = getConfig();
    const nextConfig = { ...current, leftWidth, editorHeight, canvasHeight, baudRate, robotBuild };
    localStorage.setItem('flawless-config', JSON.stringify(nextConfig));
  },[leftWidth, editorHeight, canvasHeight, baudRate, robotBuild]);

  useEffect(() => { sysLogEndRef.current?.scrollIntoView({ behavior: "smooth" }); },[sysLogs]);
  useEffect(() => { serialEndRef.current?.scrollIntoView({ behavior: "smooth" }); },[serialOutput]);

  const handleDragMain = (e) => {
    e.preventDefault(); setIsDragging(true);
    const container = e.currentTarget.parentElement; 
    const { left, width } = container.getBoundingClientRect();
    const onMouseMove = (ev) => setLeftWidth(Math.max(20, Math.min(80, ((ev.clientX - left) / width) * 100)));
    const onMouseUp = () => { setIsDragging(false); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
  };
  const handleDragEditor = (e) => {
    e.preventDefault(); setIsDragging(true);
    const container = e.currentTarget.parentElement;
    const { top, height } = container.getBoundingClientRect();
    const onMouseMove = (ev) => setEditorHeight(Math.max(20, Math.min(80, ((ev.clientY - top) / height) * 100)));
    const onMouseUp = () => { setIsDragging(false); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
  };
  const handleDragCanvas = (e) => {
    e.preventDefault(); setIsDragging(true);
    const container = e.currentTarget.parentElement;
    const { top, height } = container.getBoundingClientRect();
    const onMouseMove = (ev) => setCanvasHeight(Math.max(20, Math.min(80, ((ev.clientY - top) / height) * 100)));
    const onMouseUp = () => { setIsDragging(false); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
  };

  const handleMapUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => { setMapImage(event.target.result); setSysLogs(prev =>[...prev, `> MAP LOADED: ${file.name}`]); };
    reader.readAsDataURL(file); e.target.value = null; 
  };
  const clearMap = () => { setMapImage(null); setSysLogs(prev =>[...prev, `> MAP CLEARED.`]); };

  const exportConfig = () => {
    const configData = localStorage.getItem('flawless-config') || JSON.stringify(DEFAULT_CONFIG);
    const blob = new Blob([configData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = "flawless_layout.json"; a.click(); URL.revokeObjectURL(url);
    setSysLogs(prev =>[...prev, '> FILE EXPORTED: flawless_layout.json saved.']);
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
        if (parsed.robotBuild) setRobotBuild(parsed.robotBuild);
        
        if (robotRef.current && parsed.robotX !== undefined) {
          Matter.Body.setPosition(robotRef.current, { x: parsed.robotX, y: parsed.robotY });
          Matter.Body.setAngle(robotRef.current, parsed.robotAngle);
          Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(robotRef.current, 0);
        }
        localStorage.setItem('flawless-config', JSON.stringify(parsed));
        setSysLogs(prev =>[...prev, '> FILE IMPORTED: Sandbox Environment reconstructed!']);
        e.target.value = null;
      } catch (err) { setSysLogs(prev =>[...prev, '> ERROR: Invalid Configuration File!']); }
    };
    reader.readAsText(file);
  };

  const restoreDefaults = () => {
    localStorage.removeItem('flawless-config');
    setLeftWidth(DEFAULT_CONFIG.leftWidth);
    setEditorHeight(DEFAULT_CONFIG.editorHeight);
    setCanvasHeight(DEFAULT_CONFIG.canvasHeight);
    setBaudRate(DEFAULT_CONFIG.baudRate);
    setRobotBuild(DEFAULT_CONFIG.robotBuild);
    
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: DEFAULT_CONFIG.robotX, y: DEFAULT_CONFIG.robotY });
      Matter.Body.setAngle(robotRef.current, DEFAULT_CONFIG.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(robotRef.current, 0);
    }
    setSysLogs(prev =>[...prev, '> CACHE CLEARED: Reverted to Factory Sandbox Defaults.']);
  };

  const rebuildRobotPhysics = (buildConfig, initialX = 200, initialY = 200, initialAngle = 0) => {
    if (!engineRef.current) return;
    if (robotRef.current) {
      Matter.World.remove(engineRef.current.world, robotRef.current);
    }

    const x = robotRef.current ? robotRef.current.position.x : initialX;
    const y = robotRef.current ? robotRef.current.position.y : initialY;
    const angle = robotRef.current ? robotRef.current.angle : initialAngle;

    const w = Math.max(10, buildConfig.chassisW || 50);
    const h = Math.max(10, buildConfig.chassisH || 30);

    const chassis = Matter.Bodies.rectangle(x, y, w, h, { 
      render: { fillStyle: '#3b82f6' } 
    });
    
    const partsArray =[chassis];

    buildConfig.parts.forEach(p => {
      const pAngleRad = (p.angle || 0) * (Math.PI / 180);
      if (p.type === 'dc_motor') partsArray.push(Matter.Bodies.rectangle(x + p.offsetX, y + p.offsetY, 14, 6, { angle: pAngleRad, render: { fillStyle: '#1f2937' } }));
      if (p.type === 'sonar') partsArray.push(Matter.Bodies.rectangle(x + p.offsetX, y + p.offsetY, 6, 12, { angle: pAngleRad, render: { fillStyle: '#ef4444' } }));
      if (p.type === 'ir_sensor') partsArray.push(Matter.Bodies.rectangle(x + p.offsetX, y + p.offsetY, 6, 6, { angle: pAngleRad, render: { fillStyle: '#22c55e' } }));
      if (p.type === 'servo') partsArray.push(Matter.Bodies.rectangle(x + p.offsetX, y + p.offsetY, 8, 8, { angle: pAngleRad, render: { fillStyle: '#f97316' } }));
      if (p.type === 'imu') partsArray.push(Matter.Bodies.rectangle(x + p.offsetX, y + p.offsetY, 6, 6, { angle: pAngleRad, render: { fillStyle: '#a855f7' } }));
    });

    const robot = Matter.Body.create({
      parts: partsArray,
      frictionAir: 0.1,
      inertia: Infinity, 
    });

    Matter.Body.setPosition(robot, { x, y });
    Matter.Body.setAngle(robot, angle);

    robotRef.current = robot;
    Matter.World.add(engineRef.current.world, robot);
  };

  useEffect(() => {
    if (engineRef.current) rebuildRobotPhysics(robotBuild);
  },[robotBuild]);

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

    Matter.World.add(engine.world, [mouseConstraint, ...walls]);
    rebuildRobotPhysics(initConf.robotBuild, initConf.robotX, initConf.robotY, initConf.robotAngle);

    const syncHUD = () => {
      if (!robotRef.current) return;
      const r = robotRef.current;
      const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360; 
      
      const hudX = document.getElementById('hud-x');
      const hudY = document.getElementById('hud-y');
      const hudAngle = document.getElementById('hud-angle');
      if (hudX) hudX.innerText = Math.round(r.position.x);
      if (hudY) hudY.innerText = Math.round(r.position.y);
      if (hudAngle) hudAngle.innerText = normalizedDeg.toFixed(2);
    };

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

    Matter.Events.on(engine, 'afterUpdate', syncHUD);

    Matter.Events.on(render, 'afterRender', () => {
      if (!robotRef.current) return;
      const ctx = render.context;
      const r = robotRef.current;

      ctx.save();
      ctx.translate(r.position.x, r.position.y);
      ctx.rotate(r.angle);

      const w2 = Math.max(10, buildRef.current.chassisW) / 2;
      const h2 = Math.max(10, buildRef.current.chassisH) / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -w2; x <= w2; x += 10) { ctx.moveTo(x, -h2); ctx.lineTo(x, h2); }
      for (let y = -h2; y <= h2; y += 10) { ctx.moveTo(-w2, y); ctx.lineTo(w2, y); }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(15, 0); 
      ctx.lineTo(10, -5); ctx.moveTo(15, 0); ctx.lineTo(10, 5); 
      ctx.stroke();

      buildRef.current.parts.forEach(p => {
        if (p.type === 'dc_motor') ctx.fillStyle = '#fbbf24'; 
        else if (p.type === 'sonar') ctx.fillStyle = '#ef4444'; 
        else if (p.type === 'ir_sensor') ctx.fillStyle = '#22c55e'; 
        else if (p.type === 'servo') ctx.fillStyle = '#f97316'; 
        else if (p.type === 'imu') ctx.fillStyle = '#a855f7'; 
        else ctx.fillStyle = '#ffffff';

        ctx.beginPath();
        ctx.arc(p.offsetX, p.offsetY, 2, 0, 2 * Math.PI);
        ctx.fill();

        const pAngleRad = (p.angle || 0) * (Math.PI / 180);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.offsetX, p.offsetY);
        ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * 5, p.offsetY + Math.sin(pAngleRad) * 5);
        ctx.stroke();
      });
      ctx.restore();
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

  // --- OFFLINE HEX LOADING (DECOUPLED FROM EXECUTION) ---
  const handleLoadHex = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setOfflineHexCode(event.target.result);
      setOfflineHexName(file.name);
      setSysLogs(prev =>[...prev, `> LOCAL .HEX LOADED: ${file.name}. Ready to RUN.`]);
      e.target.value = null; 
    };
    reader.readAsText(file);
  };

  const clearOfflineHex = () => {
    setOfflineHexCode(null);
    setOfflineHexName("");
    setSysLogs(prev =>[...prev, `> LOCAL .HEX CLEARED. Ready for Cloud compilation.`]);
  };

  const addPart = (type) => {
    setRobotBuild(prev => {
      let newPart = { id: generateId(), type: type, offsetX: 0, offsetY: 0, angle: 0 };
      if (type === 'dc_motor') { newPart.name = 'New Motor'; newPart.pin = 9; }
      else if (type === 'sonar') { newPart.name = 'New Sonar'; newPart.pinTrig = 3; newPart.pinEcho = 2; newPart.offsetX = 25;}
      else if (type === 'ir_sensor') { newPart.name = 'New IR Sensor'; newPart.pin = 4; newPart.offsetX = 25; }
      else if (type === 'servo') { newPart.name = 'New Servo'; newPart.pin = 5; }
      else if (type === 'imu') { newPart.name = 'New IMU'; } 
      return { ...prev, parts:[...prev.parts, newPart] };
    });
  };

  const removePart = (id) => {
    setRobotBuild(prev => ({ ...prev, parts: prev.parts.filter(p => p.id !== id) }));
  };

  const updatePart = (id, key, value) => {
    setRobotBuild(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
         if (p.id === id) {
            const val = (key === 'name') ? value : Number(value);
            return { ...p,[key]: val };
         }
         return p;
      })
    }));
  };

  const updateChassis = (key, value) => {
    setRobotBuild(prev => ({
      ...prev,
      [key]: Math.max(10, Number(value)) 
    }));
  };

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
    
    buildRef.current.parts.forEach(p => {
       const el = document.getElementById(`pin-ui-${p.id}`);
       if (el) el.className = "transition-colors duration-75 text-gray-400 dark:text-gray-600";
    });

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
        setSysLogs(prev =>[...prev, '> OFFLINE MODE: Running local .hex file']);
      }
      setSysLogs(prev =>[...prev, '> Sandbox Physics Engine RUNNING...']);
      
      const hudPortb = document.getElementById('hud-portb');
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

            if (hudPortb) hudPortb.innerText = cpu.data[0x25].toString(2).padStart(8, '0');

            const robot = robotRef.current;
            const mouseBody = mouseConstraintRef.current?.body;
            const isDraggingRobot = (mouseBody === robot);

            if (!isDraggingRobot) {
              let localVx = 0;
              let localVy = 0;
              let angularVelocity = 0;

              buildRef.current.parts.forEach(part => {
                 if (part.type === 'dc_motor') {
                    const isHigh = getPinState(cpu, part.pin);
                    const uiEl = document.getElementById(`pin-ui-${part.id}`);
                    if (uiEl) uiEl.className = isHigh ? "transition-colors duration-75 text-green-600 dark:text-green-400 font-bold" : "transition-colors duration-75 text-gray-400 dark:text-gray-600";
                    
                    if (isHigh) {
                       const pAngleRad = (part.angle || 0) * (Math.PI / 180);
                       const forceX = Math.cos(pAngleRad) * 1; 
                       const forceY = Math.sin(pAngleRad) * 1;

                       localVx += forceX;
                       localVy += forceY;

                       const torque = (part.offsetX * forceY) - (part.offsetY * forceX);
                       angularVelocity += torque * 0.0032; 
                    }
                 }
              });

              if (localVx !== 0 || localVy !== 0 || angularVelocity !== 0) {
                 const globalVx = localVx * Math.cos(robot.angle) - localVy * Math.sin(robot.angle);
                 const globalVy = localVx * Math.sin(robot.angle) + localVy * Math.cos(robot.angle);

                 Matter.Body.setVelocity(robot, { x: globalVx, y: globalVy });
                 Matter.Body.setAngle(robot, robot.angle + angularVelocity);
              } else {
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

  const runSimulationLocal = () => {
    if (isRunningRef.current || !offlineHexCode) return;
    stopSimulation(); 
    const serialEl = document.getElementById('serial-console');
    if (serialEl) serialEl.textContent = "";
    bootVirtualCpu(offlineHexCode, true);
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
      
      <style>{`
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.4); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.6); }
      `}</style>

      <div style={{ width: `${leftWidth}%` }} className="flex flex-col gap-2 h-full pointer-events-auto relative">
        <div style={{ height: `${editorHeight}%` }} className="flex flex-col bg-white dark:bg-neutral-800 rounded-lg overflow-hidden border border-gray-300 dark:border-neutral-700 shadow-sm">
          
          <div className="bg-gray-100 dark:bg-neutral-950 p-2 text-sm font-bold text-gray-800 dark:text-gray-300 flex justify-between items-center border-b border-gray-300 dark:border-neutral-700">
            <div className="flex items-center gap-2">
              <span>💻 Monaco Editor</span>
              {offlineHexName && (
                 <div className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded text-[10px] font-mono border border-blue-200 dark:border-blue-800" title={offlineHexName}>
                   <span className="truncate max-w-[150px]">{offlineHexName}</span>
                   <button onClick={clearOfflineHex} className="hover:text-red-500 ml-1"><X size={10}/></button>
                 </div>
              )}
            </div>
            <label className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors border ${isRunning ? 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500 border-gray-300 dark:border-gray-600 cursor-not-allowed' : 'bg-teal-100 dark:bg-teal-900/40 hover:bg-teal-200 dark:hover:bg-teal-800/80 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-900 cursor-pointer'}`} title="Load a compiled .hex file into memory">
               <FileUp size={12}/> Load .HEX
               <input type="file" accept=".hex" className="hidden" disabled={isRunning} onChange={handleLoadHex} />
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
                  <option value="9600">9600 baud</option>
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
               backgroundImage: mapImage 
                 ? `url(${mapImage})` 
                 : 'linear-gradient(rgba(128, 128, 128, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(128, 128, 128, 0.2) 1px, transparent 1px)',
               backgroundSize: mapImage ? 'auto' : '20px 20px',
               backgroundPosition: 'center',
               backgroundRepeat: mapImage ? 'no-repeat' : 'repeat'
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
               <div className="flex items-center gap-2"><Wrench size={16}/> Robot Customization Lab</div>
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
            
            <div className="flex gap-4 flex-1 min-h-0">
               
               <div className="flex-[1.5] text-[11px] font-mono font-bold bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-transparent p-2 rounded overflow-y-auto custom-scrollbar">
                 
                 <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-200 dark:border-neutral-800 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-500 dark:text-blue-400">CHASSIS SIZE</span>
                    </div>
                    <div className="flex gap-2">
                       <div className="flex items-center gap-1">
                          <span className="text-gray-500 text-[10px]">W:</span>
                          <input type="number" min="10" value={robotBuild.chassisW} onChange={(e) => updateChassis('chassisW', e.target.value)} className="w-12 bg-white dark:bg-neutral-950 text-blue-600 dark:text-blue-400 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500 text-center" />
                       </div>
                       <div className="flex items-center gap-1">
                          <span className="text-gray-500 text-[10px]">H:</span>
                          <input type="number" min="10" value={robotBuild.chassisH} onChange={(e) => updateChassis('chassisH', e.target.value)} className="w-12 bg-white dark:bg-neutral-950 text-blue-600 dark:text-blue-400 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500 text-center" />
                       </div>
                    </div>
                 </div>

                 <div className="flex justify-between items-center mb-2 pb-1 border-b border-gray-200 dark:border-neutral-800 shrink-0">
                    <p className="text-gray-500">// COMPONENTS</p>
                    <div className="flex gap-1">
                      <select 
                        value={newPartType} 
                        onChange={(e) => setNewPartType(e.target.value)} 
                        className="bg-white dark:bg-neutral-950 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-neutral-700 rounded text-[9px] outline-none px-1"
                      >
                         <option value="dc_motor">DC Motor</option>
                         <option value="sonar">Sonar</option>
                         <option value="ir_sensor">IR Sensor</option>
                         <option value="servo">Servo Motor</option>
                         <option value="imu">IMU</option>
                      </select>
                      <button onClick={() => addPart(newPartType)} className="flex items-center gap-1 bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/50 dark:hover:bg-blue-800 dark:text-blue-300 px-2 py-0.5 rounded transition-colors text-[9px]">
                         <PlusCircle size={10}/> Add
                      </button>
                    </div>
                 </div>
                 
                 <div className="flex flex-col gap-2 pb-2">
                    {robotBuild.parts.map(part => (
                       <div key={part.id} className="flex flex-col gap-1 border-b border-gray-200 dark:border-neutral-800 pb-2 relative group">
                          
                          <button onClick={() => removePart(part.id)} className="absolute top-0 right-0 text-gray-400 hover:text-red-500 transition-colors opacity-50 group-hover:opacity-100 z-10 bg-gray-50 dark:bg-neutral-900 rounded pl-1">
                             <X size={12}/>
                          </button>

                          <div className="flex items-center gap-2 pr-6 mb-1">
                            <span id={`pin-ui-${part.id}`} className="transition-colors duration-75 text-gray-400 dark:text-gray-600">●</span>
                            <span className="text-[9px] bg-gray-200 dark:bg-neutral-800 text-gray-500 font-bold px-1 rounded tracking-wider uppercase shrink-0">
                               {TYPE_TAGS[part.type]}
                            </span>
                            <input 
                               type="text" 
                               value={part.name} 
                               onChange={(e) => updatePart(part.id, 'name', e.target.value)} 
                               className="bg-transparent text-gray-800 dark:text-gray-200 font-bold w-full outline-none border-b border-transparent hover:border-gray-300 dark:hover:border-neutral-700 focus:border-blue-500 transition-colors truncate"
                            />
                          </div>

                          <div className="flex gap-2 mt-1">
                            {(part.type === 'dc_motor' || part.type === 'ir_sensor' || part.type === 'servo') && (
                               <div className="flex items-center gap-1">
                                 <span className="text-[10px] text-gray-500">Pin:</span>
                                 <select value={part.pin} onChange={(e) => updatePart(part.id, 'pin', e.target.value)} className="bg-white dark:bg-neutral-950 text-blue-600 dark:text-blue-400 border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center">
                                   {renderPinOptions()}
                                 </select>
                               </div>
                            )}
                            {part.type === 'sonar' && (
                               <>
                               <div className="flex items-center gap-1">
                                 <span className="text-[10px] text-gray-500">Trig:</span>
                                 <select value={part.pinTrig} onChange={(e) => updatePart(part.id, 'pinTrig', e.target.value)} className="bg-white dark:bg-neutral-950 text-red-600 dark:text-red-400 border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center">
                                   {renderPinOptions()}
                                 </select>
                               </div>
                               <div className="flex items-center gap-1">
                                 <span className="text-[10px] text-gray-500">Echo:</span>
                                 <select value={part.pinEcho} onChange={(e) => updatePart(part.id, 'pinEcho', e.target.value)} className="bg-white dark:bg-neutral-950 text-red-600 dark:text-red-400 border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center">
                                   {renderPinOptions()}
                                 </select>
                               </div>
                               </>
                            )}
                            {part.type === 'imu' && (
                               <div className="flex items-center gap-1">
                                 <span className="text-[10px] text-gray-500">I2C (A4/A5)</span>
                               </div>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500 mt-1">
                             <div className="flex items-center gap-1">
                               <span>X:</span>
                               <input type="number" value={part.offsetX} onChange={(e) => updatePart(part.id, 'offsetX', e.target.value)} className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500" />
                             </div>
                             <div className="flex items-center gap-1">
                               <span>Y:</span>
                               <input type="number" value={part.offsetY} onChange={(e) => updatePart(part.id, 'offsetY', e.target.value)} className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500" />
                             </div>
                             <div className="flex items-center gap-1">
                               <span>Ang:</span>
                               <input type="number" value={part.angle || 0} onChange={(e) => updatePart(part.id, 'angle', e.target.value)} className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500" />
                             </div>
                          </div>
                       </div>
                    ))}
                    {robotBuild.parts.length === 0 && (
                      <div className="text-center text-gray-400 italic mt-4 border border-dashed border-gray-300 dark:border-gray-700 p-2 rounded">Empty Chassis</div>
                    )}
                 </div>
               </div>

               <div className="flex-1 bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-transparent p-2 rounded flex flex-col gap-2 overflow-y-auto">
                 
                 <div className="flex flex-col text-xs text-gray-600 dark:text-gray-400 font-mono">
                   <div className="text-[10px] text-green-600 dark:text-green-500 font-bold mb-1 tracking-widest flex items-center gap-1 border-b border-gray-200 dark:border-neutral-800 pb-1">
                      <Monitor size={12}/> SYS_TELEMETRY
                   </div>
                   <div className="flex justify-between mt-1"><span>PORTB:</span> <span id="hud-portb">00000000</span></div>
                   <div className="flex justify-between text-green-700 dark:text-green-400"><span>CUR_X:</span> <span id="hud-x">200</span></div>
                   <div className="flex justify-between text-green-700 dark:text-green-400"><span>CUR_Y:</span> <span id="hud-y">200</span></div>
                   <div className="flex justify-between text-green-700 dark:text-green-400"><span>ANGLE:</span> <span><span id="hud-angle">0.00</span>°</span></div>
                 </div>

                 <div className="flex flex-col pt-2 mt-auto">
                   <div className="text-[10px] text-gray-500 font-bold mb-1 tracking-widest flex items-center gap-1 border-b border-gray-200 dark:border-neutral-800 pb-1">
                      <Crosshair size={12}/> MANUAL POSE
                   </div>
                   <div className="grid grid-cols-2 gap-1 text-xs text-gray-600 dark:text-gray-400 font-mono mb-1">
                      <div className="flex items-center gap-1">
                         <span>X:</span>
                         <input id="input-x" type="number" className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 text-green-700 dark:text-green-400 focus:outline-none focus:border-green-500" />
                      </div>
                      <div className="flex items-center gap-1">
                         <span>Y:</span>
                         <input id="input-y" type="number" className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 text-green-700 dark:text-green-400 focus:outline-none focus:border-green-500" />
                      </div>
                      <div className="flex items-center gap-1 col-span-2">
                         <span>Ang:</span>
                         <input id="input-angle" type="number" className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 text-green-700 dark:text-green-400 focus:outline-none focus:border-green-500" />
                      </div>
                   </div>
                   <button onClick={applyManualPose} className="w-full bg-gray-300 dark:bg-neutral-700 hover:bg-gray-400 dark:hover:bg-neutral-600 text-gray-800 dark:text-white text-[10px] font-bold py-1 rounded transition-colors">
                      APPLY TELEPORT
                   </button>
                 </div>
               </div>

            </div>
          </div>

          <div className="w-1/3 bg-gray-50 dark:bg-neutral-800 rounded-lg border border-gray-300 dark:border-neutral-700 p-2 flex flex-col justify-center gap-2 shadow-sm">
            <button onClick={runSimulationCloud} disabled={isRunning} className={`flex items-center justify-center gap-2 py-1.5 px-2 rounded font-bold text-[13px] transition-colors ${isRunning ? 'bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'}`}>
              <Play size={14} fill="currentColor" /> RUN (Cloud)
            </button>
            {offlineHexCode && (
              <button onClick={runSimulationLocal} disabled={isRunning} className={`flex items-center justify-center gap-2 py-1.5 px-2 rounded font-bold text-[13px] transition-colors ${isRunning ? 'bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`} title={`Run ${offlineHexName}`}>
                <Play size={14} fill="currentColor" /> RUN (Local)
              </button>
            )}
            <button onClick={stopSimulation} className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 text-white py-1.5 px-2 rounded font-bold text-[13px] transition-colors">
              <Square size={14} fill="currentColor" /> STOP
            </button>
            <button onClick={resetSimulation} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-1.5 px-2 rounded font-bold text-[13px] transition-colors">
              <RotateCcw size={14} /> RESET
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;