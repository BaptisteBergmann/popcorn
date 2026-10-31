import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = 'http://localhost:8787';

export default defineConfig(({ command }) => ({
  root: 'src/web',
  // Build: relative base, the token is not known at build time. Dev: Vite itself is served under /<token>/.
  base: command === 'serve' && process.env.APP_TOKEN ? `/${process.env.APP_TOKEN}/` : './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@web': path.resolve(import.meta.dirname, 'src/web'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // In dev the Hono server serves the API; the SPA comes from Vite.
    proxy: {
      '^/[^/]+/(api|stremio)(/|$)': SERVER,
    },
  },
}));
