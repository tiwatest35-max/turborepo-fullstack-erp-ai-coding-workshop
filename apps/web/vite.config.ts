/// <reference types="vitest/config" />
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In Docker the API runs in the "api" container; on your machine it's localhost.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

// The browser only talks to Vite; /api/* is forwarded to NestJS (no CORS needed).
const proxy = { '/api': { target: apiTarget, changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    host: process.env.HOST ?? 'localhost',
    port: 5173,
    strictPort: true,
    proxy,
    // File change events don't always reach containers (e.g. Windows bind mounts).
    watch: process.env.WATCH_POLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
  },
  // `vite preview` serves the production build on the same port with the same proxy,
  // so the Playwright suite in apps/e2e tests what ships. See lessons/10.
  preview: {
    host: process.env.HOST ?? 'localhost',
    port: 5173,
    strictPort: true,
    proxy,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
