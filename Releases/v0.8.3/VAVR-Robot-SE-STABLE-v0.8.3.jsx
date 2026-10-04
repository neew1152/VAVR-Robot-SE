import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Play, Square, RotateCcw, Settings, Terminal, Download, Upload, 
  RefreshCcw, FileUp, ImagePlus, Trash2, PlusCircle, X, Box 
} from 'lucide-react';
import Matter from 'matter-js';
import { 
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config, 
  AVRUSART, usart0Config, AVRADC, adcConfig 
} from 'avr8js'; 

// ==========================================
// 1. CONSTANTS & DEFAULTS
// ==========================================
const TYPE_TAGS = {
  dc_motor: 'MOTOR', imu: 'IMU', ir_led: 'IR LED', ir_sensor: 'IR LED',
  ultrasonic: 'ULTRASONIC', grabber: 'GRABBER', buzzer: 'BUZZER'
};

const DEFAULT_COLORS = {
  chassis: '#60a5fa', dc_motor: '#1e293b', ultrasonic: '#f87171',
  ir_led: '#c084fc', ir_sensor: '#c084fc', grabber: '#22d3ee',
  buzzer: '#fbbf24', imu: '#a78bfa', arena_static: '#64748b', arena_prop: '#c084fc'
};

const generateId = () => Math.random().toString(36).substr(2, 9);

const DEFAULT_CONFIG = {
  robotX: 200, robotY: 250, robotAngle: 0, baudRate: "115200",
  robotBuild: {
    chassisW: 50, chassisH: 30, chassisColor: DEFAULT_COLORS.chassis,
    parts: [
      { id: generateId(), type: 'dc_motor', name: 'Left Motor', pin: 9, pinDir: 7, offsetX: 0, offsetY: -18, angle: 0, color: DEFAULT_COLORS.dc_motor },
      { id: generateId(), type: 'dc_motor', name: 'Right Motor', pin: 10, pinDir: 4, offsetX: 0, offsetY: 18, angle: 0, color: DEFAULT_COLORS.dc_motor }
    ]
  },
  arenaObjects: [] 
};

const defaultCode = `void setup() {\n\n}\n\nvoid loop() {\n\n}`;

const PIN_OPTIONS = [];
for(let i = 0; i <= 19; i++) {
  let label = `D${i}`;
  if (i === 0) label = "D0 (RX)";
  else if (i === 1) label = "D1 (TX)";
  else if (i >= 14) label = `A${i-14}`;
  PIN_OPTIONS.push(<option key={i} value={i}>{label}</option>);
}

const PART_OPTIONS = [
  { value: 'dc_motor', label: 'DC Motor' }, { value: 'ultrasonic', label: 'Ultrasonic' },
  { value: 'ir_led', label: 'IR LED' }, { value: 'grabber', label: 'Grabber' },
  { value: 'buzzer', label: 'Buzzer' }, { value: 'imu', label: 'IMU' }
].map(o => <option key={o.value} value={o.value}>{o.label}</option>);

