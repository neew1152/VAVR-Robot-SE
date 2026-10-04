### Infrastructure

> https://nodejs.org/en/download
> 
> https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.msi

```powershell
npm create vite@latest VAVR-Robot-SE -- --template react
cd VAVR-Robot-SE
npm install
npm install -D @tailwindcss/vite
npm install @monaco-editor/react avr8js jszip lucide-react matter-js react-resizable-panels

arduino-cli core update-index
arduino-cli core install arduino:avr
mkdir arduino-compiler-server
cd arduino-compiler-server
npm init -y
npm install express cors uuid
```

### Configuration

Replace `vite.config.js` with:
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins:[
    react(),
    tailwindcss(),
  ],
})
```

Replace `src/index.css` with:
```css
@import "tailwindcss";

html, body, #root {
  height: 100%;
  margin: 0;
}
```

Replace `src/App.jsx` with my GitHub version.

Make `arduino-compiler-server/server.js` match my GitHub version.

```powershell
cd VAVR-Robot-SE
npm run dev

cd VAVR-Robot-SE/arduino-compiler-server
node server.js
```
