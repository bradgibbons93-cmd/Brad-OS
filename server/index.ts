import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { ensureWorkspaces, seedSample } from './seed.ts';

const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const port = Number(process.env.PORT ?? 3000);

let password = process.env.BRAD_OS_PASSWORD ?? '';
let sessionSecret = process.env.SESSION_SECRET ?? '';
if (isProd && (!password || !sessionSecret)) {
  console.error('BRAD_OS_PASSWORD and SESSION_SECRET must be set in production. Refusing to start.');
  process.exit(1);
}
if (!password) {
  password = 'brad-os-dev';
  console.warn('⚠  BRAD_OS_PASSWORD not set — using the local development password "brad-os-dev".');
}
if (!sessionSecret) sessionSecret = randomBytes(32).toString('hex');

const db = openDb(join(dataDir, 'brad-os.db'));
ensureWorkspaces(db);
if ((process.env.SEED_SAMPLE ?? 'true') !== 'false' && seedSample(db)) console.log('Seeded sample data.');

const app = createApp({ db, password, sessionSecret, secureCookies: isProd });

const distDir = resolve('dist');
if (existsSync(distDir)) {
  const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
  app.use(
    '/assets/*',
    async (c, next) => {
      await next();
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
    serveStatic({ root: './dist' }),
  );
  app.use('*', serveStatic({ root: './dist' }));
  // SPA fallback for client-side routes.
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`BRAD OS listening on http://localhost:${info.port} (data: ${dataDir})`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
