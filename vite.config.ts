import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo>/, so the base path is configurable at build time.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
