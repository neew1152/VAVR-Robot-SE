const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');
const crypto = require('crypto');

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

const boardPaths = {};
for (const [key, fqbn] of Object.entries(fqbnMap)) {
  const safeFqbn = fqbn.replace(/:/g, '_');
  const baseDir = path.join(WORKSPACE_BASE, safeFqbn);
  boardPaths[key] = {
    fqbn,
    sketchDir: path.join(baseDir, 'sketch'),
    buildDir: path.join(baseDir, 'build'),
    cacheDir: path.join(baseDir, 'cache'),
    sketchFile: path.join(baseDir, 'sketch', 'sketch.ino')
  };
}

let activeBuild = null;

const compilationCache = new Map();
const MAX_CACHE_SIZE = 50;

app.post('/build', async (req, res) => {
  const { sketch, board } = req.body;

  if (!sketch || typeof sketch !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid sketch code' });
  }

  const paths = boardPaths[board] || boardPaths['uno'];
  
  const cacheKey = `${board}:${crypto.createHash('sha1').update(sketch).digest('hex')}`;
  if (compilationCache.has(cacheKey)) {
    return res.json(compilationCache.get(cacheKey));
  }

  if (activeBuild) {
    activeBuild.abort();
  }

  const controller = new AbortController();
  activeBuild = controller;
  const { signal } = controller;

  try {
    let currentSketch = '';
    try {
      currentSketch = await fs.readFile(paths.sketchFile, 'utf8');
    } catch (e) {

    }

    if (currentSketch !== sketch) {
      await fs.writeFile(paths.sketchFile, sketch, 'utf8');
    }

    const { stdout, stderr } = await execFileAsync('arduino-cli', [
      'compile',
      '--fqbn', paths.fqbn,
      '--build-path', paths.buildDir,
      '--build-cache-path', paths.cacheDir,
      paths.sketchDir
    ], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      signal,
      encoding: 'utf8'
    });

    const files = await fs.readdir(paths.buildDir);
    const hexFileName = files.find(f => f.endsWith('.hex'));
    
    if (!hexFileName) {
      throw new Error('Compilation succeeded but .hex file was not found in build directory.');
    }

    const hexData = await fs.readFile(path.join(paths.buildDir, hexFileName), 'utf8');
    
    const result = { hex: hexData, stdout, stderr };

    if (compilationCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = compilationCache.keys().next().value;
      compilationCache.delete(oldestKey);
    }
    compilationCache.set(cacheKey, result);

    res.json(result);

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
  try {
    await fs.mkdir(WORKSPACE_BASE, { recursive: true });
    for (const paths of Object.values(boardPaths)) {
      await Promise.all([
        fs.mkdir(paths.sketchDir, { recursive: true }),
        fs.mkdir(paths.buildDir, { recursive: true }),
        fs.mkdir(paths.cacheDir, { recursive: true })
      ]);
    }
    console.log(`Arduino Compiler Server running on http://localhost:${PORT}`);
  } catch (err) {
    console.error('Failed to initialize workspace:', err);
    process.exit(1);
  }
});