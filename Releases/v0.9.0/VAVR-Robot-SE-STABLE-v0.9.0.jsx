import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Play, Square, RotateCcw, Download, Upload, 
  RefreshCcw, ImagePlus, Trash2, X, Box 
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
  dc_motor: 'DC MOTOR',
  ir_led: 'IR LED',
  ir_sensor: 'IR RECEIVER',
  ultrasonic: 'ULTRASONIC',
  grabber: 'GRIPPER'
};

const DEFAULT_COLORS = {
  base_link: '#60a5fa',
  dc_motor: '#1e293b',
  ultrasonic: '#f87171',
  ir_led: '#c084fc',
  ir_sensor: '#c084fc',
  grabber: '#22d3ee',
  static_body: '#64748b',
  dynamic_body: '#c084fc'
};

const BAUD_RATE = 115200;

const generateId = () => Math.random().toString(36).substr(2, 9);

const DEFAULT_WORKSPACE_CONFIG = {
  originX: 200,
  originY: 250,
  originYaw: 0,
  hardwareConfig: {
    baseLinkW: 50,
    baseLinkH: 30,
    baseLinkColor: DEFAULT_COLORS.base_link,
    peripherals: [
      {
        id: generateId(),
        type: 'dc_motor',
        name: 'Left Motor',
        pin: 9,
        directionPin: 7,
        offsetX: 0,
        offsetY: -18,
        angle: 0,
        color: DEFAULT_COLORS.dc_motor
      },
      {
        id: generateId(),
        type: 'dc_motor',
        name: 'Right Motor',
        pin: 10,
        directionPin: 4,
        offsetX: 0,
        offsetY: 18,
        angle: 0,
        color: DEFAULT_COLORS.dc_motor
      }
    ]
  },
  sceneEntities: [] 
};

const defaultSourceCode = `void setup() {\n  // Initialize serial communication\n  Serial.begin(115200);\n}\n\nvoid loop() {\n  // Main logic\n}`;

const PIN_OPTIONS = [];
for (let i = 0; i <= 19; i++) {
  let label = `D${i}`;
  if (i === 0) label = "D0 (RX)";
  else if (i === 1) label = "D1 (TX)";
  else if (i >= 14) label = `A${i - 14}`;
  PIN_OPTIONS.push(<option key={i} value={i}>{label}</option>);
}

const PART_OPTIONS = [
  { value: 'dc_motor', label: 'DC Motor' },
  { value: 'ultrasonic', label: 'Ultrasonic' },
  { value: 'ir_led', label: 'IR LED' },
  { value: 'grabber', label: 'Gripper' }
].map(o => <option key={o.value} value={o.value}>{o.label}</option>);

// ==========================================
// 2. UTILITIES
// ==========================================
const getWorkspaceConfig = () => {
  try {
    const saved = localStorage.getItem('workspace-config');
    if (saved) return { ...DEFAULT_WORKSPACE_CONFIG, ...JSON.parse(saved) };
  } catch (e) {}
  return DEFAULT_WORKSPACE_CONFIG;
};

const getSourceCodeCache = () => {
  try {
    const saved = localStorage.getItem('source-code-cache');
    if (saved !== null) return saved;
  } catch (e) {}
  return defaultSourceCode;
};

const getOppositeColor = (hex) => {
  if (hex.indexOf('#') === 0) hex = hex.slice(1);
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];

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

  if (pin >= 0 && pin <= 7) {
    pinAddr = 0x29;
    bit = pin;
  } else if (pin >= 8 && pin <= 13) {
    pinAddr = 0x23;
    bit = pin - 8;
  } else if (pin >= 14 && pin <= 19) {
    pinAddr = 0x26;
    bit = pin - 14;
  } else {
    return;
  }

  if (isHigh) cpu.data[pinAddr] |= (1 << bit);
  else cpu.data[pinAddr] &= ~(1 << bit);
};

