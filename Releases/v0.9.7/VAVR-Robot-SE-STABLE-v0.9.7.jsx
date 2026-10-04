import React, { useState, useRef, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import JSZip from 'jszip';
import { 
  Play, Square, RotateCcw, Download, Upload, 
  RefreshCcw, ImagePlus, Trash2, X, Box, Plus 
} from 'lucide-react';
import Matter from 'matter-js';
import { 
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config, 
  AVRUSART, usart0Config
} from 'avr8js'; 

// ==========================================
// 1. CONSTANTS & DEFAULTS
// ==========================================
const PIXELS_PER_CM = 1;
const CPU_CLOCK_HZ = 16000000;
const CPU_CLOCK_MHZ = 16;
const BAUD_RATE = 115200;

const TYPE_TAGS = {
  dc_motor: 'DC MOTOR',
  ir_led_sensor: 'IR LED SENSOR',
  ultrasonic_sensor: 'ULTRASONIC SENSOR',
  grabber: 'GRIPPER',
  rgb_sensor: 'RGB SENSOR'
};

const DEFAULT_COLORS = {
  base_link: '#60a5fa',
  dc_motor: '#1e293b',
  ultrasonic_sensor: '#f87171',
  ir_led_sensor: '#c084fc',
  grabber: '#22d3ee',
  rgb_sensor: '#fbbf24',
  static_body: '#64748b',
  dynamic_body: '#c084fc'
};

const generateId = () => Math.random().toString(36).substring(2, 11);

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
        id: 'default_left_motor',
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
        id: 'default_right_motor',
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

const defaultSourceCode = `void setup() {\n\n}\n\nvoid loop() {\n\n}`;

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
  { value: 'ultrasonic_sensor', label: 'Ultrasonic Sensor' },
  { value: 'ir_led_sensor', label: 'IR LED Sensor' },
  { value: 'grabber', label: 'Gripper' },
  { value: 'rgb_sensor', label: 'RGB Sensor' }
].map(o => <option key={o.value} value={o.value}>{o.label}</option>);

// ==========================================
// 2. UTILITIES
// ==========================================
const getWorkspaceConfig = () => {
  try {
    const saved = localStorage.getItem('workspace-config');
    if (saved) {
      const parsed = JSON.parse(saved);
      const hwConfig = parsed.hardwareConfig || {};
      if (!hwConfig.peripherals) {
         hwConfig.peripherals = DEFAULT_WORKSPACE_CONFIG.hardwareConfig.peripherals.map(p => ({ ...p, id: generateId() }));
      }
      return { 
        ...DEFAULT_WORKSPACE_CONFIG, 
        ...parsed,
        hardwareConfig: { 
          ...DEFAULT_WORKSPACE_CONFIG.hardwareConfig, 
          ...hwConfig
        }
      };
    }
  } catch (e) {}
  return {
    ...DEFAULT_WORKSPACE_CONFIG,
    hardwareConfig: {
      ...DEFAULT_WORKSPACE_CONFIG.hardwareConfig,
      peripherals: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.peripherals.map(p => ({ ...p, id: generateId() }))
    }
  };
};

