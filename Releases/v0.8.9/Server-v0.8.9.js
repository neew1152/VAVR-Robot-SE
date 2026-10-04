const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');
const { v4: uuidv4 } = require('uuid');

const execFileAsync = util.promisify(execFile);
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const fqbnMap = {
  'uno': 'arduino:avr:uno',
  'nano': 'arduino:avr:nano',
  'mega': 'arduino:avr:mega',
  'leonardo': 'arduino:avr:leonardo'
};

app.post('/build', async (req, res) => {
  const { sketch, board } = req.body;

  if (!sketch || typeof sketch !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid sketch code' });
  }

  const fqbn = fqbnMap[board] || 'arduino:avr:uno';
  const tempId = uuidv4();
  const tempDir = path.join(os.tmpdir(), `arduino-build-${tempId}`);
  const sketchDir = path.join(tempDir, 'sketch');
  const buildDir = path.join(tempDir, 'build');

  try {
    await fs.mkdir(sketchDir, { recursive: true });
    await fs.mkdir(buildDir, { recursive: true });

    const sketchFile = path.join(sketchDir, 'sketch.ino');
    await fs.writeFile(sketchFile, sketch, 'utf8');

    const { stdout, stderr } = await execFileAsync('arduino-cli', [
      'compile',
      '--fqbn', fqbn,
      '--build-path', buildDir,
      sketchDir
    ], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024 
    });

    const hexFile = path.join(buildDir, 'sketch.ino.hex');
    const hexData = await fs.readFile(hexFile, 'utf8');
    
    res.json({ hex: hexData });

  } catch (err) {
    if (err.killed) {
      return res.status(408).json({ message: 'Compilation timed out' });
    }
    
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return res.status(400).json({
        message: 'Compilation failed',
        stderr: err.stderr,
        stdout: err.stdout
      });
    }

    if (err.code === 'ENOENT') {
      return res.status(500).json({ message: 'arduino-cli not found on server' });
    }

    console.error('Build error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`Arduino Compiler Server running on http://localhost:${PORT}`);
});