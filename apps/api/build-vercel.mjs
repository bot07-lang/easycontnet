import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the NestJS serverless handler into a single self-contained CJS file at
// the repo-root api/ folder — Vercel serves it as the /api function. Bundling
// inlines the @content/shared workspace package and every dependency, so there
// is no pnpm-monorepo resolution to fail at deploy time.
await build({
  entryPoints: [fileURLToPath(new URL('./src/vercel.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: fileURLToPath(new URL('../../api/index.js', import.meta.url)),
  // NestJS optionally require()s these; it try/catches when absent, so we leave
  // them external rather than pulling their whole trees into the bundle.
  external: [
    '@nestjs/microservices',
    '@nestjs/microservices/microservices-module',
    '@nestjs/websockets',
    '@nestjs/websockets/socket-module',
    'class-transformer',
    'class-validator',
    'cache-manager',
    '@fastify/static',
    '@nestjs/platform-fastify',
    'pg-native',
  ],
  logLevel: 'info',
});
