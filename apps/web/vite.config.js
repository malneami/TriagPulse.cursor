import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'path';

// GitHub Pages project site: set GITHUB_PAGES=true (CI) → base /TriagePulse/
const pagesBase = process.env.GITHUB_PAGES === 'true'
  ? `/${process.env.GITHUB_REPOSITORY_NAME || 'TriagePulse'}/`
  : '/';

export default defineConfig({
  base: pagesBase,
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@triagepulse/clinical': path.resolve(__dirname, '../../packages/clinical/dist/esm/index.js'),
    },
  },
  optimizeDeps: {
    exclude: ['@triagepulse/clinical'],
  },
  build: {
    commonjsOptions: {
      include: [/packages\/clinical/, /node_modules/],
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Socket.IO Engine.IO handshake (ws://localhost:5173/socket.io/...)
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      // Nest STT namespace path (HTTP upgrades / room joins under /stt)
      '/stt': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
