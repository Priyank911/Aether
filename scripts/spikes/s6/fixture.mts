import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { dpapi } from './profile.mjs';

// Match the production SQLite loading pattern for the Vite 5 test runner.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** Synthetic data only; never reads a browser profile. Caller owns directory cleanup. */
export function createFixture(userData: string): { profile: string; fixtureKey?: Buffer } {
  const profile = path.join(userData, 'Default');
  mkdirSync(path.join(profile, 'Network'), { recursive: true });
  writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({ roots: {
    bookmark_bar: { type: 'folder', children: [{ type: 'url', url: 'https://example.invalid/one' }, { type: 'folder', children: [{ type: 'url', url: 'https://example.invalid/two' }] }] },
    other: { type: 'folder', children: [] },
  } }));
  const history = new DatabaseSync(path.join(profile, 'History'));
  try {
    history.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT); INSERT INTO urls VALUES (1,'https://example.invalid/','Synthetic history');");
  } finally { history.close(); }
  const key = randomBytes(32);
  try {
    const protect = (host: string): Buffer => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const input = Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from('synthetic-cookie-value')]);
      try { return Buffer.concat([Buffer.from('v10'), nonce, cipher.update(input), cipher.final(), cipher.getAuthTag()]); }
      finally { input.fill(0); }
    };
    const db = new DatabaseSync(path.join(profile, 'Network', 'Cookies'));
    try {
      db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('version','24'); CREATE TABLE cookies (host_key TEXT, value TEXT, encrypted_value BLOB);");
      const insert = db.prepare('INSERT INTO cookies VALUES (?, ?, ?)');
      insert.run('.example.invalid', '', protect('.example.invalid'));
      const corrupt = protect('.example.invalid');
      corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 1;
      insert.run('.example.invalid', '', corrupt);
      insert.run('.different.invalid', '', protect('.example.invalid'));
      // A prefix sentinel tests reporting, not real App-Bound encryption resistance.
      insert.run('.example.invalid', '', Buffer.concat([Buffer.from('v20'), randomBytes(48)]));
      insert.run('.example.invalid', 'synthetic-plaintext-value', Buffer.alloc(0));
      insert.run('.example.invalid', '', Buffer.from('unsupported-format'));
      if (process.platform === 'win32') insert.run('.example.invalid', '', dpapi('protect', Buffer.from('synthetic-legacy-cookie')));
    } finally { db.close(); }
    if (process.platform === 'win32') {
      writeFileSync(path.join(userData, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), dpapi('protect', key)]).toString('base64') } }));
      return { profile };
    }
    return { profile, fixtureKey: Buffer.from(key) };
  } finally { key.fill(0); }
}
