import { randomUUID } from 'node:crypto';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ImportProfile } from '@aether/shared';

export interface LocalProfile { public: ImportProfile; directory: string }

/** Conventional OS locations, resolved for the current person; no device-specific paths. */
export function chromeRoots(platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') return [path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')];
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')];
  return [path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'google-chrome')];
}

export async function readable(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export async function profileAt(directory: string, name = path.basename(directory)): Promise<LocalProfile | undefined> {
  try {
    const resolved = await realpath(directory);
    if (!(await stat(resolved)).isDirectory()) return undefined;
    if (!(await Promise.all(['Bookmarks', 'History', path.join('Network', 'Cookies'), 'Cookies'].map(file => readable(path.join(resolved, file))))).some(Boolean)) return undefined;
    return { public: { id: randomUUID(), name: name.slice(0, 256), browser: 'Chrome' }, directory: resolved };
  } catch { return undefined; }
}

export async function discoverChromeProfiles(roots = chromeRoots()): Promise<LocalProfile[]> {
  const profiles: LocalProfile[] = [];
  for (const root of roots) {
    let names: Record<string, { name?: string }> = {};
    try {
      const file = path.join(root, 'Local State');
      if ((await stat(file)).size < 32 * 1024 * 1024) {
        const state = z.object({ profile: z.object({ info_cache: z.record(z.string(), z.object({ name: z.string().optional() })) }) }).parse(JSON.parse(await readFile(file, 'utf8')));
        names = state.profile.info_cache;
      }
    } catch { /* Directory discovery still works when Local State is absent or unreadable. */ }
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !(entry.name === 'Default' || /^Profile \d+$/.test(entry.name))) continue;
        const profile = await profileAt(path.join(root, entry.name), names[entry.name]?.name || entry.name);
        if (profile && !profiles.some(item => item.directory === profile.directory)) profiles.push(profile);
      }
    } catch { /* An absent browser installation is an ordinary empty state. */ }
  }
  return profiles.sort((a, b) => a.public.name.localeCompare(b.public.name));
}
