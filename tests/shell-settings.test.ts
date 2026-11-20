import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileConfig, MemoryStore, openDatabase, type DatabaseHandle } from '@aether/memory';
import { ShellSettingsStore } from '../apps/desktop/src/main/shell-settings.js';

const homes: string[] = [];
const databases: DatabaseHandle[] = [];
function setup() {
  const home = mkdtempSync(path.join(tmpdir(), 'aether-settings-')); homes.push(home);
  const file = path.join(home, 'config.json');
  const db = openDatabase(':memory:'); databases.push(db);
  const memory = new MemoryStore(db);
  const store = new ShellSettingsStore(file, fileConfig(file), memory);
  return { home, file, store, memory };
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const home of homes.splice(0)) rmSync(home, {recursive:true,force:true}); });

describe('human settings persistence', () => {
  it('reads defaults without creating a config file', () => {
    const {file,store}=setup();
    expect(store.read()).toEqual({cookieBanners:'reject',minFreeMemoryRatio:.2,memoryEnabled:true});
    expect(existsSync(file)).toBe(false);
  });
  it('atomically writes validated settings, preserves other keys and uses the existing memory switch', () => {
    const {home,file,store,memory}=setup();
    writeFileSync(file,JSON.stringify({otherPreference:'keep'}));
    memory.saveFact('currency','INR','user');
    store.save({cookieBanners:'off',minFreeMemoryRatio:.35,memoryEnabled:false});
    expect(JSON.parse(readFileSync(file,'utf8'))).toEqual({otherPreference:'keep',cookieBanners:'off',minFreeMemoryRatio:.35});
    expect(store.read()).toEqual({cookieBanners:'off',minFreeMemoryRatio:.35,memoryEnabled:false});
    expect(memory.facts()).toHaveLength(1);
    expect(memory.recall({})).toEqual({trusted:[],untrusted:[]});
    expect(readdirSync(home)).toEqual(['config.json']);
  });
  it('does not overwrite invalid JSON or save out-of-range settings', () => {
    const {home,file,store}=setup();
    expect(()=>store.save({cookieBanners:'accept',minFreeMemoryRatio:.99,memoryEnabled:true})).toThrow();
    expect(readdirSync(home)).toEqual([]);
    writeFileSync(file,'{unfinished');
    expect(()=>store.save({cookieBanners:'accept',minFreeMemoryRatio:.2,memoryEnabled:true})).toThrow(/existing config.json/);
    expect(readFileSync(file,'utf8')).toBe('{unfinished');
  });
});
