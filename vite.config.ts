import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset URL relative so the same build works on
// GitHub Pages project sites (https://<user>.github.io/<repo>/), custom
// domains and local previews without any configuration.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