// ==========================================
// 3. DRAWING HELPERS
// ==========================================
const renderOpticalBeam = (ctx, p, state, robot, oppColor, hexColor, mapPixelData) => {
  const intensity = state ? state.intensity : 0;
  const pAngleRad = (p.angle || 0) * (Math.PI / 180);

  const spreadDeg = 45;
  const maxRange = 80;

  if (intensity > 0) {
    const halfSpreadRad = (spreadDeg / 2) * (Math.PI / 180);
    const numRays = 9;
    const beamPoints = [];

    const cosR = Math.cos(robot.angle);
    const sinR = Math.sin(robot.angle);

    for (let i = 0; i < numRays; i++) {
      const rayRelAngle = pAngleRad - halfSpreadRad + (spreadDeg * (Math.PI / 180) * (i / (numRays - 1)));
      const rayGlobalAngle = robot.angle + rayRelAngle;

      const tipGlobalX = robot.position.x + (p.offsetX * cosR) - (p.offsetY * sinR);
      const tipGlobalY = robot.position.y + (p.offsetX * sinR) + (p.offsetY * cosR);

      let hitDist = maxRange;

      for (let d = 4; d <= maxRange; d += 2) {
        const ptX = tipGlobalX + Math.cos(rayGlobalAngle) * d;
        const ptY = tipGlobalY + Math.sin(rayGlobalAngle) * d;

        if (mapPixelData) {
          const ix = Math.floor(ptX);
          const iy = Math.floor(ptY);

          if (ix >= 0 && iy >= 0 && ix < mapPixelData.width && iy < mapPixelData.height) {
            const idx = (iy * mapPixelData.width + ix) * 4;
            const r = mapPixelData.data[idx];
            const g = mapPixelData.data[idx + 1];
            const b = mapPixelData.data[idx + 2];
            const a = mapPixelData.data[idx + 3];

            if (a > 128) {
              const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

              if (luminance < 128) {
                hitDist = d;
                break;
              }
            }
          }
        }
      }

      beamPoints.push({
        x: p.offsetX + Math.cos(rayRelAngle) * hitDist,
        y: p.offsetY + Math.sin(rayRelAngle) * hitDist
      });
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
  ctx.lineTo(-1, 2.8);
  ctx.lineTo(-1, -2.8);
  ctx.closePath();

  ctx.fillStyle = intensity > 0 ? '#f5d0fe' : hexColor;
  ctx.fill();
  ctx.restore();
};

const renderEndEffector = (ctx, p, state) => {
  ctx.beginPath();
  ctx.moveTo(p.offsetX - 3, p.offsetY - 5);
  ctx.lineTo(p.offsetX + 4, p.offsetY - 5);
  ctx.lineTo(p.offsetX + 6, p.offsetY - 3);
  ctx.lineTo(p.offsetX + 6, p.offsetY + 3);
  ctx.lineTo(p.offsetX + 4, p.offsetY + 5);
  ctx.lineTo(p.offsetX - 3, p.offsetY + 5);
  ctx.closePath();
  ctx.fill();

  if (state && state.constraints) {
    ctx.beginPath();
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2;

    const pAngleRad = (p.angle || 0) * (Math.PI / 180);

    ctx.moveTo(p.offsetX, p.offsetY);
    ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * 20, p.offsetY + Math.sin(pAngleRad) * 20);
    ctx.stroke();
  }
};

const renderToFSensor = (ctx, p, state, hexColor) => {
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

const renderGenericPeripheral = (ctx, p) => {
  const pAngleRad = (p.angle || 0) * (Math.PI / 180);

  ctx.beginPath();
  ctx.arc(p.offsetX, p.offsetY, 2, 0, 2 * Math.PI);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(p.offsetX, p.offsetY);
  ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * 5, p.offsetY + Math.sin(pAngleRad) * 5);
  ctx.stroke();
};

const renderRobotAssembly = (ctx, robot, buildConfig, states, mapPixelData) => {
  ctx.save();
  ctx.translate(robot.position.x, robot.position.y);
  ctx.rotate(robot.angle);

  const w2 = Math.max(10, buildConfig.baseLinkW) / 2;
  const h2 = Math.max(10, buildConfig.baseLinkH) / 2;

  const chassisColor = buildConfig.baseLinkColor || DEFAULT_COLORS.base_link;
  const oppChassisColor = getOppositeColor(chassisColor);

  ctx.strokeStyle = oppChassisColor;
  ctx.globalAlpha = 0.15;
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (let x = -w2; x <= w2; x += 10) {
    ctx.moveTo(x, -h2);
    ctx.lineTo(x, h2);
  }
  for (let y = -h2; y <= h2; y += 10) {
    ctx.moveTo(-w2, y);
    ctx.lineTo(w2, y);
  }
  ctx.stroke();

  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(15, 0); 
  ctx.lineTo(10, -5);
  ctx.moveTo(15, 0);
  ctx.lineTo(10, 5); 
  ctx.stroke();

  ctx.globalAlpha = 1.0; 

  buildConfig.peripherals.forEach(p => {
    const hexColor = p.color || DEFAULT_COLORS[p.type] || '#ffffff';
    const oppColor = getOppositeColor(hexColor);

    ctx.fillStyle = oppColor;
    ctx.strokeStyle = oppColor;
    ctx.lineWidth = 1.5;

    if (p.type === 'grabber') {
      renderEndEffector(ctx, p, states.endEffector[p.id]);
    } else if (p.type === 'ir_led' || p.type === 'ir_sensor') {
      renderOpticalBeam(ctx, p, states.optical[p.id], robot, oppColor, hexColor, mapPixelData);
    } else if (p.type === 'ultrasonic') {
      renderToFSensor(ctx, p, states.tof[p.id], hexColor);
    } else {
      renderGenericPeripheral(ctx, p);
    }
  });

  ctx.restore();
};

// ==========================================
// 4. SIMULATION LOGIC HELPERS
// ==========================================
const processActuator = (cpu, part, pinUis) => {
  const pwmVal = getPinPWM(cpu, part.pin);
  let power = pwmVal / 255.0;

  if (part.directionPin !== undefined && getPinState(cpu, part.directionPin)) {
    power = -power;
  }

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

const processOpticalSensor = (cpu, part, opticalStates, pinUis) => {
  const pwmVal = getPinPWM(cpu, part.pin);
  const isHigh = pwmVal > 0 || getPinState(cpu, part.pin);
  const intensity = pwmVal > 0 ? (pwmVal / 255.0) : (isHigh ? 1 : 0);

  opticalStates[part.id] = {
    intensity,
    isHigh: intensity > 0
  };

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

const processToFSensor = (cpu, part, tofStates, pinUis) => {
  const state = tofStates[part.id];
  const isEchoing = state && cpu.cycles >= state.echoStart && cpu.cycles <= state.echoEnd;
  const uiEl = pinUis[part.id];

  if (uiEl) {
    uiEl.className = isEchoing
      ? "transition-colors duration-75 text-rose-500 dark:text-rose-400"
      : "transition-colors duration-75 text-stone-400 dark:text-stone-500";
  }
};

const processEndEffector = (cpu, part, robot, engine, endEffectorStates, pinUis) => {
  const isHigh = getPinState(cpu, part.pin);

  const state = endEffectorStates[part.id] || {
    isHigh: false,
    constraints: null,
    target: null,
    originalMass: 1,
    originalGroup: 0
  };

  const robCos = Math.cos(robot.angle);
  const robSin = Math.sin(robot.angle);

  if (isHigh && !state.isHigh) {
    const reach = 20; 

    const tipLocalX = part.offsetX + Math.cos((part.angle || 0) * Math.PI / 180) * reach;
    const tipLocalY = part.offsetY + Math.sin((part.angle || 0) * Math.PI / 180) * reach;

    const tipGlobalX = robot.position.x + (tipLocalX * robCos) - (tipLocalY * robSin);
    const tipGlobalY = robot.position.y + (tipLocalX * robSin) + (tipLocalY * robCos);

    const bounds = {
      min: { x: tipGlobalX - 10, y: tipGlobalY - 10 },
      max: { x: tipGlobalX + 10, y: tipGlobalY + 10 }
    };

    const validBodies = Matter.Composite.allBodies(engine.world)
      .filter(b => b.plugin && b.plugin.isGraspable && !b.isStatic);

    const hits = Matter.Query.region(validBodies, bounds);

    if (hits.length > 0) {
      const target = hits[0];

      state.target = target;
      state.originalMass = target.mass;
      state.originalGroup = target.collisionFilter.group;

      Matter.Body.setMass(target, 0.0001); 
      target.collisionFilter.group = -1;

      const c1 = Matter.Constraint.create({
        bodyA: robot,
        bodyB: target,
        pointA: { x: tipLocalX, y: tipLocalY },
        pointB: { x: 0, y: 0 },
        stiffness: 1,
        length: 0,
        render: { visible: false }
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
        bodyA: robot,
        bodyB: target,
        pointA: { x: baseLocalX, y: baseLocalY },
        pointB: { x: targetLocalBaseX, y: targetLocalBaseY },
        stiffness: 1,
        length: 0,
        render: { visible: false }
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

    state.constraints = null;
    state.target = null;
  }

  state.isHigh = isHigh;
  endEffectorStates[part.id] = state;

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

const SourceEditor = ({ sourceCode, setSourceCode, editorTheme }) => (
  <div className="flex flex-col h-full bg-stone-50 dark:bg-stone-950">
    <div className="h-9 flex items-center px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide">
      <span>Sketch Editor</span>
    </div>

    <div className="flex-1">
      <Editor
        height="100%"
        defaultLanguage="cpp"
        theme={editorTheme}
        value={sourceCode}
        onChange={setSourceCode}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          renderLineHighlight: 'none'
        }}
      />
    </div>
  </div>
);

const TelemetryConsole = ({ runtimeLogs, runtimeLogEndRef, uartConsoleRef }) => (
  <div className="flex h-full">
    <div className="w-1/2 flex flex-col border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
      <div className="h-9 flex items-center px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide">
        Output
      </div>

      <div className="flex-1 p-3 font-mono text-xs text-stone-700 dark:text-stone-300 overflow-y-auto custom-scrollbar">
        {runtimeLogs.map((log, i) => <div key={i}>{log}</div>)}
        <div ref={runtimeLogEndRef} />
      </div>
    </div>

    <div className="w-1/2 flex flex-col bg-stone-50 dark:bg-stone-950">
      <div className="h-9 flex items-center justify-between px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide">
        <span>Serial Monitor</span>
        <span className="text-xs text-stone-500 dark:text-stone-400 normal-case tracking-normal font-normal">
          {BAUD_RATE} Baud
        </span>
      </div>

      <div
        ref={uartConsoleRef}
        className="flex-1 p-3 font-mono text-xs text-emerald-700 dark:text-emerald-400 overflow-y-auto whitespace-pre-wrap custom-scrollbar"
      />
    </div>
  </div>
);

const PhysicsViewport = ({ environmentMap, handleMapImport, clearEnvironmentMap, sceneRef }) => (
  <div className="flex flex-col h-full bg-stone-100 dark:bg-stone-900">
    <div className="h-9 flex items-center justify-between px-4 border-b border-stone-200 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wide bg-stone-50 dark:bg-stone-950">
      <span>Simulation Viewport</span>

      <div className="flex gap-4 normal-case tracking-normal font-normal">
        {environmentMap && (
          <button
            onClick={clearEnvironmentMap}
            className="hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 size={13}/> Clear Background
          </button>
        )}

        <label className="flex items-center gap-2 cursor-pointer hover:text-stone-900 dark:hover:text-stone-100 transition-colors">
          <ImagePlus size={14}/> Import Background
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleMapImport}
          />
        </label>
      </div>
    </div>

    <div 
      className="flex-1 relative"
      style={{
        backgroundImage: environmentMap ? `url(${environmentMap})` : 'radial-gradient(circle, #d6d3d1 1px, transparent 1px)',
        backgroundSize: environmentMap ? 'auto' : '24px 24px',
        backgroundPosition: 'center',
        backgroundRepeat: environmentMap ? 'no-repeat' : 'repeat'
      }}
    >
      <div ref={sceneRef} className="absolute inset-0"></div>
    </div>
  </div>
);

const HardwareConfig = ({
  hardwareConfig,
  updateBaseLink,
  updatePeripheral,
  removePeripheral,
  selectedPeripheral,
  setSelectedPeripheral,
  addPeripheral,
  uiRefs
}) => (
  <div className="space-y-5 text-sm">
    <div className="flex items-center justify-between">
      <span className="font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide text-xs">
        Chassis
      </span>

      <div className="flex items-center gap-3">
        <input
          type="color"
          value={hardwareConfig.baseLinkColor || DEFAULT_COLORS.base_link}
          onChange={(e) => updateBaseLink('baseLinkColor', e.target.value)}
          className="w-7 h-7 rounded cursor-pointer bg-transparent border border-stone-300 dark:border-stone-700"
        />

        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">W</span>
          <input
            type="number"
            min="10"
            value={hardwareConfig.baseLinkW}
            onChange={(e) => updateBaseLink('baseLinkW', e.target.value)}
            className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">H</span>
          <input
            type="number"
            min="10"
            value={hardwareConfig.baseLinkH}
            onChange={(e) => updateBaseLink('baseLinkH', e.target.value)}
            className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>
      </div>
    </div>

    <div className="flex items-center justify-between">
      <span className="font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide text-xs">
        Components
      </span>

      <div className="flex items-center gap-3">
        <select
          value={selectedPeripheral}
          onChange={(e) => setSelectedPeripheral(e.target.value)}
          className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-sm"
        >
          {PART_OPTIONS}
        </select>

        <button
          onClick={() => addPeripheral(selectedPeripheral)}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
        >
          + Add Component
        </button>
      </div>
    </div>

    <div className="space-y-3">
      {hardwareConfig.peripherals.map(peripheral => (
        <div
          key={peripheral.id}
          className="p-3 border border-stone-200 dark:border-stone-800 rounded-lg space-y-3 relative group hover:border-stone-300 dark:hover:border-stone-700 transition-colors"
        >
          <button
            onClick={() => removePeripheral(peripheral.id)}
            className="absolute top-2 right-2 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={14}/>
          </button>

          <div className="flex items-center gap-2.5 pr-5">
            <span ref={el => uiRefs.current.pins[peripheral.id] = el} className="text-stone-400 dark:text-stone-500">
              ●
            </span>

            <span className="text-xs bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-semibold px-2 py-1 rounded uppercase">
              {TYPE_TAGS[peripheral.type]}
            </span>

            <input
              type="text"
              value={peripheral.name}
              onChange={(e) => updatePeripheral(peripheral.id, 'name', e.target.value)}
              className="bg-transparent font-medium w-full outline-none border-b border-transparent hover:border-stone-300 dark:hover:border-stone-600 focus:border-blue-500 dark:focus:border-blue-400 truncate transition-colors"
            />

            <input
              type="color"
              value={peripheral.color || DEFAULT_COLORS[peripheral.type]}
              onChange={(e) => updatePeripheral(peripheral.id, 'color', e.target.value)}
              className="w-6 h-6 rounded cursor-pointer bg-transparent border border-stone-300 dark:border-stone-700"
            />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-600 dark:text-stone-400">
            {peripheral.type === 'dc_motor' && (
              <>
                <div className="flex items-center gap-1.5">
                  <span>PWM Pin</span>
                  <select
                    value={peripheral.pin}
                    onChange={(e) => updatePeripheral(peripheral.id, 'pin', e.target.value)}
                    className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center"
                  >
                    {PIN_OPTIONS}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span>DIR Pin</span>
                  <select
                    value={peripheral.directionPin !== undefined ? peripheral.directionPin : 7}
                    onChange={(e) => updatePeripheral(peripheral.id, 'directionPin', e.target.value)}
                    className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center"
                  >
                    {PIN_OPTIONS}
                  </select>
                </div>
              </>
            )}

            {(peripheral.type === 'ir_led' || peripheral.type === 'ir_sensor') && (
              <>
                <div className="flex items-center gap-1.5">
                  <span>Pin</span>
                  <select
                    value={peripheral.pin}
                    onChange={(e) => updatePeripheral(peripheral.id, 'pin', e.target.value)}
                    className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center"
                  >
                    {PIN_OPTIONS}
                  </select>
                </div>
              </>
            )}

            {peripheral.type === 'grabber' && (
              <div className="flex items-center gap-1.5">
                <span>Pin</span>
                <select
                  value={peripheral.pin}
                  onChange={(e) => updatePeripheral(peripheral.id, 'pin', e.target.value)}
                  className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center"
                >
                  {PIN_OPTIONS}
                </select>
              </div>
            )}

            {peripheral.type === 'ultrasonic' && (
              <>
                <div className="flex items-center gap-1.5">
                  <span>Trig Pin</span>
                  <select
                    value={peripheral.triggerPin}
                    onChange={(e) => updatePeripheral(peripheral.id, 'triggerPin', e.target.value)}
                    className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center"
                  >
                    {PIN_OPTIONS}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span>Echo Pin</span>
                  <select
                    value={peripheral.echoPin}
                    onChange={(e) => updatePeripheral(peripheral.id, 'echoPin', e.target.value)}
                    className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center"
                  >
                    {PIN_OPTIONS}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span>Range</span>
                  <input
                    type="number"
                    value={peripheral.range || 400}
                    onChange={(e) => updatePeripheral(peripheral.id, 'range', e.target.value)}
                    className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none w-12 text-center"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-4 text-xs text-stone-600 dark:text-stone-400">
            <div className="flex items-center gap-1.5">
              <span>X</span>
              <input
                type="number"
                value={peripheral.offsetX}
                onChange={(e) => updatePeripheral(peripheral.id, 'offsetX', e.target.value)}
                className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span>Y</span>
              <input
                type="number"
                value={peripheral.offsetY}
                onChange={(e) => updatePeripheral(peripheral.id, 'offsetY', e.target.value)}
                className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span>°</span>
              <input
                type="number"
                value={peripheral.angle || 0}
                onChange={(e) => updatePeripheral(peripheral.id, 'angle', e.target.value)}
                className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>
          </div>
        </div>
      ))}

      {hardwareConfig.peripherals.length === 0 && (
        <div className="text-center text-stone-500 dark:text-stone-400 italic py-5 border border-dashed border-stone-300 dark:border-stone-700 rounded-lg">
          No components attached
        </div>
      )}
    </div>
  </div>
);

const EnvironmentConfig = ({
  sceneEntities,
  addSceneEntity,
  removeSceneEntity,
  updateSceneEntity,
  uiRefs
}) => (
  <div className="space-y-5 text-sm">
    <div className="flex items-center justify-between">
      <span className="font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide text-xs">
        Environment Objects
      </span>

      <button
        onClick={addSceneEntity}
        className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium flex items-center gap-2 transition-colors"
      >
        <Box size={14}/> Add Object
      </button>
    </div>

    <div className="space-y-3">
      {sceneEntities.map(entity => (
        <div
          key={entity.id}
          className="p-3 border border-stone-200 dark:border-stone-800 rounded-lg space-y-3 relative group hover:border-stone-300 dark:hover:border-stone-700 transition-colors"
        >
          <button
            onClick={() => removeSceneEntity(entity.id)}
            className="absolute top-2 right-2 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={14}/>
          </button>

          <div className="flex items-center gap-2.5 pr-5">
            <span className={`text-xs font-semibold px-2 py-1 rounded uppercase ${
              entity.isStatic
                ? 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
                : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
            }`}>
              {entity.isStatic ? 'STATIC' : 'DYNAMIC'}
            </span>

            <input
              type="text"
              value={entity.name}
              onChange={(e) => updateSceneEntity(entity.id, 'name', e.target.value)}
              className="bg-transparent font-medium w-full outline-none border-b border-transparent hover:border-stone-300 dark:hover:border-stone-600 focus:border-purple-500 dark:focus:border-purple-400 truncate transition-colors"
            />

            <input
              type="color"
              value={entity.color || (entity.isStatic ? DEFAULT_COLORS.static_body : DEFAULT_COLORS.dynamic_body)}
              onChange={(e) => updateSceneEntity(entity.id, 'color', e.target.value)}
              className="w-6 h-6 rounded cursor-pointer bg-transparent border border-stone-300 dark:border-stone-700"
            />
          </div>

          <div className="flex gap-4 text-xs text-stone-600 dark:text-stone-400">
            <div className="flex items-center gap-1.5">
              <span>W</span>
              <input
                type="number"
                min="5"
                value={entity.w}
                onChange={(e) => updateSceneEntity(entity.id, 'w', e.target.value)}
                className="w-12 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span>H</span>
              <input
                type="number"
                min="5"
                value={entity.h}
                onChange={(e) => updateSceneEntity(entity.id, 'h', e.target.value)}
                className="w-12 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={entity.isStatic}
                onChange={(e) => updateSceneEntity(entity.id, 'isStatic', e.target.checked)}
                className="cursor-pointer"
              />
              Static
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                disabled={entity.isStatic}
                checked={!entity.isStatic && entity.isGraspable}
                onChange={(e) => updateSceneEntity(entity.id, 'isGraspable', e.target.checked)}
                className="cursor-pointer"
              />
              Graspable
            </label>
          </div>

          <div className="flex gap-4 text-xs text-stone-600 dark:text-stone-400">
            <div className="flex items-center gap-1.5">
              <span>X</span>
              <input
                ref={el => uiRefs.current.arena[`x-${entity.id}`] = el}
                type="number"
                value={Math.round(entity.x)}
                onChange={(e) => updateSceneEntity(entity.id, 'x', e.target.value)}
                className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span>Y</span>
              <input
                ref={el => uiRefs.current.arena[`y-${entity.id}`] = el}
                type="number"
                value={Math.round(entity.y)}
                onChange={(e) => updateSceneEntity(entity.id, 'y', e.target.value)}
                className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span>°</span>
              <input
                ref={el => uiRefs.current.arena[`ang-${entity.id}`] = el}
                type="number"
                value={entity.angle || 0}
                onChange={(e) => updateSceneEntity(entity.id, 'angle', e.target.value)}
                className="w-14 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
              />
            </div>
          </div>
        </div>
      ))}

      {sceneEntities.length === 0 && (
        <div className="text-center text-stone-500 dark:text-stone-400 italic py-5 border border-dashed border-stone-300 dark:border-stone-700 rounded-lg">
          No environment objects defined
        </div>
      )}
    </div>
  </div>
);

const OdometryPanel = ({ injectPoseOverride, uiRefs }) => (
  <div className="space-y-5 text-sm">
    <div className="grid grid-cols-2 gap-5 text-stone-600 dark:text-stone-400 font-mono">
      <div className="flex justify-between">
        <span>PORTB:</span>
        <span ref={el => uiRefs.current.hud.portb = el} className="text-stone-900 dark:text-stone-100">
          00000000
        </span>
      </div>

      <div className="flex justify-between">
        <span>X:</span>
        <span ref={el => uiRefs.current.hud.x = el} className="text-stone-900 dark:text-stone-100">
          0
        </span>
      </div>

      <div className="flex justify-between">
        <span>Y:</span>
        <span ref={el => uiRefs.current.hud.y = el} className="text-stone-900 dark:text-stone-100">
          0
        </span>
      </div>

      <div className="flex justify-between">
        <span>YAW:</span>
        <span className="text-stone-900 dark:text-stone-100">
          <span ref={el => uiRefs.current.hud.yaw = el}>0.00</span>°
        </span>
      </div>
    </div>

    <div className="pt-5 border-t border-stone-200 dark:border-stone-800">
      <p className="text-xs font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide mb-3">
        Position Override
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">X</span>
          <input
            ref={el => uiRefs.current.inputs.x = el}
            type="number"
            className="w-full bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">Y</span>
          <input
            ref={el => uiRefs.current.inputs.y = el}
            type="number"
            className="w-full bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 dark:text-stone-400 text-xs">°</span>
          <input
            ref={el => uiRefs.current.inputs.yaw = el}
            type="number"
            className="w-full bg-transparent border-b border-stone-300 dark:border-stone-600 text-center outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>
      </div>

      <button
        onClick={injectPoseOverride}
        className="w-full py-2 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 rounded-lg text-sm font-medium transition-colors"
      >
        Set Position
      </button>
    </div>
  </div>
);

const WorkspaceInspector = ({ 
  activeTab,
  setActiveTab,
  hardwareConfig,
  updateBaseLink,
  updatePeripheral,
  removePeripheral,
  selectedPeripheral,
  setSelectedPeripheral,
  addPeripheral,
  sceneEntities,
  addSceneEntity,
  removeSceneEntity,
  updateSceneEntity,
  injectPoseOverride,
  uiRefs
}) => (
  <div className="flex flex-col h-full bg-stone-50 dark:bg-stone-950">
    <div className="h-10 flex items-center px-3 border-b border-stone-200 dark:border-stone-800 gap-2">
      <button
        onClick={() => setActiveTab('hardware')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md uppercase tracking-wide transition-colors ${
          activeTab === 'hardware'
            ? 'bg-stone-200 dark:bg-stone-800 text-stone-900 dark:text-stone-100'
            : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
        }`}
      >
        Hardware
      </button>

      <button
        onClick={() => setActiveTab('environment')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md uppercase tracking-wide transition-colors ${
          activeTab === 'environment'
            ? 'bg-stone-200 dark:bg-stone-800 text-stone-900 dark:text-stone-100'
            : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
        }`}
      >
        Environment
      </button>

      <button
        onClick={() => setActiveTab('odometry')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md uppercase tracking-wide transition-colors ${
          activeTab === 'odometry'
            ? 'bg-stone-200 dark:bg-stone-800 text-stone-900 dark:text-stone-100'
            : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
        }`}
      >
        Odometry
      </button>
    </div>

    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      {activeTab === 'hardware' && (
        <HardwareConfig
          hardwareConfig={hardwareConfig}
          updateBaseLink={updateBaseLink}
          updatePeripheral={updatePeripheral}
          removePeripheral={removePeripheral}
          selectedPeripheral={selectedPeripheral}
          setSelectedPeripheral={setSelectedPeripheral}
          addPeripheral={addPeripheral}
          uiRefs={uiRefs}
        />
      )}

      {activeTab === 'environment' && (
        <EnvironmentConfig
          sceneEntities={sceneEntities}
          addSceneEntity={addSceneEntity}
          removeSceneEntity={removeSceneEntity}
          updateSceneEntity={updateSceneEntity}
          uiRefs={uiRefs}
        />
      )}

      {activeTab === 'odometry' && (
        <OdometryPanel
          injectPoseOverride={injectPoseOverride}
          uiRefs={uiRefs}
        />
      )}
    </div>
  </div>
);

// ==========================================
// 6. MAIN APP COMPONENT
// ==========================================
const CROSS_COMPILER_ENDPOINT = 'http://localhost:8080/build';

function App() {
  const initialWorkspaceConfig = getWorkspaceConfig();

  const [sourceCode, setSourceCode] = useState(getSourceCodeCache);
  const [runtimeLogs, setRuntimeLogs] = useState(['> Arduino IDE ready. Simulation environment loaded.']);

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
  }, []);

  const [hardwareConfig, setHardwareConfig] = useState(initialWorkspaceConfig.hardwareConfig || DEFAULT_WORKSPACE_CONFIG.hardwareConfig);
  const [sceneEntities, setSceneEntities] = useState(initialWorkspaceConfig.sceneEntities || DEFAULT_WORKSPACE_CONFIG.sceneEntities);

  const [activeTab, setActiveTab] = useState('hardware');
  const [selectedPeripheral, setSelectedPeripheral] = useState('dc_motor');

  const [isRunning, setIsRunning] = useState(false);

  const isRunningRef = useRef(false);
  const hardwareConfigRef = useRef(hardwareConfig);
  const sceneEntitiesRef = useRef(sceneEntities);

  const [leftWidth, setLeftWidth] = useState(50);
  const [editorHeight, setEditorHeight] = useState(65);
  const [canvasHeight, setCanvasHeight] = useState(65);

  const [isDragging, setIsDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState(null);

  const mainContainerRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);

  const setSimState = (state) => {
    setIsRunning(state);
    isRunningRef.current = state;
  };

  const [environmentMap, setEnvironmentMap] = useState(() => {
    try {
      return localStorage.getItem('environment-map-cache') || null;
    } catch (e) {
      return null;
    }
  });

  const environmentMapRef = useRef(null);
  const requestRef = useRef(null);
  const runtimeLogEndRef = useRef(null);
  const uartConsoleRef = useRef(null);

  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const robotRef = useRef(null);
  const sceneBodiesRef = useRef([]);
  const mouseConstraintRef = useRef(null);

  const tofSensorStatesRef = useRef({});
  const endEffectorStatesRef = useRef({});
  const opticalSensorStatesRef = useRef({});

  const offscreenCanvasRef = useRef(document.createElement('canvas'));
  const offscreenCtxRef = useRef(offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true }));

  const environmentPixelDataRef = useRef(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const updateEnvironmentPixelMapRef = useRef(null);

  const uiRefs = useRef({
    hud: {
      portb: null,
      x: null,
      y: null,
      yaw: null
    },
    inputs: {
      x: null,
      y: null,
      yaw: null
    },
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

  updateEnvironmentPixelMapRef.current = () => {
    const { w, h } = canvasSizeRef.current;
    if (w === 0 || h === 0) return;

    const canvas = offscreenCanvasRef.current;
    const ctx = offscreenCtxRef.current;

    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (environmentMapRef.current) {
      const img = new Image();

      img.onload = () => {
        ctx.drawImage(img, (w - img.width) / 2, (h - img.height) / 2);
        environmentPixelDataRef.current = ctx.getImageData(0, 0, w, h);
      };

      img.src = environmentMapRef.current;
    } else {
      environmentPixelDataRef.current = ctx.getImageData(0, 0, w, h);
    }
  };

  useEffect(() => {
    environmentMapRef.current = environmentMap;

    if (updateEnvironmentPixelMapRef.current) {
      updateEnvironmentPixelMapRef.current();
    }
  }, [environmentMap]);

  useEffect(() => {
    hardwareConfigRef.current = hardwareConfig;
  }, [hardwareConfig]);

  useEffect(() => {
    sceneEntitiesRef.current = sceneEntities;
  }, [sceneEntities]);

  useEffect(() => {
    const current = getWorkspaceConfig();
    const nextConfig = { ...current, hardwareConfig, sceneEntities };

    localStorage.setItem('workspace-config', JSON.stringify(nextConfig));
  }, [hardwareConfig, sceneEntities]);

  useEffect(() => {
    try {
      localStorage.setItem('source-code-cache', sourceCode);
    } catch (err) {}
  }, [sourceCode]);

  useEffect(() => {
    runtimeLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runtimeLogs]);

  const handleMapImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      const base64Str = event.target.result;

      setEnvironmentMap(base64Str);

      try {
        localStorage.setItem('environment-map-cache', base64Str);
        setRuntimeLogs(prev => [...prev, `> Background image loaded and cached: ${file.name}`]);
      } catch (err) {
        setRuntimeLogs(prev => [
          ...prev,
          `> Background image loaded: ${file.name}`,
          `> Warning: Background image exceeds local storage quota; caching skipped.`
        ]);
      }
    };

    reader.readAsDataURL(file);
    e.target.value = null;
  };

  const clearEnvironmentMap = () => {
    setEnvironmentMap(null);
    localStorage.removeItem('environment-map-cache');
    setRuntimeLogs(prev => [...prev, `> Background image cleared from workspace.`]);
  };

  const exportWorkspaceConfig = () => {
    const configData = localStorage.getItem('workspace-config') || JSON.stringify(DEFAULT_WORKSPACE_CONFIG);

    const blob = new Blob([configData], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = "workspace_config.json";
    a.click();

    URL.revokeObjectURL(url);

    setRuntimeLogs(prev => [...prev, '> Board configuration exported: workspace_config.json saved.']);
  };

  const importWorkspaceConfig = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);

        if (parsed.hardwareConfig) setHardwareConfig(parsed.hardwareConfig);
        if (parsed.sceneEntities) setSceneEntities(parsed.sceneEntities);

        if (robotRef.current && parsed.originX !== undefined) {
          Matter.Body.setPosition(robotRef.current, { x: parsed.originX, y: parsed.originY });
          Matter.Body.setAngle(robotRef.current, parsed.originYaw);
        }

        localStorage.setItem('workspace-config', JSON.stringify(parsed));

        setRuntimeLogs(prev => [...prev, '> Board configuration imported. Workspace environment reconstructed.']);

        e.target.value = null;
      } catch (err) {
        setRuntimeLogs(prev => [...prev, '> Error: Malformed or invalid configuration file.']);
      }
    };

    reader.readAsText(file);
  };

  const restoreFactoryDefaults = () => {
    localStorage.removeItem('source-code-cache');

    let baseHardwareConfig = {
      baseLinkW: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.baseLinkW,
      baseLinkH: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.baseLinkH,
      baseLinkColor: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.baseLinkColor,
      peripherals: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.peripherals.map(p => ({ ...p, id: generateId() }))
    };

    setSelectedPeripheral('dc_motor');
    setHardwareConfig(baseHardwareConfig);
    setSceneEntities(DEFAULT_WORKSPACE_CONFIG.sceneEntities);
    setSourceCode(defaultSourceCode);

    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: DEFAULT_WORKSPACE_CONFIG.originX, y: DEFAULT_WORKSPACE_CONFIG.originY });
      Matter.Body.setAngle(robotRef.current, DEFAULT_WORKSPACE_CONFIG.originYaw);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }

    const newConfig = { ...DEFAULT_WORKSPACE_CONFIG, hardwareConfig: baseHardwareConfig };
    localStorage.setItem('workspace-config', JSON.stringify(newConfig));

    setRuntimeLogs(prev => [...prev, '> Local cache cleared. Sketch and board configuration restored to defaults.']);
  };

  const rebuildKinematicChain = (buildConfig, initialX = 200, initialY = 200, initialYaw = 0) => {
    if (!engineRef.current) return;

    if (robotRef.current) {
      Matter.World.remove(engineRef.current.world, robotRef.current);
    }

    const x = robotRef.current ? robotRef.current.position.x : initialX;
    const y = robotRef.current ? robotRef.current.position.y : initialY;
    const yaw = robotRef.current ? robotRef.current.angle : initialYaw;

    const w = Math.max(10, buildConfig.baseLinkW || 50);
    const h = Math.max(10, buildConfig.baseLinkH || 30);

    const ROBOT_GROUP = -1;
    const chassisColor = buildConfig.baseLinkColor || DEFAULT_COLORS.base_link;

    const chassis = Matter.Bodies.rectangle(x, y, w, h, {
      render: { fillStyle: chassisColor },
      collisionFilter: { group: ROBOT_GROUP }
    });

    const partsArray = [chassis];

    buildConfig.peripherals.forEach(p => {
      const pAngleRad = (p.angle || 0) * (Math.PI / 180);
      const pColor = p.color || DEFAULT_COLORS[p.type] || '#ffffff';

      let pW = 6;
      let pH = 6;

      if (p.type === 'dc_motor') {
        pW = 14;
        pH = 6;
      } else if (p.type === 'ultrasonic') {
        pW = 6;
        pH = 12;
      } else if (p.type === 'ir_led' || p.type === 'ir_sensor') {
        pW = 6;
        pH = 6;
      } else if (p.type === 'grabber') {
        pW = 10;
        pH = 8;
      }

      partsArray.push(Matter.Bodies.rectangle(x + p.offsetX, y + p.offsetY, pW, pH, {
        angle: pAngleRad,
        render: { fillStyle: pColor },
        collisionFilter: { group: ROBOT_GROUP }
      }));
    });

    const robot = Matter.Body.create({
      parts: partsArray,
      frictionAir: 0.1,
      inertia: Infinity,
      collisionFilter: { group: ROBOT_GROUP }
    });

    Matter.Body.setPosition(robot, { x, y });
    Matter.Body.setAngle(robot, yaw);

    robotRef.current = robot;

    Matter.World.add(engineRef.current.world, robot);
  };

  const rebuildScenePhysics = (entities) => {
    if (!engineRef.current) return;

    if (sceneBodiesRef.current.length > 0) {
      Matter.World.remove(engineRef.current.world, sceneBodiesRef.current);
    }

    const newBodies = entities.map(entity => {
      const w = Math.max(5, entity.w || 20);
      const h = Math.max(5, entity.h || 20);

      const entityColor = entity.color || (entity.isStatic ? DEFAULT_COLORS.static_body : DEFAULT_COLORS.dynamic_body);

      return Matter.Bodies.rectangle(entity.x, entity.y, w, h, {
        isStatic: entity.isStatic,
        angle: (entity.angle || 0) * (Math.PI / 180),
        friction: 0.5,
        restitution: 0.2,
        render: { fillStyle: entityColor },
        plugin: {
          id: entity.id,
          isGraspable: !!entity.isGraspable
        }
      });
    });

    sceneBodiesRef.current = newBodies;
    Matter.World.add(engineRef.current.world, newBodies);
  };

  useEffect(() => {
    if (engineRef.current) rebuildKinematicChain(hardwareConfig);
  }, [hardwareConfig]);

  useEffect(() => {
    if (engineRef.current) {
      const hasGrab = Object.values(endEffectorStatesRef.current).some(s => s.constraints);
      if (hasGrab) haltSimulation();

      rebuildScenePhysics(sceneEntities);
    }
  }, [sceneEntities]);

  useEffect(() => {
    if (!sceneRef.current) return;

    const oldCanvases = sceneRef.current.querySelectorAll('canvas');
    oldCanvases.forEach(c => c.remove());

    const engine = Matter.Engine.create({
      positionIterations: 16,
      velocityIterations: 16
    });

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

    const initConf = getWorkspaceConfig();

    let walls = [
      Matter.Bodies.rectangle(render.options.width / 2, 0, render.options.width, 20, {
        isStatic: true,
        render: { fillStyle: DEFAULT_COLORS.static_body }
      }),
      Matter.Bodies.rectangle(render.options.width / 2, render.options.height, render.options.width, 20, {
        isStatic: true,
        render: { fillStyle: DEFAULT_COLORS.static_body }
      }),
      Matter.Bodies.rectangle(0, render.options.height / 2, 20, render.options.height, {
        isStatic: true,
        render: { fillStyle: DEFAULT_COLORS.static_body }
      }),
      Matter.Bodies.rectangle(render.options.width, render.options.height / 2, 20, render.options.height, {
        isStatic: true,
        render: { fillStyle: DEFAULT_COLORS.static_body }
      })
    ];

    const mouse = Matter.Mouse.create(render.canvas);

    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: false }
      }
    });

    mouseConstraintRef.current = mouseConstraint;
    render.mouse = mouse;

    Matter.World.add(engine.world, [mouseConstraint, ...walls]);

    rebuildKinematicChain(initConf.hardwareConfig, initConf.originX, initConf.originY, initConf.originYaw);
    rebuildScenePhysics(initConf.sceneEntities);

    Matter.Events.on(mouseConstraint, 'enddrag', () => {
      if (robotRef.current && mouseConstraint.body === robotRef.current) {
        const r = robotRef.current;

        const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360;

        if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(r.position.x);
        if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(r.position.y);
        if (uiRefs.current.inputs.yaw) uiRefs.current.inputs.yaw.value = normalizedDeg.toFixed(2);

        const current = getWorkspaceConfig();

        localStorage.setItem('workspace-config', JSON.stringify({
          ...current,
          originX: r.position.x,
          originY: r.position.y,
          originYaw: r.angle
        }));
      }

      const draggedBodyIndex = sceneBodiesRef.current.indexOf(mouseConstraint.body);

      if (draggedBodyIndex !== -1) {
        setSceneEntities(prev => {
          const next = [...prev];
          const body = sceneBodiesRef.current[draggedBodyIndex];

          next[draggedBodyIndex] = {
            ...next[draggedBodyIndex],
            x: body.position.x,
            y: body.position.y,
            angle: body.angle * (180 / Math.PI)
          };

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
        if (uiRefs.current.hud.yaw) uiRefs.current.hud.yaw.innerText = normalizedDeg.toFixed(2);
      }

      sceneBodiesRef.current.forEach((body, i) => {
        const entity = sceneEntitiesRef.current[i];
        if (!entity) return;

        const deg = (((body.angle * (180 / Math.PI)) % 360) + 360) % 360;

        const elX = uiRefs.current.arena[`x-${entity.id}`];
        const elY = uiRefs.current.arena[`y-${entity.id}`];
        const elAng = uiRefs.current.arena[`ang-${entity.id}`];

        if (elX && document.activeElement !== elX) elX.value = Math.round(body.position.x);
        if (elY && document.activeElement !== elY) elY.value = Math.round(body.position.y);
        if (elAng && document.activeElement !== elAng) elAng.value = deg.toFixed(2);
      });
    });

    Matter.Events.on(render, 'afterRender', () => {
      if (!robotRef.current) return;

      const ctx = render.context;

      renderRobotAssembly(ctx, robotRef.current, hardwareConfigRef.current, {
        endEffector: endEffectorStatesRef.current,
        optical: opticalSensorStatesRef.current,
        tof: tofSensorStatesRef.current
      }, environmentPixelDataRef.current);
    });

    const deg = (((initConf.originYaw * (180 / Math.PI)) % 360) + 360) % 360;

    if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(initConf.originX);
    if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(initConf.originY);
    if (uiRefs.current.inputs.yaw) uiRefs.current.inputs.yaw.value = deg.toFixed(2);

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

          canvasSizeRef.current = { w: width, h: height };

          if (updateEnvironmentPixelMapRef.current) {
            updateEnvironmentPixelMapRef.current();
          }

          Matter.World.remove(engine.world, walls);

          walls = [
            Matter.Bodies.rectangle(width / 2, 0, width, 20, {
              isStatic: true,
              render: { fillStyle: DEFAULT_COLORS.static_body }
            }),
            Matter.Bodies.rectangle(width / 2, height, width, 20, {
              isStatic: true,
              render: { fillStyle: DEFAULT_COLORS.static_body }
            }),
            Matter.Bodies.rectangle(0, height / 2, 20, height, {
              isStatic: true,
              render: { fillStyle: DEFAULT_COLORS.static_body }
            }),
            Matter.Bodies.rectangle(width, height / 2, 20, height, {
              isStatic: true,
              render: { fillStyle: DEFAULT_COLORS.static_body }
            })
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
  }, []);

  const addSceneEntity = () => {
    setSceneEntities(prev => [
      ...prev,
      {
        id: generateId(),
        name: 'New Rigid Body',
        x: 300,
        y: 300,
        w: 40,
        h: 40,
        isStatic: false,
        isGraspable: true,
        angle: 0,
        color: DEFAULT_COLORS.dynamic_body
      }
    ]);
  };

  const removeSceneEntity = (id) => {
    setSceneEntities(prev => prev
      .map((entity, i) => {
        if (sceneBodiesRef.current[i]) {
          return {
            ...entity,
            x: sceneBodiesRef.current[i].position.x,
            y: sceneBodiesRef.current[i].position.y,
            angle: sceneBodiesRef.current[i].angle * (180 / Math.PI)
          };
        }

        return entity;
      })
      .filter(entity => entity.id !== id)
    );
  };

  const updateSceneEntity = (id, key, value) => {
    setSceneEntities(prev => prev.map((entity, i) => {
      let newX = entity.x;
      let newY = entity.y;
      let newAng = entity.angle;

      if (sceneBodiesRef.current[i]) {
        newX = sceneBodiesRef.current[i].position.x;
        newY = sceneBodiesRef.current[i].position.y;
        newAng = sceneBodiesRef.current[i].angle * (180 / Math.PI);
      }

      if (entity.id === id) {
        let val = (key === 'name' || key === 'isStatic' || key === 'isGraspable' || key === 'color')
          ? value
          : Number(value);

        if (key === 'isStatic' && val === true) {
          return {
            ...entity,
            x: newX,
            y: newY,
            angle: newAng,
            isStatic: true,
            isGraspable: false
          };
        }

        return {
          ...entity,
          x: newX,
          y: newY,
          angle: newAng,
          [key]: val
        };
      }

      return {
        ...entity,
        x: newX,
        y: newY,
        angle: newAng
      };
    }));
  };

  const addPeripheral = (type) => {
    setHardwareConfig(prev => {
      let newPeripheral = {
        id: generateId(),
        type: type,
        offsetX: 0,
        offsetY: 0,
        angle: 0,
        color: DEFAULT_COLORS[type]
      };

      if (type === 'dc_motor') {
        newPeripheral.name = 'New DC Motor';
        newPeripheral.pin = 9;
        newPeripheral.directionPin = 7;
      } else if (type === 'ultrasonic') {
        newPeripheral.name = 'New Ultrasonic';
        newPeripheral.triggerPin = 3;
        newPeripheral.echoPin = 2;
        newPeripheral.offsetX = 25;
        newPeripheral.range = 400;
      } else if (type === 'ir_led' || type === 'ir_sensor') {
        newPeripheral.type = 'ir_led';
        newPeripheral.name = 'New IR LED';
        newPeripheral.pin = 14; // Defaults to A0
        newPeripheral.offsetX = 25;
      } else if (type === 'grabber') {
        newPeripheral.name = 'New Gripper';
        newPeripheral.pin = 5;
        newPeripheral.offsetX = 25;
      }

      return {
        ...prev,
        peripherals: [...prev.peripherals, newPeripheral]
      };
    });
  };

  const removePeripheral = (id) => {
    setHardwareConfig(prev => ({
      ...prev,
      peripherals: prev.peripherals.filter(p => p.id !== id)
    }));
  };

  const updatePeripheral = (id, key, value) => {
    setHardwareConfig(prev => ({
      ...prev,
      peripherals: prev.peripherals.map(p => {
        if (p.id === id) {
          const val = (key === 'name' || key === 'color') ? value : Number(value);

          return {
            ...p,
            [key]: val
          };
        }

        return p;
      })
    }));
  };

  const updateBaseLink = (key, value) => {
    setHardwareConfig(prev => ({
      ...prev,
      [key]: key === 'baseLinkColor' ? value : Math.max(10, Number(value))
    }));
  };

  const injectPoseOverride = () => {
    if (!robotRef.current) return;

    const x = uiRefs.current.inputs.x.value !== ""
      ? parseFloat(uiRefs.current.inputs.x.value)
      : robotRef.current.position.x;

    const y = uiRefs.current.inputs.y.value !== ""
      ? parseFloat(uiRefs.current.inputs.y.value)
      : robotRef.current.position.y;

    const yawDeg = uiRefs.current.inputs.yaw.value !== ""
      ? parseFloat(uiRefs.current.inputs.yaw.value)
      : (robotRef.current.angle * 180 / Math.PI);

    const yawRad = yawDeg * (Math.PI / 180);

    Matter.Body.setPosition(robotRef.current, { x, y });
    Matter.Body.setAngle(robotRef.current, yawRad);
    Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(robotRef.current, 0);

    const current = getWorkspaceConfig();

    localStorage.setItem('workspace-config', JSON.stringify({
      ...current,
      originX: x,
      originY: y,
      originYaw: yawRad
    }));

    setRuntimeLogs(prev => [
      ...prev,
      `> Robot position updated: [X:${Math.round(x)}, Y:${Math.round(y)}, Yaw:${yawDeg}°]`
    ]);
  };

  const haltSimulation = () => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }

    setSimState(false);

    tofSensorStatesRef.current = {};
    opticalSensorStatesRef.current = {};

    if (engineRef.current) {
      Object.values(endEffectorStatesRef.current).forEach(state => {
        if (state.constraints) {
          Matter.World.remove(engineRef.current.world, state.constraints);

          if (state.target) {
            Matter.Body.setMass(state.target, state.originalMass);
            state.target.collisionFilter.group = state.originalGroup || 0;
          }
        }
      });
    }

    endEffectorStatesRef.current = {};

    Object.values(uiRefs.current.pins).forEach(el => {
      if (el) el.className = "transition-colors duration-75 text-stone-400 dark:text-stone-500";
    });

    if (robotRef.current) {
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }

    sceneBodiesRef.current.forEach(body => {
      if (!body.isStatic) Matter.Body.setVelocity(body, { x: 0, y: 0 });
    });

    setRuntimeLogs(prev => [...prev, '> Simulation stopped.']);
  };

  const hardResetSimulation = () => {
    haltSimulation();

    if (uartConsoleRef.current) uartConsoleRef.current.textContent = "";

    const conf = getWorkspaceConfig();

    setSceneEntities(conf.sceneEntities || []);

    if (engineRef.current) {
      Matter.World.remove(engineRef.current.world, sceneBodiesRef.current);
      sceneBodiesRef.current = [];
    }

    rebuildScenePhysics(conf.sceneEntities || []);

    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: conf.originX, y: conf.originY });
      Matter.Body.setAngle(robotRef.current, conf.originYaw);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(robotRef.current, 0);
    }

    if (uiRefs.current.hud.portb) uiRefs.current.hud.portb.innerText = '00000000';

    const deg = (((conf.originYaw * (180 / Math.PI)) % 360) + 360) % 360;

    if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(conf.originX);
    if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(conf.originY);
    if (uiRefs.current.inputs.yaw) uiRefs.current.inputs.yaw.value = deg.toFixed(2);

    setRuntimeLogs(['> Board reset. Environment reloaded. Robot returned to saved origin.']);
  };

  const initializeVirtualCPU = (hexData) => {
    try {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }

      setRuntimeLogs(prev => [...prev, '> Allocating flash memory...']);

      const program = new Uint16Array(16384);
      loadHex(hexData, new Uint8Array(program.buffer));

      const cpu = new CPU(program);

      new AVRTimer(cpu, timer0Config);
      new AVRTimer(cpu, timer1Config);
      new AVRTimer(cpu, timer2Config);

      const usart = new AVRUSART(cpu, usart0Config, 16e6);
      new AVRADC(cpu, adcConfig);

      const analogValues = new Uint16Array(8);
      analogValues.fill(0);

      const sampleMapAnalog = (x, y) => {
        const img = environmentPixelDataRef.current;
        if (!img) return 1023;

        const ix = Math.floor(x);
        const iy = Math.floor(y);

        if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) {
          return 1023;
        }

        const idx = (iy * img.width + ix) * 4;

        const r = img.data[idx];
        const g = img.data[idx + 1];
        const b = img.data[idx + 2];
        const a = img.data[idx + 3];

        if (a < 16) return 1023;

        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

        const value = Math.round((luminance / 255) * 1023);

        return Math.max(0, Math.min(1023, value));
      };

      const updateAnalogSensors = () => {
        const robot = robotRef.current;
        if (!robot) return;

        const peripherals = hardwareConfigRef.current?.peripherals || [];
        
        // Reset all channels to 0 (unconnected/floating)
        analogValues.fill(0);

        const cos = Math.cos(robot.angle);
        const sin = Math.sin(robot.angle);

        // Iterate over all peripherals to support multiple sensors on different analog pins
        peripherals.forEach(p => {
          if (p.type === 'ir_led' || p.type === 'ir_sensor') {
            const sampleX = robot.position.x + p.offsetX * cos - p.offsetY * sin;
            const sampleY = robot.position.y + p.offsetX * sin + p.offsetY * cos;

            let channel = -1;
            if (p.pin >= 14 && p.pin <= 19) {
              channel = p.pin - 14; // A0 is 14, A1 is 15, etc.
            } else if (p.pin >= 0 && p.pin <= 5) {
              channel = p.pin;      // Fallback if user selected 0-5 directly
            }

            if (channel >= 0 && channel < 8) {
              analogValues[channel] = sampleMapAnalog(sampleX, sampleY);
            }
          }
        });
      };

      cpu.readHooks[0x78] = () => {
        const channel = cpu.data[0x7C] & 0x07;
        return analogValues[channel] & 0xff;
      };

      cpu.readHooks[0x79] = () => {
        const channel = cpu.data[0x7C] & 0x07;
        return (analogValues[channel] >> 8) & 0x03;
      };

      let serialBuffer = "";

      usart.onByteTransmit = (byte) => {
        if (byte === 13) return;

        const u2x0 = (cpu.data[0xC0] & 2) ? 8 : 16;
        const ubrr = cpu.data[0xC4] | (cpu.data[0xC5] << 8);

        const actualBaud = Math.round(16000000 / (u2x0 * (ubrr + 1)));

        const mismatchRatio = Math.abs(actualBaud - BAUD_RATE) / BAUD_RATE;

        if (mismatchRatio > 0.05) return;

        serialBuffer += String.fromCharCode(byte);
      };

      setSimState(true);

      setRuntimeLogs(prev => [...prev, '> Uploading sketch to virtual board...']);
      setRuntimeLogs(prev => [...prev, '> Running setup()...']);
      setRuntimeLogs(prev => [...prev, '> Running loop()...']);

      const ultrasonics = hardwareConfigRef.current.peripherals.filter(p => p.type === 'ultrasonic');

      const ultrasonicDefs = ultrasonics.map(p => {
        let portAddr, bit;

        if (p.triggerPin >= 0 && p.triggerPin <= 7) {
          portAddr = 0x2B;
          bit = p.triggerPin;
        } else if (p.triggerPin >= 8 && p.triggerPin <= 13) {
          portAddr = 0x25;
          bit = p.triggerPin - 8;
        } else {
          portAddr = 0x28;
          bit = p.triggerPin - 14;
        }

        return {
          id: p.id,
          portAddr,
          mask: 1 << bit,
          echoPin: p.echoPin,
          maxRange: p.range || 400,
          offsetX: p.offsetX,
          offsetY: p.offsetY,
          angle: p.angle
        };
      });

      const executeFrame = () => {
        if (!isRunningRef.current) return;

        try {
          updateAnalogSensors();

          for (let i = 0; i < 150000; i++) {
            avrInstruction(cpu);
            cpu.tick();

            if (i % 64 === 0 && robotRef.current) {
              const cycle = cpu.cycles;

              for (let s = 0; s < ultrasonicDefs.length; s++) {
                const sd = ultrasonicDefs[s];

                const isTrigHigh = (cpu.data[sd.portAddr] & sd.mask) !== 0;

                const state = tofSensorStatesRef.current[sd.id] || {
                  lastTrig: false,
                  echoStart: 0,
                  echoEnd: 0,
                  lastDist: sd.maxRange
                };

                if (isTrigHigh && !state.lastTrig) {
                  const robX = robotRef.current.position.x;
                  const robY = robotRef.current.position.y;

                  const robCos = Math.cos(robotRef.current.angle);
                  const robSin = Math.sin(robotRef.current.angle);

                  const sensorGlobalX = robX + (sd.offsetX * robCos) - (sd.offsetY * robSin);
                  const sensorGlobalY = robY + (sd.offsetX * robSin) + (sd.offsetY * robCos);

                  const pAngleRad = robotRef.current.angle + (sd.angle || 0) * (Math.PI / 180);

                  const allBodies = Matter.Composite.allBodies(engineRef.current.world);

                  const validBodies = allBodies.filter(b =>
                    b !== robotRef.current &&
                    !robotRef.current.parts.includes(b) &&
                    !b.isSensor
                  );

                  let hitDist = sd.maxRange;

                  for (let d = 5; d <= sd.maxRange; d += 5) {
                    const pt = {
                      x: sensorGlobalX + Math.cos(pAngleRad) * d,
                      y: sensorGlobalY + Math.sin(pAngleRad) * d
                    };

                    if (Matter.Query.point(validBodies, pt).length > 0) {
                      hitDist = d;
                      break;
                    }
                  }

                  state.lastDist = hitDist;
                  state.echoStart = cycle + 7200;
                  state.echoEnd = state.echoStart + (hitDist * 58 * 16);
                }

                state.lastTrig = isTrigHigh;
                tofSensorStatesRef.current[sd.id] = state;
              }
            }

            if (i % 16 === 0) {
              const cycle = cpu.cycles;

              for (let s = 0; s < ultrasonicDefs.length; s++) {
                const sd = ultrasonicDefs[s];
                const state = tofSensorStatesRef.current[sd.id];

                if (state) {
                  const isEchoing = cycle >= state.echoStart && cycle <= state.echoEnd;
                  setExternalPin(cpu, sd.echoPin, isEchoing);
                }
              }
            }
          }

          if (serialBuffer.length > 0 && uartConsoleRef.current) {
            uartConsoleRef.current.textContent += serialBuffer;
            uartConsoleRef.current.scrollTop = uartConsoleRef.current.scrollHeight;

            serialBuffer = "";
          }

          if (uiRefs.current.hud.portb) {
            uiRefs.current.hud.portb.innerText = cpu.data[0x25].toString(2).padStart(8, '0');
          }

          const robot = robotRef.current;

          const mouseBody = mouseConstraintRef.current?.body;
          const isDraggingRobot = (mouseBody === robot);

          if (!isDraggingRobot && robot) {
            let localVx = 0;
            let localVy = 0;
            let angularVelocity = 0;

            hardwareConfigRef.current.peripherals.forEach(peripheral => {
              if (peripheral.type === 'dc_motor') {
                const [vx, vy, torque] = processActuator(cpu, peripheral, uiRefs.current.pins);

                localVx += vx;
                localVy += vy;
                angularVelocity += torque;
              } else if (peripheral.type === 'ir_led' || peripheral.type === 'ir_sensor') {
                processOpticalSensor(cpu, peripheral, opticalSensorStatesRef.current, uiRefs.current.pins);
              } else if (peripheral.type === 'ultrasonic') {
                processToFSensor(cpu, peripheral, tofSensorStatesRef.current, uiRefs.current.pins);
              } else if (peripheral.type === 'grabber') {
                processEndEffector(cpu, peripheral, robot, engineRef.current, endEffectorStatesRef.current, uiRefs.current.pins);
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
          setRuntimeLogs(prev => [...prev, '> FATAL ERROR: ' + e.message]);
          setSimState(false);
        }
      };

      requestRef.current = requestAnimationFrame(executeFrame);
    } catch (err) {
      setRuntimeLogs(prev => [...prev, '> CPU Initialization Error: ' + err.message]);
      setSimState(false);
    }
  };

  const flashAndExecute = async () => {
    if (isRunningRef.current) return;

    setSimState(true);
    if (uartConsoleRef.current) uartConsoleRef.current.textContent = "";

    setRuntimeLogs(['> Compiling sketch...']);

    let response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      response = await fetch(CROSS_COMPILER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sketch: sourceCode,
          board: "uno"
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);

      const reason = err.name === 'AbortError'
        ? 'Connection timed out.'
        : err.message;

      setRuntimeLogs(prev => [
        ...prev,
        '> Compilation server error: ' + reason,
        `> Verify the build server is running at ${CROSS_COMPILER_ENDPOINT}`
      ]);

      setSimState(false);
      return;
    }

    let data = null;

    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }

    if (!response.ok || !data || !data.hex) {
      const errorMessage =
        data?.stderr ||
        data?.compilerErrors ||
        data?.message ||
        `HTTP ${response.status}`;

      setRuntimeLogs(prev => [
        ...prev,
        '> Compilation failed:',
        errorMessage
      ]);

      setSimState(false);
      return;
    }

    setRuntimeLogs(prev => [
      ...prev,
      '> Compilation successful. Uploading to virtual board...'
    ]);

    initializeVirtualCPU(data.hex);
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
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(168, 162, 158, 0.3);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(168, 162, 158, 0.5);
        }
      `}</style>

      <header className="h-12 border-b border-stone-200 dark:border-stone-800 flex items-center px-5 gap-4 bg-stone-50 dark:bg-stone-950 shrink-0">
        <div className="flex items-center gap-2.5">
          <Box size={18} className="text-stone-500 dark:text-stone-400" />
          <span className="font-semibold text-sm tracking-tight">Arduino Robot Simulator</span>
        </div>

        <div className="h-5 w-px bg-stone-300 dark:bg-stone-700 mx-1" />

        <button
          onClick={flashAndExecute}
          disabled={isRunning}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
            isRunning
              ? 'bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-600'
              : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
          }`}
        >
          <Play size={13} fill="currentColor" /> Upload
        </button>

        <button
          onClick={haltSimulation}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 transition-colors"
        >
          <Square size={13} fill="currentColor" /> Stop
        </button>

        <button
          onClick={hardResetSimulation}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 transition-colors"
        >
          <RotateCcw size={13} /> Reset
        </button>

        <div className="flex-1" />

        <label className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 cursor-pointer transition-colors">
          <Upload size={13}/> Import Config
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={importWorkspaceConfig}
          />
        </label>

        <button
          onClick={exportWorkspaceConfig}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors"
        >
          <Download size={13}/> Export Config
        </button>

        <button
          onClick={restoreFactoryDefaults}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
        >
          <RefreshCcw size={13}/> Restore Defaults
        </button>
      </header>

      <main className="flex-1 flex overflow-hidden bg-stone-100 dark:bg-stone-900" ref={mainContainerRef}>
        <div style={{ width: `${leftWidth}%` }} ref={leftPanelRef} className="flex flex-col overflow-hidden">
          <div style={{ height: `${editorHeight}%` }} className="flex flex-col overflow-hidden border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
            <SourceEditor
              sourceCode={sourceCode}
              setSourceCode={setSourceCode}
              editorTheme={editorTheme}
            />
          </div>

          <Resizer
            direction="horizontal"
            onMouseDown={(e) => handleDrag(e, setEditorHeight, 'horizontal', leftPanelRef)}
          />

          <div className="flex-1 overflow-hidden border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
            <TelemetryConsole
              runtimeLogs={runtimeLogs}
              runtimeLogEndRef={runtimeLogEndRef}
              uartConsoleRef={uartConsoleRef}
            />
          </div>
        </div>

        <Resizer
          direction="vertical"
          onMouseDown={(e) => handleDrag(e, setLeftWidth, 'vertical', mainContainerRef)}
        />

        <div className="flex-1 flex flex-col overflow-hidden" ref={rightPanelRef}>
          <div style={{ height: `${canvasHeight}%` }} className="flex flex-col overflow-hidden">
            <PhysicsViewport
              environmentMap={environmentMap}
              handleMapImport={handleMapImport}
              clearEnvironmentMap={clearEnvironmentMap}
              sceneRef={sceneRef}
            />
          </div>

          <Resizer
            direction="horizontal"
            onMouseDown={(e) => handleDrag(e, setCanvasHeight, 'horizontal', rightPanelRef)}
          />

          <div className="flex-1 overflow-hidden bg-stone-50 dark:bg-stone-950">
            <WorkspaceInspector
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              hardwareConfig={hardwareConfig}
              updateBaseLink={updateBaseLink}
              updatePeripheral={updatePeripheral}
              removePeripheral={removePeripheral}
              selectedPeripheral={selectedPeripheral}
              setSelectedPeripheral={setSelectedPeripheral}
              addPeripheral={addPeripheral}
              sceneEntities={sceneEntities}
              addSceneEntity={addSceneEntity}
              removeSceneEntity={removeSceneEntity}
              updateSceneEntity={updateSceneEntity}
              injectPoseOverride={injectPoseOverride}
              uiRefs={uiRefs}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;