import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { AppModule, ENV_FILE_PATHS } from './app.module';

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
  const configured = !!process.env.OPENAI_API_KEY?.trim();
  console.log(`[config] OPENAI_API_KEY: ${configured ? 'loaded' : 'NOT SET — STT falls back to browser speech + manual entry'}`);
  if (configured) {
    console.log(`[config] STT models: batch=${process.env.OPENAI_STT_MODEL || 'gpt-transcribe'} `
      + `realtime=${process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || 'gpt-live-transcribe'} `
      + `delay=${process.env.OPENAI_REALTIME_DELAY || 'high'} vad=${process.env.OPENAI_REALTIME_VAD || 'auto'}`);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  logConfigSources();
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  });
  app.use(json({ limit: '8mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`TriagePulse API running on http://localhost:${port}/api`);
}

bootstrap();
