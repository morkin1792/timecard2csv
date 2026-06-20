import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // In production the app is served from a GitHub Pages *project* page at
  // https://morkin1792.github.io/timecard2csv/, so assets must be referenced
  // under /timecard2csv/. Local dev (`npm run dev`) stays at the root path.
  // If you later add a custom domain, change this back to '/'.
  base: command === 'build' ? '/timecard2csv/' : '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist']
  }
}))
