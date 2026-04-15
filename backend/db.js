import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env'), override: true });
const provider = (process.env.DATABASE_PROVIDER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')).toLowerCase();

let sqlite = null;
let pool = null;
let initialized = false;

if (provider === 'postgres') {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
} else {
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'database.sqlite');
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
}

export async function initDatabase() {
  if (initialized) return;
  if (provider === 'postgres') {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS memories (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('short_term', 'long_term', 'episodic')),
        key TEXT,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notes (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS favorite_tracks (
        id SERIAL PRIMARY KEY,
        title TEXT,
        url TEXT NOT NULL,
        play_order INTEGER NOT NULL DEFAULT 0,
        last_played_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id BIGSERIAL PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_key TEXT UNIQUE NOT NULL,
        secret_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'revoked')),
        last_seen_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE devices ADD COLUMN IF NOT EXISTS secret_hash TEXT;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

      CREATE TABLE IF NOT EXISTS commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'running', 'success', 'error', 'cancelled')),
        type TEXT NOT NULL,
        payload JSONB DEFAULT '{}'::jsonb,
        result JSONB DEFAULT '{}'::jsonb,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor TEXT NOT NULL DEFAULT 'jarvis',
        action TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } else {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('short_term', 'long_term', 'episodic')),
        key TEXT,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS favorite_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        url TEXT NOT NULL,
        play_order INTEGER NOT NULL DEFAULT 0,
        last_played_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        device_key TEXT UNIQUE NOT NULL,
        secret_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'revoked')),
        last_seen_at TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'running', 'success', 'error', 'cancelled')),
        type TEXT NOT NULL,
        payload TEXT DEFAULT '{}',
        result TEXT DEFAULT '{}',
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL DEFAULT 'jarvis',
        action TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    migrateSqliteDeviceColumns();
  }
  initialized = true;
}

export async function query(sql, params = []) {
  await initDatabase();
  if (provider === 'postgres') {
    return pool.query(sql, params);
  }
  return runSqlite(sql, params);
}

export function dbProvider() {
  return provider;
}

export function nowIso() {
  return new Date().toISOString();
}

function runSqlite(sql, params = []) {
  const normalized = sql
    .replace(/\$(\d+)/g, '?')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/::jsonb/g, '');
  const sqliteParams = params.map((value) => {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
  const statement = sqlite.prepare(normalized);
  const command = normalized.trim().split(/\s+/)[0].toUpperCase();

  if (command === 'SELECT' || /\bRETURNING\b/i.test(normalized)) {
    return { rows: statement.all(...sqliteParams), rowCount: 0 };
  }

  const info = statement.run(...sqliteParams);
  return {
    rows: info.lastInsertRowid ? [{ id: info.lastInsertRowid }] : [],
    rowCount: info.changes
  };
}

function migrateSqliteDeviceColumns() {
  const columns = sqlite.prepare('PRAGMA table_info(devices)').all().map((column) => column.name);
  if (!columns.includes('secret_hash')) {
    sqlite.exec("ALTER TABLE devices ADD COLUMN secret_hash TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes('is_default')) {
    sqlite.exec('ALTER TABLE devices ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
  }
}
