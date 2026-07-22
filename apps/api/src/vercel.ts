import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
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
  app.setGlobalPrefix('api');
  const origins = (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim());
  app.enableCors({ origin: origins.includes('*') ? true : origins, credentials: true });
  await app.init();
  const instance = app.getHttpAdapter().getInstance() as ExpressInstance;
  cached = instance;
  return instance;
}

export default async function handler(req: Request, res: Response) {
  const express = await getApp();
  express(req, res);
}
