import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square, RotateCcw, Monitor, Settings, Terminal, Crosshair, GripVertical, GripHorizontal, Download, Upload, RefreshCcw, FileUp, ImagePlus, Trash2, Wrench, PlusCircle, X, Box } from 'lucide-react';
import Matter from 'matter-js';
import { 
  CPU, avrInstruction, 
  AVRTimer, timer0Config, timer1Config, timer2Config, 
  AVRUSART, usart0Config,
  AVRADC, adcConfig 
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

// Directly read the ATmega328P Timer Output Compare Registers (OCR) for precise Analog/PWM values
const getPinPWM = (cpu, pin) => {
  if (pin === 3) {
    if (cpu.data[0xB0] & (1 << 5)) return cpu.data[0xB4]; // TCCR2A & COM2B1 -> OCR2B
  } else if (pin === 5) {
    if (cpu.data[0x44] & (1 << 5)) return cpu.data[0x48]; // TCCR0A & COM0B1 -> OCR0B
  } else if (pin === 6) {
    if (cpu.data[0x44] & (1 << 7)) return cpu.data[0x47]; // TCCR0A & COM0A1 -> OCR0A
  } else if (pin === 9) {
    if (cpu.data[0x80] & (1 << 7)) return cpu.data[0x88]; // TCCR1A & COM1A1 -> OCR1AL
  } else if (pin === 10) {
    if (cpu.data[0x80] & (1 << 5)) return cpu.data[0x8A]; // TCCR1A & COM1B1 -> OCR1BL
  } else if (pin === 11) {
    if (cpu.data[0xB0] & (1 << 7)) return cpu.data[0xB3]; // TCCR2A & COM2A1 -> OCR2A
  }
  // Fallback to digital reading if PWM is not active on the pin
  return getPinState(cpu, pin) ? 255 : 0;
};

const setExternalPin = (cpu, pin, isHigh) => {
  let pinAddr, bit;
  if (pin >= 0 && pin <= 7) { pinAddr = 0x29; bit = pin; }  
  else if (pin >= 8 && pin <= 13) { pinAddr = 0x23; bit = pin - 8; } 
  else if (pin >= 14 && pin <= 19) { pinAddr = 0x26; bit = pin - 14; } 
  else { return; }

  if (isHigh) {
    cpu.data[pinAddr] |= (1 << bit);
  } else {
    cpu.data[pinAddr] &= ~(1 << bit);
  }
};

const generateId = () => Math.random().toString(36).substr(2, 9);

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

const TYPE_TAGS = {
  dc_motor: 'DC MOTOR',
  imu: 'IMU',
  ir_sensor: 'IR SENSOR',
  sonar: 'SONAR',
  grabber: 'GRABBER',
  buzzer: 'BUZZER',
  oled128x64: '128x64 OLED',
  lcd16x2: '16x2 LCD'
};

const DEFAULT_COLORS = {
  chassis: '#3b82f6',
  dc_motor: '#000000',
  sonar: '#ef4444',
  ir_sensor: '#22c55e',
  grabber: '#06b6d4',
  buzzer: '#f59e0b',
  imu: '#a855f7',
  lcd16x2: '#84cc16',
  oled128x64: '#0ea5e9',
  arena_static: '#52525b',
  arena_prop: '#a855f7'
};

const DEFAULT_CONFIG = {
  leftWidth: 45,
  editorHeight: 60,
  canvasHeight: 65,
  customLabWidth: 66,
  robotX: 200,
  robotY: 250,
  robotAngle: 0,
  baudRate: "9600",
  krumonMode: false,
  robotBuild: {
    chassisW: 50,
    chassisH: 30,
    chassisColor: DEFAULT_COLORS.chassis,
    parts:[
      { id: generateId(), type: 'dc_motor', name: 'Front Left', pin: 9, pinDir: 7, offsetX: 15, offsetY: -18, angle: 0, color: DEFAULT_COLORS.dc_motor },
      { id: generateId(), type: 'dc_motor', name: 'Back Left', pin: 9, pinDir: 7, offsetX: -15, offsetY: -18, angle: 0, color: DEFAULT_COLORS.dc_motor },
      { id: generateId(), type: 'dc_motor', name: 'Front Right', pin: 10, pinDir: 4, offsetX: 15, offsetY: 18, angle: 0, color: DEFAULT_COLORS.dc_motor },
      { id: generateId(), type: 'dc_motor', name: 'Back Right', pin: 10, pinDir: 4, offsetX: -15, offsetY: 18, angle: 0, color: DEFAULT_COLORS.dc_motor },
      { id: generateId(), type: 'buzzer', name: 'Horn', pin: 8, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS.buzzer }
    ]
  },
  arenaObjects:[] 
};

const getConfig = () => {
  try {
    const saved = localStorage.getItem('flawless-config');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {}
  return DEFAULT_CONFIG;
};

const defaultCode = `// HARDWARE PINS
int MOTOR_L_PWM = 9; int MOTOR_L_DIR = 7;
int MOTOR_R_PWM = 10; int MOTOR_R_DIR = 4;
int HORN_PIN = 8;

void setup() {
  Serial.begin(9600);
  pinMode(MOTOR_L_PWM, OUTPUT); pinMode(MOTOR_L_DIR, OUTPUT);
  pinMode(MOTOR_R_PWM, OUTPUT); pinMode(MOTOR_R_DIR, OUTPUT);
  pinMode(HORN_PIN, OUTPUT);
  Serial.println("[LCD]System Online\\nReady.");
}

void loop() {
  Serial.println("[LCD]Driving Forward");
  digitalWrite(MOTOR_L_DIR, LOW); digitalWrite(MOTOR_R_DIR, LOW);
  analogWrite(MOTOR_L_PWM, 180); analogWrite(MOTOR_R_PWM, 180);
  delay(1000);

  Serial.println("[LCD]Reversing!");
  digitalWrite(MOTOR_L_DIR, HIGH); digitalWrite(MOTOR_R_DIR, HIGH); // Reverse Polarity
  analogWrite(MOTOR_L_PWM, 128); analogWrite(MOTOR_R_PWM, 128);
  delay(1000);

  Serial.println("[LCD]Stopped & Honking");
  analogWrite(MOTOR_L_PWM, 0); analogWrite(MOTOR_R_PWM, 0);
  digitalWrite(HORN_PIN, HIGH); delay(500); digitalWrite(HORN_PIN, LOW);
  delay(500);
}`;

const krumonDefaultCode = `// KRUMON V.130715 COMPATIBILITY MODE
// Functions: fd(), bk(), sl(), sr(), tl(), tr(), ao(), motor(), analog(), beep(), sleep(), lcd(), keep_up(), keep_down()

void setup() {
  int a = 23;
  float b = 2.34f;
  
  // Custom printf natively handles floats!
  lcd(" A = %03d \\n B = %.2f", a, b);
  beep();
  sleep(1500);
}
  
void loop() {
  lcd("Driving Forward (50%)");
  fd(50);
  sleep(1000);
  
  lcd("Turning Left (tl)");
  tl(50);
  sleep(500);
  
  lcd("Stopping & Grabbing");
  ao();
  keep_up();
  beep();
  sleep(500);
  
  lcd("Releasing...");
  keep_down();
  sleep(500);
  
  lcd("Spinning Right (sr)");
  sr(50);
  sleep(1000);
}`;

const KRUMON_LIB = `
#define Binary_h // Prevent Arduino binary macros from conflicting with user variables
#include <Arduino.h>
#include <stdarg.h>

#define KRUMON_MOTOR_L_PWM 9
#define KRUMON_MOTOR_L_DIR 7
#define KRUMON_MOTOR_R_PWM 10
#define KRUMON_MOTOR_R_DIR 4
#define KRUMON_BUZZER 8
#define KRUMON_GRABBER 5

void _krumon_init() {
  pinMode(KRUMON_MOTOR_L_PWM, OUTPUT); pinMode(KRUMON_MOTOR_L_DIR, OUTPUT);
  pinMode(KRUMON_MOTOR_R_PWM, OUTPUT); pinMode(KRUMON_MOTOR_R_DIR, OUTPUT);
  pinMode(KRUMON_BUZZER, OUTPUT);
  pinMode(KRUMON_GRABBER, OUTPUT);
}
void sleep(int ms) { delay(ms); }
void fd(int p) { int v=(p*255)/100; digitalWrite(KRUMON_MOTOR_L_DIR, LOW); digitalWrite(KRUMON_MOTOR_R_DIR, LOW); analogWrite(KRUMON_MOTOR_L_PWM, v); analogWrite(KRUMON_MOTOR_R_PWM, v); }
void bk(int p) { int v=(p*255)/100; digitalWrite(KRUMON_MOTOR_L_DIR, HIGH); digitalWrite(KRUMON_MOTOR_R_DIR, HIGH); analogWrite(KRUMON_MOTOR_L_PWM, v); analogWrite(KRUMON_MOTOR_R_PWM, v); }
void sl(int p) { int v=(p*255)/100; digitalWrite(KRUMON_MOTOR_L_DIR, HIGH); digitalWrite(KRUMON_MOTOR_R_DIR, LOW); analogWrite(KRUMON_MOTOR_L_PWM, v); analogWrite(KRUMON_MOTOR_R_PWM, v); }
void sr(int p) { int v=(p*255)/100; digitalWrite(KRUMON_MOTOR_L_DIR, LOW); digitalWrite(KRUMON_MOTOR_R_DIR, HIGH); analogWrite(KRUMON_MOTOR_L_PWM, v); analogWrite(KRUMON_MOTOR_R_PWM, v); }
void tl(int p) { int v=(p*255)/100; digitalWrite(KRUMON_MOTOR_L_DIR, LOW); digitalWrite(KRUMON_MOTOR_R_DIR, LOW); analogWrite(KRUMON_MOTOR_L_PWM, 0); analogWrite(KRUMON_MOTOR_R_PWM, v); }
void tr(int p) { int v=(p*255)/100; digitalWrite(KRUMON_MOTOR_L_DIR, LOW); digitalWrite(KRUMON_MOTOR_R_DIR, LOW); analogWrite(KRUMON_MOTOR_L_PWM, v); analogWrite(KRUMON_MOTOR_R_PWM, 0); }
void ao() { analogWrite(KRUMON_MOTOR_L_PWM, 0); analogWrite(KRUMON_MOTOR_R_PWM, 0); }
void motor(int ch, int p) {
  int v = abs(p) * 255 / 100;
  bool dir = p < 0 ? HIGH : LOW;
  if(ch==1) { digitalWrite(KRUMON_MOTOR_L_DIR, dir); analogWrite(KRUMON_MOTOR_L_PWM, v); }
  if(ch==2) { digitalWrite(KRUMON_MOTOR_R_DIR, dir); analogWrite(KRUMON_MOTOR_R_PWM, v); }
}
void beep() { digitalWrite(KRUMON_BUZZER, HIGH); delay(100); digitalWrite(KRUMON_BUZZER, LOW); }
void keylow(char note, int ms) { digitalWrite(KRUMON_BUZZER, HIGH); delay(ms); digitalWrite(KRUMON_BUZZER, LOW); }
int analog(int ch) { return analogRead(A0 + ch); }
int sw1() { return 0; }
void sw1_press() {}
int sw_OK() { return 0; }
void OK() {}
void grab(int state) { digitalWrite(KRUMON_GRABBER, state ? HIGH : LOW); }
void keep_up() { digitalWrite(KRUMON_GRABBER, HIGH); }
void keep_down() { digitalWrite(KRUMON_GRABBER, LOW); }
void system_stop() { ao(); while(1); }

void lcd(const char* format, ...) {
  va_list args;
  va_start(args, format);
  Serial.print("[LCD]");
  while (*format != '\\0') {
    if (*format == '%') {
      format++;
      bool zeroPad = false;
      int width = 0;
      if (*format == '0') {
        zeroPad = true;
        format++;
      }
      while (*format >= '0' && *format <= '9') {
        width = width * 10 + (*format - '0');
        format++;
      }
      int decimals = 2;
      if (*format == '.') {
        format++;
        decimals = 0;
        while (*format >= '0' && *format <= '9') {
          decimals = decimals * 10 + (*format - '0');
          format++;
        }
      }
      if (*format == 'd' || *format == 'i' || *format == 'u') {
        String s = String(va_arg(args, int));
        while(s.length() < width) s = (zeroPad ? "0" : " ") + s;
        Serial.print(s);
      } else if (*format == 'l') { 
        format++;
        if (*format == 'd' || *format == 'i' || *format == 'u') {
          String s = String(va_arg(args, long));
          while(s.length() < width) s = (zeroPad ? "0" : " ") + s;
          Serial.print(s);
        }
      } else if (*format == 'f') {
        double val = va_arg(args, double);
        char buf[32];
        dtostrf(val, width > 0 ? width : 1, decimals, buf);
        String s = String(buf);
        if (zeroPad) {
            s.trim();
            while(s.length() < width) s = "0" + s;
        }
        Serial.print(s);
      } else if (*format == 's') {
        Serial.print(va_arg(args, char*));
      } else if (*format == 'c') {
        Serial.print((char)va_arg(args, int));
      } else if (*format == '%') {
        Serial.print('%');
      } else {
        Serial.print('%');
        Serial.print(*format);
      }
    } else if (*format == '\\n') {
      Serial.print("\\\\n");
    } else {
      Serial.print(*format);
    }
    format++;
  }
  Serial.println();
  va_end(args);
}
`;

const getSavedCode = () => {
  try {
    const saved = localStorage.getItem('flawless-code-cache');
    if (saved !== null) return saved;
  } catch (e) {}
  return defaultCode;
};

function App() {
  const initConfig = getConfig();
  
  const[code, setCode] = useState(getSavedCode);
  const[sysLogs, setSysLogs] = useState(['> System Ready. Sandbox Environment Loaded.']);
  const[serialOutput, setSerialOutput] = useState("");
  const[baudRate, setBaudRate] = useState(initConfig.baudRate || "9600");
  const[krumonMode, setKrumonMode] = useState(initConfig.krumonMode || false);
  
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

  // --- STATE ---
  const[robotBuild, setRobotBuild] = useState(initConfig.robotBuild || DEFAULT_CONFIG.robotBuild);
  const[arenaObjects, setArenaObjects] = useState(initConfig.arenaObjects || DEFAULT_CONFIG.arenaObjects);
  const[activeTab, setActiveTab] = useState('robot'); 
  const[newPartType, setNewPartType] = useState(initConfig.krumonMode ? 'ir_sensor' : 'dc_motor'); 
  
  const[isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false); 
  const baudRateRef = useRef(baudRate); 
  const buildRef = useRef(robotBuild); 
  const arenaObjectsRef = useRef(arenaObjects); 

  const setSimState = (state) => { setIsRunning(state); isRunningRef.current = state; };
  
  const[mapImage, setMapImage] = useState(() => {
    try { return localStorage.getItem('flawless-map-cache') || null; } 
    catch (e) { return null; }
  });
  
  const mapImageRef = useRef(null);
  const[leftWidth, setLeftWidth] = useState(initConfig.leftWidth);      
  const[editorHeight, setEditorHeight] = useState(initConfig.editorHeight); 
  const[canvasHeight, setCanvasHeight] = useState(initConfig.canvasHeight); 
  const[customLabWidth, setCustomLabWidth] = useState(initConfig.customLabWidth || 66); 
  const[isDragging, setIsDragging] = useState(false);  
  
  const requestRef = useRef(null);
  const sysLogEndRef = useRef(null);
  const serialEndRef = useRef(null);
  
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const robotRef = useRef(null);
  const arenaBodiesRef = useRef([]); 
  const mouseConstraintRef = useRef(null); 
  
  const sonarStatesRef = useRef({}); 
  const grabberStatesRef = useRef({}); 

  // Audio Infrastructure
  const audioCtxRef = useRef(null);
  const activeOscillatorsRef = useRef({});

  // Capture ALL display components
  const displayComponents = robotBuild.parts.filter(p => p.type === 'lcd16x2' || p.type === 'oled128x64');

  // OFF-SCREEN CANVAS FOR PIXEL READING
  const offscreenCanvasRef = useRef(document.createElement('canvas'));
  const offscreenCtxRef = useRef(offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true }));
  const mapPixelDataRef = useRef(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const updatePixelMapRef = useRef(null);

  updatePixelMapRef.current = () => {
    const { w, h } = canvasSizeRef.current;
    if (w === 0 || h === 0) return;
    
    const canvas = offscreenCanvasRef.current;
    const ctx = offscreenCtxRef.current;
    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

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

  // Cache Layout Configuration
  useEffect(() => {
    const current = getConfig();
    const nextConfig = { ...current, leftWidth, editorHeight, canvasHeight, customLabWidth, baudRate, robotBuild, arenaObjects, krumonMode };
    localStorage.setItem('flawless-config', JSON.stringify(nextConfig));
  },[leftWidth, editorHeight, canvasHeight, customLabWidth, baudRate, robotBuild, arenaObjects, krumonMode]);

  // Cache User Code
  useEffect(() => {
    try {
      localStorage.setItem('flawless-code-cache', code);
    } catch (err) { }
  }, [code]);

  useEffect(() => { sysLogEndRef.current?.scrollIntoView({ behavior: "smooth" }); },[sysLogs]);
  useEffect(() => { serialEndRef.current?.scrollIntoView({ behavior: "smooth" }); },[serialOutput]);

  const handleKrumonToggle = () => {
    const nextMode = !krumonMode;
    setKrumonMode(nextMode);
    
    setSysLogs(prev =>[
       ...prev, 
       `> KRUMON v.130715 Compatibility Mode: ${nextMode ? 'ENABLED (Hardware Auto-Configured)' : 'DISABLED'}`
    ]);

    if (nextMode) {
       if (code === defaultCode) setCode(krumonDefaultCode);

       setNewPartType('ir_sensor'); 
       setRobotBuild(prev => {
          const nextParts =[];
          let counts = { ir_sensor: 0, sonar: 0 };
          
          prev.parts.forEach(p => {
             if (p.type === 'ir_sensor' && counts.ir_sensor < 7) {
                nextParts.push(p);
                counts.ir_sensor++;
             }
             if (p.type === 'sonar' && counts.sonar < 1) {
                nextParts.push(p);
                counts.sonar++;
             }
          });

          nextParts.push({ id: generateId(), type: 'dc_motor', name: 'Front Left Motor', pin: 9, pinDir: 7, offsetX: 15, offsetY: -18, angle: 0, color: DEFAULT_COLORS.dc_motor });
          nextParts.push({ id: generateId(), type: 'dc_motor', name: 'Back Left Motor', pin: 9, pinDir: 7, offsetX: -15, offsetY: -18, angle: 0, color: DEFAULT_COLORS.dc_motor });
          nextParts.push({ id: generateId(), type: 'dc_motor', name: 'Front Right Motor', pin: 10, pinDir: 4, offsetX: 15, offsetY: 18, angle: 0, color: DEFAULT_COLORS.dc_motor });
          nextParts.push({ id: generateId(), type: 'dc_motor', name: 'Back Right Motor', pin: 10, pinDir: 4, offsetX: -15, offsetY: 18, angle: 0, color: DEFAULT_COLORS.dc_motor });
          
          nextParts.push({ id: generateId(), type: 'buzzer', name: 'Buzzer', pin: 8, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS.buzzer });
          nextParts.push({ id: generateId(), type: 'grabber', name: 'Grabber', pin: 5, offsetX: 25, offsetY: 0, angle: 0, color: DEFAULT_COLORS.grabber });
          nextParts.push({ id: generateId(), type: 'lcd16x2', name: '16x2 LCD', pin: 0, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS.lcd16x2 });

          return { ...prev, parts: nextParts };
       });
    } else {
       if (code === krumonDefaultCode) setCode(defaultCode);
       setNewPartType('dc_motor'); 
    }
  };

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
  const handleDragBottom = (e) => {
    e.preventDefault(); setIsDragging(true);
    const container = e.currentTarget.parentElement; 
    const { left, width } = container.getBoundingClientRect();
    const onMouseMove = (ev) => setCustomLabWidth(Math.max(30, Math.min(80, ((ev.clientX - left) / width) * 100)));
    const onMouseUp = () => { setIsDragging(false); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
  };

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
        setSysLogs(prev =>[
          ...prev, 
          `> MAP LOADED: ${file.name}`, 
          `> WARNING: Map file is too large to cache. It will disappear on refresh.`
        ]);
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
        if (parsed.leftWidth) setLeftWidth(parsed.leftWidth);
        if (parsed.editorHeight) setEditorHeight(parsed.editorHeight);
        if (parsed.canvasHeight) setCanvasHeight(parsed.canvasHeight);
        if (parsed.customLabWidth) setCustomLabWidth(parsed.customLabWidth);
        if (parsed.baudRate) setBaudRate(parsed.baudRate);
        
        let importedKrumonMode = parsed.krumonMode !== undefined ? parsed.krumonMode : false;
        setKrumonMode(importedKrumonMode);
        setNewPartType(importedKrumonMode ? 'ir_sensor' : 'dc_motor');

        if (parsed.robotBuild) {
           let nextBuild = parsed.robotBuild;
           if (importedKrumonMode) {
               // Enforce Krumon limits on imported builds
               const nextParts =[];
               const counts = { dc_motor: 0, buzzer: 0, grabber: 0, lcd16x2: 0, ir_sensor: 0, sonar: 0 };
               nextBuild.parts.forEach(p => {
                  if (['imu', 'oled128x64'].includes(p.type)) return;
                  const max = p.type === 'dc_motor' ? 4 : p.type === 'ir_sensor' ? 7 : 1;
                  if (counts[p.type] < max) {
                     nextParts.push(p);
                     counts[p.type]++;
                  }
               });
               nextBuild.parts = nextParts;
           }
           setRobotBuild(nextBuild);
        }
        
        if (parsed.arenaObjects) setArenaObjects(parsed.arenaObjects);
        
        if (robotRef.current && parsed.robotX !== undefined) {
          Matter.Body.setPosition(robotRef.current, { x: parsed.robotX, y: parsed.robotY });
          Matter.Body.setAngle(robotRef.current, parsed.robotAngle);
        }
        localStorage.setItem('flawless-config', JSON.stringify(parsed));
        setSysLogs(prev =>[...prev, '> FILE IMPORTED: Sandbox Environment reconstructed!']);
        e.target.value = null;
      } catch (err) { setSysLogs(prev =>[...prev, '> ERROR: Invalid Configuration File!']); }
    };
    reader.readAsText(file);
  };

  const restoreDefaults = () => {
    // Preserve the current mode when resetting!
    localStorage.removeItem('flawless-code-cache');
    
    setLeftWidth(DEFAULT_CONFIG.leftWidth);
    setEditorHeight(DEFAULT_CONFIG.editorHeight);
    setCanvasHeight(DEFAULT_CONFIG.canvasHeight);
    setCustomLabWidth(DEFAULT_CONFIG.customLabWidth || 66);
    setBaudRate(DEFAULT_CONFIG.baudRate);
    
    let baseBuild = { 
       chassisW: DEFAULT_CONFIG.robotBuild.chassisW,
       chassisH: DEFAULT_CONFIG.robotBuild.chassisH,
       chassisColor: DEFAULT_CONFIG.robotBuild.chassisColor,
       parts:[]
    };

    if (krumonMode) {
       baseBuild.parts =[
          { id: generateId(), type: 'dc_motor', name: 'Front Left Motor', pin: 9, pinDir: 7, offsetX: 15, offsetY: -18, angle: 0, color: DEFAULT_COLORS.dc_motor },
          { id: generateId(), type: 'dc_motor', name: 'Back Left Motor', pin: 9, pinDir: 7, offsetX: -15, offsetY: -18, angle: 0, color: DEFAULT_COLORS.dc_motor },
          { id: generateId(), type: 'dc_motor', name: 'Front Right Motor', pin: 10, pinDir: 4, offsetX: 15, offsetY: 18, angle: 0, color: DEFAULT_COLORS.dc_motor },
          { id: generateId(), type: 'dc_motor', name: 'Back Right Motor', pin: 10, pinDir: 4, offsetX: -15, offsetY: 18, angle: 0, color: DEFAULT_COLORS.dc_motor },
          { id: generateId(), type: 'buzzer', name: 'Buzzer', pin: 8, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS.buzzer },
          { id: generateId(), type: 'grabber', name: 'Grabber', pin: 5, offsetX: 25, offsetY: 0, angle: 0, color: DEFAULT_COLORS.grabber },
          { id: generateId(), type: 'lcd16x2', name: '16x2 LCD', pin: 0, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS.lcd16x2 }
       ];
       setNewPartType('ir_sensor');
    } else {
       baseBuild.parts = DEFAULT_CONFIG.robotBuild.parts.map(p => ({ ...p, id: generateId() }));
       setNewPartType('dc_motor');
    }

    setRobotBuild(baseBuild);
    setArenaObjects(DEFAULT_CONFIG.arenaObjects);
    setCode(krumonMode ? krumonDefaultCode : defaultCode);
    
    if (robotRef.current) {
      Matter.Body.setPosition(robotRef.current, { x: DEFAULT_CONFIG.robotX, y: DEFAULT_CONFIG.robotY });
      Matter.Body.setAngle(robotRef.current, DEFAULT_CONFIG.robotAngle);
      Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    }

    const newConfig = { ...DEFAULT_CONFIG, krumonMode, robotBuild: baseBuild };
    localStorage.setItem('flawless-config', JSON.stringify(newConfig));

    setSysLogs(prev =>[...prev, `> CACHE CLEARED: Reverted to Factory Defaults${krumonMode ? ' (Krumon Chassis)' : ''}.`]);
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

    const ROBOT_GROUP = -1; 
    const chassisColor = buildConfig.chassisColor || DEFAULT_COLORS.chassis;
    
    const chassis = Matter.Bodies.rectangle(x, y, w, h, { 
      render: { fillStyle: chassisColor },
      collisionFilter: { group: ROBOT_GROUP }
    });
    
    const partsArray =[chassis];

    buildConfig.parts.forEach(p => {
      const pAngleRad = (p.angle || 0) * (Math.PI / 180);
      const pColor = p.color || DEFAULT_COLORS[p.type] || '#ffffff';

      let pW = 6, pH = 6;
      if (p.type === 'dc_motor') { pW = 14; pH = 6; }
      else if (p.type === 'sonar') { pW = 6; pH = 12; }
      else if (p.type === 'ir_sensor') { pW = 4; pH = 4; }
      else if (p.type === 'grabber') { pW = 10; pH = 8; }
      else if (p.type === 'buzzer' || p.type === 'imu' || p.type === 'lcd16x2' || p.type === 'oled128x64') { pW = 6; pH = 6; } 
      
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
    Matter.Body.setAngle(robot, angle);

    robotRef.current = robot;
    Matter.World.add(engineRef.current.world, robot);
  };

  const rebuildArenaPhysics = (objects) => {
    if (!engineRef.current) return;
    
    if (arenaBodiesRef.current.length > 0) {
      Matter.World.remove(engineRef.current.world, arenaBodiesRef.current);
    }

    const newBodies = objects.map(obj => {
      const w = Math.max(5, obj.w || 20);
      const h = Math.max(5, obj.h || 20);
      const objColor = obj.color || (obj.isStatic ? DEFAULT_COLORS.arena_static : DEFAULT_COLORS.arena_prop);
      
      return Matter.Bodies.rectangle(obj.x, obj.y, w, h, {
        isStatic: obj.isStatic,
        angle: (obj.angle || 0) * (Math.PI / 180),
        friction: 0.5,
        restitution: 0.2, 
        render: { fillStyle: objColor },
        plugin: { id: obj.id, isPickable: !!obj.isPickable } 
      });
    });

    arenaBodiesRef.current = newBodies;
    Matter.World.add(engineRef.current.world, newBodies);
  };

  useEffect(() => {
    if (engineRef.current) rebuildRobotPhysics(robotBuild);
  },[robotBuild]);

  useEffect(() => {
    if (engineRef.current) {
       const hasGrab = Object.values(grabberStatesRef.current).some(s => s.constraints);
       if (hasGrab) stopSimulation();
       rebuildArenaPhysics(arenaObjects);
    }
  },[arenaObjects]);

  // --- INITIALIZE PHYSICS ENGINE ---
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

    const initConf = getConfig();
    
    let walls =[
      Matter.Bodies.rectangle(render.options.width / 2, 0, render.options.width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
      Matter.Bodies.rectangle(render.options.width / 2, render.options.height, render.options.width, 20, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
      Matter.Bodies.rectangle(0, render.options.height / 2, 20, render.options.height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } }),
      Matter.Bodies.rectangle(render.options.width, render.options.height / 2, 20, render.options.height, { isStatic: true, render: { fillStyle: DEFAULT_COLORS.arena_static } })
    ];

    const mouse = Matter.Mouse.create(render.canvas);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, render: { visible: false } }
    });
    mouseConstraintRef.current = mouseConstraint;
    render.mouse = mouse;

    Matter.World.add(engine.world,[mouseConstraint, ...walls]);
    
    rebuildRobotPhysics(initConf.robotBuild, initConf.robotX, initConf.robotY, initConf.robotAngle);
    rebuildArenaPhysics(initConf.arenaObjects);

    Matter.Events.on(mouseConstraint, 'enddrag', () => {
      if (robotRef.current && mouseConstraint.body === robotRef.current) {
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
      }

      const draggedBodyIndex = arenaBodiesRef.current.indexOf(mouseConstraint.body);
      if (draggedBodyIndex !== -1) {
         setArenaObjects(prev => {
            const next = [...prev];
            const body = arenaBodiesRef.current[draggedBodyIndex];
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
         const hudX = document.getElementById('hud-x');
         const hudY = document.getElementById('hud-y');
         const hudAngle = document.getElementById('hud-angle');
         if (hudX) hudX.innerText = Math.round(r.position.x);
         if (hudY) hudY.innerText = Math.round(r.position.y);
         if (hudAngle) hudAngle.innerText = normalizedDeg.toFixed(2);
      }

      arenaBodiesRef.current.forEach((body, i) => {
         const obj = arenaObjectsRef.current[i];
         if (!obj) return;
         const deg = (((body.angle * (180 / Math.PI)) % 360) + 360) % 360;
         const elX = document.getElementById(`arena-x-${obj.id}`);
         const elY = document.getElementById(`arena-y-${obj.id}`);
         const elAng = document.getElementById(`arena-ang-${obj.id}`);
         
         if (elX && document.activeElement !== elX) elX.value = Math.round(body.position.x);
         if (elY && document.activeElement !== elY) elY.value = Math.round(body.position.y);
         if (elAng && document.activeElement !== elAng) elAng.value = deg.toFixed(2);
      });
    });

    Matter.Events.on(render, 'afterRender', () => {
      if (!robotRef.current) return;
      const ctx = render.context;
      const r = robotRef.current;

      ctx.save();
      ctx.translate(r.position.x, r.position.y);
      ctx.rotate(r.angle);

      const w2 = Math.max(10, buildRef.current.chassisW) / 2;
      const h2 = Math.max(10, buildRef.current.chassisH) / 2;
      
      const chassisColor = buildRef.current.chassisColor || DEFAULT_COLORS.chassis;
      const oppChassisColor = getOppositeColor(chassisColor);

      // Chassis Grid Lines
      ctx.strokeStyle = oppChassisColor;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -w2; x <= w2; x += 10) { ctx.moveTo(x, -h2); ctx.lineTo(x, h2); }
      for (let y = -h2; y <= h2; y += 10) { ctx.moveTo(-w2, y); ctx.lineTo(w2, y); }
      ctx.stroke();

      // Chassis Directional Arrow
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(15, 0); 
      ctx.lineTo(10, -5); ctx.moveTo(15, 0); ctx.lineTo(10, 5); 
      ctx.stroke();
      
      ctx.globalAlpha = 1.0; 

      buildRef.current.parts.forEach(p => {
        const isIR = p.type === 'ir_sensor';
        const isBuzzer = p.type === 'buzzer';
        const hexColor = p.color || DEFAULT_COLORS[p.type] || '#ffffff';
        const oppColor = getOppositeColor(hexColor);

        ctx.fillStyle = oppColor;
        ctx.strokeStyle = oppColor;
        ctx.lineWidth = 1.5;

        // Custom shape for grabber (brackets)
        if (p.type === 'grabber') {
           ctx.beginPath();
           ctx.moveTo(p.offsetX - 3, p.offsetY - 5);
           ctx.lineTo(p.offsetX + 4, p.offsetY - 5);
           ctx.lineTo(p.offsetX + 6, p.offsetY - 3);
           ctx.lineTo(p.offsetX + 6, p.offsetY + 3);
           ctx.lineTo(p.offsetX + 4, p.offsetY + 5);
           ctx.lineTo(p.offsetX - 3, p.offsetY + 5);
           ctx.closePath();
           ctx.fill();

           // Visual effect if active
           const state = grabberStatesRef.current[p.id];
           if (state && state.constraints) {
              ctx.beginPath();
              ctx.strokeStyle = '#a855f7'; 
              ctx.lineWidth = 2;
              const pAngleRad = (p.angle || 0) * (Math.PI / 180);
              ctx.moveTo(p.offsetX, p.offsetY);
              ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * 20, p.offsetY + Math.sin(pAngleRad) * 20);
              ctx.stroke();
           } else if (state && state.isHigh) {
              ctx.beginPath();
              ctx.strokeStyle = '#eab308'; 
              ctx.lineWidth = 1;
              ctx.arc(p.offsetX + 5, p.offsetY, 6, 0, Math.PI * 2);
              ctx.stroke();
           }
        } 
        else if (isBuzzer) {
           // Draw buzzer (circle with a dot in middle)
           ctx.beginPath();
           ctx.arc(p.offsetX, p.offsetY, 3, 0, 2 * Math.PI);
           ctx.fill();
           ctx.fillStyle = hexColor;
           ctx.beginPath();
           ctx.arc(p.offsetX, p.offsetY, 1, 0, 2 * Math.PI);
           ctx.fill();
           
           // If making sound, draw soundwaves
           const state = activeOscillatorsRef.current[p.id];
           if (state && state.isHigh) {
              ctx.strokeStyle = hexColor;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(p.offsetX, p.offsetY, 6, -Math.PI/4, Math.PI/4);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(p.offsetX, p.offsetY, 9, -Math.PI/4, Math.PI/4);
              ctx.stroke();
           }
        }
        else {
           ctx.beginPath();
           ctx.arc(p.offsetX, p.offsetY, isIR ? 1.5 : 2, 0, 2 * Math.PI);
           ctx.fill();

           const pAngleRad = (p.angle || 0) * (Math.PI / 180);
           
           if (isIR && p.irMode === 'object') {
              ctx.beginPath();
              ctx.strokeStyle = hexColor;
              ctx.globalAlpha = 0.3; 
              ctx.moveTo(p.offsetX, p.offsetY);
              ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * 40, p.offsetY + Math.sin(pAngleRad) * 40);
              ctx.stroke();
              ctx.globalAlpha = 1.0;
           } else {
              ctx.beginPath();
              ctx.moveTo(p.offsetX, p.offsetY);
              ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * (isIR ? 3 : 5), p.offsetY + Math.sin(pAngleRad) * (isIR ? 3 : 5));
              ctx.stroke();
           }
        }

        // --- RENDER SONAR RAYCAST LINE ---
        if (p.type === 'sonar') {
          const state = sonarStatesRef.current[p.id];
          const maxRange = p.range || 400;
          const hitDist = state ? state.lastDist : maxRange; 
          
          const pAngleRad = (p.angle || 0) * (Math.PI / 180);
          ctx.beginPath();
          ctx.strokeStyle = hexColor;
          ctx.globalAlpha = 0.3; 
          ctx.moveTo(p.offsetX, p.offsetY);
          ctx.lineTo(p.offsetX + Math.cos(pAngleRad) * hitDist, p.offsetY + Math.sin(pAngleRad) * hitDist);
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }
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

          canvasSizeRef.current = { w: width, h: height };
          if(updatePixelMapRef.current) updatePixelMapRef.current();

          Matter.World.remove(engine.world, walls);
          walls =[
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

  // --- COMPONENT & ARENA MANAGEMENT ---
  const addArenaObject = () => {
    setArenaObjects(prev =>[
      ...prev, 
      { id: generateId(), name: 'New Box', x: 300, y: 300, w: 40, h: 40, isStatic: false, isPickable: true, angle: 0, color: DEFAULT_COLORS.arena_prop }
    ]);
  };

  const removeArenaObject = (id) => {
    setArenaObjects(prev => prev
      .map((obj, i) => {
         if (arenaBodiesRef.current[i]) {
            return { ...obj, x: arenaBodiesRef.current[i].position.x, y: arenaBodiesRef.current[i].position.y, angle: arenaBodiesRef.current[i].angle * (180 / Math.PI) };
         }
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
          if (key === 'isStatic' && val === true) {
              return { ...obj, x: newX, y: newY, angle: newAng, isStatic: true, isPickable: false };
          }
          return { ...obj, x: newX, y: newY, angle: newAng, [key]: val };
       }
       return { ...obj, x: newX, y: newY, angle: newAng };
    }));
  };

  const addPart = (type) => {
    if (krumonMode) {
      const count = robotBuild.parts.filter(p => p.type === type).length;
      if (type === 'ir_sensor' && count >= 7) return;
      if (type === 'sonar' && count >= 1) return;
    }

    setRobotBuild(prev => {
      let newPart = { id: generateId(), type: type, offsetX: 0, offsetY: 0, angle: 0, color: DEFAULT_COLORS[type] };
      if (type === 'dc_motor') { newPart.name = 'New Motor'; newPart.pin = 9; newPart.pinDir = 7; }
      else if (type === 'sonar') { newPart.name = 'New Sonar'; newPart.pinTrig = 3; newPart.pinEcho = 2; newPart.offsetX = 25; newPart.range = 400; }
      else if (type === 'ir_sensor') { newPart.name = 'New IR Sensor'; newPart.pin = 14; newPart.offsetX = 25; newPart.irMode = 'map'; } 
      else if (type === 'grabber') { newPart.name = 'New Grabber'; newPart.pin = 5; newPart.offsetX = 25; } 
      else if (type === 'buzzer') { newPart.name = 'Active Buzzer'; newPart.pin = 8; newPart.offsetX = 0; } 
      else if (type === 'imu') { newPart.name = 'Analog Compass'; newPart.pin = 15; newPart.offsetX = 0; } 
      else if (type === 'oled128x64') { newPart.name = '128x64 OLED'; newPart.pin = 0; newPart.offsetX = 0; } 
      else if (type === 'lcd16x2') { newPart.name = '16x2 LCD'; newPart.pin = 0; newPart.offsetX = 0; } 
      return { ...prev, parts:[...prev.parts, newPart] };
    });
  };

  const removePart = (id) => setRobotBuild(prev => ({ ...prev, parts: prev.parts.filter(p => p.id !== id) }));

  const updatePart = (id, key, value) => {
    setRobotBuild(prev => ({
      ...prev,
      parts: prev.parts.map(p => {
         if (p.id === id) {
            const val = (key === 'name' || key === 'color' || key === 'irMode') ? value : Number(value);
            return { ...p,[key]: val };
         }
         return p;
      })
    }));
  };

  const updateChassis = (key, value) => setRobotBuild(prev => ({ 
    ...prev,[key]: key === 'chassisColor' ? value : Math.max(10, Number(value)) 
  }));

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
    
    // Stop all audio
    Object.values(activeOscillatorsRef.current).forEach(state => {
        if (state.osc) {
            try { state.osc.stop(); } catch(e){}
            state.osc.disconnect();
            if(state.gain) state.gain.disconnect();
        }
    });
    activeOscillatorsRef.current = {};

    sonarStatesRef.current = {}; 
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
    
    buildRef.current.parts.forEach(p => {
       const el = document.getElementById(`pin-ui-${p.id}`);
       if (el) el.className = "transition-colors duration-75 text-gray-400 dark:text-gray-600";
    });

    if (robotRef.current) Matter.Body.setVelocity(robotRef.current, { x: 0, y: 0 });
    
    arenaBodiesRef.current.forEach(body => {
       if (!body.isStatic) Matter.Body.setVelocity(body, { x: 0, y: 0 });
    });

    // Reset LCD/OLED Screens to offline message
    document.querySelectorAll('.screen-text-content').forEach(el => {
       if (el.dataset.screenType === 'lcd16x2') el.innerHTML = "16x2 LCD<br/>OFFLINE";
       if (el.dataset.screenType === 'oled128x64') el.innerHTML = "128x64 OLED<br/>OFFLINE";
    });

    setSysLogs(prev =>[...prev, '> Simulation STOPPED.']);
  };

  const resetSimulation = () => {
    stopSimulation();
    const serialEl = document.getElementById('serial-console');
    if (serialEl) serialEl.textContent = "";
    
    const conf = getConfig();
    
    setArenaObjects(conf.arenaObjects ||[]);
    if (engineRef.current) {
      Matter.World.remove(engineRef.current.world, arenaBodiesRef.current);
      arenaBodiesRef.current =[];
    }
    rebuildArenaPhysics(conf.arenaObjects ||[]); 

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
    
    setSysLogs(['> Hardware Reset. Arena rebuilt. Robot returned to Saved Position.']);
  };

  const bootVirtualCpu = (hexData, isOffline = false) => {
    try {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }

      // Initialize Audio Context on user action (Run)
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }

      setSysLogs(prev =>[...prev, '> Flashing to Virtual Flash Memory...']);
      
      const program = new Uint16Array(16384);
      loadHex(hexData, new Uint8Array(program.buffer));
      
      const cpu = new CPU(program);
      const timer0 = new AVRTimer(cpu, timer0Config);
      const timer1 = new AVRTimer(cpu, timer1Config);
      const timer2 = new AVRTimer(cpu, timer2Config);
      const usart = new AVRUSART(cpu, usart0Config, 16e6);
      
      const adc = new AVRADC(cpu, adcConfig);
      
      let serialBuffer = "";
      let serialLine = "";

      usart.onByteTransmit = (byte) => {
        if (byte === 13) return; // Ignore CR internally to avoid double newlines in HTML
        
        const u2x0 = (cpu.data[0xC0] & 2) ? 8 : 16; 
        const ubrr = cpu.data[0xC4] | (cpu.data[0xC5] << 8); 
        const actualBaud = Math.round(16000000 / (u2x0 * (ubrr + 1))); 
        const mismatchRatio = Math.abs(actualBaud - parseInt(baudRateRef.current, 10)) / parseInt(baudRateRef.current, 10);

        if (mismatchRatio > 0.05) return; // Skip if baud is mismatched

        const char = String.fromCharCode(byte);
        serialBuffer += char;

        // Custom[LCD] serial interceptor for virtual screens
        if (byte === 10) { 
           if (serialLine.startsWith('[LCD]')) {
               // Extract string and convert C-style escaped \\n back into actual newlines
               const lcdMsg = serialLine.substring(5).replace(/\\n/g, '\n'); 
               document.querySelectorAll('.screen-text-content').forEach(el => {
                   el.textContent = lcdMsg;
               });
           }
           serialLine = "";
        } else {
           serialLine += char;
        }
      };
      
      setSimState(true);
      if (isOffline) setSysLogs(prev =>[...prev, '> OFFLINE MODE: Running local .hex file']);
      setSysLogs(prev =>[...prev, '> Sandbox Physics Engine RUNNING...']);
      
      const hudPortb = document.getElementById('hud-portb');
      const serialEl = document.getElementById('serial-console');

      // Clear virtual screens on boot
      document.querySelectorAll('.screen-text-content').forEach(el => {
         el.textContent = "";
      });

      const sonars = buildRef.current.parts.filter(p => p.type === 'sonar');
      const sonarDefs = sonars.map(p => {
         let portAddr, bit;
         if (p.pinTrig >= 0 && p.pinTrig <= 7) { portAddr = 0x2B; bit = p.pinTrig; } 
         else if (p.pinTrig >= 8 && p.pinTrig <= 13) { portAddr = 0x25; bit = p.pinTrig - 8; } 
         else { portAddr = 0x28; bit = p.pinTrig - 14; }
         return { 
           id: p.id, portAddr, mask: 1 << bit, echoPin: p.pinEcho, 
           maxRange: p.range || 400, 
           offsetX: p.offsetX, offsetY: p.offsetY, angle: p.angle 
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
                  for (let s=0; s < sonarDefs.length; s++) {
                      const sd = sonarDefs[s];
                      const isTrigHigh = (cpu.data[sd.portAddr] & sd.mask) !== 0;
                      const state = sonarStatesRef.current[sd.id] || { lastTrig: false, echoStart: 0, echoEnd: 0, lastDist: sd.maxRange };

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
                      sonarStatesRef.current[sd.id] = state;
                  }
              }

              if (i % 16 === 0) {
                  const cycle = cpu.cycles;
                  for (let s=0; s < sonarDefs.length; s++) {
                      const sd = sonarDefs[s];
                      const state = sonarStatesRef.current[sd.id];
                      if (state) {
                          const isEchoing = cycle >= state.echoStart && cycle <= state.echoEnd;
                          setExternalPin(cpu, sd.echoPin, isEchoing);
                      }
                  }
              }
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

            if (!isDraggingRobot && robot) {
              let localVx = 0;
              let localVy = 0;
              let angularVelocity = 0;

              const robX = robot.position.x;
              const robY = robot.position.y;
              const robCos = Math.cos(robot.angle);
              const robSin = Math.sin(robot.angle);
              const cycle = cpu.cycles;

              buildRef.current.parts.forEach(part => {
                 if (part.type === 'dc_motor') {
                    const pwmVal = getPinPWM(cpu, part.pin);
                    let power = pwmVal / 255.0;
                    
                    // If motor is wired with a direction pin, reverse power if HIGH
                    if (part.pinDir !== undefined && getPinState(cpu, part.pinDir)) {
                       power = -power;
                    }

                    const isRunning = Math.abs(power) > 0;
                    const uiEl = document.getElementById(`pin-ui-${part.id}`);
                    
                    if (uiEl) {
                        if (power > 0) uiEl.className = "transition-colors duration-75 text-green-600 dark:text-green-400 font-bold";
                        else if (power < 0) uiEl.className = "transition-colors duration-75 text-red-600 dark:text-red-400 font-bold";
                        else uiEl.className = "transition-colors duration-75 text-gray-400 dark:text-gray-600";
                        
                        uiEl.style.opacity = isRunning ? (0.4 + (Math.abs(power) * 0.6)) : 1;
                    }
                    
                    if (isRunning) {
                       const pAngleRad = (part.angle || 0) * (Math.PI / 180);
                       const forceX = Math.cos(pAngleRad) * 1 * power; 
                       const forceY = Math.sin(pAngleRad) * 1 * power;
                       localVx += forceX; localVy += forceY;

                       const torque = (part.offsetX * forceY) - (part.offsetY * forceX);
                       angularVelocity += torque * 0.0032; 
                    }
                 }
                 else if (part.type === 'buzzer') {
                    const isHigh = getPinState(cpu, part.pin);
                    const state = activeOscillatorsRef.current[part.id] || { isHigh: false, osc: null, gain: null };

                    if (isHigh && !state.isHigh) {
                        if (audioCtxRef.current) {
                            const osc = audioCtxRef.current.createOscillator();
                            const gain = audioCtxRef.current.createGain();
                            osc.type = 'square';
                            osc.frequency.setValueAtTime(800, audioCtxRef.current.currentTime);
                            gain.gain.setValueAtTime(0.05, audioCtxRef.current.currentTime); // low volume beep
                            osc.connect(gain);
                            gain.connect(audioCtxRef.current.destination);
                            osc.start();
                            state.osc = osc;
                            state.gain = gain;
                        }
                    } else if (!isHigh && state.isHigh) {
                        if (state.osc) {
                            try { state.osc.stop(); } catch(e){}
                            state.osc.disconnect();
                            state.gain.disconnect();
                            state.osc = null;
                            state.gain = null;
                        }
                    }
                    state.isHigh = isHigh;
                    activeOscillatorsRef.current[part.id] = state;

                    const uiEl = document.getElementById(`pin-ui-${part.id}`);
                    if (uiEl) uiEl.className = isHigh ? "transition-colors duration-75 text-orange-500 font-bold" : "transition-colors duration-75 text-gray-400 dark:text-gray-600";
                 }
                 else if (part.type === 'ir_sensor') {
                    const sensorGlobalX = robX + (part.offsetX * robCos) - (part.offsetY * robSin);
                    const sensorGlobalY = robY + (part.offsetX * robSin) + (part.offsetY * robCos);
                    
                    let isDetected = false;
                    let gray = 255;
                    let dist = 40;

                    if (part.irMode === 'object') {
                       const pAngleRad = robot.angle + (part.angle || 0) * (Math.PI / 180);
                       const allBodies = Matter.Composite.allBodies(engineRef.current.world);
                       const validBodies = allBodies.filter(b => b !== robot && !robot.parts.includes(b) && !b.isSensor);

                       for (let d = 0; d <= 40; d += 5) {
                           const pt = { x: sensorGlobalX + Math.cos(pAngleRad)*d, y: sensorGlobalY + Math.sin(pAngleRad)*d };
                           if (Matter.Query.point(validBodies, pt).length > 0) {
                               dist = d;
                               isDetected = true;
                               break;
                           }
                       }
                    } else {
                       if (mapPixelDataRef.current) {
                          const px = Math.floor(sensorGlobalX);
                          const py = Math.floor(sensorGlobalY);
                          const { width, height, data } = mapPixelDataRef.current;
                          
                          if (px >= 0 && px < width && py >= 0 && py < height) {
                             const idx = (py * width + px) * 4;
                             const r = data[idx];
                             const g = data[idx+1];
                             const b = data[idx+2];
                             gray = 0.299 * r + 0.587 * g + 0.114 * b;
                          }
                       }
                       isDetected = gray < 128;
                    }

                    const isAnalogPin = part.pin >= 14 && part.pin <= 19;

                    if (isAnalogPin) {
                        const channel = part.pin - 14;
                        let voltage = 0;
                        if (part.irMode === 'object') {
                            voltage = ((40 - dist) / 40) * 5;
                        } else {
                            voltage = ((255 - gray) / 255) * 5; 
                        }
                        adc.channelValues[channel] = voltage;
                        
                        const uiEl = document.getElementById(`pin-ui-${part.id}`);
                        if (uiEl) uiEl.className = isDetected ? "transition-colors duration-75 text-green-600 dark:text-green-400 font-bold" : "transition-colors duration-75 text-gray-400 dark:text-gray-600";
                    } else {
                        setExternalPin(cpu, part.pin, isDetected);
                        
                        const uiEl = document.getElementById(`pin-ui-${part.id}`);
                        if (uiEl) uiEl.className = isDetected ? "transition-colors duration-75 text-green-600 dark:text-green-400 font-bold" : "transition-colors duration-75 text-gray-400 dark:text-gray-600";
                    }
                 }
                 else if (part.type === 'imu') {
                    const pAngleRad = robot.angle + (part.angle || 0) * (Math.PI / 180);
                    let deg = ((pAngleRad * 180 / Math.PI) % 360 + 360) % 360; 

                    const isAnalogPin = part.pin >= 14 && part.pin <= 19;
                    if (isAnalogPin) {
                        const channel = part.pin - 14;
                        const voltage = (deg / 360) * 5; 
                        adc.channelValues[channel] = voltage;
                        
                        const uiEl = document.getElementById(`pin-ui-${part.id}`);
                        if (uiEl) uiEl.className = "transition-colors duration-75 text-purple-600 dark:text-purple-400 font-bold";
                    }
                 }
                 else if (part.type === 'sonar') {
                    const state = sonarStatesRef.current[part.id];
                    const isEchoing = state && cpu.cycles >= state.echoStart && cpu.cycles <= state.echoEnd;
                    const uiEl = document.getElementById(`pin-ui-${part.id}`);
                    if (uiEl) uiEl.className = isEchoing ? "transition-colors duration-75 text-red-600 dark:text-red-400 font-bold" : "transition-colors duration-75 text-gray-400 dark:text-gray-600";
                 }
                 else if (part.type === 'grabber') {
                    const isHigh = getPinState(cpu, part.pin);
                    const state = grabberStatesRef.current[part.id] || { isHigh: false, constraints: null, target: null, originalMass: 1, originalGroup: 0 };

                    if (isHigh && !state.isHigh) {
                        const pAngleRad = robot.angle + (part.angle || 0) * (Math.PI / 180);
                        const reach = 20; 
                        
                        const tipLocalX = part.offsetX + Math.cos((part.angle || 0) * Math.PI / 180) * reach;
                        const tipLocalY = part.offsetY + Math.sin((part.angle || 0) * Math.PI / 180) * reach;
                        const tipGlobalX = robX + (tipLocalX * robCos) - (tipLocalY * robSin);
                        const tipGlobalY = robY + (tipLocalX * robSin) + (tipLocalY * robCos);

                        const bounds = { min: { x: tipGlobalX - 10, y: tipGlobalY - 10 }, max: { x: tipGlobalX + 10, y: tipGlobalY + 10 } };
                        const validBodies = Matter.Composite.allBodies(engineRef.current.world).filter(b => b.plugin && b.plugin.isPickable && !b.isStatic);
                        
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
                                pointA: { x: tipLocalX, y: tipLocalY },
                                pointB: { x: 0, y: 0 },
                                stiffness: 1, length: 0,
                                render: { visible: false }
                            });
                            
                            const baseLocalX = part.offsetX;
                            const baseLocalY = part.offsetY;
                            const baseGlobalX = robX + (baseLocalX * robCos) - (baseLocalY * robSin);
                            const baseGlobalY = robY + (baseLocalX * robSin) + (baseLocalY * robCos);
                            
                            const dx = baseGlobalX - tipGlobalX;
                            const dy = baseGlobalY - tipGlobalY;
                            const tarCos = Math.cos(-target.angle);
                            const tarSin = Math.sin(-target.angle);
                            const targetLocalBaseX = dx * tarCos - dy * tarSin;
                            const targetLocalBaseY = dx * tarSin + dy * tarCos;

                            const c2 = Matter.Constraint.create({
                                bodyA: robot, bodyB: target,
                                pointA: { x: baseLocalX, y: baseLocalY },
                                pointB: { x: targetLocalBaseX, y: targetLocalBaseY },
                                stiffness: 1, length: 0,
                                render: { visible: false }
                            });

                            Matter.World.add(engineRef.current.world,[c1, c2]);
                            state.constraints =[c1, c2];
                        }
                    } 
                    else if (!isHigh && state.isHigh) {
                        if (state.constraints) {
                            Matter.World.remove(engineRef.current.world, state.constraints);
                            if (state.target) {
                                Matter.Body.setMass(state.target, state.originalMass);
                                state.target.collisionFilter.group = state.originalGroup || 0;
                            }
                            state.constraints = null;
                            state.target = null;
                        }
                    }

                    state.isHigh = isHigh;
                    grabberStatesRef.current[part.id] = state;

                    const uiEl = document.getElementById(`pin-ui-${part.id}`);
                    if (uiEl) {
                        if (state.constraints) uiEl.className = "transition-colors duration-75 text-purple-600 dark:text-purple-400 font-bold";
                        else if (isHigh) uiEl.className = "transition-colors duration-75 text-yellow-500 font-bold";
                        else uiEl.className = "transition-colors duration-75 text-gray-400 dark:text-gray-600";
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
    
    let payloadSketch = code;

    // INVISIBLE KRUMON C LIBRARY INJECTION
    if (krumonMode) {
      setSysLogs(prev =>[...prev, '> Injecting Krumon v.130715 Compatibility Library...']);
      
      // Strip legacy includes so the Wokwi compiler doesn't fail trying to find them
      let cleanCode = code.replace(/#include\s*[<"][^>"]*(krumon|popbot|ipst)[^>"]*[>"]/gi, '// removed legacy include');
      
      // Support BOTH void main() and standard setup()/loop()
      const usesMain = /main\s*\(/.test(cleanCode);
      const usesSetup = /setup\s*\(/.test(cleanCode);
      
      if (usesMain) {
        payloadSketch = KRUMON_LIB + "\n#define main _krumon_main\n" + cleanCode + "\n#undef main\nint main(void) { init(); Serial.begin(9600); _krumon_init(); _krumon_main(); Serial.flush(); while(1); return 0; }\n";
      } else if (usesSetup) {
        // Just inject the _krumon_init into their setup function
        payloadSketch = KRUMON_LIB + "\n#define setup _user_setup\n" + cleanCode + "\n#undef setup\nvoid setup() { Serial.begin(9600); _krumon_init(); _user_setup(); }\n";
      } else {
        payloadSketch = KRUMON_LIB + "\n" + cleanCode;
      }
    }

    try {
      const response = await fetch('https://hexi.wokwi.com/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch: payloadSketch, board: "uno" })
      });
      const data = await response.json();
      if (!data.hex) {
        setSysLogs(prev =>[...prev, '> COMPILATION FAILED:', data.stderr || data.compilerErrors]);
        setSimState(false); return;
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
    reader.onload = (event) => { bootVirtualCpu(event.target.result, true); e.target.value = null; };
    reader.readAsText(file);
  };

  const renderPinOptions = () => {
    const options =[];
    for(let i = 0; i <= 19; i++) {
       let label = `D${i}`;
       if (i === 0) label = "D0 (RX)";
       else if (i === 1) label = "D1 (TX)";
       else if (i >= 14) label = `A${i-14}`;
       options.push(<option key={i} value={i}>{label}</option>);
    }
    return options;
  };

  const renderPartOptions = () => {
    const counts = robotBuild.parts.reduce((acc, p) => { acc[p.type] = (acc[p.type] || 0) + 1; return acc; }, {});
    const opts =[];

    if (!krumonMode) {
      opts.push({ value: 'dc_motor', label: 'DC Motor', max: Infinity });
      opts.push({ value: 'sonar', label: 'Sonar', max: Infinity });
      opts.push({ value: 'ir_sensor', label: 'IR Sensor', max: Infinity });
      opts.push({ value: 'grabber', label: 'Grabber', max: Infinity });
      opts.push({ value: 'buzzer', label: 'Buzzer', max: Infinity });
      opts.push({ value: 'lcd16x2', label: '16x2 LCD', max: Infinity });
      opts.push({ value: 'imu', label: 'IMU', max: Infinity });
      opts.push({ value: 'oled128x64', label: '128x64 OLED', max: Infinity });
    } else {
      opts.push({ value: 'sonar', label: 'Sonar', max: 1 });
      opts.push({ value: 'ir_sensor', label: 'IR Sensor', max: 7 });
    }

    return opts.map(o => {
      const disabled = (counts[o.value] || 0) >= o.max;
      return <option key={o.value} value={o.value} disabled={disabled}>{o.label} {disabled ? '(MAX)' : ''}</option>
    });
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
            <div className="flex items-center gap-3">
               <span>💻 Monaco Editor</span>
               <button 
                  onClick={handleKrumonToggle}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
                    krumonMode 
                      ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800' 
                      : 'bg-gray-200 dark:bg-neutral-800 text-gray-500 border-gray-300 dark:border-neutral-700 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                  title="Toggle Legacy Krumon v.130715 Compatibility Mode"
               >
                  <div className={`w-2 h-2 rounded-full ${krumonMode ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'}`}></div>
                  KRUMON V.130715
               </button>
            </div>
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
            <div className="flex-grow p-2 font-mono text-xs text-gray-600 dark:text-gray-500 overflow-y-auto flex flex-col custom-scrollbar">
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
            <div id="serial-console" className="flex-grow p-2 font-mono text-sm text-green-700 dark:text-green-400 overflow-y-auto whitespace-pre-wrap custom-scrollbar"></div>
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
                 <ImagePlus size={12}/> Import Map
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
          
          {/* CUSTOMIZATION LAB & TELEMETRY */}
          <div style={{ width: `${customLabWidth}%` }} className="flex flex-col gap-2 overflow-hidden">
            <div className="flex-grow bg-white dark:bg-neutral-800 rounded-lg border border-gray-300 dark:border-neutral-700 p-3 flex flex-col overflow-hidden shadow-sm">
              <div className="text-sm font-bold text-gray-800 dark:text-gray-300 mb-2 flex justify-between items-center border-b border-gray-200 dark:border-neutral-700 pb-2">
                 <div className="flex items-center gap-2">
                   <Wrench size={16}/> Customization Lab
                   <div className="flex bg-gray-200 dark:bg-neutral-800 p-0.5 rounded ml-2">
                      <button onClick={() => setActiveTab('robot')} className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${activeTab === 'robot' ? 'bg-white dark:bg-neutral-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>ROBOT</button>
                      <button onClick={() => setActiveTab('arena')} className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${activeTab === 'arena' ? 'bg-white dark:bg-neutral-600 shadow-sm text-purple-600 dark:text-purple-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>ARENA</button>
                   </div>
                 </div>
                 <div className="flex gap-2">
                   <button onClick={restoreDefaults} className="flex items-center gap-1 text-[10px] bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800/80 text-red-700 dark:text-red-300 px-2 py-1 rounded transition-colors" title="Restore Default Settings">
                     <RefreshCcw size={10}/> Reset All
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
                 {/* --- TAB CONTENT: ROBOT --- */}
                 {activeTab === 'robot' && (
                   <div className="flex-[1.5] text-[11px] font-mono font-bold bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-transparent p-2 rounded overflow-y-auto custom-scrollbar">
                     <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-200 dark:border-neutral-800 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-500 dark:text-blue-400">CHASSIS SIZE</span>
                          <input 
                             type="color" 
                             value={robotBuild.chassisColor || DEFAULT_COLORS.chassis} 
                             onChange={(e) => updateChassis('chassisColor', e.target.value)} 
                             className="w-5 h-5 p-0 border-0 rounded cursor-pointer bg-transparent" 
                             title="Chassis Color"
                          />
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
                             {renderPartOptions()}
                          </select>
                          <button onClick={() => addPart(newPartType)} className="flex items-center gap-1 bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/50 dark:hover:bg-blue-800 dark:text-blue-300 px-2 py-0.5 rounded transition-colors text-[9px]">
                             <PlusCircle size={10}/> Add
                          </button>
                        </div>
                     </div>
                     
                     <div className="flex flex-col gap-2 pb-2">
                        {robotBuild.parts.map(part => {
                           // Define strict constraints for legacy Krumon Mode
                           const isMandatory = krumonMode &&['dc_motor', 'buzzer', 'grabber', 'lcd16x2'].includes(part.type);
                           const isPinLocked = krumonMode &&['dc_motor', 'buzzer', 'grabber', 'lcd16x2'].includes(part.type);
                           const isPosLocked = krumonMode && part.type === 'dc_motor';

                           return (
                           <div key={part.id} className="flex flex-col gap-1 border-b border-gray-200 dark:border-neutral-800 pb-2 relative group">
                              {!isMandatory && (
                                <button onClick={() => removePart(part.id)} className="absolute top-0 right-0 text-gray-400 hover:text-red-500 transition-colors opacity-50 group-hover:opacity-100 z-10 bg-gray-50 dark:bg-neutral-900 rounded pl-1">
                                   <X size={12}/>
                                </button>
                              )}

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
                                <input 
                                   type="color" 
                                   value={part.color || DEFAULT_COLORS[part.type]} 
                                   onChange={(e) => updatePart(part.id, 'color', e.target.value)} 
                                   className="w-5 h-5 p-0 border-0 rounded cursor-pointer bg-transparent shrink-0" 
                                   title="Component Color"
                                />
                              </div>

                              <div className="flex gap-2 mt-1">
                                {(part.type === 'dc_motor') && (
                                   <>
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">PWM:</span>
                                     <select 
                                       value={part.pin} 
                                       onChange={(e) => updatePart(part.id, 'pin', e.target.value)} 
                                       disabled={isPinLocked}
                                       className={`border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center ${isPinLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950 text-blue-600 dark:text-blue-400'}`}
                                     >
                                       {renderPinOptions()}
                                     </select>
                                   </div>
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">Dir:</span>
                                     <select 
                                       value={part.pinDir !== undefined ? part.pinDir : 7} 
                                       onChange={(e) => updatePart(part.id, 'pinDir', e.target.value)} 
                                       disabled={isPinLocked}
                                       className={`border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center ${isPinLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950 text-yellow-600 dark:text-yellow-500'}`}
                                     >
                                       {renderPinOptions()}
                                     </select>
                                   </div>
                                   </>
                                )}
                                {(part.type === 'ir_sensor') && (
                                   <>
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">Pin:</span>
                                     <select 
                                       value={part.pin} 
                                       onChange={(e) => updatePart(part.id, 'pin', e.target.value)} 
                                       disabled={isPinLocked}
                                       className={`border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center ${isPinLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950 text-blue-600 dark:text-blue-400'}`}
                                     >
                                       {renderPinOptions()}
                                     </select>
                                   </div>
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">Mode:</span>
                                     <select 
                                       value={part.irMode || 'map'} 
                                       onChange={(e) => updatePart(part.id, 'irMode', e.target.value)} 
                                       disabled={isPinLocked}
                                       className={`border border-gray-300 dark:border-neutral-700 rounded w-16 outline-none text-center text-[9px] ${isPinLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950 text-green-600 dark:text-green-400'}`}
                                     >
                                       <option value="map">Map</option>
                                       <option value="object">Object (40px)</option>
                                     </select>
                                   </div>
                                   </>
                                )}
                                {(part.type === 'grabber' || part.type === 'buzzer') && (
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">Pin:</span>
                                     <select 
                                       value={part.pin} 
                                       onChange={(e) => updatePart(part.id, 'pin', e.target.value)} 
                                       disabled={isPinLocked}
                                       className={`border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center ${isPinLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950 text-blue-600 dark:text-blue-400'}`}
                                     >
                                       {renderPinOptions()}
                                     </select>
                                   </div>
                                )}
                                {(part.type === 'imu' || part.type === 'lcd16x2' || part.type === 'oled128x64') && (
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">I2C (A4/A5)</span>
                                   </div>
                                )}
                                {part.type === 'sonar' && (
                                   <>
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">Trig:</span>
                                     <select value={part.pinTrig} onChange={(e) => updatePart(part.id, 'pinTrig', e.target.value)} disabled={isPinLocked} className={`border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center ${isPinLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950 text-red-600 dark:text-red-400'}`}>
                                       {renderPinOptions()}
                                     </select>
                                   </div>
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500">Echo:</span>
                                     <select value={part.pinEcho} onChange={(e) => updatePart(part.id, 'pinEcho', e.target.value)} disabled={isPinLocked} className={`border border-gray-300 dark:border-neutral-700 rounded w-10 outline-none text-center ${isPinLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950 text-red-600 dark:text-red-400'}`}>
                                       {renderPinOptions()}
                                     </select>
                                   </div>
                                   <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-gray-500" title="Max Range (px/cm)">Rng:</span>
                                     <input type="number" min="5" max="1000" value={part.range || 400} onChange={(e) => updatePart(part.id, 'range', e.target.value)} className="bg-white dark:bg-neutral-950 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-neutral-700 rounded w-12 outline-none text-center" />
                                   </div>
                                   </>
                                )}
                              </div>
                              
                              <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500 mt-1">
                                 <div className="flex items-center gap-1">
                                   <span>X:</span>
                                   <input type="number" value={part.offsetX} onChange={(e) => updatePart(part.id, 'offsetX', e.target.value)} disabled={isPosLocked} className={`w-full min-w-0 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500 ${isPosLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950'}`} />
                                 </div>
                                 <div className="flex items-center gap-1">
                                   <span>Y:</span>
                                   <input type="number" value={part.offsetY} onChange={(e) => updatePart(part.id, 'offsetY', e.target.value)} disabled={isPosLocked} className={`w-full min-w-0 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500 ${isPosLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950'}`} />
                                 </div>
                                 <div className="flex items-center gap-1">
                                   <span>Ang:</span>
                                   <input type="number" value={part.angle || 0} onChange={(e) => updatePart(part.id, 'angle', e.target.value)} disabled={isPosLocked} className={`w-full min-w-0 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-blue-500 ${isPosLocked ? 'bg-gray-200 dark:bg-neutral-800 text-gray-400 cursor-not-allowed opacity-75' : 'bg-white dark:bg-neutral-950'}`} />
                                 </div>
                              </div>
                           </div>
                           );
                        })}
                        {robotBuild.parts.length === 0 && (
                          <div className="text-center text-gray-400 italic mt-4 border border-dashed border-gray-300 dark:border-gray-700 p-2 rounded">Empty Chassis</div>
                        )}
                     </div>
                   </div>
                 )}

                 {/* --- TAB CONTENT: ARENA --- */}
                 {activeTab === 'arena' && (
                   <div className="flex-[1.5] text-[11px] font-mono font-bold bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-transparent p-2 rounded overflow-y-auto custom-scrollbar">
                     <div className="flex justify-between items-center mb-2 pb-1 border-b border-gray-200 dark:border-neutral-800 shrink-0">
                        <p className="text-gray-500">// WORLD OBJECTS</p>
                        <button onClick={addArenaObject} className="flex items-center gap-1 bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-900/50 dark:hover:bg-purple-800 dark:text-purple-300 px-2 py-0.5 rounded transition-colors text-[9px]">
                           <Box size={10}/> Add Object
                        </button>
                     </div>
                     
                     <div className="flex flex-col gap-2 pb-2">
                        {arenaObjects.map(obj => (
                           <div key={obj.id} className="flex flex-col gap-1 border-b border-gray-200 dark:border-neutral-800 pb-2 relative group">
                              <button onClick={() => removeArenaObject(obj.id)} className="absolute top-0 right-0 text-gray-400 hover:text-red-500 transition-colors opacity-50 group-hover:opacity-100 z-10 bg-gray-50 dark:bg-neutral-900 rounded pl-1">
                                 <X size={12}/>
                              </button>

                              <div className="flex items-center gap-2 pr-6 mb-1">
                                <span className={`text-[9px] font-bold px-1 rounded tracking-wider uppercase shrink-0 ${obj.isStatic ? 'bg-gray-300 dark:bg-neutral-700 text-gray-600 dark:text-gray-400' : 'bg-purple-200 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400'}`}>
                                   {obj.isStatic ? 'FIXED' : 'PROP'}
                                </span>
                                <input 
                                   type="text" 
                                   value={obj.name} 
                                   onChange={(e) => updateArenaObject(obj.id, 'name', e.target.value)} 
                                   className="bg-transparent text-gray-800 dark:text-gray-200 font-bold w-full outline-none border-b border-transparent hover:border-gray-300 dark:hover:border-neutral-700 focus:border-purple-500 transition-colors truncate"
                                />
                                <input 
                                   type="color" 
                                   value={obj.color || (obj.isStatic ? DEFAULT_COLORS.arena_static : DEFAULT_COLORS.arena_prop)} 
                                   onChange={(e) => updateArenaObject(obj.id, 'color', e.target.value)} 
                                   className="w-5 h-5 p-0 border-0 rounded cursor-pointer bg-transparent shrink-0" 
                                   title="Object Color"
                                />
                              </div>

                              <div className="flex gap-4 items-center text-[10px] text-gray-500 mt-1">
                                 <div className="flex items-center gap-1">
                                   <span>W:</span>
                                   <input type="number" min="5" value={obj.w} onChange={(e) => updateArenaObject(obj.id, 'w', e.target.value)} className="w-10 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-purple-500 text-center" />
                                 </div>
                                 <div className="flex items-center gap-1">
                                   <span>H:</span>
                                   <input type="number" min="5" value={obj.h} onChange={(e) => updateArenaObject(obj.id, 'h', e.target.value)} className="w-10 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-purple-500 text-center" />
                                 </div>
                                 <label className="flex items-center gap-1 cursor-pointer" title="Static walls cannot be picked up or moved.">
                                   <input type="checkbox" checked={obj.isStatic} onChange={(e) => updateArenaObject(obj.id, 'isStatic', e.target.checked)} className="cursor-pointer" />
                                   <span className={obj.isStatic ? 'text-gray-700 dark:text-gray-300 font-bold' : ''}>Fixed Wall</span>
                                 </label>
                                 <label className="flex items-center gap-1 cursor-pointer" title="Can this object be snatched by a Grabber component?">
                                   <input type="checkbox" disabled={obj.isStatic} checked={!obj.isStatic && obj.isPickable} onChange={(e) => updateArenaObject(obj.id, 'isPickable', e.target.checked)} className="cursor-pointer" />
                                   <span className={!obj.isStatic && obj.isPickable ? 'text-purple-600 dark:text-purple-400 font-bold' : 'text-gray-400'}>Pickable</span>
                                 </label>
                              </div>
                              
                              <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500 mt-1">
                                 <div className="flex items-center gap-1">
                                   <span>X:</span>
                                   <input id={`arena-x-${obj.id}`} type="number" value={Math.round(obj.x)} onChange={(e) => updateArenaObject(obj.id, 'x', e.target.value)} className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-purple-500" />
                                 </div>
                                 <div className="flex items-center gap-1">
                                   <span>Y:</span>
                                   <input id={`arena-y-${obj.id}`} type="number" value={Math.round(obj.y)} onChange={(e) => updateArenaObject(obj.id, 'y', e.target.value)} className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-purple-500" />
                                 </div>
                                 <div className="flex items-center gap-1">
                                   <span>Ang:</span>
                                   <input id={`arena-ang-${obj.id}`} type="number" value={obj.angle || 0} onChange={(e) => updateArenaObject(obj.id, 'angle', e.target.value)} className="w-full min-w-0 bg-white dark:bg-neutral-950 border border-gray-300 dark:border-neutral-700 rounded px-1 outline-none focus:border-purple-500" />
                                 </div>
                              </div>
                           </div>
                        ))}
                        {arenaObjects.length === 0 && (
                          <div className="text-center text-gray-400 italic mt-4 border border-dashed border-gray-300 dark:border-gray-700 p-2 rounded">No Custom Objects</div>
                        )}
                     </div>
                   </div>
                 )}

                 <div className="flex-1 bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-transparent p-2 rounded flex flex-col gap-2 overflow-y-auto custom-scrollbar">
                   
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
          </div>

          <div onMouseDown={handleDragBottom} className="w-2 flex items-center justify-center cursor-col-resize group relative z-50">
            <div className="w-1 h-8 bg-gray-300 dark:bg-neutral-700 group-hover:bg-blue-500 rounded transition-colors flex items-center justify-center">
              <GripVertical size={10} className="text-gray-500 dark:text-neutral-900 group-hover:text-white pointer-events-none" />
            </div>
          </div>

          <div style={{ width: `${100 - customLabWidth}%` }} className="flex flex-col gap-2 overflow-hidden h-full">
            
            {/* VIRTUAL SCREEN LIST */}
            {displayComponents.length > 0 && (
               <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2">
                 {displayComponents.map(disp => (
                   <div key={disp.id} className="w-full h-24 shrink-0 bg-white dark:bg-neutral-800 rounded-lg border border-gray-300 dark:border-neutral-700 p-2 shadow-sm flex flex-col relative overflow-hidden">
                      <div className="text-[9px] text-gray-500 font-bold mb-1 uppercase truncate">{disp.name}</div>
                      
                      {disp.type === 'lcd16x2' && (
                         <div className="flex-1 w-full bg-[#a3d132] border-[4px] border-[#8baf28] rounded flex items-center justify-center shadow-inner relative overflow-hidden">
                            <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(0,0,0,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.5)_1px,transparent_1px)] bg-[size:4px_4px]"></div>
                            <div data-screen-type="lcd16x2" className="screen-text-content text-[#1f2937] font-mono font-bold text-center z-10 leading-snug tracking-widest text-sm drop-shadow-[1px_1px_0_rgba(255,255,255,0.4)] whitespace-pre-wrap w-full px-2 break-all overflow-hidden max-h-full flex items-center justify-center">
                               16x2 LCD<br/>OFFLINE
                            </div>
                         </div>
                      )}

                      {disp.type === 'oled128x64' && (
                         <div className="flex-1 w-full bg-[#0a0a0a] border-[2px] border-gray-700 rounded flex items-center justify-center shadow-inner relative overflow-hidden">
                            <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(14,165,233,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.1)_1px,transparent_1px)] bg-[size:2px_2px]"></div>
                            <div data-screen-type="oled128x64" className="screen-text-content text-cyan-400 font-mono font-bold text-center z-10 text-[10px] tracking-wide shadow-cyan-500/50 drop-shadow-[0_0_8px_rgba(14,165,233,0.8)] whitespace-pre-wrap w-full px-2 break-all overflow-hidden max-h-full flex items-center justify-center">
                               128x64 OLED<br/>OFFLINE
                            </div>
                         </div>
                      )}
                   </div>
                 ))}
               </div>
            )}

            <div className={`bg-gray-50 dark:bg-neutral-800 rounded-lg border border-gray-300 dark:border-neutral-700 p-2 flex flex-col justify-center gap-2 shadow-sm ${displayComponents.length > 0 ? 'shrink-0' : 'h-full'}`}>
              <button onClick={runSimulationCloud} disabled={isRunning} className={`flex items-center justify-center gap-2 py-1.5 px-2 rounded font-bold text-[13px] transition-colors ${isRunning ? 'bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'}`}>
                <Play size={14} fill="currentColor" /> RUN (Cloud)
              </button>
              {offlineHexCode && (
                <button onClick={runSimulationOffline} disabled={isRunning} className={`flex items-center justify-center gap-2 py-1.5 px-2 rounded font-bold text-[13px] transition-colors ${isRunning ? 'bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`} title={`Run ${offlineHexName}`}>
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
    </div>
  );
}

export default App;