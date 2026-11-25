import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/*
 * Loaded at run time rather than imported: Vite 5 (under vitest) rewrites
 * `node:sqlite` to `sqlite`, which does not exist, because it predates this
 * prefix-only builtin. Node and Electron load it the same either way.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

/**
 * The database handle. node:sqlite is built into Node and Electron, so the
 * same code runs in the CLI and in Aether Desktop with no native module to
 * rebuild (decision D2, spike S9).
 */
export type DatabaseHandle = DatabaseSync;

export const DEFAULT_DATABASE_PATH = path.join(homedir(), '.aether', 'aether.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS facts (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'agent')),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_site ON notes (site);
CREATE TABLE IF NOT EXISTS procedures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  goal TEXT NOT NULL,
  steps TEXT NOT NULL,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (site, goal)
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  success INTEGER,
  result TEXT
);
CREATE TABLE IF NOT EXISTS run_steps (
  run_id TEXT NOT NULL REFERENCES runs (id),
  step INTEGER NOT NULL,
  tool TEXT NOT NULL,
  label TEXT NOT NULL,
  result_tokens INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS run_steps_run ON run_steps (run_id);
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  partition TEXT NOT NULL CHECK (partition IN ('persist', 'ephemeral')),
  created_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  active_tab TEXT
);
CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  favicon TEXT,
  scroll_y REAL NOT NULL DEFAULT 0,
  last_viewed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tabs_space ON tabs (space_id, position);
CREATE TABLE IF NOT EXISTS space_state (
  space_id TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (space_id, key)
);
CREATE TABLE IF NOT EXISTS form_inputs (
  field_hash TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS form_inputs_site ON form_inputs (site);
`;

/** Open the local database and create the schema. ':memory:' is accepted for tests. */
export function openDatabase(file = DEFAULT_DATABASE_PATH): DatabaseHandle {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // auto_vacuum takes effect only on a new database (plan 3.1, section 11.3); an existing one keeps its mode.
  db.exec('PRAGMA auto_vacuum = INCREMENTAL');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Run a body in one transaction: committed if it returns, rolled back if it throws. */
export function inTransaction<T>(db: DatabaseHandle, body: () => T): T {
  db.exec('BEGIN');
  try {
    const result = body();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
