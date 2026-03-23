import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import { loadConfig } from './config.js';
import { initDb, migrate } from './db.js';
import routes from './routes.js';

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

async function start() {
  const db = initDb(dbFile);
  await migrate(db);
  console.log(`[config-service] Database ready: ${dbFile}`);

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
