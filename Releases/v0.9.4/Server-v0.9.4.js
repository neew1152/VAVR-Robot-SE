const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const fqbnMap = {
  'uno': 'arduino:avr:uno',
  'nano': 'arduino:avr:nano',
  'mega': 'arduino:avr:mega',
  'leonardo': 'arduino:avr:leonardo'
};

const WORKSPACE_BASE = path.join(os.tmpdir(), 'arduino-compiler-workspace');

const boardState = {};

for (const [key, fqbn] of Object.entries(fqbnMap)) {
  const safeFqbn = fqbn.replace(/:/g, '_');
  const baseDir = path.join(WORKSPACE_BASE, safeFqbn);
  boardState[key] = {
    fqbn,
    sketchDir: path.join(baseDir, 'sketch'),
    buildDir: path.join(baseDir, 'build'),
    cacheDir: path.join(baseDir, 'cache'),
    sketchFile: path.join(baseDir, 'sketch', 'sketch.ino'),

    currentSketch: null,
    lastResult: null
  };
}

let activeBuild = null;

app.post('/build', async (req, res) => {
  const { sketch, board } = req.body;

  if (!sketch || typeof sketch !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid sketch code' });
  }

  const state = boardState[board] || boardState['uno'];
  
  if (state.lastResult && state.currentSketch === sketch) {
    return res.json(state.lastResult);
  }

  if (activeBuild) {
    activeBuild.abort();
  }

  const controller = new AbortController();
  activeBuild = controller;
  const { signal } = controller;

  try {
    if (state.currentSketch !== sketch) {
      await fs.writeFile(state.sketchFile, sketch, 'utf8');
      state.currentSketch = sketch;
    }

    const { stdout, stderr } = await execFileAsync('arduino-cli', [
      'compile',
      '--fqbn', state.fqbn,
      '--build-path', state.buildDir,
      '--build-cache-path', state.cacheDir,
      state.sketchDir
    ], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      signal,
      encoding: 'utf8'
    });

    const files = await fs.readdir(state.buildDir);
    const hexFileName = files.find(f => f.endsWith('.hex'));
    
    if (!hexFileName) {
      throw new Error('Compilation succeeded but .hex file was not found in build directory.');
    }

    const hexData = await fs.readFile(path.join(state.buildDir, hexFileName), 'utf8');
    
    const result = { hex: hexData, stdout, stderr };

    state.lastResult = result;

    res.json(result);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(409).json({ message: 'Build superseded by a newer request' });
    }

    if (err.killed || err.signal === 'SIGTERM') {
      return res.status(408).json({ message: 'Compilation timed out or was cancelled' });
    }
    
    if (err.stderr !== undefined || err.stdout !== undefined) {
      state.lastResult = null;
      return res.status(400).json({
        message: 'Compilation failed',
        stderr: err.stderr,
        stdout: err.stdout
      });
    }

    if (err.code === 'ENOENT') {
      return res.status(500).json({ message: 'arduino-cli not found.' });
    }

    console.error('Build error:', err);
    res.status(500).json({ message: 'Error', error: err.message });
  } finally {
    if (activeBuild === controller) {
      activeBuild = null;
    }
  }
});

const PORT = 8080;
app.listen(PORT, async () => {
  try {
    await fs.mkdir(WORKSPACE_BASE, { recursive: true });
    for (const state of Object.values(boardState)) {
      await Promise.all([
        fs.mkdir(state.sketchDir, { recursive: true }),
        fs.mkdir(state.buildDir, { recursive: true }),
        fs.mkdir(state.cacheDir, { recursive: true })
      ]);
    }
    console.log(`Arduino Compiler Server on http://localhost:${PORT}`);
  } catch (err) {
    console.error('Failed to initialize:', err);
    process.exit(1);
  }
});