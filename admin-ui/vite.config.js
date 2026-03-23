import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'config-service',
      filename: 'remoteEntry.js',
      exposes: {
        './ConfigApp': './src/App.jsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: false },
        'react-dom': { singleton: true, requiredVersion: false },
      }
    })
  ],
  server: {
    port: 5196,
    proxy: {
      '/api': 'http://localhost:5195',
      '/health': 'http://localhost:5195',
    },
  },
  build: {
    target: 'esnext',
    minify: true,
    outDir: 'dist',
  },
});
