import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite + Tauri 2 conventions: fixed port 1420, no auto-clear, no HMR overlay races.
// See https://tauri.app/v2/guides/ for the standard recipe.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
  },
});
