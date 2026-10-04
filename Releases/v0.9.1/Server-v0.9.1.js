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

let activeBuild = null;

app.post('/build', async (req, res) => {
  const { sketch, board } = req.body;

  if (!sketch || typeof sketch !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid sketch code' });
  }

  const fqbn = fqbnMap[board] || fqbnMap['uno'];
  const safeFqbn = fqbn.replace(/:/g, '_');

  if (activeBuild) {
    activeBuild.abort();
  }

  const controller = new AbortController();
  activeBuild = controller;
  const { signal } = controller;

  const boardDir = path.join(WORKSPACE_BASE, safeFqbn);
  const sketchDir = path.join(boardDir, 'sketch');
  const buildDir = path.join(boardDir, 'build');
  const cacheDir = path.join(boardDir, 'cache'); 

  try {
    await Promise.all([
      fs.mkdir(sketchDir, { recursive: true }),
      fs.mkdir(buildDir, { recursive: true }),
      fs.mkdir(cacheDir, { recursive: true })
    ]);

    const sketchFile = path.join(sketchDir, 'sketch.ino');
    await fs.writeFile(sketchFile, sketch, 'utf8');

    const { stdout, stderr } = await execFileAsync('arduino-cli', [
      'compile',
      '--fqbn', fqbn,
      '--build-path', buildDir,
      '--build-cache-path', cacheDir,
      sketchDir
    ], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      signal,
      encoding: 'utf8'
    });

    const hexFile = path.join(buildDir, 'sketch.ino.hex');
    const hexData = await fs.readFile(hexFile, 'utf8');
    
    res.json({ 
      hex: hexData,
      stdout,
      stderr
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(409).json({ message: 'Build superseded by a newer request' });
    }

    if (err.killed || err.signal === 'SIGTERM') {
      return res.status(408).json({ message: 'Compilation timed out or was cancelled' });
    }
    
    if (err.stderr !== undefined || err.stdout !== undefined) {
      return res.status(400).json({
        message: 'Compilation failed',
        stderr: err.stderr,
        stdout: err.stdout
      });
    }

    if (err.code === 'ENOENT') {
      return res.status(500).json({ message: 'arduino-cli not found on server. Ensure it is installed and in PATH.' });
    }

    console.error('Build error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    if (activeBuild === controller) {
      activeBuild = null;
    }
  }
});

const PORT = 8080;
app.listen(PORT, async () => {
  await fs.mkdir(WORKSPACE_BASE, { recursive: true });
  console.log(`Arduino Compiler Server running on http://localhost:${PORT}`);
});