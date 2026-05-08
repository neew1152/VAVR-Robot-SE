### Install Infrastructure

> https://nodejs.org/dist/v24.15.0/node-v24.15.0-x64.msi
>
> ✅ Automatically install the necessary tools.

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

### Configure Tailwind

Open the newly created `tailwind.config.js` file and replace its contents with this, so Tailwind knows where to look for your code:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Open `src/index.css` and delete everything. Replace it with:
```css
@import "tailwindcss";

html, body, #root {
  height: 100%;
  margin: 0;
}
```

### Update `vite.config.js`

Open the `vite.config.js` file in the root of your project, and add the Tailwind plugin. Replace the contents of the file with this:
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

### The main app

Replace `src/App.jsx` with my GitHub version.

```powershell
npm run dev
```

### How offline works with the Arduino IDE:

1. You write your code in the real Arduino IDE.
2. You click **Sketch -> Export compiled Binary**.
3. The IDE drops a `.hex` file directly into your project folder. 
4. You import that file to our simulator.
