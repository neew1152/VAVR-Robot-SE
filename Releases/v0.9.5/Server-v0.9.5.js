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

const FQBN_MAP = {
  'uno': 'arduino:avr:uno',
  'nano': 'arduino:avr:nano',
  'mega': 'arduino:avr:mega',
  'leonardo': 'arduino:avr:leonardo'
};

const WORKSPACE_BASE = path.join(os.tmpdir(), 'arduino-compiler-workspace');
const SKETCH_DIR = path.join(WORKSPACE_BASE, 'sketch');
const SKETCH_FILE = path.join(SKETCH_DIR, 'sketch.ino');

let lastBuild = {
  sketch: null,
  board: null,
  result: null
};

let isBuilding = false;

app.post('/build', async (req, res) => {
  const { sketch, board } = req.body;

  if (!sketch || typeof sketch !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid sketch code' });
  }

  const fqbn = FQBN_MAP[board] || FQBN_MAP['uno'];
  const safeFqbn = fqbn.replace(/:/g, '_');
  
  const buildDir = path.join(WORKSPACE_BASE, 'build', safeFqbn);
  const cacheDir = path.join(WORKSPACE_BASE, 'cache', safeFqbn);

  if (lastBuild.sketch === sketch && lastBuild.board === board && lastBuild.result) {
    return res.json(lastBuild.result);
  }

  if (isBuilding) {
    return res.status(429).json({ message: 'A build is already in progress. Please wait.' });
  }

  isBuilding = true;

  try {
    await fs.mkdir(buildDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });

    await fs.writeFile(SKETCH_FILE, sketch, 'utf8');

    const { stdout, stderr } = await execFileAsync('arduino-cli', [
      'compile',
      '--fqbn', fqbn,
      '--build-path', buildDir,
      '--build-cache-path', cacheDir,
      SKETCH_DIR
    ], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8'
    });

    const files = await fs.readdir(buildDir);
    const hexFileName = files.find(f => f.endsWith('.hex'));
    
    if (!hexFileName) {
      throw new Error('Compilation succeeded but .hex file was not found.');
    }

    const hexData = await fs.readFile(path.join(buildDir, hexFileName), 'utf8');
    const result = { hex: hexData, stdout, stderr };

    // Update cache
    lastBuild = { sketch, board, result };

    res.json(result);

  } catch (err) {
    if (lastBuild.sketch === sketch && lastBuild.board === board) {
      lastBuild.result = null;
    }

    if (err.killed || err.signal === 'SIGTERM') {
      return res.status(408).json({ message: 'Compilation timed out' });
    }
    
    if (err.stderr !== undefined || err.stdout !== undefined) {
      return res.status(400).json({
        message: 'Compilation failed',
        stderr: err.stderr,
        stdout: err.stdout
      });
    }

    if (err.code === 'ENOENT') {
      return res.status(500).json({ message: 'arduino-cli not found in PATH.' });
    }

    console.error('Build error:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    isBuilding = false;
  }
});

const PORT = 8080;
app.listen(PORT, async () => {
  try {
    await fs.mkdir(WORKSPACE_BASE, { recursive: true });
    await fs.mkdir(SKETCH_DIR, { recursive: true });
    console.log(`Arduino Compiler Server on http://localhost:${PORT}`);
  } catch (err) {
    console.error('Failed to initialize:', err);
    process.exit(1);
  }
});