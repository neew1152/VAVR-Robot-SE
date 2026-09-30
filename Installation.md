### Infrastructure

> https://nodejs.org/en/download
> 
```powershell
npm create vite@latest VAVR-Robot-SE -- --template react
cd VAVR-Robot-SE
npm install
npm install -D @tailwindcss/vite
npm install @monaco-editor/react lucide-react avr8js matter-js react-resizable-panels
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
