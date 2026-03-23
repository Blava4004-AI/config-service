import knex from 'knex';
import path from 'path';
import fs from 'fs';

let db;

export function initDb(filename) {
  const dbPath = path.resolve(process.cwd(), filename);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = knex({
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
  });
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export async function migrate(db) {
  const hasConfigs = await db.schema.hasTable('configs');
  if (!hasConfigs) {
    await db.schema.createTable('configs', (t) => {
      t.increments('id').primary();
      t.text('app').notNullable();
      t.text('key').notNullable();
      t.text('value');
      t.text('value_type').defaultTo('string');
      t.text('description').defaultTo('');
      t.integer('is_secret').defaultTo(0);
      t.text('updated_at');
      t.text('updated_by').defaultTo('');
      t.unique(['app', 'key']);
    });
  }

  const hasRegistry = await db.schema.hasTable('app_registry');
  if (!hasRegistry) {
    await db.schema.createTable('app_registry', (t) => {
      t.increments('id').primary();
      t.text('app').unique().notNullable();
      t.text('display_name').defaultTo('');
      t.text('version').defaultTo('');
      t.text('last_seen');
      t.text('base_url').defaultTo('');
    });
  }

  const hasAudit = await db.schema.hasTable('audit_log');
  if (!hasAudit) {
    await db.schema.createTable('audit_log', (t) => {
      t.increments('id').primary();
      t.text('app');
      t.text('key');
      t.text('event');
      t.text('old_value');
      t.text('new_value');
      t.text('ip');
      t.text('created_at');
    });
  }
}
