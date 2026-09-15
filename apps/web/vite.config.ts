import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    // VITE_API_URL is '/api' (relative) so the same build works unmodified in
    // the merged-deployment setup, where the API serves the built SPA from
    // its own origin. In local dev the two run on separate ports (this
    // server on 3000, the Nest API on 3001), so a relative '/api' fetch from
    // the page would otherwise hit Vite itself — which has no such route and
    // falls back to index.html, returning HTML where the client expects
    // JSON. This proxy forwards it to the real API instead.
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
