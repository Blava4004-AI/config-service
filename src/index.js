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
