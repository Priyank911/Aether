'use strict';
/*
 * Spike S9 (docs/PLAN.md section 14, decision D2): which SQLite driver works
 * inside Electron's Node?
 *   - node:sqlite (built in): does it cover what packages/memory uses
 *     (prepare/run/get/all, exec, pragmas, transactions, WAL, incremental
 *     vacuum), and how fast is it?
 *   - better-sqlite3 (current driver, native): does the build made for Node
 *     load in Electron without a rebuild?
 *
 * Run inside Electron as Node:
 *   ELECTRON_RUN_AS_NODE=1 <electron.exe> scripts/spikes/s9-sqlite.cjs
 * and under plain Node for comparison:
 *   node scripts/spikes/s9-sqlite.cjs
 */
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ROWS = 10000;
const report = [`runtime: node ${process.versions.node}${process.versions.electron ? `, electron ${process.versions.electron}` : ''}, modules ABI ${process.versions.modules}`];

function timed(label, body) {
  const started = performance.now();
  const value = body();
  report.push(`  ${label}: ${(performance.now() - started).toFixed(1)} ms`);
  return value;
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'aether-s9-'));
try {
  const { DatabaseSync } = require('node:sqlite');
  report.push(`node:sqlite: loaded (SQLite ${process.versions.sqlite})`);
  const db = new DatabaseSync(path.join(dir, 'node-sqlite.db'));
  db.exec('PRAGMA auto_vacuum = INCREMENTAL');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const mode = db.prepare('PRAGMA journal_mode').get();
  const vacuum = db.prepare('PRAGMA auto_vacuum').get();
  report.push(`  journal_mode=${Object.values(mode)[0]}, auto_vacuum=${Object.values(vacuum)[0]} (2 = incremental)`);
  db.exec(`CREATE TABLE facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('user','agent')), updated_at INTEGER NOT NULL);
           CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
           CREATE INDEX notes_site ON notes (site);`);
  const insert = db.prepare('INSERT INTO notes (site, text, created_at) VALUES (?, ?, ?)');
  timed(`${ROWS} inserts in one transaction (BEGIN/COMMIT by hand; no .transaction() helper)`, () => {
    db.exec('BEGIN');
    try {
      for (let i = 0; i < ROWS; i++) insert.run(`site${i % 50}.example`, `note ${i}`, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  const bySite = db.prepare('SELECT id, text FROM notes WHERE site = ? ORDER BY id DESC LIMIT 5');
  timed('1000 indexed selects', () => {
    for (let i = 0; i < 1000; i++) bySite.all(`site${i % 50}.example`);
  });
  const upsert = db.prepare('INSERT INTO facts (key, value, source, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
  upsert.run('shoe size', '9', 'user', Date.now());
  upsert.run('shoe size', '10', 'user', Date.now());
  const fact = db.prepare('SELECT value FROM facts WHERE key = ?').get('shoe size');
  const changes = db.prepare('DELETE FROM notes WHERE site = ?').run('site1.example');
  report.push(`  upsert read back: ${fact.value}; delete changes=${changes.changes}, lastInsertRowid type=${typeof insert.run('x', 'y', 1).lastInsertRowid}`);
  let constraint = 'not enforced';
  try {
    upsert.run('bad', 'v', 'robot', 1);
  } catch (error) {
    constraint = `enforced (${error.code ?? error.message})`;
  }
  report.push(`  CHECK constraint: ${constraint}`);
  db.exec('PRAGMA incremental_vacuum');
  db.close();
} catch (error) {
  report.push(`node:sqlite: FAILED ${error.message}`);
}

try {
  const Database = require(path.resolve(__dirname, '../../packages/memory/node_modules/better-sqlite3'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (a)');
  report.push('better-sqlite3: loaded and ran without a rebuild');
  db.close();
} catch (error) {
  report.push(`better-sqlite3: FAILED to load: ${String(error.message).split('\n')[0].slice(0, 220)}`);
}

rmSync(dir, { recursive: true, force: true });
console.log(report.join('\n'));
