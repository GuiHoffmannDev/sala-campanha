import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri loads the dev server from a fixed port and the build from ../dist.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust build output changes constantly; it is not part of the web app.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'safari16' },
})
