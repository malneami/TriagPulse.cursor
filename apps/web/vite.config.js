import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));

/** public/ocr is gitignored — copy tesseract files whenever Vite starts, not only via predev. */
function ocrAssetsPlugin() {
  const copy = () => {
    execFileSync(process.execPath, [path.join(webRoot, 'scripts/copy-ocr-assets.mjs')], { stdio: 'inherit' });
  };
  return { name: 'ocr-assets', buildStart: copy, configureServer: copy };
}

// GitHub Pages project site: set GITHUB_PAGES=true (CI) → base /TriagePulse/
const pagesBase = process.env.GITHUB_PAGES === 'true'
  ? `/${process.env.GITHUB_REPOSITORY_NAME || 'TriagePulse'}/`
  : '/';

export default defineConfig({
  base: pagesBase,
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react(), ocrAssetsPlugin()],
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
    // Listen on every interface (needed inside containers and Codespaces).
    host: true,
    port: 5174,
    strictPort: true,
    // GitHub Codespaces serves the dev server at https://<name>-5174.app.github.dev.
    allowedHosts: ['localhost', '.app.github.dev'],
    // Behind the Codespaces HTTPS proxy, hot reload must connect on port 443.
    hmr: process.env.CODESPACES ? { clientPort: 443 } : undefined,
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
