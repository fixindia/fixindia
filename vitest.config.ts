import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest 3 ships a rollup-based vite type set that conflicts with this
// project's Vite 8 (rolldown) types, so the test config is isolated here.
// `vitest` auto-discovers this file ahead of vite.config.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
});
