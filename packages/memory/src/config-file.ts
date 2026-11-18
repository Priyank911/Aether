import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { AetherConfigSchema, DEFAULT_CONFIG, type AetherConfig } from '@aether/shared';

/*
 * ~/.aether/config.json, the person's settings. Read on use, cached by
 * modification time, so a change in the file (or, from Step 4, the Settings
 * page) applies to the next page without a restart. A missing file means the
 * defaults; a broken file means the defaults plus one warning, never a crash.
 */

export const CONFIG_PATH = path.join(homedir(), '.aether', 'config.json');

export interface ConfigSource {
  read(): AetherConfig;
}

export function fileConfig(file = CONFIG_PATH, warn: (message: string) => void = () => undefined): ConfigSource {
  let cached: { mtimeMs: number; config: AetherConfig } | undefined;
  let warned = '';
  return {
    read(): AetherConfig {
      let mtimeMs: number;
      try {
        mtimeMs = statSync(file).mtimeMs;
      } catch {
        return DEFAULT_CONFIG;
      }
      if (cached?.mtimeMs === mtimeMs) return cached.config;
      let config = DEFAULT_CONFIG;
      try {
        const parsed = AetherConfigSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
        if (parsed.success) config = parsed.data;
        else {
          const problem = `${file}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}; using the defaults`;
          if (problem !== warned) warn(problem);
          warned = problem;
        }
      } catch (error) {
        const problem = `${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}); using the defaults`;
        if (problem !== warned) warn(problem);
        warned = problem;
      }
      cached = { mtimeMs, config };
      return config;
    },
  };
}

/** Fixed settings, for tests. */
export function staticConfig(config: Partial<AetherConfig>): ConfigSource {
  const value = AetherConfigSchema.parse(config);
  return { read: () => value };
}
