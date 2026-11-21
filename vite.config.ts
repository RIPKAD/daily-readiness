import { defineConfig } from 'vitest/config';

// Relative asset URLs so the built site works at /daily-readiness/ on GitHub Pages
// and also at the root of a local preview.
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 45931, strictPort: true },
  preview: { host: '0.0.0.0', port: 45931, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
