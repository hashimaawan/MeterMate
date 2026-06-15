import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SPA runs on :5173 in dev and proxies API calls to the Express backend on
// :4000, so the browser only ever talks to one origin (no CORS in dev).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
