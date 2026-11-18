import { homedir } from 'node:os';
import path from 'node:path';

/*
 * Where Aether Desktop keeps its files: ~/.aether, shared with the CLI
 * (memory database, settings, log). AETHER_HOME moves all of it, so tests
 * never touch the person's own profile.
 */

export interface AetherPaths {
  home: string;
  database: string;
  config: string;
  /** Electron's own profile: cookies, cache, local storage. */
  profile: string;
}

export function aetherPaths(env: NodeJS.ProcessEnv = process.env): AetherPaths {
  const home = env.AETHER_HOME ? path.resolve(env.AETHER_HOME) : path.join(homedir(), '.aether');
  return {
    home,
    database: path.join(home, 'aether.db'),
    config: path.join(home, 'config.json'),
    profile: path.join(home, 'profile'),
  };
}
