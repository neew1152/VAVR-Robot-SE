const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/build', async (req, res) => {
  const { sketch, board } = req.body;

  if (!sketch) {
    return res.status(400).json({ message: 'Missing sketch code' });
  }

  const fqbnMap = {
    'uno': 'arduino:avr:uno',
    'nano': 'arduino:avr:nano',
    'mega': 'arduino:avr:mega',
    'leonardo': 'arduino:avr:leonardo'
  };
  
  const fqbn = fqbnMap[board] || 'arduino:avr:uno';

  const tempId = uuidv4();
  const tempDir = path.join(os.tmpdir(), `arduino-build-${tempId}`);
  const sketchDir = path.join(tempDir, 'sketch');
  const buildDir = path.join(tempDir, 'build');

  try {
    await fs.mkdir(sketchDir, { recursive: true });
    await fs.mkdir(buildDir, { recursive: true });

    const sketchFile = path.join(sketchDir, 'sketch.ino');
    await fs.writeFile(sketchFile, sketch);

    const command = `arduino-cli compile --fqbn ${fqbn} --build-path "${buildDir}" "${sketchDir}"`;

    exec(command, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
      if (error) {
        return res.status(400).json({
          message: 'Compilation failed',
          stderr: stderr,
          stdout: stdout
        });
      }

      try {
        const hexFile = path.join(buildDir, 'sketch.ino.hex');
        const hexData = await fs.readFile(hexFile, 'utf8');

        res.json({ hex: hexData });
      } catch (readErr) {
        res.status(500).json({ message: 'Failed to read compiled hex file', stderr: readErr.message });
      } finally {
        fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', stderr: err.message });
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`🚀 Arduino Compiler Server running on http://localhost:${PORT}`);
});