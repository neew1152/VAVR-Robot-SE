import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square, RotateCcw, Monitor, Settings } from 'lucide-react';
import { 
  CPU, avrInstruction, 
  AVRTimer, timer0Config, timer1Config, timer2Config, 
  AVRUSART, usart0Config, 
  AVRIOPort, portBConfig, portCConfig, portDConfig 
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

function App() {
  const[code, setCode] = useState(`void setup() {\n  Serial.begin(9600);\n  Serial.println("Hello from Flawless Simulator!");\n}\n\nvoid loop() {\n  Serial.println("Running perfectly...");\n  delay(1000);\n}`);
  
  // UI States
  const[sysLogs, setSysLogs] = useState(['> System Ready. Waiting for compilation...']);
  const[serialOutput, setSerialOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  
  const requestRef = useRef(null);
  const logEndRef = useRef(null);

  // Auto-scroll terminal
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sysLogs, serialOutput]);

  const stopSimulation = () => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    setIsRunning(false);
    setSysLogs(prev => [...prev, '> Simulation STOPPED.']);
  };

  const resetSimulation = () => {
    stopSimulation();
    setSerialOutput("");
    setSysLogs(['> System Reset. Memory flushed. Ready.']);
  };

  const runSimulation = async () => {
    if (isRunning) return;
    setSysLogs(['> Compiling code via Cloud Compiler...']);
    setSerialOutput(""); // Clear old serial data
    
    try {
      const response = await fetch('https://hexi.wokwi.com/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch: code })
      });
      const data = await response.json();
      
      if (!data.hex) {
        setSysLogs(prev =>[...prev, '> COMPILATION FAILED:', data.stderr || data.compilerErrors]);
        return;
      }
      
      setSysLogs(prev => [...prev, '> Compilation Success! Flashing to Virtual Flash Memory...']);
      
      const program = new Uint16Array(16384);
      loadHex(data.hex, new Uint8Array(program.buffer));
      
      const cpu = new CPU(program);
      
      // FULL HARDWARE INSTANTIATION (No more boot loops!)
      const timer0 = new AVRTimer(cpu, timer0Config);
      const timer1 = new AVRTimer(cpu, timer1Config);
      const timer2 = new AVRTimer(cpu, timer2Config);
      const portB = new AVRIOPort(cpu, portBConfig);
      const portC = new AVRIOPort(cpu, portCConfig);
      const portD = new AVRIOPort(cpu, portDConfig);
      const usart = new AVRUSART(cpu, usart0Config, 16e6);
      
      // Real-time Serial Output Mapping
      usart.onByteTransmit = (byte) => {
        const char = String.fromCharCode(byte);
        setSerialOutput(prev => prev + char);
      };
      
      setIsRunning(true);
      setSysLogs(prev =>[...prev, '> Virtual Arduino RUNNING...']);
      
      const executeFrame = () => {
         try {
            // Run exactly 1 frame of hardware time (16MHz / 60fps)
            for (let i = 0; i < 266666; i++) {
              avrInstruction(cpu); 
              cpu.tick(); // <--- ADD THIS LINE! This advances the hardware clock!
            }
            requestRef.current = requestAnimationFrame(executeFrame);
         } catch (e) {
            setSysLogs(prev =>[...prev, '> FATAL CPU CRASH: ' + e.message]);
            setIsRunning(false);
         }
      };
      
      requestRef.current = requestAnimationFrame(executeFrame);
      
    } catch (err) {
      setSysLogs(prev =>[...prev, '> NETWORK/SYSTEM ERROR: ' + err.message]);
      setIsRunning(false);
    }
  };

  return (
    <div className="flex h-screen w-screen p-2 gap-2 bg-neutral-900 font-sans">
      
      {/* LEFT COLUMN */}
      <div className="flex flex-col w-1/2 gap-2">
        <div className="flex-grow bg-neutral-800 rounded-lg overflow-hidden border border-neutral-700 flex flex-col">
          <div className="bg-neutral-950 p-2 text-sm font-bold text-gray-300 flex justify-between items-center">
            <span>💻 Arduino C/C++ Editor</span>
          </div>
          <div className="flex-grow">
            <Editor
              height="100%"
              defaultLanguage="cpp"
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value)}
              options={{ minimap: { enabled: false }, fontSize: 14 }}
            />
          </div>
        </div>

        {/* TERMINAL UI UPGRADE */}
        <div className="h-56 bg-neutral-950 rounded-lg border border-neutral-700 flex flex-col overflow-hidden">
           <div className="bg-neutral-900 p-2 text-sm font-bold text-gray-300 flex items-center gap-2 border-b border-neutral-700">
            <Monitor size={16}/> Serial Monitor
          </div>
          <div className="flex-grow p-2 font-mono text-sm overflow-y-auto flex flex-col">
            {/* System Logs (Gray) */}
            <div className="text-gray-500 mb-2">
              {sysLogs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
            {/* Hardware Serial Output (Green) */}
            <div className="text-green-400 whitespace-pre-wrap">
              {serialOutput}
            </div>
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="flex flex-col w-1/2 gap-2">
        <div className="flex-grow bg-white rounded-lg border border-neutral-700 relative overflow-hidden flex flex-col">
          <div className="bg-neutral-200 p-2 text-sm font-bold text-black flex justify-between items-center z-10">
            <span>🏁 Simulation Field</span>
            <button className="text-xs bg-gray-300 hover:bg-gray-400 text-black px-2 py-1 rounded transition-colors">Upload Map</button>
          </div>
          <div className="flex-grow flex items-center justify-center text-gray-400">
            [ 2D Physics Canvas Goes Here ]
          </div>
        </div>

        <div className="h-48 flex gap-2">
          <div className="flex-grow bg-neutral-800 rounded-lg border border-neutral-700 p-2 flex flex-col">
            <div className="text-sm font-bold text-gray-300 mb-2 flex items-center gap-2">
              <Settings size={16}/> Robot Workshop
            </div>
            <div className="text-sm text-gray-400">
              <p>Hardware Pins:</p>
              <ul className="list-disc ml-5 mt-1">
                <li>Motor L: Pin 9</li>
                <li>Motor R: Pin 10</li>
                <li>Sonar Trigger: Pin 3</li>
              </ul>
            </div>
          </div>

          <div className="w-1/3 bg-neutral-800 rounded-lg border border-neutral-700 p-4 flex flex-col justify-center gap-3">
            <button 
              onClick={runSimulation}
              disabled={isRunning}
              className={`flex items-center justify-center gap-2 py-2 px-4 rounded font-bold transition-colors ${isRunning ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
              <Play size={20} fill="currentColor" /> RUN
            </button>
            <button 
              onClick={stopSimulation}
              className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-4 rounded font-bold transition-colors">
              <Square size={20} fill="currentColor" /> STOP
            </button>
            <button 
              onClick={resetSimulation}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded font-bold transition-colors">
              <RotateCcw size={20} /> RESET
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;