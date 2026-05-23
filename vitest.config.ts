import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config kept separate from vite.config.ts so the production build
// (manualChunks, esnext target) and the test runner don't share knobs.
// The React plugin is included so PR2's component/hook tests (.tsx with
// @testing-library/react) work; pure-logic tests don't need it but it's
// harmless. Default env is node — files that need a DOM opt in per-file
// via a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
