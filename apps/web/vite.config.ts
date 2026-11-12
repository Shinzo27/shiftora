import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin in development: the browser talks to :5173, Vite forwards /api to the API.
    // No CORS, and the refresh cookie (Path=/api/v1/auth) works as it will in production.
    proxy: {
      '/api': 'http://localhost:4000',
      // Socket.IO handshake + upgrades: same origin, so `io()` needs no URL.
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
