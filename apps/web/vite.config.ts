import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * Installable app (W3 D1): manifest + a precached shell, so the staff app opens from the
     * home screen and survives a dead connection as a shell — data still comes from the API.
     *
     * Deliberately no runtime caching of `/api`: a stale rota is worse than a spinner, and the
     * clock-in path will need its own offline queue (IndexedDB) rather than a cached GET.
     */
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Shiftora — shifts and attendance',
        short_name: 'Shiftora',
        description: 'Staff scheduling, attendance and payroll for clinics and shops.',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // Never answer an API or socket request with the shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        cleanupOutdatedCaches: true,
        // Our own push + notificationclick handlers, imported into the generated worker.
        importScripts: ['push-handler.js'],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin in development: the browser talks to :5173, Vite forwards /api to the API.
    // No CORS, and the refresh cookie (Path=/api/v1/auth) works as it will in production.
    proxy: {
      // 127.0.0.1, not localhost: the API binds 0.0.0.0 (IPv4), and on Windows 'localhost'
      // can resolve to ::1 first — which is a 502 that looks like the API being down.
      '/api': 'http://127.0.0.1:4000',
      // Socket.IO handshake + upgrades: same origin, so `io()` needs no URL.
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
