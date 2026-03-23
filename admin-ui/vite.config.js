import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5196,
    proxy: {
      '/api': 'http://localhost:5195',
      '/health': 'http://localhost:5195',
    },
  },
  build: {
    outDir: 'dist',
  },
});
