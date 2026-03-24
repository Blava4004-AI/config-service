import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import { createRequire } from 'module';
import { loadConfig } from './config.js';
import { initDb, migrate, getDb } from './db.js';
import routes from './routes.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const { nested: cfg, flat } = loadConfig();

const port = flat['api.port'] || 5195;
const sslKey = flat['api.ssl.key_path'];
const sslCert = flat['api.ssl.cert_path'];
const dbFile = flat['database.filename'] || './data/config.db';
const requireToken = flat['api.auth.require_token'];
const authToken = flat['api.auth.token'];

const app = express();
app.use(cors());
app.use(express.json());

// Auth middleware
if (requireToken && authToken) {
  app.use('/api', (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token !== authToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

app.use(routes);

// Error handler — always return JSON
app.use((err, req, res, next) => {
  console.error('[config-service] Error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function selfRegister(db) {
  try {
    const existing = await db('app_registry').where({ app: 'config-service' }).first();
    if (!existing) {
      await db('app_registry').insert({
        app: 'config-service',
        display_name: 'Config Service',
        version: packageJson.version,
        last_seen: new Date().toISOString(),
        base_url: `http://localhost:${port}`
      });
      const ownKeys = [
        { key: 'api.port', value: JSON.stringify(port), value_type: 'number', description: 'API port', updated_by: 'self-register' },
        { key: 'api.auth.require_token', value: JSON.stringify(requireToken || false), value_type: 'boolean', description: 'Require bearer token', updated_by: 'self-register' },
        { key: 'database.driver', value: JSON.stringify('better-sqlite3'), value_type: 'string', description: 'Database driver', updated_by: 'self-register' },
      ];
      for (const k of ownKeys) {
        const exists = await db('configs').where({ app: 'config-service', key: k.key }).first();
        if (!exists) await db('configs').insert({ app: 'config-service', ...k, updated_at: new Date().toISOString() });
      }
      console.log('[config-service] Self-registered in database');
    } else {
      await db('app_registry').where({ app: 'config-service' }).update({ last_seen: new Date().toISOString() });
      console.log('[config-service] Updated last_seen in registry');
    }

    // Seed auth permission config keys in __global__
    const authPermKeys = [
      { key: 'auth.config-service.min_permission', value: JSON.stringify('admin'), value_type: 'string', description: 'Minimum permission to access Config Service' },
      { key: 'auth.auth-service.min_permission', value: JSON.stringify('admin'), value_type: 'string', description: 'Minimum permission to access Auth Service' },
      { key: 'auth.task-tracker.min_permission', value: JSON.stringify('read'), value_type: 'string', description: 'Minimum permission to access Task Tracker' },
      { key: 'auth.__default__.min_permission', value: JSON.stringify('read'), value_type: 'string', description: 'Default minimum permission for unlisted apps' },
    ];
    for (const k of authPermKeys) {
      const exists = await db('configs').where({ app: '__global__', key: k.key }).first();
      if (!exists) {
        await db('configs').insert({ app: '__global__', ...k, updated_by: 'self-register', updated_at: new Date().toISOString() });
      }
    }

    // Register __global__ pseudo-app with shared config
    const globalExists = await db('app_registry').where({ app: '__global__' }).first();
    if (!globalExists) {
      await db('app_registry').insert({
        app: '__global__',
        display_name: 'Global (Shared)',
        version: '-',
        last_seen: new Date().toISOString(),
        base_url: '-'
      });
      const globalKeys = [
        { key: 'ssl.key_path', value: JSON.stringify('/home/johnathan/certs/aiserver.key'), value_type: 'string', description: 'SSL private key path (shared by all apps)' },
        { key: 'ssl.cert_path', value: JSON.stringify('/home/johnathan/certs/aiserver.crt'), value_type: 'string', description: 'SSL certificate path (shared by all apps)' },
        { key: 'tailscale.hostname', value: JSON.stringify('aiserver.weasel-armadillo.ts.net'), value_type: 'string', description: 'Tailscale MagicDNS hostname' },
        { key: 'gateway.url', value: JSON.stringify('http://127.0.0.1:18789/v1/chat/completions'), value_type: 'string', description: 'OpenClaw Gateway URL' },
        { key: 'gateway.token', value: JSON.stringify('4f7220ba866825cda16fdf104c0f8fe9af5b892feb6e2622'), value_type: 'string', description: 'OpenClaw Gateway token', is_secret: 1 },
      ];
      for (const k of globalKeys) {
        const exists = await db('configs').where({ app: '__global__', key: k.key }).first();
        if (!exists) await db('configs').insert({ app: '__global__', ...k, updated_by: 'self-register', updated_at: new Date().toISOString() });
      }
      console.log('[config-service] Global shared config registered');
    }
  } catch (e) {
    console.error('[config-service] Self-registration failed:', e.message);
  }
}

async function start() {
  const db = initDb(dbFile);
  await migrate(db);
  console.log(`[config-service] Database ready: ${dbFile}`);

  await selfRegister(db);

  let server;
  if (sslKey && sslCert && fs.existsSync(sslKey) && fs.existsSync(sslCert)) {
    const opts = {
      key: fs.readFileSync(sslKey),
      cert: fs.readFileSync(sslCert),
    };
    server = https.createServer(opts, app);
    server.listen(port, () => console.log(`[config-service] HTTPS on port ${port}`));
  } else {
    server = app.listen(port, () => console.log(`[config-service] HTTP on port ${port}`));
  }
}

start().catch((err) => {
  console.error('[config-service] Fatal:', err);
  process.exit(1);
});
