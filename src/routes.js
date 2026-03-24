import { Router } from 'express';
import { getDb } from './db.js';
import { createAuthGuard } from './middleware/authGuard.js';
import { loadConfig } from './config.js';

const router = Router();
const startTime = Date.now();

// Auth guard — config service uses its own flat config for auth.enabled
const { flat: configFlat } = loadConfig();
const auth = createAuthGuard({
  appName: 'config-service',
  getConfig: (key, defaultVal) => {
    const val = configFlat[key];
    return val !== undefined ? val : defaultVal;
  }
});

function detectType(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object') return 'json';
  return 'string';
}

function serializeValue(value) {
  return JSON.stringify(value);
}

function deserializeValue(raw, type) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getIp(req) {
  return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
}

async function auditLog(app, key, event, oldValue, newValue, ip) {
  const db = getDb();
  await db('audit_log').insert({
    app,
    key,
    event,
    old_value: oldValue != null ? String(oldValue) : null,
    new_value: newValue != null ? String(newValue) : null,
    ip,
    created_at: new Date().toISOString(),
  });
}

// GET /health
router.get('/health', async (req, res) => {
  const db = getDb();
  const count = await db('app_registry').count('* as c').first();
  res.json({
    ok: true,
    version: '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    appCount: count?.c || 0,
  });
});

// GET /api/apps
router.get('/api/apps', auth.adminOnly(), async (req, res) => {
  const db = getDb();
  const apps = await db('app_registry').select('*').orderBy('app');
  const configCounts = await db('configs')
    .select('app')
    .count('* as count')
    .groupBy('app');
  const countMap = Object.fromEntries(configCounts.map((r) => [r.app, r.count]));
  res.json(
    apps.map((a) => ({
      ...a,
      config_count: countMap[a.app] || 0,
    }))
  );
});

// DELETE /api/apps/:app
router.delete('/api/apps/:app', auth.adminOnly(), async (req, res) => {
  const db = getDb();
  const { app } = req.params;
  const existing = await db('app_registry').where({ app }).first();
  if (!existing) return res.status(404).json({ error: 'App not found' });

  await db('configs').where({ app }).del();
  await db('app_registry').where({ app }).del();
  await auditLog(app, null, 'DELETE_APP', null, null, getIp(req));
  res.json({ ok: true });
});

// GET /api/config/:app
// Resolution: app-specific values override global values
router.get('/api/config/:app', auth.readOnly(), async (req, res) => {
  const db = getDb();
  const { app } = req.params;
  
  // Load global config first (base layer)
  const globalRows = await db('configs').where({ app: '__global__' });
  const config = {};
  for (const row of globalRows) {
    config[row.key] = deserializeValue(row.value, row.value_type);
  }
  
  // Layer app-specific config on top (overrides globals)
  const appRows = await db('configs').where({ app });
  for (const row of appRows) {
    config[row.key] = deserializeValue(row.value, row.value_type);
  }
  
  // Update last_seen on every config poll so the dashboard shows accurate status
  await db('app_registry').where({ app }).update({ last_seen: new Date().toISOString() }).catch(() => {});
  res.json(config);
});

// PUT /api/config/:app (self-register)
router.put('/api/config/:app', auth.readWrite(), async (req, res) => {
  const db = getDb();
  const { app } = req.params;
  const { config = {}, meta = {} } = req.body;
  const now = new Date().toISOString();
  const ip = getIp(req);

  // Upsert app_registry
  const existing = await db('app_registry').where({ app }).first();
  if (existing) {
    await db('app_registry').where({ app }).update({
      last_seen: now,
      ...(meta.display_name && { display_name: meta.display_name }),
      ...(meta.version && { version: meta.version }),
      ...(meta.base_url && { base_url: meta.base_url }),
    });
  } else {
    await db('app_registry').insert({
      app,
      display_name: meta.display_name || app,
      version: meta.version || '',
      last_seen: now,
      base_url: meta.base_url || '',
    });
    await auditLog(app, null, 'REGISTER', null, null, ip);
  }

  // Insert only new keys
  for (const [key, value] of Object.entries(config)) {
    const existingKey = await db('configs').where({ app, key }).first();
    if (!existingKey) {
      const type = detectType(value);
      await db('configs').insert({
        app,
        key,
        value: serializeValue(value),
        value_type: type,
        description: '',
        is_secret: 0,
        updated_at: now,
        updated_by: 'self-register',
      });
      await auditLog(app, key, 'SET', null, serializeValue(value), ip);
    }
  }

  // Return full stored config
  const rows = await db('configs').where({ app });
  const result = {};
  for (const row of rows) {
    result[row.key] = deserializeValue(row.value, row.value_type);
  }
  res.json(result);
});

// PATCH /api/config/:app/:key
router.patch('/api/config/:app/:key', auth.adminOnly(), async (req, res) => {
  const db = getDb();
  const { app, key } = req.params;
  const { value, is_secret, description } = req.body;
  const now = new Date().toISOString();
  const ip = getIp(req);

  const existing = await db('configs').where({ app, key }).first();
  const oldValue = existing ? existing.value : null;
  const type = detectType(value);

  if (existing) {
    const update = {
      value: serializeValue(value),
      value_type: type,
      updated_at: now,
      updated_by: ip,
    };
    if (is_secret !== undefined) update.is_secret = is_secret ? 1 : 0;
    if (description !== undefined) update.description = description;
    await db('configs').where({ app, key }).update(update);
  } else {
    await db('configs').insert({
      app,
      key,
      value: serializeValue(value),
      value_type: type,
      description: description || '',
      is_secret: is_secret ? 1 : 0,
      updated_at: now,
      updated_by: ip,
    });
  }

  await auditLog(app, key, 'SET', oldValue, serializeValue(value), ip);
  res.json({ ok: true, key, value });
});

// DELETE /api/config/:app/:key
router.delete('/api/config/:app/:key', auth.adminOnly(), async (req, res) => {
  const db = getDb();
  const { app, key } = req.params;
  const ip = getIp(req);

  const existing = await db('configs').where({ app, key }).first();
  if (!existing) return res.status(404).json({ error: 'Key not found' });

  await db('configs').where({ app, key }).del();
  await auditLog(app, key, 'DELETE', existing.value, null, ip);
  res.json({ ok: true });
});

// GET /api/audit
router.get('/api/audit', auth.adminOnly(), async (req, res) => {
  const db = getDb();
  const { app, limit = 50 } = req.query;
  let query = db('audit_log').orderBy('created_at', 'desc').limit(parseInt(limit));
  if (app) query = query.where({ app });
  const rows = await query;
  res.json(rows);
});

// GET /api/config-details/:app (for admin UI - includes metadata)
router.get('/api/config-details/:app', auth.adminOnly(), async (req, res) => {
  const db = getDb();
  const { app } = req.params;
  const rows = await db('configs').where({ app }).orderBy('key');
  res.json(rows);
});

export default router;
