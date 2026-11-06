import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development: the browser talks to :5173, Vite forwards /api to the API.
    // No CORS, and the refresh cookie (Path=/api/v1/auth) works as it will in production.
    proxy: { '/api': 'http://localhost:4000' },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
