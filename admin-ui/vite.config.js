import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';
import fs from 'fs';

const sslKey = '/home/johnathan/certs/aiserver.key';
const sslCert = '/home/johnathan/certs/aiserver.crt';
const httpsConfig = fs.existsSync(sslKey) && fs.existsSync(sslCert)
  ? { key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) }
  : false;

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'config-service',
      filename: 'remoteEntry.js',
      exposes: {
        './ConfigApp': './src/AppRemote.jsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: false },
        'react-dom': { singleton: true, requiredVersion: false },
      }
    })
  ],
  server: {
    port: 5196,
    allowedHosts: ['aiserver.weasel-armadillo.ts.net'],
    proxy: {
      '/api': 'http://localhost:5195',
      '/health': 'http://localhost:5195',
    },
  },
  preview: {
    port: 5196,
    allowedHosts: ['aiserver.weasel-armadillo.ts.net'],
    https: httpsConfig,
  },
  build: {
    target: 'esnext',
    minify: true,
    outDir: 'dist',
  },
});
