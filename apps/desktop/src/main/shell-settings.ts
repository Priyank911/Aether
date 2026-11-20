import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { ConfigSource, MemoryStore } from '@aether/memory';
import { ShellSettingsSchema, type ShellSettings } from '@aether/shared';

/** Human-only settings adapter. No service, Code Mode or page preload exposes it. */
export class ShellSettingsStore {
  public constructor(private readonly file: string, private readonly config: ConfigSource, private readonly memory: MemoryStore) {}

  public read(): ShellSettings {
    return { ...this.config.read(), memoryEnabled: this.memory.enabled };
  }

  public save(raw: ShellSettings): void {
    const settings = ShellSettingsSchema.parse(raw);
    let existing: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be a JSON object.');
      existing = value as Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('The existing config.json could not be read. Fix that file before saving settings.');
    }
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify({ ...existing, cookieBanners: settings.cookieBanners, minFreeMemoryRatio: settings.minFreeMemoryRatio }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.file);
      this.memory.setEnabled(settings.memoryEnabled);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Preserve the original save failure if cleanup also fails. */ }
      throw error;
    }
  }
}
