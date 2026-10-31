import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const SERVER = 'http://localhost:8787';
// = --background (oklch(0.17 0.012 60)) as hex; keep in sync with index.html and pwa-assets.config.ts.
const BACKGROUND = '#130e0a';

export default defineConfig(({ command }) => ({
  root: 'src/web',
  // Build: relative base, the token is not known at build time. Dev: Vite itself is served under /<token>/.
  base: command === 'serve' && process.env.APP_TOKEN ? `/${process.env.APP_TOKEN}/` : './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Relative paths so the app, manifest and SW all live under /<token>/ whatever the token is.
      manifest: {
        id: './',
        name: 'Popcorn',
        short_name: 'Popcorn',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: BACKGROUND,
        background_color: BACKGROUND,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}', '**/inter-latin*.woff2'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//, /\/stremio\//],
        runtimeCaching: [
          {
            // Network-first so the list still opens offline (read-only). Search is never cached.
            urlPattern: ({ url }) => /\/api\/(titles|config|members)$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://image.tmdb.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-posters',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
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
