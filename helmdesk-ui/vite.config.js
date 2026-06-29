import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Split deploy: the UI is hosted standalone (Vercel) at the ROOT of helmdeskapp.vaultsuite.store,
// and talks to the API at VITE_API_URL (helmdeskapi.vaultsuite.store). Base stays default '/'.
// Dev server proxies /api, /oauth, /portal to the local API (:3020) to avoid CORS friction locally.
export default defineConfig({
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
