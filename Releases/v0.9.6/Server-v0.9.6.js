const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);
const app = express();

app.use(cors());
app.use(express.json({ limit: '512kb' }));

const FQBN_MAP = {
  uno: 'arduino:avr:uno',
  nano: 'arduino:avr:nano',
  mega: 'arduino:avr:mega',
  leonardo: 'arduino:avr:leonardo'
};

const WORKSPACE_BASE = path.join(os.tmpdir(), 'arduino-compiler-workspace');
const SKETCH_DIR = path.join(WORKSPACE_BASE, 'sketch');
const SKETCH_FILE = path.join(SKETCH_DIR, 'sketch.ino');

const BOARD_PATHS = {};
for (const [key, fqbn] of Object.entries(FQBN_MAP)) {
  const safe = fqbn.replace(/:/g, '_');
  BOARD_PATHS[key] = {
    fqbn,
    buildDir: path.join(WORKSPACE_BASE, 'build', safe),
    cacheDir: path.join(WORKSPACE_BASE, 'cache', safe)
  };
}

const MAX_CACHE_PER_BOARD = 5;
const buildCache = new Map();

function cacheKey(board, sketch) {
  const hash = crypto.createHash('sha1').update(sketch).digest('hex');
  return `${board}:${hash}`;
}

app.post('/build', async (req, res) => {
  const { sketch, board } = req.body;

  if (!sketch || typeof sketch !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid sketch code' });
  }

  const boardKey = FQBN_MAP[board] ? board : 'uno';
  const paths = BOARD_PATHS[boardKey];
  const key = cacheKey(boardKey, sketch);

  if (buildCache.has(key)) {
    return res.json(buildCache.get(key));
  }

  try {
    await fs.writeFile(SKETCH_FILE, sketch, 'utf8');

    const { stdout, stderr } = await execFileAsync('arduino-cli', [
      'compile',
      '--fqbn', paths.fqbn,
      '--build-path', paths.buildDir,
      '--build-cache-path', paths.cacheDir,
      '--no-color',
      '--warnings', 'default',
      SKETCH_DIR
    ], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8'
    });

    const files = await fs.readdir(paths.buildDir);
    const hexFileName = files.find(f => f.endsWith('.hex'));

    if (!hexFileName) {
      throw new Error('Compilation succeeded but .hex file was not found.');
    }

    const hexData = await fs.readFile(path.join(paths.buildDir, hexFileName), 'utf8');
    const result = { hex: hexData, stdout, stderr };

    if (buildCache.size >= MAX_CACHE_PER_BOARD * Object.keys(FQBN_MAP).length) {
      const oldest = buildCache.keys().next().value;
      buildCache.delete(oldest);
    }
    buildCache.set(key, result);

    return res.json(result);

  } catch (err) {
    if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
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
    return res.status(500).json({ message: 'Internal server error', error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = 8080;
app.listen(PORT, async () => {
  try {
    await fs.mkdir(SKETCH_DIR, { recursive: true });
    await Promise.all(
      Object.values(BOARD_PATHS).flatMap(p => [
        fs.mkdir(p.buildDir, { recursive: true }),
        fs.mkdir(p.cacheDir, { recursive: true })
      ])
    );

    await execFileAsync('arduino-cli', ['version'], { timeout: 10000 });

    console.log(`Arduino Compiler Server on http://localhost:${PORT}`);
  } catch (err) {
    console.error('Failed to initialize:', err);
    process.exit(1);
  }
});