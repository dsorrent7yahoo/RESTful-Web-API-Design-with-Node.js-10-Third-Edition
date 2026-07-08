import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      '/api/pharmacist': { target: 'http://localhost:4006', rewrite: p => p.replace(/^\/api\/pharmacist/, ''), changeOrigin: true },
      '/api/ehr':         { target: 'http://localhost:4007', rewrite: p => p.replace(/^\/api\/ehr/, ''),         changeOrigin: true },
      '/api/diagnosis':   { target: 'http://localhost:4008', rewrite: p => p.replace(/^\/api\/diagnosis/, ''),   changeOrigin: true },
      '/api/config':      { target: 'http://localhost:4009', rewrite: p => p.replace(/^\/api/, ''),      changeOrigin: true },
    },
  },
});
