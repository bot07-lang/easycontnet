import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

// Minimal .env loader — no dependency needed for a handful of keys.
function loadEnv() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && !(m[1] in process.env)) {
        process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env file — rely on the real environment.
  }
}

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create(AppModule, { cors: false });

  // All API routes live under /api. This keeps them clear of the SPA when the
  // built frontend is served from this same process (merged deployment), and is
  // harmless when the API runs standalone.
  app.setGlobalPrefix('api');

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({ origin: origins, credentials: true });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
