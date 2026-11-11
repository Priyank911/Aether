import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/** The database handle type, so callers need no direct dependency on better-sqlite3. */
export type DatabaseHandle = Database.Database;

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
`;

/** Open the local database and create the schema. ':memory:' is accepted for tests. */
export function openDatabase(file = DEFAULT_DATABASE_PATH): Database.Database {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
