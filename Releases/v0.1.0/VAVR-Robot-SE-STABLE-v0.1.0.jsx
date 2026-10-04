import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square, RotateCcw, Monitor, Settings } from 'lucide-react';

function App() {
  const [code, setCode] = useState(`void setup() {\n  // Initialize your robot here\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  // Your flawless, complex logic here\n  Serial.println("Running perfectly...");\n  delay(1000);\n}`);

  return (
    <div className="flex h-screen w-screen p-2 gap-2 bg-neutral-900 font-sans">
      
      {/* LEFT COLUMN: IDE & Logs */}
      <div className="flex flex-col w-1/2 gap-2">
        {/* IDE Section */}
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

        {/* Compiler Logs / Serial Monitor */}
        <div className="h-48 bg-neutral-800 rounded-lg border border-neutral-700 flex flex-col">
           <div className="bg-neutral-950 p-2 text-sm font-bold text-gray-300 flex items-center gap-2">
            <Monitor size={16}/> Serial Monitor & Logs
          </div>
          <div className="p-2 font-mono text-sm text-green-400 overflow-y-auto">
            &gt; System Ready. Waiting for compilation...
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Simulation & Controls */}
      <div className="flex flex-col w-1/2 gap-2">
        
        {/* Simulation Canvas (Matter.js will go here later) */}
        <div className="flex-grow bg-white rounded-lg border border-neutral-700 relative overflow-hidden flex flex-col">
          <div className="bg-neutral-200 p-2 text-sm font-bold text-black flex justify-between items-center z-10">
            <span>🏁 Simulation Field</span>
            <button className="text-xs bg-gray-300 hover:bg-gray-400 text-black px-2 py-1 rounded">Upload Map</button>
          </div>
          <div className="flex-grow flex items-center justify-center text-gray-400">
            [ 2D Physics Canvas Goes Here ]
          </div>
        </div>

        {/* Hardware Controller & Workshop */}
        <div className="h-48 flex gap-2">
          {/* Workshop Details */}
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

          {/* Execution Controls */}
          <div className="w-1/3 bg-neutral-800 rounded-lg border border-neutral-700 p-4 flex flex-col justify-center gap-3">
            <button className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white py-2 px-4 rounded font-bold transition-colors">
              <Play size={20} fill="currentColor" /> RUN
            </button>
            <button className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-4 rounded font-bold transition-colors">
              <Square size={20} fill="currentColor" /> STOP
            </button>
            <button className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded font-bold transition-colors">
              <RotateCcw size={20} /> RESET
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;