import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api, /oauth and /portal to the local HelmDesk API (:3020) so the UI can
// run on :5174 without CORS friction. Built assets are served by the API at /app in production.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3020',
      '/oauth': 'http://localhost:3020',
      '/portal': 'http://localhost:3020'
    }
  }
});