const getOppositeColor = (hex) => {
  if (!hex || typeof hex !== 'string') return '#000000';
  if (hex.startsWith('#')) hex = hex.slice(1);
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
  let upperAddress = 0;
  for (const line of source.split('\n')) {
    if (!line || line[0] !== ':') continue;
    const bytes = parseInt(line.substring(1, 3), 16);
    const addr = parseInt(line.substring(3, 7), 16);
    const type = parseInt(line.substring(7, 9), 16);

    if (type === 0) { 
      const fullAddr = (upperAddress + addr) & 0x00FFFFFF;
      for (let i = 0; i < bytes; i++) {
        const byteAddr = fullAddr + i;
        if (byteAddr < target.length) {
          target[byteAddr] = parseInt(line.substring(9 + i * 2, 11 + i * 2), 16);
        }
      }
    } else if (type === 4) { 
      upperAddress = parseInt(line.substring(9, 13), 16) * 0x10000;
    } else if (type === 1) { 
      break;
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
  
  if (pin === 9 && (cpu.data[0x80] & (1 << 7))) {
    const val16 = cpu.data[0x88] | (cpu.data[0x89] << 8);
    const wgm = (cpu.data[0x80] & 0x03) | ((cpu.data[0x81] & 0x18) >> 1);
    const is8BitMode = (wgm === 1 || wgm === 5);
    const is9BitMode = (wgm === 2 || wgm === 6);
    const is10BitMode = (wgm === 3 || wgm === 7);
    if (is8BitMode) return cpu.data[0x88]; 
    if (is9BitMode) return Math.round((val16 / 511) * 255);
    if (is10BitMode) return Math.round((val16 / 1023) * 255);
    return Math.round((val16 / 65535) * 255);
  }
  if (pin === 10 && (cpu.data[0x80] & (1 << 5))) {
    const val16 = cpu.data[0x8A] | (cpu.data[0x8B] << 8);
    const wgm = (cpu.data[0x80] & 0x03) | ((cpu.data[0x81] & 0x18) >> 1);
    const is8BitMode = (wgm === 1 || wgm === 5);
    const is9BitMode = (wgm === 2 || wgm === 6);
    const is10BitMode = (wgm === 3 || wgm === 7);
    if (is8BitMode) return cpu.data[0x8A]; 
    if (is9BitMode) return Math.round((val16 / 511) * 255);
    if (is10BitMode) return Math.round((val16 / 1023) * 255);
    return Math.round((val16 / 65535) * 255);
  }
  
  if (pin === 11 && (cpu.data[0xB0] & (1 << 7))) return cpu.data[0xB3]; 

  return getPinState(cpu, pin) ? 255 : 0;
};

const setExternalPin = (cpu, pin, isHigh, externalPinStates) => {
  externalPinStates[pin] = isHigh;
};

const setCPUReadHook = (cpu, addr, callback) => {
  if (typeof cpu.onRead === 'function') {
    cpu.onRead(addr, callback);
  } else {
    cpu.readHooks[addr] = callback;
  }
};

const setCPUWriteHook = (cpu, addr, callback) => {
  if (typeof cpu.onWrite === 'function') {
    cpu.onWrite(addr, callback);
  } else {
    cpu.writeHooks[addr] = callback;
  }
};

// ==========================================
// 3. DRAWING HELPERS
// ==========================================
const renderOpticalBeam = (ctx, p, state, robot, oppColor, hexColor, mapPixelData, engine, validBodies, vOffX, vOffY) => {
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

    const localX = p.offsetX - vOffX;
    const localY = p.offsetY - vOffY;

    for (let i = 0; i < numRays; i++) {
      const rayRelAngle = pAngleRad - halfSpreadRad + (spreadDeg * (Math.PI / 180) * (i / (numRays - 1)));
      const rayGlobalAngle = robot.angle + rayRelAngle;

      const tipGlobalX = robot.position.x + (localX * cosR) - (localY * sinR);
      const tipGlobalY = robot.position.y + (localX * sinR) + (localY * cosR);

      let hitDist = maxRange;
      let physicalHit = false;

      if (engine && validBodies) {
        for (let d = 2; d <= maxRange; d += 2) {
          const ptX = tipGlobalX + Math.cos(rayGlobalAngle) * d;
          const ptY = tipGlobalY + Math.sin(rayGlobalAngle) * d;
          if (Matter.Query.point(validBodies, { x: ptX, y: ptY }).length > 0) {
            hitDist = d;
            physicalHit = true;
            break;
          }
        }
      }

      if (!physicalHit && mapPixelData) {
        for (let d = 2; d <= maxRange; d += 2) {
          const ptX = tipGlobalX + Math.cos(rayGlobalAngle) * d;
          const ptY = tipGlobalY + Math.sin(rayGlobalAngle) * d;

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

const renderUltrasonicSensor = (ctx, p, state, hexColor) => {
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

const renderRGBSensor = (ctx, p, state, hexColor) => {
  const pAngleRad = (p.angle || 0) * (Math.PI / 180);
  
  ctx.save();
  ctx.translate(p.offsetX, p.offsetY);
  ctx.rotate(pAngleRad);
  
  ctx.fillStyle = hexColor || '#1e293b';
  ctx.fillRect(-4, -5, 8, 10);
  
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(-1.5, -2.5, 1.2, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(1.5, -2.5, 1.2, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.arc(0, 1.5, 1.2, 0, Math.PI*2); ctx.fill();
  
  ctx.restore();
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

const renderRobotAssembly = (ctx, robot, buildConfig, states, mapPixelData, engine, validBodies) => {
  ctx.save();
  ctx.translate(robot.position.x, robot.position.y);
  ctx.rotate(robot.angle);

  const vOffX = robot.plugin?.visualOffsetX || 0;
  const vOffY = robot.plugin?.visualOffsetY || 0;
  ctx.translate(-vOffX, -vOffY);

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
    } else if (p.type === 'ir_led_sensor') {
      renderOpticalBeam(ctx, p, states.optical[p.id], robot, oppColor, hexColor, mapPixelData, engine, validBodies, vOffX, vOffY);
    } else if (p.type === 'ultrasonic_sensor') {
      renderUltrasonicSensor(ctx, p, states.ultrasonic[p.id], hexColor);
    } else if (p.type === 'rgb_sensor') {
      renderRGBSensor(ctx, p, null, hexColor);
    } else {
      renderGenericPeripheral(ctx, p);
    }
  });

  ctx.restore();
};

// ==========================================
// 4. SIMULATION LOGIC HELPERS
// ==========================================
const processActuator = (cpu, part, pinUis, robot) => {
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
    
    const vOffX = robot.plugin?.visualOffsetX || 0;
    const vOffY = robot.plugin?.visualOffsetY || 0;
    const localX = part.offsetX - vOffX;
    const localY = part.offsetY - vOffY;
    
    const torque = (localX * forceY) - (localY * forceX);

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

const processUltrasonicSensor = (cpu, part, ultrasonicStates, pinUis) => {
  const state = ultrasonicStates[part.id];
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
    originalGroup: 0
  };

  const robCos = Math.cos(robot.angle);
  const robSin = Math.sin(robot.angle);
  
  const vOffX = robot.plugin?.visualOffsetX || 0;
  const vOffY = robot.plugin?.visualOffsetY || 0;

  if (isHigh && !state.isHigh) {
    const reach = 20; 

    const tipLocalX = part.offsetX + Math.cos((part.angle || 0) * Math.PI / 180) * reach;
    const tipLocalY = part.offsetY + Math.sin((part.angle || 0) * Math.PI / 180) * reach;

    const tipLocalXMatter = tipLocalX - vOffX;
    const tipLocalYMatter = tipLocalY - vOffY;

    const tipGlobalX = robot.position.x + (tipLocalXMatter * robCos) - (tipLocalYMatter * robSin);
    const tipGlobalY = robot.position.y + (tipLocalXMatter * robSin) + (tipLocalYMatter * robCos);

    const bounds = {
      min: { x: tipGlobalX - 10, y: tipGlobalY - 10 },
      max: { x: tipGlobalX + 10, y: tipGlobalY + 10 }
    };

    const validBodies = Matter.Composite.allBodies(engine.world)
      .filter(b => b.plugin && b.plugin.isGraspable && !b.isStatic);

    const hits = validBodies.filter(b => Matter.Bounds.overlaps(b.bounds, bounds));

    if (hits.length > 0) {
      const target = hits[0];

      state.target = target;
      state.originalGroup = target.collisionFilter.group;

      target.collisionFilter.group = -1;

      const c1 = Matter.Constraint.create({
        bodyA: robot,
        bodyB: target,
        pointA: { x: tipLocalX - vOffX, y: tipLocalY - vOffY },
        pointB: { x: 0, y: 0 },
        stiffness: 0.9,
        damping: 0.05,
        length: 0,
        render: { visible: false }
      });

      const baseLocalX = part.offsetX;
      const baseLocalY = part.offsetY;

      const baseGlobalX = robot.position.x + ((baseLocalX - vOffX) * robCos) - ((baseLocalY - vOffY) * robSin);
      const baseGlobalY = robot.position.y + ((baseLocalX - vOffX) * robSin) + ((baseLocalY - vOffY) * robCos);

      const dx = baseGlobalX - tipGlobalX;
      const dy = baseGlobalY - tipGlobalY;

      const tarCos = Math.cos(-target.angle);
      const tarSin = Math.sin(-target.angle);

      const targetLocalBaseX = dx * tarCos - dy * tarSin;
      const targetLocalBaseY = dx * tarSin + dy * tarCos;

      const c2 = Matter.Constraint.create({
        bodyA: robot,
        bodyB: target,
        pointA: { x: baseLocalX - vOffX, y: baseLocalY - vOffY },
        pointB: { x: targetLocalBaseX, y: targetLocalBaseY },
        stiffness: 0.9,
        damping: 0.05,
        length: 0,
        render: { visible: false }
      });

      Matter.World.add(engine.world, [c1, c2]);
      state.constraints = [c1, c2];
    }
  } else if (!isHigh && state.isHigh && state.constraints) {
    if (Array.isArray(state.constraints)) {
      state.constraints.forEach(c => Matter.World.remove(engine.world, c));
    } else {
      Matter.World.remove(engine.world, state.constraints);
    }

    if (state.target) {
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
        isVertical ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
      }`}
    >
      <div className={`bg-stone-200 dark:bg-stone-700 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 transition-colors ${
        isVertical ? 'w-px h-full' : 'h-px w-full'
      }`} />
    </div>
  );
};

const Input = React.forwardRef(({ type, value, onChange, className, ...props }, ref) => {
  const [localValue, setLocalValue] = useState(String(value ?? ''));
  const [isFocused, setIsFocused] = useState(false);
  
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(value ?? ''));
    }
  }, [value, isFocused]);

  const handleChange = (e) => {
    const raw = e.target.value;
    if (type === 'number') {
      setLocalValue(raw);
      if (raw === '' || raw === '-' || raw.endsWith('.') || raw.endsWith('.0')) {
         return; 
      }
      const num = Number(raw);
      const currentVal = (value === '' || value === null || value === undefined) ? 0 : Number(value);
      if (!isNaN(num) && onChange && num !== currentVal) onChange(num);
    } else {
      if (onChange && raw !== String(value ?? '')) onChange(raw);
    }
  };

  const handleBlur = (e) => {
    setIsFocused(false);
    if (type === 'number') {
      const num = parseFloat(e.target.value);
      const finalVal = (isNaN(num) || !isFinite(num)) ? 0 : num;
      setLocalValue(String(finalVal));
      const currentVal = (value === '' || value === null || value === undefined) ? 0 : Number(value);
      if (onChange && finalVal !== currentVal) onChange(finalVal);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  return (
    <input 
      ref={ref}
      type="text" 
      inputMode={type === 'number' ? 'decimal' : 'text'}
      value={localValue} 
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      className={`bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center text-[11px] ${className || ''}`} 
      {...props} 
    />
  );
});

const SourceEditor = ({ tabs, activeTabId, setActiveTabId, editorTheme, addTab, closeTab, handleEditorChange }) => {
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  return (
    <div className="flex flex-col h-full">
      <div className="flex bg-stone-100 dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 text-[11px] shrink-0">
        {tabs.map(tab => (
          <div key={tab.id} className={`flex items-center px-2 py-1 cursor-pointer border-r border-stone-200 dark:border-stone-800 ${tab.id === activeTabId ? 'bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100' : 'text-stone-500'}`} onClick={() => setActiveTabId(tab.id)}>
            {tab.name}
            {tabs.length > 1 && <button onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} className="ml-1.5 text-rose-500 hover:text-rose-700"><X size={10} /></button>}
          </div>
        ))}
        <button onClick={addTab} className="px-2 py-1 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"><Plus size={12} /></button>
      </div>
      <div className="flex-1 min-h-0">
        <Editor height="100%" defaultLanguage="cpp" theme={editorTheme} value={activeTab?.content || ''} onChange={handleEditorChange} options={{ minimap: { enabled: false }, fontSize: 12, lineNumbers: 'on' }} />
      </div>
    </div>
  );
};

const TelemetryConsole = ({ runtimeLogs, runtimeLogEndRef, uartConsoleRef }) => (
  <div className="flex h-full text-[11px] font-mono">
    <div className="w-1/2 flex flex-col border-r border-stone-200 dark:border-stone-800">
      <div className="px-2 py-1 border-b border-stone-200 dark:border-stone-800 font-sans font-bold text-stone-600 dark:text-stone-400">Output</div>
      <div className="flex-1 p-1.5 overflow-y-auto custom-scrollbar">
        {runtimeLogs.map((log, i) => <div key={i}>{log}</div>)}
        <div ref={runtimeLogEndRef} />
      </div>
    </div>
    <div className="w-1/2 flex flex-col">
      <div className="px-2 py-1 border-b border-stone-200 dark:border-stone-800 font-sans font-bold text-stone-600 dark:text-stone-400">Serial 115200</div>
      <div ref={uartConsoleRef} className="flex-1 p-1.5 overflow-y-auto whitespace-pre-wrap custom-scrollbar" />
    </div>
  </div>
);

const PhysicsViewport = ({ environmentMap, handleMapImport, clearEnvironmentMap, sceneRef }) => (
  <div className="flex flex-col h-full">
    <div className="flex items-center justify-between px-2 py-1 border-b border-stone-200 dark:border-stone-800 text-[11px] shrink-0">
      <span className="font-bold text-stone-600 dark:text-stone-400">Viewport</span>
      <div className="flex gap-2">
        {environmentMap && <button onClick={clearEnvironmentMap} className="flex items-center gap-1 hover:text-rose-500"><Trash2 size={10}/> Clear</button>}
        <label className="flex items-center gap-1 cursor-pointer hover:text-stone-900 dark:hover:text-stone-100">
          <ImagePlus size={10}/> Import
          <input type="file" accept="image/*" className="hidden" onChange={handleMapImport} />
        </label>
      </div>
    </div>
    <div className="flex-1 relative" style={{ backgroundImage: environmentMap ? `url(${environmentMap})` : 'radial-gradient(circle, #d6d3d1 1px, transparent 1px)', backgroundSize: environmentMap ? 'auto' : '24px 24px', backgroundPosition: 'center', backgroundRepeat: environmentMap ? 'no-repeat' : 'repeat' }}>
      <div ref={sceneRef} className="absolute inset-0" />
    </div>
  </div>
);

const HardwareConfig = ({ hardwareConfig, updateBaseLink, updatePeripheral, removePeripheral, addPeripheral, selectedPeripheral, setSelectedPeripheral, uiRefs }) => (
  <div className="space-y-2 text-[11px]">
    <div className="flex items-center justify-between">
      <span className="font-bold text-stone-600 dark:text-stone-400">Chassis</span>
      <div className="flex gap-1.5 items-center">
        <input type="color" value={hardwareConfig.baseLinkColor} onChange={e => updateBaseLink('baseLinkColor', e.target.value)} className="w-5 h-5 rounded cursor-pointer" />
        <Input type="number" value={hardwareConfig.baseLinkW} onChange={v => updateBaseLink('baseLinkW', v)} className="w-10" />
        <Input type="number" value={hardwareConfig.baseLinkH} onChange={v => updateBaseLink('baseLinkH', v)} className="w-10" />
      </div>
    </div>
    <div className="flex items-center justify-between">
      <span className="font-bold text-stone-600 dark:text-stone-400">Components</span>
      <div className="flex gap-1.5 items-center">
        <select value={selectedPeripheral} onChange={e => setSelectedPeripheral(e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PART_OPTIONS}</select>
        <button onClick={() => addPeripheral(selectedPeripheral)} className="text-blue-500 hover:text-blue-600">+ Add</button>
      </div>
    </div>
    {hardwareConfig.peripherals.map(p => (
      <div key={p.id} className="p-1.5 border border-stone-200 dark:border-stone-800 rounded space-y-1.5 relative">
        <button onClick={() => removePeripheral(p.id)} className="absolute top-1 right-1 text-stone-400 hover:text-rose-500"><X size={10}/></button>
        <div className="flex items-center gap-1.5 pr-3">
          <span ref={el => uiRefs.current.pins[p.id] = el}>●</span>
          <span className="font-bold">{TYPE_TAGS[p.type]}</span>
          <Input value={p.name} onChange={v => updatePeripheral(p.id, 'name', v)} className="flex-1 text-left" />
          <input type="color" value={p.color} onChange={e => updatePeripheral(p.id, 'color', e.target.value)} className="w-4 h-4 rounded cursor-pointer" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.type === 'dc_motor' && <>
            <label>PWM <select value={p.pin} onChange={e => updatePeripheral(p.id, 'pin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
            <label>DIR <select value={p.directionPin} onChange={e => updatePeripheral(p.id, 'directionPin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
          </>}
          {(p.type === 'ir_led_sensor' || p.type === 'grabber') && (
            <label>Pin <select value={p.pin} onChange={e => updatePeripheral(p.id, 'pin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
          )}
          {p.type === 'ultrasonic_sensor' && <>
            <label>Trig <select value={p.triggerPin} onChange={e => updatePeripheral(p.id, 'triggerPin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
            <label>Echo <select value={p.echoPin} onChange={e => updatePeripheral(p.id, 'echoPin', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
            <label>Range <Input type="number" value={p.range} onChange={v => updatePeripheral(p.id, 'range', v)} className="w-10" /></label>
          </>}
          {p.type === 'rgb_sensor' && <>
            <label>R <select value={p.pinR} onChange={e => updatePeripheral(p.id, 'pinR', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
            <label>G <select value={p.pinG} onChange={e => updatePeripheral(p.id, 'pinG', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
            <label>B <select value={p.pinB} onChange={e => updatePeripheral(p.id, 'pinB', e.target.value)} className="bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none">{PIN_OPTIONS}</select></label>
          </>}
          <label>X <Input type="number" value={p.offsetX} onChange={v => updatePeripheral(p.id, 'offsetX', v)} className="w-10" /></label>
          <label>Y <Input type="number" value={p.offsetY} onChange={v => updatePeripheral(p.id, 'offsetY', v)} className="w-10" /></label>
          <label>° <Input type="number" value={p.angle} onChange={v => updatePeripheral(p.id, 'angle', v)} className="w-10" /></label>
        </div>
      </div>
    ))}
  </div>
);

const EnvironmentConfig = ({ sceneEntities, addSceneEntity, removeSceneEntity, updateSceneEntity, uiRefs }) => (
  <div className="space-y-2 text-[11px]">
    <div className="flex justify-between items-center">
      <span className="font-bold text-stone-600 dark:text-stone-400">Environment</span>
      <button onClick={addSceneEntity} className="text-purple-500 hover:text-purple-600 flex items-center gap-1"><Box size={10}/> Add</button>
    </div>
    {sceneEntities.map(e => (
      <div key={e.id} className="p-1.5 border border-stone-200 dark:border-stone-800 rounded space-y-1.5 relative">
        <button onClick={() => removeSceneEntity(e.id)} className="absolute top-1 right-1 text-stone-400 hover:text-rose-500"><X size={10}/></button>
        <div className="flex items-center gap-1.5 pr-3">
          <span className={`text-[9px] font-bold px-1 rounded ${e.isStatic ? 'bg-stone-200 dark:bg-stone-800' : 'bg-purple-200 dark:bg-purple-900'}`}>{e.isStatic ? 'STATIC' : 'DYNAMIC'}</span>
          <Input value={e.name} onChange={v => updateSceneEntity(e.id, 'name', v)} className="flex-1 text-left" />
          <input type="color" value={e.color} onChange={ev => updateSceneEntity(e.id, 'color', ev.target.value)} className="w-4 h-4 rounded cursor-pointer" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <label>W <Input type="number" value={e.w} onChange={v => updateSceneEntity(e.id, 'w', v)} className="w-9" /></label>
          <label>H <Input type="number" value={e.h} onChange={v => updateSceneEntity(e.id, 'h', v)} className="w-9" /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={e.isStatic} onChange={ev => updateSceneEntity(e.id, 'isStatic', ev.target.checked)} /> Static</label>
          <label className="flex items-center gap-1"><input type="checkbox" disabled={e.isStatic} checked={!e.isStatic && e.isGraspable} onChange={ev => updateSceneEntity(e.id, 'isGraspable', ev.target.checked)} /> Grasp</label>
        </div>
        <div className="flex gap-1.5">
          <label>X <Input ref={el => uiRefs.current.arena[`x-${e.id}`] = el} type="number" value={Math.round(e.x)} onChange={v => updateSceneEntity(e.id, 'x', v)} className="w-10" /></label>
          <label>Y <Input ref={el => uiRefs.current.arena[`y-${e.id}`] = el} type="number" value={Math.round(e.y)} onChange={v => updateSceneEntity(e.id, 'y', v)} className="w-10" /></label>
          <label>° <Input ref={el => uiRefs.current.arena[`ang-${e.id}`] = el} type="number" value={e.angle} onChange={v => updateSceneEntity(e.id, 'angle', v)} className="w-10" /></label>
        </div>
      </div>
    ))}
  </div>
);

const OdometryPanel = ({ injectPoseOverride, uiRefs }) => (
  <div className="space-y-2 text-[11px]">
    <div className="grid grid-cols-2 gap-1.5 font-mono">
      <div>PORTB: <span ref={el => uiRefs.current.hud.portb = el}>00000000</span></div>
      <div>X: <span ref={el => uiRefs.current.hud.x = el}>0</span></div>
      <div>Y: <span ref={el => uiRefs.current.hud.y = el}>0</span></div>
      <div>YAW: <span ref={el => uiRefs.current.hud.yaw = el}>0.00</span>°</div>
    </div>
    <div className="pt-1.5 border-t border-stone-200 dark:border-stone-800">
      <div className="font-bold mb-1.5 text-stone-600 dark:text-stone-400">Position Override</div>
      <div className="grid grid-cols-3 gap-1.5 mb-1.5">
        <label>X <Input ref={el => uiRefs.current.inputs.x = el} type="number" className="w-full" /></label>
        <label>Y <Input ref={el => uiRefs.current.inputs.y = el} type="number" className="w-full" /></label>
        <label>° <Input ref={el => uiRefs.current.inputs.yaw = el} type="number" className="w-full" /></label>
      </div>
      <button onClick={injectPoseOverride} className="w-full py-0.5 bg-stone-200 dark:bg-stone-800 rounded hover:bg-stone-300 dark:hover:bg-stone-700">Set Position</button>
    </div>
  </div>
);

const WorkspaceInspector = ({ activeTab, setActiveTab, ...props }) => (
  <div className="flex flex-col h-full">
    <div className="flex border-b border-stone-200 dark:border-stone-800 text-[11px] shrink-0">
      {['hardware', 'environment', 'odometry'].map(t => (
        <button key={t} onClick={() => setActiveTab(t)} className={`px-2 py-1 capitalize ${activeTab === t ? 'bg-stone-200 dark:bg-stone-800 font-bold' : 'text-stone-500'}`}>{t}</button>
      ))}
    </div>
    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
      {activeTab === 'hardware' && <HardwareConfig {...props} />}
      {activeTab === 'environment' && <EnvironmentConfig {...props} />}
      {activeTab === 'odometry' && <OdometryPanel {...props} />}
    </div>
  </div>
);

// ==========================================
// 6. MAIN APP COMPONENT
// ==========================================
const CROSS_COMPILER_ENDPOINT = window.__COMPILER_ENDPOINT__ || 'http://localhost:8080/build';

function App() {
  const initialWorkspaceConfig = getWorkspaceConfig();

  const [tabs, setTabs] = useState(() => {
    try {
      const saved = localStorage.getItem('editor-tabs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [{ id: generateId(), name: 'main.ino', content: defaultSourceCode }];
  });

  const [activeTabId, setActiveTabId] = useState(() => {
    try {
      return localStorage.getItem('editor-active-tab') || null;
    } catch(e) { return null; }
  });

  const validActiveTabId = tabs.length > 0 ? (tabs.find(t => t.id === activeTabId) ? activeTabId : tabs[0].id) : null;

  const [runtimeLogs, setRuntimeLogs] = useState(['> Simulation environment loaded.']);
  const [editorTheme, setEditorTheme] = useState('vs-dark');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setEditorTheme(mediaQuery.matches ? 'vs-dark' : 'vs');
    const handleChange = (e) => setEditorTheme(e.matches ? 'vs-dark' : 'vs');
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

  const [leftWidth, setLeftWidth] = useState(50);
  const [editorHeight, setEditorHeight] = useState(65);
  const [canvasHeight, setCanvasHeight] = useState(65);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState(null);

  const isRunningRef = useRef(false);
  const hardwareConfigRef = useRef(hardwareConfig);
  const sceneEntitiesRef = useRef(sceneEntities);
  const environmentMapRef = useRef(null);
  const requestRef = useRef(null);
  const runtimeLogEndRef = useRef(null);
  const uartConsoleRef = useRef(null);
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const robotRef = useRef(null);
  
  const sceneBodiesRef = useRef(new Map());
  
  const mouseConstraintRef = useRef(null);
  const ultrasonicSensorStatesRef = useRef({});
  const endEffectorStatesRef = useRef({});
  const opticalSensorStatesRef = useRef({});
  const offscreenCanvasRef = useRef(document.createElement('canvas'));
  const offscreenCtxRef = useRef(offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true }));
  const environmentPixelDataRef = useRef(null);
  const environmentMapLoadedRef = useRef(false);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  const mainContainerRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);

  const uiRefs = useRef({
    hud: { portb: null, x: null, y: null, yaw: null },
    inputs: { x: null, y: null, yaw: null },
    pins: {},
    arena: {}
  });

  const [environmentMap, setEnvironmentMap] = useState(() => {
    try { return localStorage.getItem('environment-map-cache') || null; } catch (e) { return null; }
  });

  const setSimState = (state) => {
    setIsRunning(state);
    isRunningRef.current = state;
  };

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

  const updateEnvironmentPixelMap = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    if (w === 0 || h === 0) return;
    const canvas = offscreenCanvasRef.current;
    const ctx = offscreenCtxRef.current;
    canvas.width = w;
    canvas.height = h;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    environmentPixelDataRef.current = ctx.getImageData(0, 0, w, h);
    environmentMapLoadedRef.current = true;

    if (environmentMapRef.current) {
      environmentMapLoadedRef.current = false;
      const loadId = Date.now();
      offscreenCanvasRef.current.loadId = loadId;
      const img = new Image();
      img.onload = () => {
        if (offscreenCanvasRef.current.loadId !== loadId) return;
        ctx.drawImage(img, (w - img.width) / 2, (h - img.height) / 2);
        environmentPixelDataRef.current = ctx.getImageData(0, 0, w, h);
        environmentMapLoadedRef.current = true;
      };
      img.onerror = () => {
        console.warn("Failed to load environment map for pixel sampling.");
        environmentPixelDataRef.current = null;
        environmentMapLoadedRef.current = true;
      };
      img.src = environmentMapRef.current;
    }
  }, []);

  useEffect(() => {
    environmentMapRef.current = environmentMap;
    updateEnvironmentPixelMap();
  }, [environmentMap, updateEnvironmentPixelMap]);

  useEffect(() => { hardwareConfigRef.current = hardwareConfig; }, [hardwareConfig]);
  useEffect(() => { sceneEntitiesRef.current = sceneEntities; }, [sceneEntities]);

  useEffect(() => {
    const current = getWorkspaceConfig();
    const nextConfig = { ...current, hardwareConfig, sceneEntities };
    localStorage.setItem('workspace-config', JSON.stringify(nextConfig));
  }, [hardwareConfig, sceneEntities]);

  useEffect(() => {
    try {
      localStorage.setItem('editor-tabs', JSON.stringify(tabs));
      if (validActiveTabId) localStorage.setItem('editor-active-tab', validActiveTabId);
    } catch (err) {}
  }, [tabs, validActiveTabId]);

  useEffect(() => {
    runtimeLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runtimeLogs]);

  const handleEditorChange = (value) => {
    if (!validActiveTabId) return;
    setTabs(prev => prev.map(t => t.id === validActiveTabId ? { ...t, content: value } : t));
  };

  const addTab = () => {
    const newId = generateId();
    const newName = `sketch${tabs.length}.ino`;
    const newTab = { id: newId, name: newName, content: defaultSourceCode };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (id) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (id === validActiveTabId) {
      const nextActive = newTabs[Math.min(idx, newTabs.length - 1)];
      setActiveTabId(nextActive.id);
    }
  };

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
        setRuntimeLogs(prev => [...prev, `> Background image loaded: ${file.name}`, `> Warning: Background image exceeds local storage quota; caching skipped.`]);
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

  const exportProject = async () => {
    const zip = new JSZip();
    const codeFolder = zip.folder("code");
    tabs.forEach(tab => {
      codeFolder.file(tab.name, tab.content);
    });
    if (environmentMap) {
      const base64Data = environmentMap.split(',')[1];
      const mimeType = environmentMap.split(';')[0].split(':')[1];
      const ext = mimeType.split('/')[1] || 'png';
      zip.folder("environment").file(`map.${ext}`, base64Data, { base64: true });
    }
    const currentConfig = getWorkspaceConfig();
    const workspaceConfig = {
      originX: currentConfig.originX,
      originY: currentConfig.originY,
      originYaw: currentConfig.originYaw,
      hardwareConfig: hardwareConfig,
      sceneEntities: sceneEntities
    };
    zip.file("workspace.json", JSON.stringify(workspaceConfig, null, 2));
    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = "arduino_project.zip";
      a.click();
      URL.revokeObjectURL(url);
      setRuntimeLogs(prev => [...prev, '> Project exported: arduino_project.zip saved.']);
    } catch (err) {
      setRuntimeLogs(prev => [...prev, `> Export failed: ${err.message}`]);
    }
  };

  const importProject = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const zip = await JSZip.loadAsync(file);
      const workspaceFile = zip.file("workspace.json");
      if (workspaceFile) {
        const text = await workspaceFile.async("string");
        const parsed = JSON.parse(text);
        if (parsed.hardwareConfig) setHardwareConfig(parsed.hardwareConfig);
        if (parsed.sceneEntities) setSceneEntities(parsed.sceneEntities);
        if (parsed.originX !== undefined && robotRef.current) {
          Matter.Body.setPosition(robotRef.current, { x: parsed.originX, y: parsed.originY });
          Matter.Body.setAngle(robotRef.current, parsed.originYaw);
        }
        localStorage.setItem('workspace-config', JSON.stringify(parsed));
      }
      const envFolder = zip.folder("environment");
      if (envFolder) {
        let mapFile = null;
        envFolder.forEach((relativePath, file) => {
          if (relativePath.startsWith("map.")) {
            mapFile = file;
          }
        });
        if (mapFile) {
          const base64 = await mapFile.async("base64");
          const ext = mapFile.name.split('.').pop();
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          const dataUrl = `data:${mimeType};base64,${base64}`;
          setEnvironmentMap(dataUrl);
          try {
            localStorage.setItem('environment-map-cache', dataUrl);
          } catch (err) {
            setRuntimeLogs(prev => [...prev, `> Warning: Map image exceeds local storage quota.`]);
          }
        }
      }
      const codeFolder = zip.folder("code");
      if (codeFolder) {
        const filePromises = [];
        codeFolder.forEach((relativePath, file) => {
          if (!file.dir) {
            filePromises.push(
              file.async("string").then(content => ({
                id: generateId(),
                name: relativePath,
                content: content
              }))
            );
          }
        });
        
        const newTabs = await Promise.all(filePromises);
        
        if (newTabs.length > 0) {
          setTabs(newTabs);
          setActiveTabId(newTabs[0].id);
        } else {
          const fallbackTab = { id: generateId(), name: 'main.ino', content: defaultSourceCode };
          setTabs([fallbackTab]);
          setActiveTabId(fallbackTab.id);
        }
      }
      setRuntimeLogs(prev => [...prev, '> Project imported successfully. Workspace reconstructed.']);
      e.target.value = null;
    } catch (err) {
      setRuntimeLogs(prev => [...prev, `> Error importing project: ${err.message}`]);
      e.target.value = null;
    }
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
    localStorage.removeItem('editor-tabs');
    localStorage.removeItem('editor-active-tab');
    let baseHardwareConfig = {
      baseLinkW: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.baseLinkW,
      baseLinkH: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.baseLinkH,
      baseLinkColor: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.baseLinkColor,
      peripherals: DEFAULT_WORKSPACE_CONFIG.hardwareConfig.peripherals.map(p => ({ ...p, id: generateId() }))
    };
    setSelectedPeripheral('dc_motor');
    setHardwareConfig(baseHardwareConfig);
    setSceneEntities(DEFAULT_WORKSPACE_CONFIG.sceneEntities);
    const newMainTab = { id: generateId(), name: 'main.ino', content: defaultSourceCode };
    setTabs([newMainTab]);
    setActiveTabId(newMainTab.id);
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: DEFAULT_WORKSPACE_CONFIG.originX, y: DEFAULT_WORKSPACE_CONFIG.originY });
      Matter.Body.setAngle(robotRef.current, DEFAULT_WORKSPACE_CONFIG.originYaw);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }
    const newConfig = { ...DEFAULT_WORKSPACE_CONFIG, hardwareConfig: baseHardwareConfig };
    localStorage.setItem('workspace-config', JSON.stringify(newConfig));
    setRuntimeLogs(prev => [...prev, '> Local cache cleared. Sketch and board configuration restored to defaults.']);
  };

  const rebuildKinematicChain = useCallback((buildConfig, initialX = 200, initialY = 200, initialYaw = 0) => {
    if (!engineRef.current) return;
    
    let x = initialX;
    let y = initialY;
    let yaw = initialYaw;
    
    if (robotRef.current) {
      x = robotRef.current.position.x;
      y = robotRef.current.position.y;
      yaw = robotRef.current.angle;
      Matter.World.remove(engineRef.current.world, robotRef.current);
    }

    const w = Math.max(10, buildConfig.baseLinkW || 50);
    const h = Math.max(10, buildConfig.baseLinkH || 30);
    const ROBOT_GROUP = -1;
    const chassisColor = buildConfig.baseLinkColor || DEFAULT_COLORS.base_link;
    
    const chassis = Matter.Bodies.rectangle(0, 0, w, h, { render: { fillStyle: chassisColor }, collisionFilter: { group: ROBOT_GROUP } });
    const partsArray = [chassis];
    
    buildConfig.peripherals.forEach(p => {
      const pAngleRad = (p.angle || 0) * (Math.PI / 180);
      const pColor = p.color || DEFAULT_COLORS[p.type] || '#ffffff';
      let pW = 6, pH = 6;
      if (p.type === 'dc_motor') { pW = 14; pH = 6; }
      else if (p.type === 'ultrasonic_sensor') { pW = 6; pH = 12; }
      else if (p.type === 'grabber') { pW = 10; pH = 8; }
      else if (p.type === 'rgb_sensor') { pW = 8; pH = 10; }
      
      partsArray.push(Matter.Bodies.rectangle(p.offsetX, p.offsetY, pW, pH, { 
        angle: pAngleRad, 
        density: 0, 
        render: { fillStyle: pColor }, 
        collisionFilter: { group: ROBOT_GROUP } 
      }));
    });
    
    const robot = Matter.Body.create({ parts: partsArray, collisionFilter: { group: ROBOT_GROUP } });
    robot.frictionAir = 0.1;
    Matter.Body.setInertia(robot, Infinity);
    
    const visualOffsetX = robot.position.x;
    const visualOffsetY = robot.position.y;
    
    Matter.Body.setPosition(robot, { x, y });
    Matter.Body.setAngle(robot, yaw);
    robot.plugin = { ...(robot.plugin || {}), visualOffsetX, visualOffsetY };
    
    robotRef.current = robot;
    Matter.World.add(engineRef.current.world, robot);
  }, []);

  const rebuildScenePhysics = useCallback((entities) => {
    if (!engineRef.current) return;
    const currentBodies = sceneBodiesRef.current;
    const newEntityIds = new Set(entities.map(e => e.id));
    
    currentBodies.forEach((b, id) => {
      if (!newEntityIds.has(id)) {
        Object.values(endEffectorStatesRef.current).forEach(state => {
          if (state.target === b) {
            if (Array.isArray(state.constraints)) {
              state.constraints.forEach(c => Matter.World.remove(engineRef.current.world, c));
            }
            state.constraints = null;
            state.target = null;
            state.isHigh = false;
          }
        });
        Matter.World.remove(engineRef.current.world, b);
        currentBodies.delete(id);
      }
    });

    const nextBodies = new Map();
    entities.forEach(entity => {
      let body = currentBodies.get(entity.id);
      const w = Math.max(5, entity.w || 20);
      const h = Math.max(5, entity.h || 20);
      const entityColor = entity.color || (entity.isStatic ? DEFAULT_COLORS.static_body : DEFAULT_COLORS.dynamic_body);

      if (!body) {
        body = Matter.Bodies.rectangle(entity.x, entity.y, w, h, {
          isStatic: entity.isStatic, 
          angle: (entity.angle || 0) * (Math.PI / 180), 
          friction: 0.5, 
          restitution: 0.2,
          render: { fillStyle: entityColor }, 
          plugin: { id: entity.id, isGraspable: !!entity.isGraspable, w, h, isStatic: entity.isStatic, isSensor: false }
        });
        Matter.World.add(engineRef.current.world, body);
      } else {
        const needsRebuild = body.plugin.w !== w || body.plugin.h !== h || body.plugin.isStatic !== entity.isStatic;
        if (needsRebuild) {
          Object.values(endEffectorStatesRef.current).forEach(state => {
            if (state.target === body) {
              if (Array.isArray(state.constraints)) {
                state.constraints.forEach(c => Matter.World.remove(engineRef.current.world, c));
              }
              state.constraints = null;
              state.target = null;
              state.isHigh = false;
            }
          });

          const pos = body.position;
          const angle = body.angle;
          const vel = body.velocity;
          const angVel = body.angularVelocity;
          
          Matter.World.remove(engineRef.current.world, body);
          body = Matter.Bodies.rectangle(pos.x, pos.y, w, h, {
            isStatic: entity.isStatic,
            angle: angle,
            friction: 0.5,
            restitution: 0.2,
            render: { fillStyle: entityColor },
            plugin: { id: entity.id, isGraspable: !!entity.isGraspable, w, h, isStatic: entity.isStatic, isSensor: false }
          });
          if (!entity.isStatic) {
            Matter.Body.setVelocity(body, vel);
            Matter.Body.setAngularVelocity(body, angVel);
          }
          Matter.World.add(engineRef.current.world, body);
        } else {
          body.render.fillStyle = entityColor;
          body.plugin.isGraspable = !!entity.isGraspable;
        }
      }
      nextBodies.set(entity.id, body);
    });
    sceneBodiesRef.current = nextBodies;
  }, []);

  useEffect(() => { if (engineRef.current) rebuildKinematicChain(hardwareConfig); }, [hardwareConfig, rebuildKinematicChain]);
  
  useEffect(() => {
    if (engineRef.current) {
      rebuildScenePhysics(sceneEntities);
    }
  }, [sceneEntities, rebuildScenePhysics]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const oldCanvases = sceneRef.current.querySelectorAll('canvas');
    oldCanvases.forEach(c => c.remove());
    const engine = Matter.Engine.create({ positionIterations: 16, velocityIterations: 16 });
    engine.world.gravity.y = 0;
    engineRef.current = engine;
    const render = Matter.Render.create({ element: sceneRef.current, engine: engine, options: { width: sceneRef.current.clientWidth, height: sceneRef.current.clientHeight, wireframes: false, background: 'transparent' } });
    const initConf = getWorkspaceConfig();
    let walls = [
      Matter.Bodies.rectangle(render.options.width / 2, 0, render.options.width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } }),
      Matter.Bodies.rectangle(render.options.width / 2, render.options.height, render.options.width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } }),
      Matter.Bodies.rectangle(0, render.options.height / 2, 20, render.options.height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } }),
      Matter.Bodies.rectangle(render.options.width, render.options.height / 2, 20, render.options.height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } })
    ];
    const mouse = Matter.Mouse.create(render.canvas);
    const mouseConstraint = Matter.MouseConstraint.create(engine, { mouse: mouse, constraint: { stiffness: 0.2, render: { visible: false } } });
    mouseConstraintRef.current = mouseConstraint;
    render.mouse = mouse;
    Matter.World.add(engine.world, [mouseConstraint, ...walls]);
    rebuildKinematicChain(initConf.hardwareConfig, initConf.originX, initConf.originY, initConf.originYaw);
    rebuildScenePhysics(initConf.sceneEntities);
    
    const handleEndDrag = () => {
      if (robotRef.current && robotRef.current.parts.includes(mouseConstraint.body)) {
        const r = robotRef.current;
        const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360;
        if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(r.position.x);
        if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(r.position.y);
        if (uiRefs.current.inputs.yaw) uiRefs.current.inputs.yaw.value = normalizedDeg.toFixed(2);
        const current = getWorkspaceConfig();
        localStorage.setItem('workspace-config', JSON.stringify({ ...current, originX: r.position.x, originY: r.position.y, originYaw: r.angle }));
      }
      
      let draggedEntityId = null;
      for (const [id, body] of sceneBodiesRef.current.entries()) {
        if (body === mouseConstraint.body) {
          draggedEntityId = id;
          break;
        }
      }
      
      if (draggedEntityId) {
        setSceneEntities(prev => {
          return prev.map(e => {
            if (e.id === draggedEntityId) {
              const body = sceneBodiesRef.current.get(draggedEntityId);
              return { ...e, x: body.position.x, y: body.position.y, angle: body.angle * (180 / Math.PI) };
            }
            return e;
          });
        });
      }
    };

    const handleAfterUpdate = () => {
      if (robotRef.current) {
        const r = robotRef.current;
        const normalizedDeg = (((r.angle * (180 / Math.PI)) % 360) + 360) % 360;
        if (uiRefs.current.hud.x) uiRefs.current.hud.x.innerText = Math.round(r.position.x);
        if (uiRefs.current.hud.y) uiRefs.current.hud.y.innerText = Math.round(r.position.y);
        if (uiRefs.current.hud.yaw) uiRefs.current.hud.yaw.innerText = normalizedDeg.toFixed(2);
      }
      sceneBodiesRef.current.forEach((body, id) => {
        const entity = sceneEntitiesRef.current.find(e => e.id === id);
        if (!entity) return;
        const deg = (((body.angle * (180 / Math.PI)) % 360) + 360) % 360;
        const elX = uiRefs.current.arena[`x-${id}`];
        const elY = uiRefs.current.arena[`y-${id}`];
        const elAng = uiRefs.current.arena[`ang-${id}`];
        if (elX && document.activeElement !== elX) elX.value = Math.round(body.position.x);
        if (elY && document.activeElement !== elY) elY.value = Math.round(body.position.y);
        if (elAng && document.activeElement !== elAng) elAng.value = deg.toFixed(2);
      });
    };

    const handleAfterRender = () => {
      if (!robotRef.current || !engineRef.current) return;
      const ctx = render.context;
      
      const allBodies = Matter.Composite.allBodies(engineRef.current.world);
      const validBodies = allBodies.filter(b => b !== robotRef.current && !robotRef.current.parts.includes(b));
      
      renderRobotAssembly(
        ctx, 
        robotRef.current, 
        hardwareConfigRef.current, 
        { 
          endEffector: endEffectorStatesRef.current, 
          optical: opticalSensorStatesRef.current, 
          ultrasonic: ultrasonicSensorStatesRef.current 
        }, 
        environmentPixelDataRef.current, 
        engineRef.current,
        validBodies
      );
    };

    Matter.Events.on(mouseConstraint, 'enddrag', handleEndDrag);
    Matter.Events.on(engine, 'afterUpdate', handleAfterUpdate);
    Matter.Events.on(render, 'afterRender', handleAfterRender);

    const deg = (((initConf.originYaw * (180 / Math.PI)) % 360) + 360) % 360;
    if (uiRefs.current.inputs.x) uiRefs.current.inputs.x.value = Math.round(initConf.originX);
    if (uiRefs.current.inputs.y) uiRefs.current.inputs.y.value = Math.round(initConf.originY);
    if (uiRefs.current.inputs.yaw) uiRefs.current.inputs.yaw.value = deg.toFixed(2);
    Matter.Render.run(render);
    
    let isActive = true;
    
    let lastIdleTime = performance.now();
    const idleLoop = (timestamp) => {
      if (!isActive) return;
      if (!isRunningRef.current && engineRef.current) {
        const delta = timestamp - lastIdleTime;
        const cappedDelta = Math.min(delta || 16.666, 32);
        Matter.Engine.update(engineRef.current, cappedDelta);
      }
      lastIdleTime = timestamp;
      requestAnimationFrame(idleLoop);
    };
    requestAnimationFrame(idleLoop);
    
    let resizeTimeout;
    const resizeObserver = new ResizeObserver((entries) => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        for (let entry of entries) {
          const { width, height } = entry.contentRect;
          if (render.canvas && width > 0 && height > 0) {
            render.canvas.width = width;
            render.canvas.height = height;
            render.options.width = width;
            render.options.height = height;
            canvasSizeRef.current = { w: width, h: height };
            updateEnvironmentPixelMap();
            walls.forEach(w => Matter.World.remove(engine.world, w));
            walls = [
              Matter.Bodies.rectangle(width / 2, 0, width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } }),
              Matter.Bodies.rectangle(width / 2, height, width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } }),
              Matter.Bodies.rectangle(0, height / 2, 20, height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } }),
              Matter.Bodies.rectangle(width, height / 2, 20, height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.static_body } })
            ];
            Matter.World.add(engine.world, walls);
          }
        }
      }, 150);
    });
    resizeObserver.observe(sceneRef.current);
    
    return () => {
      isActive = false;
      clearTimeout(resizeTimeout);
      
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      isRunningRef.current = false;
      
      resizeObserver.disconnect();
      
      Matter.Events.off(mouseConstraint, 'enddrag', handleEndDrag);
      Matter.Events.off(engine, 'afterUpdate', handleAfterUpdate);
      Matter.Events.off(render, 'afterRender', handleAfterRender);
      
      Matter.Render.stop(render);
      if (render.canvas) render.canvas.remove();
      Matter.Engine.clear(engine);
    };
  }, [rebuildKinematicChain, rebuildScenePhysics, updateEnvironmentPixelMap]);

  const addSceneEntity = () => {
    setSceneEntities(prev => [...prev, { id: generateId(), name: 'New Rigid Body', x: 300, y: 300, w: 40, h: 40, isStatic: false, isGraspable: true, angle: 0, color: DEFAULT_COLORS.dynamic_body }]);
  };

  const removeSceneEntity = (id) => {
    setSceneEntities(prev => prev.filter(entity => entity.id !== id));
  };

  const updateSceneEntity = (id, key, value) => {
    let val = value;
    if (key !== 'name' && key !== 'isStatic' && key !== 'isGraspable' && key !== 'color') {
       val = Number(val);
       if (isNaN(val)) val = 0;
    }

    const body = sceneBodiesRef.current.get(id);
    
    if (body) {
      if (key === 'x' || key === 'y') {
        const nextX = key === 'x' ? val : body.position.x;
        const nextY = key === 'y' ? val : body.position.y;
        Matter.Body.setPosition(body, { x: nextX, y: nextY });
      } else if (key === 'angle') {
        const nextAngRad = val * (Math.PI / 180);
        Matter.Body.setAngle(body, nextAngRad);
      }
    }

    setSceneEntities(prev => prev.map((entity) => {
      if (entity.id === id) {
        let newX = entity.x, newY = entity.y, newAng = entity.angle;
        
        if (body) {
          newX = body.position.x;
          newY = body.position.y;
          newAng = body.angle * (180 / Math.PI);
        }

        if (key === 'isStatic' && val === true) return { ...entity, x: newX, y: newY, angle: newAng, isStatic: true, isGraspable: false };
        return { ...entity, x: newX, y: newY, angle: newAng, [key]: val };
      }
      
      return entity;
    }));
  };

  const addPeripheral = (type) => {
    setHardwareConfig(prev => {
      let newPeripheral = { id: generateId(), type: type, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS[type] };
      if (type === 'dc_motor') { newPeripheral.name = 'New DC Motor'; newPeripheral.pin = 9; newPeripheral.directionPin = 7; }
      else if (type === 'ultrasonic_sensor') { newPeripheral.name = 'New Ultrasonic Sensor'; newPeripheral.triggerPin = 3; newPeripheral.echoPin = 2; newPeripheral.offsetX = 25; newPeripheral.range = 400; }
      else if (type === 'ir_led_sensor') { newPeripheral.name = 'New IR LED Sensor'; newPeripheral.pin = 14; newPeripheral.offsetX = 25; }
      else if (type === 'grabber') { newPeripheral.name = 'New Gripper'; newPeripheral.pin = 5; newPeripheral.offsetX = 25; }
      else if (type === 'rgb_sensor') { newPeripheral.name = 'New RGB Sensor'; newPeripheral.pinR = 14; newPeripheral.pinG = 15; newPeripheral.pinB = 16; newPeripheral.offsetX = 25; }
      return { ...prev, peripherals: [...prev.peripherals, newPeripheral] };
    });
  };

  const removePeripheral = (id) => setHardwareConfig(prev => ({ ...prev, peripherals: prev.peripherals.filter(p => p.id !== id) }));

  const updatePeripheral = (id, key, value) => {
    setHardwareConfig(prev => ({ 
      ...prev, 
      peripherals: prev.peripherals.map(p => {
        if (p.id !== id) return p;
        let val = value;
        if (key !== 'name' && key !== 'color') {
           val = Number(val);
           if (isNaN(val)) val = 0;
        }
        return { ...p, [key]: val };
      }) 
    }));
  };

  const updateBaseLink = (key, value) => setHardwareConfig(prev => ({ ...prev, [key]: key === 'baseLinkColor' ? value : Math.max(10, Number(value) || 10) }));

  const injectPoseOverride = () => {
    if (!robotRef.current) return;
    const x = uiRefs.current.inputs.x.value !== "" ? parseFloat(uiRefs.current.inputs.x.value) : robotRef.current.position.x;
    const y = uiRefs.current.inputs.y.value !== "" ? parseFloat(uiRefs.current.inputs.y.value) : robotRef.current.position.y;
    const yawDeg = uiRefs.current.inputs.yaw.value !== "" ? parseFloat(uiRefs.current.inputs.yaw.value) : (robotRef.current.angle * 180 / Math.PI);
    const yawRad = yawDeg * (Math.PI / 180);
    Matter.Body.setPosition(robotRef.current, { x, y });
    Matter.Body.setAngle(robotRef.current, yawRad);
    Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(robotRef.current, 0);
    const current = getWorkspaceConfig();
    localStorage.setItem('workspace-config', JSON.stringify({ ...current, originX: x, originY: y, originYaw: yawRad }));
    setRuntimeLogs(prev => [...prev, `> Robot position updated: [X:${Math.round(x)}, Y:${Math.round(y)}, Yaw:${yawDeg}°]`]);
  };

  const haltSimulation = useCallback(() => {
    if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }
    setSimState(false);
    ultrasonicSensorStatesRef.current = {};
    opticalSensorStatesRef.current = {};
    if (engineRef.current) {
      Object.values(endEffectorStatesRef.current).forEach(state => {
        if (state.constraints) {
          if (Array.isArray(state.constraints)) {
            state.constraints.forEach(c => Matter.World.remove(engineRef.current.world, c));
          } else {
            Matter.World.remove(engineRef.current.world, state.constraints);
          }
          if (state.target) { 
            state.target.collisionFilter.group = state.originalGroup || 0; 
          }
        }
      });
    }
    endEffectorStatesRef.current = {};
    Object.values(uiRefs.current.pins).forEach(el => { if (el) el.className = "transition-colors duration-75 text-stone-400 dark:text-stone-500"; });
    if (robotRef.current) Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    
    sceneBodiesRef.current.forEach((body, id) => { 
      if (!body.isStatic) Matter.Body.setVelocity(body, { x: 0, y: 0 }); 
    });
    setRuntimeLogs(prev => [...prev, '> Simulation stopped.']);
  }, []);

  const hardResetSimulation = () => {
    haltSimulation();
    if (uartConsoleRef.current) uartConsoleRef.current.textContent = "";
    const conf = getWorkspaceConfig();
    setSceneEntities(conf.sceneEntities || []);
    if (engineRef.current) { 
      sceneBodiesRef.current.forEach(b => Matter.World.remove(engineRef.current.world, b));
      sceneBodiesRef.current = new Map(); 
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
      if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }
      setRuntimeLogs(prev => [...prev, '> Allocating flash memory...']);
      const program = new Uint16Array(16384);
      loadHex(hexData, new Uint8Array(program.buffer));
      const cpu = new CPU(program);
      new AVRTimer(cpu, timer0Config);
      new AVRTimer(cpu, timer1Config);
      new AVRTimer(cpu, timer2Config);
      const usart = new AVRUSART(cpu, usart0Config, CPU_CLOCK_HZ);
      
      const analogValues = new Uint16Array(8);
      analogValues.fill(0);

      const sampleMapAnalog = (x, y, angle, maxRange = 30, validBodies) => {
        let hitBody = null;
        if (validBodies) {
          for (let d = 2; d <= maxRange; d += 2) {
            const ptX = x + Math.cos(angle) * d;
            const ptY = y + Math.sin(angle) * d;
            const hits = Matter.Query.point(validBodies, { x: ptX, y: ptY });
            if (hits.length > 0) {
              hitBody = hits[0];
              break;
            }
          }
        }

        let luminance = 255;

        if (hitBody) {
          const hexColor = hitBody.render?.fillStyle || (hitBody.plugin?.isStatic ? DEFAULT_COLORS.static_body : DEFAULT_COLORS.dynamic_body);
          if (typeof hexColor === 'string' && hexColor.startsWith('#')) {
             let hex = hexColor.slice(1);
             if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
             const r = parseInt(hex.slice(0, 2), 16);
             const g = parseInt(hex.slice(2, 4), 16);
             const b = parseInt(hex.slice(4, 6), 16);
             luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          } else {
             luminance = 0;
          }
        } else {
          const img = environmentPixelDataRef.current;
          if (!img || !environmentMapLoadedRef.current) return 1023;
          
          const focalDist = 15;
          const sampleX = x + Math.cos(angle) * focalDist;
          const sampleY = y + Math.sin(angle) * focalDist;
          
          const ix = Math.floor(sampleX);
          const iy = Math.floor(sampleY);
          if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return 1023;
          const idx = (iy * img.width + ix) * 4;
          const r = img.data[idx];
          const g = img.data[idx + 1];
          const b = img.data[idx + 2];
          const a = img.data[idx + 3];
          if (a < 16) return 1023;
          luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        const value = Math.round((luminance / 255) * 1023);
        return Math.max(0, Math.min(1023, value));
      };

      const sampleMapRGB = (x, y, angle, validBodies) => {
        let hitBody = null;
        if (validBodies) {
          for (let d = 2; d <= 15; d += 2) {
            const ptX = x + Math.cos(angle) * d;
            const ptY = y + Math.sin(angle) * d;
            const hits = Matter.Query.point(validBodies, { x: ptX, y: ptY });
            if (hits.length > 0) {
              hitBody = hits[0];
              break;
            }
          }
        }

        if (hitBody) {
          const hexColor = hitBody.render?.fillStyle || (hitBody.plugin?.isStatic ? DEFAULT_COLORS.static_body : DEFAULT_COLORS.dynamic_body);
          if (typeof hexColor === 'string' && hexColor.startsWith('#')) {
             let hex = hexColor.slice(1);
             if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
             const r = parseInt(hex.slice(0, 2), 16);
             const g = parseInt(hex.slice(2, 4), 16);
             const b = parseInt(hex.slice(4, 6), 16);
             return {
               r: Math.round((r / 255) * 1023),
               g: Math.round((g / 255) * 1023),
               b: Math.round((b / 255) * 1023)
             };
          }
          return { r: 0, g: 0, b: 0 };
        }

        const img = environmentPixelDataRef.current;
        if (!img || !environmentMapLoadedRef.current) return { r: 1023, g: 1023, b: 1023 };
        
        const focalDist = 15;
        const sampleX = x + Math.cos(angle) * focalDist;
        const sampleY = y + Math.sin(angle) * focalDist;
        
        const ix = Math.floor(sampleX);
        const iy = Math.floor(sampleY);
        if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return { r: 1023, g: 1023, b: 1023 };
        const idx = (iy * img.width + ix) * 4;
        const r = img.data[idx];
        const g = img.data[idx + 1];
        const b = img.data[idx + 2];
        const a = img.data[idx + 3];
        if (a < 16) return { r: 1023, g: 1023, b: 1023 };
        
        return {
          r: Math.round((r / 255) * 1023),
          g: Math.round((g / 255) * 1023),
          b: Math.round((b / 255) * 1023)
        };
      };

      const updateAnalogSensors = (cachedValidBodies) => {
        const robot = robotRef.current;
        if (!robot || !engineRef.current) return;
        
        const validBodies = cachedValidBodies || Matter.Composite.allBodies(engineRef.current.world).filter(b => b !== robot && !robot.parts.includes(b));
        
        const vOffX = robot.plugin?.visualOffsetX || 0;
        const vOffY = robot.plugin?.visualOffsetY || 0;

        const peripherals = hardwareConfigRef.current?.peripherals || [];
        analogValues.fill(0);
        const cos = Math.cos(robot.angle);
        const sin = Math.sin(robot.angle);
        peripherals.forEach(p => {
          if (p.type === 'ir_led_sensor') {
            const pAngleRad = robot.angle + (p.angle || 0) * (Math.PI / 180);
            
            const localX = p.offsetX - vOffX;
            const localY = p.offsetY - vOffY;
            const sampleX = robot.position.x + localX * cos - localY * sin;
            const sampleY = robot.position.y + localX * sin + localY * cos;
            
            let channel = -1;
            if (p.pin >= 14 && p.pin <= 19) channel = p.pin - 14;
            if (channel >= 0 && channel < 8) analogValues[channel] = sampleMapAnalog(sampleX, sampleY, pAngleRad, 30, validBodies);
          } else if (p.type === 'rgb_sensor') {
            const pAngleRad = robot.angle + (p.angle || 0) * (Math.PI / 180);
            
            const localX = p.offsetX - vOffX;
            const localY = p.offsetY - vOffY;
            const sampleX = robot.position.x + localX * cos - localY * sin;
            const sampleY = robot.position.y + localX * sin + localY * cos;
            
            const rgb = sampleMapRGB(sampleX, sampleY, pAngleRad, validBodies);
            const getChannel = (pin) => {
              if (pin >= 14 && pin <= 19) return pin - 14;
              return -1;
            };
            const chR = getChannel(p.pinR);
            const chG = getChannel(p.pinG);
            const chB = getChannel(p.pinB);
            if (chR >= 0 && chR < 8) analogValues[chR] = rgb.r;
            if (chG >= 0 && chG < 8) analogValues[chG] = rgb.g;
            if (chB >= 0 && chB < 8) analogValues[chB] = rgb.b;
          }
        });
      };
      
      setCPUWriteHook(cpu, 0x7A, (value) => {
        const adsc = value & 0x40;
        const oldAdsc = cpu.data[0x7A] & 0x40;
        
        if (adsc && !oldAdsc) {
          const channel = cpu.data[0x7C] & 0x0F;
          const val = channel < 8 ? analogValues[channel] : 0;
          const adlar = (cpu.data[0x7C] & 0x20) !== 0;
          
          if (adlar) {
            cpu.data[0x78] = (val << 6) & 0xff;
            cpu.data[0x79] = (val >> 2) & 0xff;
          } else {
            cpu.data[0x78] = val & 0xff;
            cpu.data[0x79] = (val >> 8) & 0x03;
          }
          
          cpu.data[0x7A] = (value & ~0x40) | 0x10; 
          return true;
        }
        
        if (value & 0x10) {
          cpu.data[0x7A] = value & ~0x10;
          return true;
        }
        
        return false;
      });
      
      const externalPinStates = {};

      setCPUReadHook(cpu, 0x23, () => {
        let val = cpu.data[0x23];
        const ddr = cpu.data[0x24];
        for (let i = 8; i <= 13; i++) {
          const bit = i - 8;
          if ((ddr & (1 << bit)) === 0 && externalPinStates[i] !== undefined) {
            if (externalPinStates[i]) val |= (1 << bit);
            else val &= ~(1 << bit);
          }
        }
        return val;
      });

      setCPUReadHook(cpu, 0x29, () => {
        let val = cpu.data[0x29];
        const ddr = cpu.data[0x2A];
        for (let i = 0; i <= 7; i++) {
          if ((ddr & (1 << i)) === 0 && externalPinStates[i] !== undefined) {
            if (externalPinStates[i]) val |= (1 << i);
            else val &= ~(1 << i);
          }
        }
        return val;
      });

      setCPUReadHook(cpu, 0x26, () => {
        let val = cpu.data[0x26];
        const ddr = cpu.data[0x27];
        for (let i = 14; i <= 19; i++) {
          const bit = i - 14;
          if ((ddr & (1 << bit)) === 0 && externalPinStates[i] !== undefined) {
            if (externalPinStates[i]) val |= (1 << bit);
            else val &= ~(1 << bit);
          }
        }
        return val;
      });

      let serialBytes = [];
      const serialDecoder = new TextDecoder('utf-8', { fatal: false });
      usart.onByteTransmit = (byte) => {
        const u2x0 = (cpu.data[0xC0] & 2) ? 8 : 16;
        const ubrr = cpu.data[0xC4] | (cpu.data[0xC5] << 8);
        const actualBaud = Math.round(CPU_CLOCK_HZ / (u2x0 * (ubrr + 1)));
        const mismatchRatio = Math.abs(actualBaud - BAUD_RATE) / BAUD_RATE;
        if (mismatchRatio > 0.05) return;
        serialBytes.push(byte);
      };
      setSimState(true);
      setRuntimeLogs(prev => [...prev, '> Uploading sketch to virtual board...', '> Running setup()...', '> Running loop()...']);
      const ultrasonics = hardwareConfigRef.current.peripherals.filter(p => p.type === 'ultrasonic_sensor');
      
      const ultrasonicDefs = ultrasonics.map(p => {
        let portAddr, bit;
        if (p.triggerPin >= 0 && p.triggerPin <= 7) { portAddr = 0x2B; bit = p.triggerPin; }
        else if (p.triggerPin >= 8 && p.triggerPin <= 13) { portAddr = 0x25; bit = p.triggerPin - 8; }
        else { portAddr = 0x28; bit = p.triggerPin - 14; }
        return { id: p.id, portAddr, mask: 1 << bit, echoPin: p.echoPin, maxRange: p.range || 400, offsetX: p.offsetX, offsetY: p.offsetY, angle: p.angle };
      });
      
      let lastFrameTime = performance.now();
      
      const executeFrame = (timestamp) => {
        if (!isRunningRef.current) return;
        try {
          const delta = timestamp - lastFrameTime;
          lastFrameTime = timestamp;
          
          const cappedDelta = Math.min(delta, 20);
          const cyclesToRun = Math.floor(cappedDelta * (CPU_CLOCK_HZ / 1000));
          
          const timeBudget = 8; 
          const startTime = performance.now();

          const allBodies = Matter.Composite.allBodies(engineRef.current.world);
          const validBodies = allBodies.filter(b => b !== robotRef.current && !robotRef.current.parts.includes(b) && !b.plugin?.isSensor);
          
          updateAnalogSensors(validBodies);
          for (let i = 0; i < cyclesToRun; i++) {
            avrInstruction(cpu);
            if ((i & 4095) === 0 && (performance.now() - startTime) > timeBudget) {
              break; 
            }
            if (i % 16 === 0 && robotRef.current) {
              const cycle = cpu.cycles;
              
              const vOffX = robotRef.current.plugin?.visualOffsetX || 0;
              const vOffY = robotRef.current.plugin?.visualOffsetY || 0;

              for (let s = 0; s < ultrasonicDefs.length; s++) {
                const sd = ultrasonicDefs[s];
                const isTrigHigh = (cpu.data[sd.portAddr] & sd.mask) !== 0;
                const state = ultrasonicSensorStatesRef.current[sd.id] || { lastTrig: false, echoStart: 0, echoEnd: 0, lastDist: sd.maxRange };
                if (isTrigHigh && !state.lastTrig) {
                  const robX = robotRef.current.position.x;
                  const robY = robotRef.current.position.y;
                  const robCos = Math.cos(robotRef.current.angle);
                  const robSin = Math.sin(robotRef.current.angle);
                  
                  const localX = sd.offsetX - vOffX;
                  const localY = sd.offsetY - vOffY;
                  const sensorGlobalX = robX + (localX * robCos) - (localY * robSin);
                  const sensorGlobalY = robY + (localX * robSin) + (localY * robCos);
                  const pAngleRad = robotRef.current.angle + (sd.angle || 0) * (Math.PI / 180);
                  
                  let hitDist = sd.maxRange;
                  for (let d = 2; d <= sd.maxRange; d += 2) {
                    const pt = { x: sensorGlobalX + Math.cos(pAngleRad) * d, y: sensorGlobalY + Math.sin(pAngleRad) * d };
                    if (Matter.Query.point(validBodies, pt).length > 0) { hitDist = d; break; }
                  }
                  state.lastDist = hitDist;
                  state.echoStart = cycle + 200; 
                  
                  const distInCM = hitDist / PIXELS_PER_CM;
                  const echoDurationMicros = distInCM * 58;
                  const echoDurationCycles = echoDurationMicros * CPU_CLOCK_MHZ;
                  state.echoEnd = state.echoStart + echoDurationCycles;
                }
                state.lastTrig = isTrigHigh;
                ultrasonicSensorStatesRef.current[sd.id] = state;
              }
            }
            if (i % 16 === 0) {
              const cycle = cpu.cycles;
              for (let s = 0; s < ultrasonicDefs.length; s++) {
                const sd = ultrasonicDefs[s];
                const state = ultrasonicSensorStatesRef.current[sd.id];
                if (state) {
                  const isEchoing = cycle >= state.echoStart && cycle <= state.echoEnd;
                  setExternalPin(cpu, sd.echoPin, isEchoing, externalPinStates);
                }
              }
            }
          }
          if (serialBytes.length > 0 && uartConsoleRef.current) {
            const text = serialDecoder.decode(new Uint8Array(serialBytes), { stream: true });
            const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            uartConsoleRef.current.textContent += cleanText;
            
            if (uartConsoleRef.current.textContent.length > 50000) {
              uartConsoleRef.current.textContent = uartConsoleRef.current.textContent.slice(-40000);
            }
            
            uartConsoleRef.current.scrollTop = uartConsoleRef.current.scrollHeight;
            serialBytes.length = 0;
          }
          if (uiRefs.current.hud.portb) uiRefs.current.hud.portb.innerText = cpu.data[0x25].toString(2).padStart(8, '0');
          const robot = robotRef.current;
          const mouseBody = mouseConstraintRef.current?.body;
          const isDraggingRobot = mouseBody && robot.parts.includes(mouseBody);
          if (!isDraggingRobot && robot) {
            let localVx = 0, localVy = 0, angularVelocity = 0;
            hardwareConfigRef.current.peripherals.forEach(peripheral => {
              if (peripheral.type === 'dc_motor') {
                const [vx, vy, torque] = processActuator(cpu, peripheral, uiRefs.current.pins, robot);
                localVx += vx; localVy += vy; angularVelocity += torque;
              } else if (peripheral.type === 'ir_led_sensor') {
                processOpticalSensor(cpu, peripheral, opticalSensorStatesRef.current, uiRefs.current.pins);
              } else if (peripheral.type === 'ultrasonic_sensor') {
                processUltrasonicSensor(cpu, peripheral, ultrasonicSensorStatesRef.current, uiRefs.current.pins);
              } else if (peripheral.type === 'grabber') {
                processEndEffector(cpu, peripheral, robot, engineRef.current, endEffectorStatesRef.current, uiRefs.current.pins);
              }
            });
            
            if (localVx !== 0 || localVy !== 0 || angularVelocity !== 0) {
              const globalVx = localVx * Math.cos(robot.angle) - localVy * Math.sin(robot.angle);
              const globalVy = localVx * Math.sin(robot.angle) + localVy * Math.cos(robot.angle);
              
              const forceMagnitude = 0.0005; 
              Matter.Body.applyForce(robot, robot.position, { 
                x: globalVx * forceMagnitude, 
                y: globalVy * forceMagnitude 
              });
              
              const targetAngVel = angularVelocity * 0.5;
              const currentAngVel = robot.angularVelocity;
              Matter.Body.setAngularVelocity(robot, currentAngVel + (targetAngVel - currentAngVel) * 0.15); 
            }
          }
          
          Matter.Engine.update(engineRef.current, cappedDelta);
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
    const combinedSketch = tabs.map(t => t.content).join('\n');
    let response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      response = await fetch(CROSS_COMPILER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch: combinedSketch, board: "uno" }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      const reason = err.name === 'AbortError' ? 'Connection timed out.' : err.message;
      setRuntimeLogs(prev => [...prev, '> Compilation server error: ' + reason, `> Verify the build server is running at ${CROSS_COMPILER_ENDPOINT}`]);
      setSimState(false);
      return;
    }
    let data = null;
    try { data = await response.json(); } catch (err) { data = null; }
    if (!response.ok || !data || !data.hex) {
      const errorMessage = data?.stderr || data?.compilerErrors || data?.message || `HTTP ${response.status}`;
      setRuntimeLogs(prev => [...prev, '> Compilation failed:', errorMessage]);
      setSimState(false);
      return;
    }
    setRuntimeLogs(prev => [...prev, '> Compilation successful. Uploading to virtual board...']);
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
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(168, 162, 158, 0.3); border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(168, 162, 158, 0.5); }
      `}</style>

      <header className="h-8 border-b border-stone-200 dark:border-stone-800 flex items-center px-2 gap-1.5 bg-stone-50 dark:bg-stone-950 shrink-0 text-[11px]">
        <button onClick={flashAndExecute} disabled={isRunning} className={`px-2 py-1 rounded flex items-center gap-1 ${isRunning ? 'bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
          <Play size={10} fill="currentColor" /> Upload
        </button>
        <button onClick={haltSimulation} className="px-2 py-1 rounded bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 flex items-center gap-1">
          <Square size={10} fill="currentColor" /> Stop
        </button>
        <button onClick={hardResetSimulation} className="px-2 py-1 rounded bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 flex items-center gap-1">
          <RotateCcw size={10} /> Reset
        </button>
        <div className="flex-1" />
        <label className="cursor-pointer px-2 py-1 rounded hover:bg-stone-200 dark:hover:bg-stone-800 flex items-center gap-1">
          <Upload size={10}/> Import
          <input 
            type="file" 
            accept=".json,.zip" 
            className="hidden" 
            onChange={(e) => {
              const file = e.target.files[0];
              if (!file) return;
              if (file.name.endsWith('.zip')) {
                importProject(e);
              } else {
                importWorkspaceConfig(e);
              }
            }} 
          />
        </label>
        <button onClick={exportProject} className="px-2 py-1 rounded hover:bg-stone-200 dark:hover:bg-stone-800 flex items-center gap-1">
          <Download size={10}/> Export
        </button>
        <button onClick={restoreFactoryDefaults} className="px-2 py-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-1">
          <RefreshCcw size={10}/> Defaults
        </button>
      </header>

      <main className="flex-1 flex overflow-hidden bg-stone-100 dark:bg-stone-900" ref={mainContainerRef}>
        <div style={{ width: `${leftWidth}%` }} ref={leftPanelRef} className="flex flex-col overflow-hidden">
          <div style={{ height: `${editorHeight}%` }} className="flex flex-col overflow-hidden border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
            <SourceEditor 
              tabs={tabs} 
              activeTabId={validActiveTabId} 
              setActiveTabId={setActiveTabId} 
              editorTheme={editorTheme} 
              addTab={addTab} 
              closeTab={closeTab} 
              handleEditorChange={handleEditorChange} 
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