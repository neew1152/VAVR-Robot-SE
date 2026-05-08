### Infrastructure

> https://nodejs.org/dist/v24.15.0/node-v24.15.0-x64.msi

```powershell
mkdir C:\VAVR-Robot-SE
cd C:\VAVR-Robot-SE
npm create vite@latest flawless-simulator -- --template react
cd flawless-simulator
npm install
npm install -D @tailwindcss/vite
npm install @monaco-editor/react lucide-react
npm install avr8js matter-js react-resizable-panels
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

```powershell
npm run dev
```

### How offline works with the Arduino IDE:

1. You write your code in the real Arduino IDE.
2. You click **Sketch -> Export compiled Binary**.
3. The IDE drops a `.hex` file directly into your project folder. 
4. You import that file to our simulator.
