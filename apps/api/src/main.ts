import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import express, { json, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { AppModule, ENV_FILE_PATHS } from './app.module';
import { startBoosthis } from './boosthis';

/**
 * Report where config came from and whether the STT key resolved. Paths and booleans
 * only — never values. Without this, a shadowed or empty OPENAI_API_KEY surfaces to
 * the clinician as an opaque 400 from /stt/transcribe.
 */
function logConfigSources() {
  const cwd = process.cwd();
  const candidates = ENV_FILE_PATHS.map((p) => resolve(cwd, p));
  console.log(`[config] cwd=${cwd}`);
  for (const [i, path] of candidates.entries()) {
    const precedence = i === 0 ? 'highest' : `#${i + 1}`;
    console.log(`[config] env(${precedence}) ${path} — ${existsSync(path) ? 'found' : 'missing'}`);
  }
  if (candidates.filter((p) => existsSync(p)).length > 1) {
    console.log('[config] NOTE: multiple .env files found. For any key defined in more than one,'
      + ' the FIRST file listed above wins — including when its value is blank.');
  }
  console.log(`[config] SPEECHMATICS_API_KEY: ${process.env.SPEECHMATICS_API_KEY?.trim() ? 'loaded — live speech uses Speechmatics (Arabic + English)' : 'not set'}`);
  const configured = !!process.env.OPENAI_API_KEY?.trim();
  console.log(`[config] OPENAI_API_KEY: ${configured ? 'loaded' : 'NOT SET — STT falls back to browser speech + manual entry'}`);
  if (configured) {
    console.log(`[config] STT models: batch=${process.env.OPENAI_STT_MODEL || 'gpt-transcribe'} `
      + `realtime=${process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || 'gpt-live-transcribe'} `
      + `delay=${process.env.OPENAI_REALTIME_DELAY || 'high'} vad=${process.env.OPENAI_REALTIME_VAD || 'auto'}`);
  }
}

/**
 * Optional single-port mode: when SERVE_WEB_DIR points at a built web app
 * (apps/web/dist), the API also serves the UI, so the whole app runs on one
 * port. Used in GitHub Codespaces, where the API's port forwards reliably.
 * /api and /socket.io always go to the API; other GET page routes get
 * index.html so the React router can handle them.
 */
function serveWebApp(server: express.Express) {
  const dir = process.env.SERVE_WEB_DIR?.trim();
  if (!dir) return;
  const root = resolve(process.cwd(), dir);
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) {
    console.warn(`[web] SERVE_WEB_DIR=${dir} has no index.html (build the web app first); UI not served.`);
    return;
  }
  // Hashed build files (/assets/*) never change → cache for a year. The OCR model files
  // change rarely → a day. index.html must always be re-checked so a release shows at once.
  server.use(express.static(root, {
    index: 'index.html',
    setHeaders: (res, filePath) => {
      const rel = filePath.slice(root.length).replace(/\\/g, '/');
      if (rel.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (rel.startsWith('/ocr/')) res.setHeader('Cache-Control', 'public, max-age=86400');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  server.use((req: Request, res: Response, next: NextFunction) => {
    const isApi = req.path.startsWith('/api') || req.path.startsWith('/socket.io');
    if (req.method !== 'GET' || isApi || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
  console.log(`[web] Serving the web app from ${root}`);
}

async function bootstrap() {
  startBoosthis(); // before NestFactory.create(): it watches the HTTP server as it is created
  const app = await NestFactory.create(AppModule);
  logConfigSources();
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5174',
    credentials: true,
  });
  // Security headers (review H4): content security policy, HSTS, no framing, no sniffing.
  // The web app loads only its own files plus Google Fonts; live speech and the board use
  // same-origin Socket.IO (ws/wss); the API calls Speechmatics/OpenAI server-side only.
  const connectExtra = process.env.CSP_CONNECT_EXTRA?.split(/\s+/).filter(Boolean) || [];
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // 'wasm-unsafe-eval' lets the on-device text reader (WebAssembly) start; it does not allow eval().
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:', ...connectExtra],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(json({ limit: '8mb' }));
  serveWebApp(app.getHttpAdapter().getInstance());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`TriagePulse API running on http://localhost:${port}/api`);
  if (process.env.SERVE_WEB_DIR) console.log(`TriagePulse app running on http://localhost:${port}/`);
}

bootstrap();
