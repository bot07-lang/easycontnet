import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

/**
 * Vercel serverless entrypoint. Unlike main.ts (which calls app.listen() for a
 * long-lived server), this builds the Nest app once, caches the underlying
 * Express instance across warm invocations, and hands each request to it.
 *
 * SERVE_WEB stays unset on Vercel — the SPA is served by Vercel's static CDN,
 * and /api/* is rewritten to this function (see vercel.json). Use the Supabase
 * transaction pooler (port 6543) with DB_POOL_MAX=1 here.
 */
type ExpressInstance = (req: Request, res: Response) => void;
let cached: ExpressInstance | null = null;

async function getApp(): Promise<ExpressInstance> {
  if (cached) return cached;
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  // Same hardening as main.ts — CSP left off, same reasoning (see there).
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api');
  // Fails CLOSED, not open: an unset CORS_ORIGINS means no cross-origin
  // caller is allowed (same-origin requests — the normal case, since the SPA
  // is rewritten to this same function on Vercel — are unaffected either
  // way). "*" must be set explicitly to allow any origin; it's never the
  // default for a missing env var.
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.includes('*') ? true : origins.length > 0 ? origins : false, credentials: true });
  await app.init();
  const instance = app.getHttpAdapter().getInstance() as ExpressInstance;
  cached = instance;
  return instance;
}

export default async function handler(req: Request, res: Response) {
  const express = await getApp();
  express(req, res);
}