// ==========================================
// 2. UTILITIES
// ==========================================
const getConfig = () => {
  try {
    const saved = localStorage.getItem('flawless-config');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {}
  return DEFAULT_CONFIG;
};

const getSavedCode = () => {
  try {
    const saved = localStorage.getItem('flawless-code-cache');
    if (saved !== null) return saved;
  } catch (e) {}
  return defaultCode;
};

const getOppositeColor = (hex) => {
  if (hex.indexOf('#') === 0) hex = hex.slice(1);
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  let r = 255 - parseInt(hex.slice(0, 2), 16);
  let g = 255 - parseInt(hex.slice(2, 4), 16);
  let b = 255 - parseInt(hex.slice(4, 6), 16);
  if (Math.abs(r - 128) < 30 && Math.abs(g - 128) < 30 && Math.abs(b - 128) < 30) {
    return r > 128 ? '#000000' : '#ffffff';
  }
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const loadHex = (source, target) => {
  for (const line of source.split('\n')) {
    if (line[0] === ':' && line.substring(7, 9) === '00') {
      const bytes = parseInt(line.substring(1, 3), 16);
      const addr = parseInt(line.substring(3, 7), 16);
      for (let i = 0; i < bytes; i++) {
        target[addr + i] = parseInt(line.substring(9 + i * 2, 11 + i * 2), 16);
      }
    }
  }
};

const getPinState = (cpu, pin) => {
  let portAddr, bit;
  if (pin >= 0 && pin <= 7) { portAddr = 0x2B; bit = pin; } 
  else if (pin >= 8 && pin <= 13) { portAddr = 0x25; bit = pin - 8; } 
  else if (pin >= 14 && pin <= 19) { portAddr = 0x28; bit = pin - 14; } 
  else return false;
  return (cpu.data[portAddr] & (1 << bit)) !== 0;
};

const getPinPWM = (cpu, pin) => {
  if (pin === 3 && (cpu.data[0xB0] & (1 << 5))) return cpu.data[0xB4]; 
  if (pin === 5 && (cpu.data[0x44] & (1 << 5))) return cpu.data[0x48]; 
  if (pin === 6 && (cpu.data[0x44] & (1 << 7))) return cpu.data[0x47]; 
  if (pin === 9 && (cpu.data[0x80] & (1 << 7))) return cpu.data[0x88]; 
  if (pin === 10 && (cpu.data[0x80] & (1 << 5))) return cpu.data[0x8A]; 
  if (pin === 11 && (cpu.data[0xB0] & (1 << 7))) return cpu.data[0xB3]; 
  return getPinState(cpu, pin) ? 255 : 0;
};

const setExternalPin = (cpu, pin, isHigh) => {
  let pinAddr, bit;
  if (pin >= 0 && pin <= 7) { pinAddr = 0x29; bit = pin; }  
  else if (pin >= 8 && pin <= 13) { pinAddr = 0x23; bit = pin - 8; } 
  else if (pin >= 14 && pin <= 19) { pinAddr = 0x26; bit = pin - 14; } 
  else return;
  if (isHigh) cpu.data[pinAddr] |= (1 << bit);
  else cpu.data[pinAddr] &= ~(1 << bit);
};

// ==========================================
// 3. DRAWING HELPERS
// ==========================================
const drawIRBeam = (ctx, p, state, robot, engine, oppColor, hexColor) => {
  const intensity = state ? state.intensity : 0;
  const pAngleRad = (p.angle || 0) * (Math.PI / 180);
  const spreadDeg = p.spread || 45;
  const maxRange = p.range || 80;

  if (intensity > 0) {
    const halfSpreadRad = (spreadDeg / 2) * (Math.PI / 180);
    const numRays = 9;
    const beamPoints = [];
    const allBodies = Matter.Composite.allBodies(engine.world);
    const validBodies = allBodies.filter(b => b !== robot && !robot.parts.includes(b) && !b.isSensor);
    const cosR = Math.cos(robot.angle);
    const sinR = Math.sin(robot.angle);

    for (let i = 0; i < numRays; i++) {
      const rayRelAngle = pAngleRad - halfSpreadRad + (spreadDeg * (Math.PI / 180) * (i / (numRays - 1)));
      const rayGlobalAngle = robot.angle + rayRelAngle;
      const tipGlobalX = robot.position.x + (p.offsetX * cosR) - (p.offsetY * sinR);
      const tipGlobalY = robot.position.y + (p.offsetX * sinR) + (p.offsetY * cosR);
      let hitDist = maxRange;
      for (let d = 8; d <= maxRange; d += 6) {
        const pt = { x: tipGlobalX + Math.cos(rayGlobalAngle) * d, y: tipGlobalY + Math.sin(rayGlobalAngle) * d };
        if (Matter.Query.point(validBodies, pt).length > 0) { hitDist = d; break; }
      }
      beamPoints.push({ x: p.offsetX + Math.cos(rayRelAngle) * hitDist, y: p.offsetY + Math.sin(rayRelAngle) * hitDist });
    }

    ctx.beginPath();
    ctx.moveTo(p.offsetX, p.offsetY);
    beamPoints.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.closePath();
    const grad = ctx.createRadialGradient(p.offsetX, p.offsetY, 2, p.offsetX, p.offsetY, maxRange);
    grad.addColorStop(0, `rgba(192, 132, 252, ${0.45 * intensity})`);
    grad.addColorStop(0.5, `rgba(167, 139, 250, ${0.2 * intensity})`);
    grad.addColorStop(1, `rgba(139, 92, 246, 0)`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    const haloGrad = ctx.createRadialGradient(p.offsetX, p.offsetY, 1, p.offsetX, p.offsetY, 8);
    haloGrad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * intensity})`);
    haloGrad.addColorStop(0.4, `rgba(232, 191, 255, ${0.7 * intensity})`);
    haloGrad.addColorStop(1, 'rgba(192, 132, 252, 0)');
    ctx.fillStyle = haloGrad;
    ctx.arc(p.offsetX, p.offsetY, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(p.offsetX, p.offsetY);
  ctx.rotate(pAngleRad);
  ctx.fillStyle = oppColor;
  ctx.fillRect(-3, -2.5, 2, 5);
  ctx.beginPath();
  ctx.arc(0, 0, 2.8, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-1, 2.8); ctx.lineTo(-1, -2.8); ctx.closePath();
  ctx.fillStyle = intensity > 0 ? '#f5d0fe' : hexColor;
  ctx.fill();
  ctx.restore();
};

const drawGrabber = (ctx, p, state) => {
  ctx.beginPath();
  ctx.moveTo(p.offsetX - 3, p.offsetY - 5); ctx.lineTo(p.offsetX + 4, p.offsetY - 5);
  ctx.lineTo(p.offsetX + 6, p.offsetY - 3); ctx.lineTo(p.offsetX + 6, p.offsetY + 3);
  ctx.lineTo(p.offsetX + 4, p.offsetY + 5); ctx.lineTo(p.offsetX - 3, p.offsetY + 5);
  ctx.closePath();
  ctx.fill();

  if (state && state.constraints) {
    ctx.beginPath();
    ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 2;
    const pAngleRad = (p.angle || 0) * (Math.PI / 180);
    ctx.moveTo(p.offsetX, p.offsetY);
    ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * 20, p.offsetY + Math.sin(pAngleRad) * 20);
    ctx.stroke();
  }
};

const drawBuzzer = (ctx, p, state, hexColor) => {
  ctx.beginPath();
  ctx.arc(p.offsetX, p.offsetY, 3, 0, 2 * Math.PI);
  ctx.fill();
  
  if (state && state.isHigh) {
    ctx.strokeStyle = hexColor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.offsetX, p.offsetY, 6, -Math.PI/4, Math.PI/4); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.offsetX, p.offsetY, 9, -Math.PI/4, Math.PI/4); ctx.stroke();
  }
};

const drawUltrasonic = (ctx, p, state, hexColor) => {
  const maxRange = p.range || 400;
  const hitDist = state ? state.lastDist : maxRange; 
  const pAngleRad = (p.angle || 0) * (Math.PI / 180);
  
  ctx.beginPath();
  ctx.arc(p.offsetX, p.offsetY, 2, 0, 2 * Math.PI);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = hexColor;
  ctx.globalAlpha = 0.3; 
  ctx.moveTo(p.offsetX, p.offsetY);
  ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * hitDist, p.offsetY + Math.sin(pAngleRad) * hitDist);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
};

const drawStandardPart = (ctx, p) => {
  const pAngleRad = (p.angle || 0) * (Math.PI / 180);
  ctx.beginPath();
  ctx.arc(p.offsetX, p.offsetY, 2, 0, 2 * Math.PI);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(p.offsetX, p.offsetY);
  ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * 5, p.offsetY + Math.sin(pAngleRad) * 5);
  ctx.stroke();
};

const renderRobot = (ctx, robot, buildConfig, states, engine) => {
  ctx.save();
  ctx.translate(robot.position.x, robot.position.y);
  ctx.rotate(robot.angle);

  const w2 = Math.max(10, buildConfig.chassisW) / 2;
  const h2 = Math.max(10, buildConfig.chassisH) / 2;
  const chassisColor = buildConfig.chassisColor || DEFAULT_COLORS.chassis;
  const oppChassisColor = getOppositeColor(chassisColor);

  ctx.strokeStyle = oppChassisColor;
  ctx.globalAlpha = 0.15;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -w2; x <= w2; x += 10) { ctx.moveTo(x, -h2); ctx.lineTo(x, h2); }
  for (let y = -h2; y <= h2; y += 10) { ctx.moveTo(-w2, y); ctx.lineTo(w2, y); }
  ctx.stroke();

  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(15, 0); 
  ctx.lineTo(10, -5); ctx.moveTo(15, 0); ctx.lineTo(10, 5); 
  ctx.stroke();
  ctx.globalAlpha = 1.0; 

  buildConfig.parts.forEach(p => {
    const hexColor = p.color || DEFAULT_COLORS[p.type] || '#ffffff';
    const oppColor = getOppositeColor(hexColor);
    ctx.fillStyle = oppColor;
    ctx.strokeStyle = oppColor;
    ctx.lineWidth = 1.5;

    if (p.type === 'grabber') drawGrabber(ctx, p, states.grabber[p.id]);
    else if (p.type === 'buzzer') drawBuzzer(ctx, p, states.buzzer[p.id], hexColor);
    else if (p.type === 'ir_led' || p.type === 'ir_sensor') drawIRBeam(ctx, p, states.ir[p.id], robot, engine, oppColor, hexColor);
    else if (p.type === 'ultrasonic') drawUltrasonic(ctx, p, states.ultrasonic[p.id], hexColor);
    else drawStandardPart(ctx, p);
  });

  ctx.restore();
};

// ==========================================
// 4. SIMULATION LOGIC HELPERS
// ==========================================
const processMotor = (cpu, part, robot, pinUis) => {
  const pwmVal = getPinPWM(cpu, part.pin);
  let power = pwmVal / 255.0;
  if (part.pinDir !== undefined && getPinState(cpu, part.pinDir)) power = -power;

  const isRunning = Math.abs(power) > 0;
  const uiEl = pinUis[part.id];
  if (uiEl) {
    if (power > 0) uiEl.className = "transition-colors duration-75 text-emerald-600 dark:text-emerald-400";
    else if (power < 0) uiEl.className = "transition-colors duration-75 text-rose-500 dark:text-rose-400";
    else uiEl.className = "transition-colors duration-75 text-stone-400 dark:text-stone-500";
    uiEl.style.opacity = isRunning ? (0.4 + (Math.abs(power) * 0.6)) : 1;
  }

  if (isRunning) {
    const pAngleRad = (part.angle || 0) * (Math.PI / 180);
    const forceX = Math.cos(pAngleRad) * 1 * power; 
    const forceY = Math.sin(pAngleRad) * 1 * power;
    const torque = (part.offsetX * forceY) - (part.offsetY * forceX);
    return [forceX, forceY, torque * 0.0032];
  }
  return [0, 0, 0];
};

const processBuzzer = (cpu, part, audioCtxRef, oscillators, pinUis) => {
  const isHigh = getPinState(cpu, part.pin);
  const state = oscillators[part.id] || { isHigh: false, osc: null, gain: null };

  if (isHigh && !state.isHigh && audioCtxRef.current) {
    const osc = audioCtxRef.current.createOscillator();
    const gain = audioCtxRef.current.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, audioCtxRef.current.currentTime);
    gain.gain.setValueAtTime(0.05, audioCtxRef.current.currentTime);
    osc.connect(gain); gain.connect(audioCtxRef.current.destination);
    osc.start();
    state.osc = osc; state.gain = gain;
  } else if (!isHigh && state.isHigh && state.osc) {
    try { state.osc.stop(); } catch(e){}
    state.osc.disconnect(); state.gain.disconnect();
    state.osc = null; state.gain = null;
  }
  state.isHigh = isHigh;
  oscillators[part.id] = state;

  const uiEl = pinUis[part.id];
  if (uiEl) uiEl.className = isHigh ? "transition-colors duration-75 text-amber-600 dark:text-amber-400" : "transition-colors duration-75 text-stone-400 dark:text-stone-500";
};

const processIR = (cpu, part, irStates, pinUis) => {
  const pwmVal = getPinPWM(cpu, part.pin);
  const isHigh = pwmVal > 0 || getPinState(cpu, part.pin);
  const intensity = pwmVal > 0 ? (pwmVal / 255.0) : (isHigh ? 1 : 0);
  irStates[part.id] = { intensity, isHigh: intensity > 0 };

  const uiEl = pinUis[part.id];
  if (uiEl) {
    if (intensity > 0) {
      uiEl.className = "transition-colors duration-75 text-purple-500 dark:text-purple-400";
      uiEl.style.opacity = (0.35 + (intensity * 0.65)).toString();
    } else {
      uiEl.className = "transition-colors duration-75 text-stone-400 dark:text-stone-500";
      uiEl.style.opacity = "1";
    }
  }
};

const processIMU = (cpu, part, robot, adc, pinUis) => {
  const pAngleRad = robot.angle + (part.angle || 0) * (Math.PI / 180);
  let deg = ((pAngleRad * 180 / Math.PI) % 360 + 360) % 360; 
  const isAnalogPin = part.pin >= 14 && part.pin <= 19;
  if (isAnalogPin) {
    adc.channelValues[part.pin - 14] = (deg / 360) * 5; 
    const uiEl = pinUis[part.id];
    if (uiEl) uiEl.className = "transition-colors duration-75 text-violet-600 dark:text-violet-400";
  }
};

const processUltrasonicUI = (cpu, part, ultrasonicStates, pinUis) => {
  const state = ultrasonicStates[part.id];
  const isEchoing = state && cpu.cycles >= state.echoStart && cpu.cycles <= state.echoEnd;
  const uiEl = pinUis[part.id];
  if (uiEl) uiEl.className = isEchoing ? "transition-colors duration-75 text-rose-500 dark:text-rose-400" : "transition-colors duration-75 text-stone-400 dark:text-stone-500";
};

const processGrabber = (cpu, part, robot, engine, grabberStates, pinUis) => {
  const isHigh = getPinState(cpu, part.pin);
  const state = grabberStates[part.id] || { isHigh: false, constraints: null, target: null, originalMass: 1, originalGroup: 0 };
  const robCos = Math.cos(robot.angle);
  const robSin = Math.sin(robot.angle);

  if (isHigh && !state.isHigh) {
    const reach = 20; 
    const tipLocalX = part.offsetX + Math.cos((part.angle || 0) * Math.PI / 180) * reach;
    const tipLocalY = part.offsetY + Math.sin((part.angle || 0) * Math.PI / 180) * reach;
    const tipGlobalX = robot.position.x + (tipLocalX * robCos) - (tipLocalY * robSin);
    const tipGlobalY = robot.position.y + (tipLocalX * robSin) + (tipLocalY * robCos);

    const bounds = { min: { x: tipGlobalX - 10, y: tipGlobalY - 10 }, max: { x: tipGlobalX + 10, y: tipGlobalY + 10 } };
    const validBodies = Matter.Composite.allBodies(engine.world).filter(b => b.plugin && b.plugin.isPickable && !b.isStatic);
    const hits = Matter.Query.region(validBodies, bounds);
    
    if (hits.length > 0) {
      const target = hits[0];
      state.target = target;
      state.originalMass = target.mass;
      state.originalGroup = target.collisionFilter.group;
      Matter.Body.setMass(target, 0.0001); 
      target.collisionFilter.group = -1;

      const c1 = Matter.Constraint.create({
        bodyA: robot, bodyB: target,
        pointA: { x: tipLocalX, y: tipLocalY }, pointB: { x: 0, y: 0 },
        stiffness: 1, length: 0, render: { visible: false }
      });
      
      const baseLocalX = part.offsetX;
      const baseLocalY = part.offsetY;
      const baseGlobalX = robot.position.x + (baseLocalX * robCos) - (baseLocalY * robSin);
      const baseGlobalY = robot.position.y + (baseLocalX * robSin) + (baseLocalY * robCos);
      const dx = baseGlobalX - tipGlobalX;
      const dy = baseGlobalY - tipGlobalY;
      const tarCos = Math.cos(-target.angle);
      const tarSin = Math.sin(-target.angle);
      const targetLocalBaseX = dx * tarCos - dy * tarSin;
      const targetLocalBaseY = dx * tarSin + dy * tarCos;

      const c2 = Matter.Constraint.create({
        bodyA: robot, bodyB: target,
        pointA: { x: baseLocalX, y: baseLocalY }, pointB: { x: targetLocalBaseX, y: targetLocalBaseY },
        stiffness: 1, length: 0, render: { visible: false }
      });

      Matter.World.add(engine.world, [c1, c2]);
      state.constraints = [c1, c2];
    }
  } else if (!isHigh && state.isHigh && state.constraints) {
    Matter.World.remove(engine.world, state.constraints);
    if (state.target) {
      Matter.Body.setMass(state.target, state.originalMass);
      state.target.collisionFilter.group = state.originalGroup || 0;
    }
    state.constraints = null; state.target = null;
  }

  state.isHigh = isHigh;
  grabberStates[part.id] = state;

  const uiEl = pinUis[part.id];
  if (uiEl) {
    if (state.constraints) uiEl.className = "transition-colors duration-75 text-violet-600 dark:text-violet-400";
    else if (isHigh) uiEl.className = "transition-colors duration-75 text-yellow-600 dark:text-yellow-400";
    else uiEl.className = "transition-colors duration-75 text-stone-400 dark:text-stone-500";
  }
};

// ==========================================
// 5. MINIMAL UI COMPONENTS
// ==========================================
const Resizer = ({ direction, onMouseDown }) => {
  const isVertical = direction === 'vertical';
  return (
    <div 
      onMouseDown={onMouseDown} 
      className={`flex items-center justify-center shrink-0 group relative z-10 ${
        isVertical ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize'
      }`}
    >
      <div className={`bg-stone-200 dark:bg-stone-700 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 transition-colors ${
        isVertical ? 'w-px h-full' : 'h-px w-full'
      }`} />
    </div>
  );
};

const EditorPanel = ({ code, setCode, editorTheme, isRunning, runSimulationOffline }) => (
  <div className="flex flex-col h-full bg-stone-50 dark:bg-stone-950">
    <div className="h-9 flex items-center justify-between px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide">
      <span>Editor</span>
      <label className="flex items-center gap-2 cursor-pointer hover:text-stone-900 dark:hover:text-stone-100 normal-case tracking-normal font-normal">
        <FileUp size={14}/> Load .hex
        <input type="file" accept=".hex" className="hidden" disabled={isRunning} onChange={runSimulationOffline} />
      </label>
    </div>
    <div className="flex-1">
      <Editor height="100%" defaultLanguage="cpp" theme={editorTheme} value={code} onChange={setCode} options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', renderLineHighlight: 'none' }} />
    </div>
  </div>
);

const ConsolePanel = ({ sysLogs, sysLogEndRef, serialConsoleRef }) => (
  <div className="flex h-full">
    <div className="w-1/2 flex flex-col border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
      <div className="h-9 flex items-center px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide">System</div>
      <div className="flex-1 p-3 font-mono text-xs text-stone-700 dark:text-stone-300 overflow-y-auto custom-scrollbar">
        {sysLogs.map((log, i) => <div key={i}>{log}</div>)}
        <div ref={sysLogEndRef} />
      </div>
    </div>
    <div className="w-1/2 flex flex-col bg-stone-50 dark:bg-stone-950">
      <div className="h-9 flex items-center justify-between px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide">
        <span>Serial</span>
        <span className="text-xs text-stone-500 dark:text-stone-400 normal-case tracking-normal font-normal">115200</span>
      </div>
      <div ref={serialConsoleRef} className="flex-1 p-3 font-mono text-xs text-emerald-700 dark:text-emerald-400 overflow-y-auto whitespace-pre-wrap custom-scrollbar"></div>
    </div>
  </div>
);

const SimulationField = ({ mapImage, handleMapUpload, clearMap, sceneRef }) => (
  <div className="flex flex-col h-full bg-stone-100 dark:bg-stone-900">
    <div className="h-9 flex items-center justify-between px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide bg-stone-50 dark:bg-stone-950">
      <span>Simulation</span>
      <div className="flex gap-4 normal-case tracking-normal font-normal">
        {mapImage && <button onClick={clearMap} className="hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-1.5 transition-colors"><Trash2 size={13}/> Clear</button>}
        <label className="flex items-center gap-2 cursor-pointer hover:text-stone-900 dark:hover:text-stone-100 transition-colors">
          <ImagePlus size={14}/> Map
          <input type="file" accept="image/*" className="hidden" onChange={handleMapUpload} />
        </label>
      </div>
    </div>
    <div 
      className="flex-1 relative"
      style={{
        backgroundImage: mapImage ? `url(${mapImage})` : 'radial-gradient(circle, #d6d3d1 1px, transparent 1px)',
        backgroundSize: mapImage ? 'auto' : '24px 24px',
        backgroundPosition: 'center',
        backgroundRepeat: mapImage ? 'no-repeat' : 'repeat'
      }}
    >
      <div ref={sceneRef} className="absolute inset-0"></div>
    </div>
  </div>
);

const RobotConfig = ({ robotBuild, updateChassis, updatePart, removePart, newPartType, setNewPartType, addPart, uiRefs }) => (
  <div className="space-y-5 text-sm">
    <div className="flex items-center justify-between">
      <span className="font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide text-xs">Chassis</span>
      <div className="flex items-center gap-3">
        <input type="color" value={robotBuild.chassisColor || DEFAULT_COLORS.chassis} onChange={(e) => updateChassis('chassisColor', e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent border border-stone-300 dark:border-stone-700" />
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">W</span>
          <input type="number" min="10" value={robotBuild.chassisW} onChange={(e) => updateChassis('chassisW', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">H</span>
          <input type="number" min="10" value={robotBuild.chassisH} onChange={(e) => updateChassis('chassisH', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors" />
        </div>
      </div>
    </div>

    <div className="flex items-center justify-between">
      <span className="font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide text-xs">Components</span>
      <div className="flex items-center gap-3">
        <select value={newPartType} onChange={(e) => setNewPartType(e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-sm">
          {PART_OPTIONS}
        </select>
        <button onClick={() => addPart(newPartType)} className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors">+ Add</button>
      </div>
    </div>

    <div className="space-y-3">
      {robotBuild.parts.map(part => (
        <div key={part.id} className="p-3 border border-stone-200 dark:border-stone-800 rounded-lg space-y-3 relative group hover:border-stone-300 dark:hover:border-stone-700 transition-colors">
          <button onClick={() => removePart(part.id)} className="absolute top-2 right-2 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
            <X size={14}/>
          </button>
          <div className="flex items-center gap-2.5 pr-5">
            <span ref={el => uiRefs.current.pins[part.id] = el} className="text-stone-400 dark:text-stone-500">●</span>
            <span className="text-xs bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-semibold px-2 py-1 rounded uppercase">
              {TYPE_TAGS[part.type]}
            </span>
            <input type="text" value={part.name} onChange={(e) => updatePart(part.id, 'name', e.target.value)} className="bg-transparent font-medium w-full outline-none border-b border-transparent hover:border-stone-300 dark:hover:border-stone-600 focus:border-blue-500 dark:focus:border-blue-400 truncate transition-colors" />
            <input type="color" value={part.color || DEFAULT_COLORS[part.type]} onChange={(e) => updatePart(part.id, 'color', e.target.value)} className="w-6 h-6 rounded cursor-pointer bg-transparent border border-stone-300 dark:border-stone-700" />
          </div>
          
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-600 dark:text-stone-400">
            {part.type === 'dc_motor' && (
              <>
                <div className="flex items-center gap-1.5"><span>PWM</span><select value={part.pin} onChange={(e) => updatePart(part.id, 'pin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center">{PIN_OPTIONS}</select></div>
                <div className="flex items-center gap-1.5"><span>DIR</span><select value={part.pinDir !== undefined ? part.pinDir : 7} onChange={(e) => updatePart(part.id, 'pinDir', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center">{PIN_OPTIONS}</select></div>
              </>
            )}
            {(part.type === 'ir_led' || part.type === 'ir_sensor') && (
              <>
                <div className="flex items-center gap-1.5"><span>Pin</span><select value={part.pin} onChange={(e) => updatePart(part.id, 'pin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center">{PIN_OPTIONS}</select></div>
                <div className="flex items-center gap-1.5"><span>Rng</span><input type="number" value={part.range || 80} onChange={(e) => updatePart(part.id, 'range', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center" /></div>
                <div className="flex items-center gap-1.5"><span>Spr</span><input type="number" value={part.spread || 45} onChange={(e) => updatePart(part.id, 'spread', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center" /></div>
              </>
            )}
            {(part.type === 'grabber' || part.type === 'buzzer') && (
              <div className="flex items-center gap-1.5"><span>Pin</span><select value={part.pin} onChange={(e) => updatePart(part.id, 'pin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center">{PIN_OPTIONS}</select></div>
            )}
            {part.type === 'ultrasonic' && (
              <>
                <div className="flex items-center gap-1.5"><span>Trig</span><select value={part.pinTrig} onChange={(e) => updatePart(part.id, 'pinTrig', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center">{PIN_OPTIONS}</select></div>
                <div className="flex items-center gap-1.5"><span>Echo</span><select value={part.pinEcho} onChange={(e) => updatePart(part.id, 'pinEcho', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center">{PIN_OPTIONS}</select></div>
                <div className="flex items-center gap-1.5"><span>Rng</span><input type="number" value={part.range || 400} onChange={(e) => updatePart(part.id, 'range', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center" /></div>
              </>
            )}
          </div>

          <div className="flex gap-4 text-xs text-stone-600 dark:text-stone-400">
            <div className="flex items-center gap-1.5"><span>X</span><input type="number" value={part.offsetX} onChange={(e) => updatePart(part.id, 'offsetX', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
            <div className="flex items-center gap-1.5"><span>Y</span><input type="number" value={part.offsetY} onChange={(e) => updatePart(part.id, 'offsetY', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
            <div className="flex items-center gap-1.5"><span>°</span><input type="number" value={part.angle || 0} onChange={(e) => updatePart(part.id, 'angle', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
          </div>
        </div>
      ))}
      {robotBuild.parts.length === 0 && <div className="text-center text-stone-500 dark:text-stone-400 italic py-5 border border-dashed border-stone-300 dark:border-stone-700 rounded-lg">No components</div>}
    </div>
  </div>
);

const ArenaConfig = ({ arenaObjects, addArenaObject, removeArenaObject, updateArenaObject, uiRefs }) => (
  <div className="space-y-5 text-sm">
    <div className="flex items-center justify-between">
      <span className="font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide text-xs">Objects</span>
      <button onClick={addArenaObject} className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium flex items-center gap-2 transition-colors"><Box size={14}/> Add</button>
    </div>

    <div className="space-y-3">
      {arenaObjects.map(obj => (
        <div key={obj.id} className="p-3 border border-stone-200 dark:border-stone-800 rounded-lg space-y-3 relative group hover:border-stone-300 dark:hover:border-stone-700 transition-colors">
          <button onClick={() => removeArenaObject(obj.id)} className="absolute top-2 right-2 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
            <X size={14}/>
          </button>
          <div className="flex items-center gap-2.5 pr-5">
            <span className={`text-xs font-semibold px-2 py-1 rounded uppercase ${obj.isStatic ? 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'}`}>
              {obj.isStatic ? 'FIXED' : 'PROP'}
            </span>
            <input type="text" value={obj.name} onChange={(e) => updateArenaObject(obj.id, 'name', e.target.value)} className="bg-transparent font-medium w-full outline-none border-b border-transparent hover:border-stone-300 dark:hover:border-stone-600 focus:border-purple-500 dark:focus:border-purple-400 truncate transition-colors" />
            <input type="color" value={obj.color || (obj.isStatic ? DEFAULT_COLORS.arena_static : DEFAULT_COLORS.arena_prop)} onChange={(e) => updateArenaObject(obj.id, 'color', e.target.value)} className="w-6 h-6 rounded cursor-pointer bg-transparent border border-stone-300 dark:border-stone-700" />
          </div>

          <div className="flex gap-4 text-xs text-stone-600 dark:text-stone-400">
            <div className="flex items-center gap-1.5"><span>W</span><input type="number" min="5" value={obj.w} onChange={(e) => updateArenaObject(obj.id, 'w', e.target.value)} className="w-12 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
            <div className="flex items-center gap-1.5"><span>H</span><input type="number" min="5" value={obj.h} onChange={(e) => updateArenaObject(obj.id, 'h', e.target.value)} className="w-12 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={obj.isStatic} onChange={(e) => updateArenaObject(obj.id, 'isStatic', e.target.checked)} className="cursor-pointer" /> Fixed</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" disabled={obj.isStatic} checked={!obj.isStatic && obj.isPickable} onChange={(e) => updateArenaObject(obj.id, 'isPickable', e.target.checked)} className="cursor-pointer" /> Pick</label>
          </div>
          
          <div className="flex gap-4 text-xs text-stone-600 dark:text-stone-400">
            <div className="flex items-center gap-1.5"><span>X</span><input ref={el => uiRefs.current.arena[`x-${obj.id}`] = el} type="number" value={Math.round(obj.x)} onChange={(e) => updateArenaObject(obj.id, 'x', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
            <div className="flex items-center gap-1.5"><span>Y</span><input ref={el => uiRefs.current.arena[`y-${obj.id}`] = el} type="number" value={Math.round(obj.y)} onChange={(e) => updateArenaObject(obj.id, 'y', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
            <div className="flex items-center gap-1.5"><span>°</span><input ref={el => uiRefs.current.arena[`ang-${obj.id}`] = el} type="number" value={obj.angle || 0} onChange={(e) => updateArenaObject(obj.id, 'angle', e.target.value)} className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center" /></div>
          </div>
        </div>
      ))}
      {arenaObjects.length === 0 && <div className="text-center text-stone-500 dark:text-stone-400 italic py-5 border border-dashed border-stone-300 dark:border-stone-700 rounded-lg">No objects</div>}
    </div>
  </div>
);

const TelemetryPanel = ({ applyManualPose, uiRefs }) => (
  <div className="space-y-5 text-sm">
    <div className="grid grid-cols-2 gap-5 text-stone-600 dark:text-stone-400 font-mono">
      <div className="flex justify-between"><span>PORTB:</span> <span ref={el => uiRefs.current.hud.portb = el} className="text-stone-900 dark:text-stone-100">00000000</span></div>
      <div className="flex justify-between"><span>X:</span> <span ref={el => uiRefs.current.hud.x = el} className="text-stone-900 dark:text-stone-100">0</span></div>
      <div className="flex justify-between"><span>Y:</span> <span ref={el => uiRefs.current.hud.y = el} className="text-stone-900 dark:text-stone-100">0</span></div>
      <div className="flex justify-between"><span>ANGLE:</span> <span className="text-stone-900 dark:text-stone-100"><span ref={el => uiRefs.current.hud.angle = el}>0.00</span>°</span></div>
    </div>
    
    <div className="pt-5 border-t border-stone-200 dark:border-stone-800">
      <p className="text-xs font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide mb-3">Manual Pose</p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">X</span>
          <input ref={el => uiRefs.current.inputs.x = el} type="number" className="w-full bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">Y</span>
          <input ref={el => uiRefs.current.inputs.y = el} type="number" className="w-full bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">°</span>
          <input ref={el => uiRefs.current.inputs.angle = el} type="number" className="w-full bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors" />
        </div>
      </div>
      <button onClick={applyManualPose} className="w-full py-2 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 rounded-lg text-sm font-medium transition-colors">
        Teleport
      </button>
    </div>
  </div>
);

const ConfigPanel = ({ 
  activeTab, setActiveTab, robotBuild, updateChassis, updatePart, removePart, newPartType, setNewPartType, addPart, 
  arenaObjects, addArenaObject, removeArenaObject, updateArenaObject, applyManualPose, uiRefs 
}) => (
  <div className="flex flex-col h-full bg-stone-50 dark:bg-stone-950">
    <div className="h-10 flex items-center px-3 border-b border-stone-200 dark:border-stone-800 gap-2">
      <button onClick={() => setActiveTab('robot')} className={`px-3 py-1.5 text-xs font-semibold rounded-md uppercase tracking-wide transition-colors ${activeTab === 'robot' ? 'bg-stone-200 dark:bg-stone-800 text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}>Robot</button>
      <button onClick={() => setActiveTab('arena')} className={`px-3 py-1.5 text-xs font-semibold rounded-md uppercase tracking-wide transition-colors ${activeTab === 'arena' ? 'bg-stone-200 dark:bg-stone-800 text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}>Arena</button>
      <button onClick={() => setActiveTab('pose')} className={`px-3 py-1.5 text-xs font-semibold rounded-md uppercase tracking-wide transition-colors ${activeTab === 'pose' ? 'bg-stone-200 dark:bg-stone-800 text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}>Pose</button>
    </div>
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      {activeTab === 'robot' && <RobotConfig robotBuild={robotBuild} updateChassis={updateChassis} updatePart={updatePart} removePart={removePart} newPartType={newPartType} setNewPartType={setNewPartType} addPart={addPart} uiRefs={uiRefs} />}
      {activeTab === 'arena' && <ArenaConfig arenaObjects={arenaObjects} addArenaObject={addArenaObject} removeArenaObject={removeArenaObject} updateArenaObject={updateArenaObject} uiRefs={uiRefs} />}
      {activeTab === 'pose' && <TelemetryPanel applyManualPose={applyManualPose} uiRefs={uiRefs} />}
    </div>
  </div>
);

// ==========================================
// 6. MAIN APP COMPONENT
// ==========================================
function App() {
  const initConfig = getConfig();
  
  const [code, setCode] = useState(getSavedCode);
  const [sysLogs, setSysLogs] = useState(['> System Ready. Sandbox Environment Loaded.']);
  const baudRate = "115200";
  
  const [offlineHexCode, setOfflineHexCode] = useState(null);
  const [offlineHexName, setOfflineHexName] = useState("");

  const [editorTheme, setEditorTheme] = useState('vs-dark');
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

  const [robotBuild, setRobotBuild] = useState(initConfig.robotBuild || DEFAULT_CONFIG.robotBuild);
  const [arenaObjects, setArenaObjects] = useState(initConfig.arenaObjects || DEFAULT_CONFIG.arenaObjects);
  const [activeTab, setActiveTab] = useState('robot'); 
  const [newPartType, setNewPartType] = useState('dc_motor'); 
  
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false); 
  const baudRateRef = useRef(baudRate); 
  const buildRef = useRef(robotBuild); 
  const arenaObjectsRef = useRef(arenaObjects); 

  const [leftWidth, setLeftWidth] = useState(50);
  const [editorHeight, setEditorHeight] = useState(65);
  const [canvasHeight, setCanvasHeight] = useState(65);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState(null);

  const mainContainerRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);

  const setSimState = (state) => { setIsRunning(state); isRunningRef.current = state; };
  
  const [mapImage, setMapImage] = useState(() => {
    try { return localStorage.getItem('flawless-map-cache') || null; } 
    catch (e) { return null; }
  });
  
  const mapImageRef = useRef(null);
  const requestRef = useRef(null);
  const sysLogEndRef = useRef(null);
  const serialConsoleRef = useRef(null);
  
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const robotRef = useRef(null);
  const arenaBodiesRef = useRef([]); 
  const mouseConstraintRef = useRef(null); 
  
  const ultrasonicStatesRef = useRef({}); 
  const grabberStatesRef = useRef({}); 
  const irLedStatesRef = useRef({}); 

  const audioCtxRef = useRef(null);
  const activeOscillatorsRef = useRef({});

  const offscreenCanvasRef = useRef(document.createElement('canvas'));
  const offscreenCtxRef = useRef(offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true }));
  const mapPixelDataRef = useRef(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const updatePixelMapRef = useRef(null);

  const uiRefs = useRef({
    hud: { portb: null, x: null, y: null, angle: null },
    inputs: { x: null, y: null, angle: null },
    pins: {},
    arena: {}
  });

  const handleDrag = (e, setter, direction, containerRef) => {
    e.preventDefault();
    setIsDragging(true);
    setDragDirection(direction);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    
    const onMouseMove = (ev) => {
      let percent;
      if (direction === 'vertical') {
        percent = ((ev.clientX - rect.left) / rect.width) * 100;
      } else {
        percent = ((ev.clientY - rect.top) / rect.height) * 100;
      }
      setter(Math.max(15, Math.min(85, percent)));
    };
    
    const onMouseUp = () => {
      setIsDragging(false);
      setDragDirection(null);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  updatePixelMapRef.current = () => {
    const { w, h } = canvasSizeRef.current;
    if (w === 0 || h === 0) return;
    const canvas = offscreenCanvasRef.current;
    const ctx = offscreenCtxRef.current;
    canvas.width = w; canvas.height = h;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    if (mapImageRef.current) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, (w - img.width) / 2, (h - img.height) / 2);
        mapPixelDataRef.current = ctx.getImageData(0, 0, w, h);
      };
      img.src = mapImageRef.current;
    } else {
      mapPixelDataRef.current = ctx.getImageData(0, 0, w, h);
    }
  };

  useEffect(() => { 
    mapImageRef.current = mapImage; 
    if(updatePixelMapRef.current) updatePixelMapRef.current(); 
  },[mapImage]);

  useEffect(() => { baudRateRef.current = baudRate; },[baudRate]);
  useEffect(() => { buildRef.current = robotBuild; },[robotBuild]);
  useEffect(() => { arenaObjectsRef.current = arenaObjects; },[arenaObjects]);

  useEffect(() => {
    const current = getConfig();
    const nextConfig = { ...current, baudRate, robotBuild, arenaObjects };
    localStorage.setItem('flawless-config', JSON.stringify(nextConfig));
  },[baudRate, robotBuild, arenaObjects]);

  useEffect(() => {
    try { localStorage.setItem('flawless-code-cache', code); } catch (err) { }
  }, [code]);

  useEffect(() => { sysLogEndRef.current?.scrollIntoView({ behavior: "smooth" }); },[sysLogs]);

  const handleMapUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => { 
      const base64Str = event.target.result;
      setMapImage(base64Str); 
      try {
        localStorage.setItem('flawless-map-cache', base64Str);
        setSysLogs(prev =>[...prev, `> MAP LOADED & CACHED: ${file.name}`]);
      } catch (err) {
        setSysLogs(prev =>[...prev, `> MAP LOADED: ${file.name}`, `> WARNING: Map file is too large to cache.`]);
      }
    };
    reader.readAsDataURL(file); 
    e.target.value = null; 
  };
  
  const clearMap = () => { 
    setMapImage(null); 
    localStorage.removeItem('flawless-map-cache');
    setSysLogs(prev =>[...prev, `> MAP CLEARED.`]); 
  };

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
        if (parsed.robotBuild) setRobotBuild(parsed.robotBuild);
        if (parsed.arenaObjects) setArenaObjects(parsed.arenaObjects);
        
        if (robotRef.current && parsed.robotX !== undefined) {
          Matter.Body.setPosition(robotRef.current, { x: parsed.robotX, y: parsed.robotY });
          Matter.Body.setAngle(robotRef.current, parsed.robotAngle);
        }
        localStorage.setItem('flawless-config', JSON.stringify({ ...parsed, baudRate: "115200" }));
        setSysLogs(prev =>[...prev, '> FILE IMPORTED: Sandbox Environment reconstructed!']);
        e.target.value = null;
      } catch (err) { setSysLogs(prev =>[...prev, '> ERROR: Invalid Configuration File!']); }
    };
    reader.readAsText(file);
  };

  const restoreDefaults = () => {
    localStorage.removeItem('flawless-code-cache');
    
    let baseBuild = { 
      chassisW: DEFAULT_CONFIG.robotBuild.chassisW, chassisH: DEFAULT_CONFIG.robotBuild.chassisH,
      chassisColor: DEFAULT_CONFIG.robotBuild.chassisColor,
      parts: DEFAULT_CONFIG.robotBuild.parts.map(p => ({ ...p, id: generateId() }))
    };

    setNewPartType('dc_motor'); setRobotBuild(baseBuild);
    setArenaObjects(DEFAULT_CONFIG.arenaObjects); setCode(defaultCode);
    
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: DEFAULT_CONFIG.robotX, y: DEFAULT_CONFIG.robotY });
      Matter.Body.setAngle(robotRef.current, DEFAULT_CONFIG.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }

    const newConfig = { ...DEFAULT_CONFIG, robotBuild: baseBuild, baudRate: "115200" };
    localStorage.setItem('flawless-config', JSON.stringify(newConfig));
    setSysLogs(prev =>[...prev, '> CACHE CLEARED: Reverted to Factory Defaults.']);
  };

  const rebuildRobotPhysics = (buildConfig, initialX = 200, initialY = 200, initialAngle = 0) => {
    if (!engineRef.current) return;
    if (robotRef.current) Matter.World.remove(engineRef.current.world, robotRef.current);

    const x = robotRef.current ? robotRef.current.position.x : initialX;
    const y = robotRef.current ? robotRef.current.position.y : initialY;
    const angle = robotRef.current ? robotRef.current.angle : initialAngle;

    const w = Math.max(10, buildConfig.chassisW || 50);
    const h = Math.max(10, buildConfig.chassisH || 30);
    const ROBOT_GROUP = -1; 
    const chassisColor = buildConfig.chassisColor || DEFAULT_COLORS.chassis;
    
    const chassis = Matter.Bodies.rectangle(x, y, w, h, { 
      render: { fillStyle: chassisColor }, collisionFilter: { group: ROBOT_GROUP }
    });
    
    const partsArray = [chassis];
    buildConfig.parts.forEach(p => {
      const pAngleRad = (p.angle || 0) * (Math.PI / 180);
      const pColor = p.color || DEFAULT_COLORS[p.type] || '#ffffff';
      let pW = 6, pH = 6;
      if (p.type === 'dc_motor') { pW = 14; pH = 6; }
      else if (p.type === 'ultrasonic') { pW = 6; pH = 12; }
      else if (p.type === 'ir_led' || p.type === 'ir_sensor') { pW = 6; pH = 6; }
      else if (p.type === 'grabber') { pW = 10; pH = 8; }
      else if (p.type === 'buzzer' || p.type === 'imu') { pW = 6; pH = 6; } 
      
      partsArray.push(Matter.Bodies.rectangle(x + p.offsetX, y + p.offsetY, pW, pH, { 
        angle: pAngleRad, render: { fillStyle: pColor }, collisionFilter: { group: ROBOT_GROUP }
      }));
    });

    const robot = Matter.Body.create({
      parts: partsArray, frictionAir: 0.1, inertia: Infinity, collisionFilter: { group: ROBOT_GROUP }
    });

    Matter.Body.setPosition(robot, { x, y });
    Matter.Body.setAngle(robot, angle);
    robotRef.current = robot;
    Matter.World.add(engineRef.current.world, robot);
  };

  const rebuildArenaPhysics = (objects) => {
    if (!engineRef.current) return;
    if (arenaBodiesRef.current.length > 0) Matter.World.remove(engineRef.current.world, arenaBodiesRef.current);

    const newBodies = objects.map(obj => {
      const w = Math.max(5, obj.w || 20);
      const h = Math.max(5, obj.h || 20);
      const objColor = obj.color || (obj.isStatic ? DEFAULT_COLORS.arena_static : DEFAULT_COLORS.arena_prop);
      return Matter.Bodies.rectangle(obj.x, obj.y, w, h, {
        isStatic: obj.isStatic, angle: (obj.angle || 0) * (Math.PI / 180),
        friction: 0.5, restitution: 0.2, render: { fillStyle: objColor },
        plugin: { id: obj.id, isPickable: !!obj.isPickable } 
      });
    });

    arenaBodiesRef.current = newBodies;
    Matter.World.add(engineRef.current.world, newBodies);
  };

  useEffect(() => { if (engineRef.current) rebuildRobotPhysics(robotBuild); },[robotBuild]);
  useEffect(() => {
    if (engineRef.current) {
      const hasGrab = Object.values(grabberStatesRef.current).some(s => s.constraints);
      if (hasGrab) stopSimulation();
      rebuildArenaPhysics(arenaObjects);
    }
  },[arenaObjects]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const oldCanvases = sceneRef.current.querySelectorAll('canvas');
    oldCanvases.forEach(c => c.remove());

    const engine = Matter.Engine.create({ positionIterations: 16, velocityIterations: 16 });
    engine.world.gravity.y = 0; 
    engineRef.current = engine;

    const render = Matter.Render.create({
      element: sceneRef.current, engine: engine,
      options: { width: sceneRef.current.clientWidth, height: sceneRef.current.clientHeight, wireframes: false, background: 'transparent' }
    });

    const initConf = getConfig();
    let walls = [
      Matter.Bodies.rectangle(render.options.width / 2, 0, render.options.width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
      Matter.Bodies.rectangle(render.options.width / 2, render.options.height, render.options.width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
      Matter.Bodies.rectangle(0, render.options.height / 2, 20, render.options.height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
      Matter.Bodies.rectangle(render.options.width, render.options.height / 2, 20, render.options.height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } })
    ];

    const mouse = Matter.Mouse.create(render.canvas);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse: mouse, constraint: { stiffness: 0.2, render: { visible: false } }
    });
    mouseConstraintRef.current = mouseConstraint;
    render.mouse = mouse;

    Matter.World.add(engine.world, [mouseConstraint, ...walls]);
    rebuildRobotPhysics(initConf.robotBuild, initConf.robotX, initConf.robotY, initConf.robotAngle);
    rebuildArenaPhysics(initConf.arenaObjects);

    Matter.Events.on(mouseConstraint, 'enddrag', () => {
      if (robotRef.current && mouseConstraint.body === robotRef.current) {
        const r = robotRef.current;
        const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360; 
        if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(r.position.x);
        if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(r.position.y);
        if (uiRefs.current.inputs.angle) uiRefs.current.inputs.angle.value = normalizedDeg.toFixed(2);

        const current = getConfig();
        localStorage.setItem('flawless-config', JSON.stringify({ ...current, robotX: r.position.x, robotY: r.position.y, robotAngle: r.angle }));
      }

      const draggedBodyIndex = arenaBodiesRef.current.indexOf(mouseConstraint.body);
      if (draggedBodyIndex !== -1) {
        setArenaObjects(prev => {
          const next = [...prev];
          const body = arenaBodiesRef.current[draggedBodyIndex];
          next[draggedBodyIndex] = { ...next[draggedBodyIndex], x: body.position.x, y: body.position.y, angle: body.angle * (180 / Math.PI) };
          return next;
        });
      }
    });

    Matter.Events.on(engine, 'afterUpdate', () => {
      if (robotRef.current) {
        const r = robotRef.current;
        const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360; 
        if (uiRefs.current.hud.x) uiRefs.current.hud.x.innerText = Math.round(r.position.x);
        if (uiRefs.current.hud.y) uiRefs.current.hud.y.innerText = Math.round(r.position.y);
        if (uiRefs.current.hud.angle) uiRefs.current.hud.angle.innerText = normalizedDeg.toFixed(2);
      }

      arenaBodiesRef.current.forEach((body, i) => {
        const obj = arenaObjectsRef.current[i];
        if (!obj) return;
        const deg = (((body.angle * (180 / Math.PI)) % 360) + 360) % 360;
        const elX = uiRefs.current.arena[`x-${obj.id}`];
        const elY = uiRefs.current.arena[`y-${obj.id}`];
        const elAng = uiRefs.current.arena[`ang-${obj.id}`];
        
        if (elX && document.activeElement !== elX) elX.value = Math.round(body.position.x);
        if (elY && document.activeElement !== elY) elY.value = Math.round(body.position.y);
        if (elAng && document.activeElement !== elAng) elAng.value = deg.toFixed(2);
      });
    });

    Matter.Events.on(render, 'afterRender', () => {
      if (!robotRef.current) return;
      const ctx = render.context;
      renderRobot(ctx, robotRef.current, buildRef.current, {
        grabber: grabberStatesRef.current, buzzer: activeOscillatorsRef.current,
        ir: irLedStatesRef.current, ultrasonic: ultrasonicStatesRef.current
      }, engineRef.current);
    });

    const deg = (((initConf.robotAngle * (180 / Math.PI)) % 360) + 360) % 360;
    if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(initConf.robotX);
    if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(initConf.robotY);
    if (uiRefs.current.inputs.angle) uiRefs.current.inputs.angle.value = deg.toFixed(2);

    Matter.Render.run(render);

    let idleFrameId;
    const idleLoop = () => {
      if (!isRunningRef.current && engineRef.current) Matter.Engine.update(engineRef.current, 16.666);
      idleFrameId = requestAnimationFrame(idleLoop);
    };
    idleLoop();

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (render.canvas && width > 0 && height > 0) {
          render.canvas.width = width; render.canvas.height = height;
          render.options.width = width; render.options.height = height;
          canvasSizeRef.current = { w: width, h: height };
          if(updatePixelMapRef.current) updatePixelMapRef.current();

          Matter.World.remove(engine.world, walls);
          walls = [
            Matter.Bodies.rectangle(width / 2, 0, width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
            Matter.Bodies.rectangle(width / 2, height, width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
            Matter.Bodies.rectangle(0, height / 2, 20, height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
            Matter.Bodies.rectangle(width, height / 2, 20, height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } })
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

  const addArenaObject = () => {
    setArenaObjects(prev => [...prev, { id: generateId(), name: 'New Box', x: 300, y: 300, w: 40, h: 40, isStatic: false, isPickable: true, angle: 0, color: DEFAULT_COLORS.arena_prop }]);
  };

  const removeArenaObject = (id) => {
    setArenaObjects(prev => prev
      .map((obj, i) => {
        if (arenaBodiesRef.current[i]) return { ...obj, x: arenaBodiesRef.current[i].position.x, y: arenaBodiesRef.current[i].position.y, angle: arenaBodiesRef.current[i].angle * (180 / Math.PI) };
        return obj;
      })
      .filter(obj => obj.id !== id)
    );
  };

  const updateArenaObject = (id, key, value) => {
    setArenaObjects(prev => prev.map((obj, i) => {
      let newX = obj.x, newY = obj.y, newAng = obj.angle;
      if (arenaBodiesRef.current[i]) {
        newX = arenaBodiesRef.current[i].position.x;
        newY = arenaBodiesRef.current[i].position.y;
        newAng = arenaBodiesRef.current[i].angle * (180 / Math.PI);
      }
      if (obj.id === id) {
        let val = (key === 'name' || key === 'isStatic' || key === 'isPickable' || key === 'color') ? value : Number(value);
        if (key === 'isStatic' && val === true) return { ...obj, x: newX, y: newY, angle: newAng, isStatic: true, isPickable: false };
        return { ...obj, x: newX, y: newY, angle: newAng, [key]: val };
      }
      return { ...obj, x: newX, y: newY, angle: newAng };
    }));
  };

  const addPart = (type) => {
    setRobotBuild(prev => {
      let newPart = { id: generateId(), type: type, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS[type] };
      if (type === 'dc_motor') { newPart.name = 'New Motor'; newPart.pin = 9; newPart.pinDir = 7; }
      else if (type === 'ultrasonic') { newPart.name = 'New Ultrasonic'; newPart.pinTrig = 3; newPart.pinEcho = 2; newPart.offsetX = 25; newPart.range = 400; }
      else if (type === 'ir_led' || type === 'ir_sensor') { newPart.type = 'ir_led'; newPart.name = 'New IR LED'; newPart.pin = 8; newPart.offsetX = 25; newPart.range = 80; newPart.spread = 45; } 
      else if (type === 'grabber') { newPart.name = 'New Grabber'; newPart.pin = 5; newPart.offsetX = 25; } 
      else if (type === 'buzzer') { newPart.name = 'Active Buzzer'; newPart.pin = 8; newPart.offsetX = 0; } 
      else if (type === 'imu') { newPart.name = 'Analog Compass'; newPart.pin = 15; newPart.offsetX = 0; } 
      return { ...prev, parts: [...prev.parts, newPart] };
    });
  };

  const removePart = (id) => setRobotBuild(prev => ({ ...prev, parts: prev.parts.filter(p => p.id !== id) }));

  const updatePart = (id, key, value) => {
    setRobotBuild(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
        if (p.id === id) {
          const val = (key === 'name' || key === 'color') ? value : Number(value);
          return { ...p, [key]: val };
        }
        return p;
      })
    }));
  };

  const updateChassis = (key, value) => setRobotBuild(prev => ({ 
    ...prev, [key]: key === 'chassisColor' ? value : Math.max(10, Number(value)) 
  }));

  const applyManualPose = () => {
    if (!robotRef.current) return;
    const x = uiRefs.current.inputs.x.value !== "" ? parseFloat(uiRefs.current.inputs.x.value) : robotRef.current.position.x;
    const y = uiRefs.current.inputs.y.value !== "" ? parseFloat(uiRefs.current.inputs.y.value) : robotRef.current.position.y;
    const angleDeg = uiRefs.current.inputs.angle.value !== "" ? parseFloat(uiRefs.current.inputs.angle.value) : (robotRef.current.angle * 180 / Math.PI);
    const angleRad = angleDeg * (Math.PI / 180);

    Matter.Body.setPosition(robotRef.current, { x, y });
    Matter.Body.setAngle(robotRef.current, angleRad);
    Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(robotRef.current, 0); 
    
    const current = getConfig();
    localStorage.setItem('flawless-config', JSON.stringify({ ...current, robotX: x, robotY: y, robotAngle: angleRad }));
    setSysLogs(prev => [...prev, `> Teleported Robot to [X:${Math.round(x)}, Y:${Math.round(y)}, Angle:${angleDeg}°]`]);
  };

  const stopSimulation = () => {
    if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }
    setSimState(false);
    
    Object.values(activeOscillatorsRef.current).forEach(state => {
      if (state.osc) {
        try { state.osc.stop(); } catch(e){}
        state.osc.disconnect();
        if(state.gain) state.gain.disconnect();
      }
    });
    activeOscillatorsRef.current = {};
    ultrasonicStatesRef.current = {}; 
    irLedStatesRef.current = {};

    if (engineRef.current) {
      Object.values(grabberStatesRef.current).forEach(state => {
        if (state.constraints) {
          Matter.World.remove(engineRef.current.world, state.constraints);
          if (state.target) {
            Matter.Body.setMass(state.target, state.originalMass);
            state.target.collisionFilter.group = state.originalGroup || 0;
          }
        }
      });
    }
    grabberStatesRef.current = {}; 
    
    Object.values(uiRefs.current.pins).forEach(el => {
      if (el) el.className = "transition-colors duration-75 text-stone-400 dark:text-stone-500";
    });

    if (robotRef.current) Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    arenaBodiesRef.current.forEach(body => {
      if (!body.isStatic) Matter.Body.setVelocity(body, { x: 0, y: 0 });
    });

    setSysLogs(prev => [...prev, '> Simulation STOPPED.']);
  };

  const resetSimulation = () => {
    stopSimulation();
    if (serialConsoleRef.current) serialConsoleRef.current.textContent = "";
    
    const conf = getConfig();
    setArenaObjects(conf.arenaObjects || []);
    if (engineRef.current) {
      Matter.World.remove(engineRef.current.world, arenaBodiesRef.current);
      arenaBodiesRef.current = [];
    }
    rebuildArenaPhysics(conf.arenaObjects || []); 

    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: conf.robotX, y: conf.robotY });
      Matter.Body.setAngle(robotRef.current, conf.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(robotRef.current, 0);
    }
    
    if (uiRefs.current.hud.portb) uiRefs.current.hud.portb.innerText = '00000000';

    const deg = (((conf.robotAngle * (180 / Math.PI)) % 360) + 360) % 360;
    if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(conf.robotX);
    if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(conf.robotY);
    if (uiRefs.current.inputs.angle) uiRefs.current.inputs.angle.value = deg.toFixed(2);
    
    setSysLogs(['> Hardware Reset. Arena rebuilt. Robot returned to Saved Position.']);
  };

  const bootVirtualCpu = (hexData, isOffline = false) => {
    try {
      if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }

      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();

      setSysLogs(prev => [...prev, '> Flashing to Virtual Flash Memory...']);
      
      const program = new Uint16Array(16384);
      loadHex(hexData, new Uint8Array(program.buffer));
      
      const cpu = new CPU(program);
      const timer0 = new AVRTimer(cpu, timer0Config);
      const timer1 = new AVRTimer(cpu, timer1Config);
      const timer2 = new AVRTimer(cpu, timer2Config);
      const usart = new AVRUSART(cpu, usart0Config, 16e6);
      const adc = new AVRADC(cpu, adcConfig);
      
      let serialBuffer = "";

      usart.onByteTransmit = (byte) => {
        if (byte === 13) return;
        const u2x0 = (cpu.data[0xC0] & 2) ? 8 : 16; 
        const ubrr = cpu.data[0xC4] | (cpu.data[0xC5] << 8); 
        const actualBaud = Math.round(16000000 / (u2x0 * (ubrr + 1))); 
        const mismatchRatio = Math.abs(actualBaud - parseInt(baudRateRef.current, 10)) / parseInt(baudRateRef.current, 10);
        if (mismatchRatio > 0.05) return;
        serialBuffer += String.fromCharCode(byte);
      };
      
      setSimState(true);
      if (isOffline) setSysLogs(prev => [...prev, '> OFFLINE MODE: Running local .hex file']);
      setSysLogs(prev => [...prev, '> Sandbox Physics Engine RUNNING...']);

      const ultrasonics = buildRef.current.parts.filter(p => p.type === 'ultrasonic');
      const ultrasonicDefs = ultrasonics.map(p => {
        let portAddr, bit;
        if (p.pinTrig >= 0 && p.pinTrig <= 7) { portAddr = 0x2B; bit = p.pinTrig; } 
        else if (p.pinTrig >= 8 && p.pinTrig <= 13) { portAddr = 0x25; bit = p.pinTrig - 8; } 
        else { portAddr = 0x28; bit = p.pinTrig - 14; }
        return { 
          id: p.id, portAddr, mask: 1 << bit, echoPin: p.pinEcho, 
          maxRange: p.range || 400, offsetX: p.offsetX, offsetY: p.offsetY, angle: p.angle 
        };
      });

      const executeFrame = () => {
        if (!isRunningRef.current) return;

        try {
          for (let i = 0; i < 150000; i++) {
            avrInstruction(cpu); 
            cpu.tick(); 

            if (i % 64 === 0 && robotRef.current) {
              const cycle = cpu.cycles;
              for (let s=0; s < ultrasonicDefs.length; s++) {
                const sd = ultrasonicDefs[s];
                const isTrigHigh = (cpu.data[sd.portAddr] & sd.mask) !== 0;
                const state = ultrasonicStatesRef.current[sd.id] || { lastTrig: false, echoStart: 0, echoEnd: 0, lastDist: sd.maxRange };

                if (isTrigHigh && !state.lastTrig) {
                  const robX = robotRef.current.position.x;
                  const robY = robotRef.current.position.y;
                  const robCos = Math.cos(robotRef.current.angle);
                  const robSin = Math.sin(robotRef.current.angle);

                  const sensorGlobalX = robX + (sd.offsetX * robCos) - (sd.offsetY * robSin);
                  const sensorGlobalY = robY + (sd.offsetX * robSin) + (sd.offsetY * robCos);
                  const pAngleRad = robotRef.current.angle + (sd.angle || 0) * (Math.PI / 180);

                  const allBodies = Matter.Composite.allBodies(engineRef.current.world);
                  const validBodies = allBodies.filter(b => b !== robotRef.current && !robotRef.current.parts.includes(b) && !b.isSensor);

                  let hitDist = sd.maxRange; 
                  for (let d = 5; d <= sd.maxRange; d += 5) {
                    const pt = { x: sensorGlobalX + Math.cos(pAngleRad)*d, y: sensorGlobalY + Math.sin(pAngleRad)*d };
                    if (Matter.Query.point(validBodies, pt).length > 0) { hitDist = d; break; }
                  }
                  
                  state.lastDist = hitDist;
                  state.echoStart = cycle + 7200; 
                  state.echoEnd = state.echoStart + (hitDist * 58 * 16);
                }
                state.lastTrig = isTrigHigh;
                ultrasonicStatesRef.current[sd.id] = state;
              }
            }

            if (i % 16 === 0) {
              const cycle = cpu.cycles;
              for (let s=0; s < ultrasonicDefs.length; s++) {
                const sd = ultrasonicDefs[s];
                const state = ultrasonicStatesRef.current[sd.id];
                if (state) {
                  const isEchoing = cycle >= state.echoStart && cycle <= state.echoEnd;
                  setExternalPin(cpu, sd.echoPin, isEchoing);
                }
              }
            }
          }

          if (serialBuffer.length > 0 && serialConsoleRef.current) {
            serialConsoleRef.current.textContent += serialBuffer;
            serialConsoleRef.current.scrollTop = serialConsoleRef.current.scrollHeight; 
            serialBuffer = "";
          }

          if (uiRefs.current.hud.portb) uiRefs.current.hud.portb.innerText = cpu.data[0x25].toString(2).padStart(8, '0');

          const robot = robotRef.current;
          const mouseBody = mouseConstraintRef.current?.body;
          const isDraggingRobot = (mouseBody === robot);

          if (!isDraggingRobot && robot) {
            let localVx = 0, localVy = 0, angularVelocity = 0;

            buildRef.current.parts.forEach(part => {
              if (part.type === 'dc_motor') {
                const [vx, vy, torque] = processMotor(cpu, part, robot, uiRefs.current.pins);
                localVx += vx; localVy += vy; angularVelocity += torque;
              }
              else if (part.type === 'buzzer') processBuzzer(cpu, part, audioCtxRef, activeOscillatorsRef.current, uiRefs.current.pins);
              else if (part.type === 'ir_led' || part.type === 'ir_sensor') processIR(cpu, part, irLedStatesRef.current, uiRefs.current.pins);
              else if (part.type === 'imu') processIMU(cpu, part, robot, adc, uiRefs.current.pins);
              else if (part.type === 'ultrasonic') processUltrasonicUI(cpu, part, ultrasonicStatesRef.current, uiRefs.current.pins);
              else if (part.type === 'grabber') processGrabber(cpu, part, robot, engineRef.current, grabberStatesRef.current, uiRefs.current.pins);
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
          setSysLogs(prev => [...prev, '> FATAL ERROR: ' + e.message]);
          setSimState(false);
        }
      };
      
      requestRef.current = requestAnimationFrame(executeFrame);
    } catch (err) {
      setSysLogs(prev => [...prev, '> CPU BOOT ERROR: ' + err.message]);
      setSimState(false);
    }
  };

  const runSimulationCloud = async () => {
    if (isRunningRef.current) return;
    setSimState(true); 
    setSysLogs(['> Compiling code via Cloud Compiler...']);
    if (serialConsoleRef.current) serialConsoleRef.current.textContent = "";

    try {
      const response = await fetch('https://hexi.wokwi.com/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch: code, board: "uno" })
      });
      const data = await response.json();
      if (!data.hex) {
        setSysLogs(prev => [...prev, '> COMPILATION FAILED:', data.stderr || data.compilerErrors]);
        setSimState(false); return;
      }
      bootVirtualCpu(data.hex, false);
    } catch (err) {
      setSysLogs(prev => [...prev, '> CLOUD ERROR: ' + err.message]);
      setSimState(false); 
    }
  };

  const runSimulationOffline = (e) => {
    const file = e.target.files ? e.target.files[0] : offlineHexCode;
    if (!file) return;
    stopSimulation(); 
    if (serialConsoleRef.current) serialConsoleRef.current.textContent = "";
    setSysLogs(['> Loading local .hex file...']);
    const reader = new FileReader();
    reader.onload = (event) => { 
      setOfflineHexCode(file);
      setOfflineHexName(file.name);
      bootVirtualCpu(event.target.result, true); 
      if(e.target) e.target.value = null; 
    };
    reader.readAsText(file);
  };

  return (
    <div className={`flex flex-col h-screen w-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans overflow-hidden ${isDragging ? 'select-none' : ''}`}>
      {isDragging && (
        <div 
          className="fixed inset-0 z-[9999]" 
          style={{ cursor: dragDirection === 'vertical' ? 'col-resize' : 'row-resize' }} 
        />
      )}
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(168, 162, 158, 0.3); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(168, 162, 158, 0.5); }
      `}</style>

      <header className="h-12 border-b border-stone-200 dark:border-stone-800 flex items-center px-5 gap-4 bg-stone-50 dark:bg-stone-950 shrink-0">
        <div className="flex items-center gap-2.5">
          <Box size={18} className="text-stone-500 dark:text-stone-400" />
          <span className="font-semibold text-sm tracking-tight">Arduino Sandbox</span>
        </div>
        
        <div className="h-5 w-px bg-stone-300 dark:bg-stone-700 mx-1" />

        <button onClick={runSimulationCloud} disabled={isRunning} className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${isRunning ? 'bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-600' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'}`}>
          <Play size={13} fill="currentColor" /> Run
        </button>
        <button onClick={stopSimulation} className="flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 transition-colors">
          <Square size={13} fill="currentColor" /> Stop
        </button>
        <button onClick={resetSimulation} className="flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 transition-colors">
          <RotateCcw size={13} /> Reset
        </button>

        <div className="flex-1" />

        <label className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 cursor-pointer transition-colors">
          <Upload size={13}/> Config
          <input type="file" accept=".json" className="hidden" onChange={importConfig} />
        </label>
        <button onClick={exportConfig} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors">
          <Download size={13}/> Export
        </button>
        <button onClick={restoreDefaults} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
          <RefreshCcw size={13}/> Defaults
        </button>
      </header>

      <main className="flex-1 flex overflow-hidden bg-stone-100 dark:bg-stone-900" ref={mainContainerRef}>
        <div style={{ width: `${leftWidth}%` }} ref={leftPanelRef} className="flex flex-col overflow-hidden">
          <div style={{ height: `${editorHeight}%` }} className="flex flex-col overflow-hidden border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
            <EditorPanel code={code} setCode={setCode} editorTheme={editorTheme} isRunning={isRunning} runSimulationOffline={runSimulationOffline} />
          </div>
          <Resizer direction="horizontal" onMouseDown={(e) => handleDrag(e, setEditorHeight, 'horizontal', leftPanelRef)} />
          <div className="flex-1 overflow-hidden border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
            <ConsolePanel sysLogs={sysLogs} sysLogEndRef={sysLogEndRef} serialConsoleRef={serialConsoleRef} />
          </div>
        </div>

        <Resizer direction="vertical" onMouseDown={(e) => handleDrag(e, setLeftWidth, 'vertical', mainContainerRef)} />

        <div className="flex-1 flex flex-col overflow-hidden" ref={rightPanelRef}>
          <div style={{ height: `${canvasHeight}%` }} className="flex flex-col overflow-hidden">
            <SimulationField mapImage={mapImage} handleMapUpload={handleMapUpload} clearMap={clearMap} sceneRef={sceneRef} />
          </div>
          <Resizer direction="horizontal" onMouseDown={(e) => handleDrag(e, setCanvasHeight, 'horizontal', rightPanelRef)} />
          <div className="flex-1 overflow-hidden bg-stone-50 dark:bg-stone-950">
            <ConfigPanel 
              activeTab={activeTab} setActiveTab={setActiveTab} 
              robotBuild={robotBuild} updateChassis={updateChassis} updatePart={updatePart} removePart={removePart} 
              newPartType={newPartType} setNewPartType={setNewPartType} addPart={addPart} 
              arenaObjects={arenaObjects} addArenaObject={addArenaObject} removeArenaObject={removeArenaObject} updateArenaObject={updateArenaObject} 
              applyManualPose={applyManualPose} uiRefs={uiRefs} 
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;