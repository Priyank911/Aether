import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CODEMODE_INSTRUCTIONS } from '../src/codemode/instructions.js';
import { SPACE_SDK_DECLARATION } from '../src/codemode/sdk-declaration.js';
import { AETHER_EXEC_DESCRIPTION } from '../src/codemode/codemode-server.js';

/*
 * Plan 3.2, section 8.2: the working method lives in three places that must
 * never disagree — `aether skill` (reached from skills/aether/SKILL.md in
 * every host), the MCP server instructions, and the aether_exec description.
 * One source feeds all three; this test pins that.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILL_MD = path.join(REPO_ROOT, 'skills', 'aether', 'SKILL.md');
const CLI = path.join(REPO_ROOT, 'apps', 'cli', 'dist', 'index.js');

describe('the skill and method text (Phase 3.6)', () => {
  it('skills/aether/SKILL.md is a bootstrap under 1500 characters that points at `aether skill`', () => {
    const text = readFileSync(SKILL_MD, 'utf8');
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).toMatch(/^---\r?\nname: aether\r?\ndescription: .+\r?\n---/);
    expect(text).toContain('`aether skill`');
    expect(text).toContain('aether exec');
    expect(text).toContain('aether done');
  });

  it('`aether skill` prints the method and the SDK declaration verbatim', () => {
    const run = spawnSync(process.execPath, [CLI, 'skill'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(CODEMODE_INSTRUCTIONS);
    expect(run.stdout).toContain(SPACE_SDK_DECLARATION);
    expect(run.stdout.indexOf(CODEMODE_INSTRUCTIONS)).toBeLessThan(run.stdout.indexOf(SPACE_SDK_DECLARATION));
  });

  it('the aether_exec description carries the same SDK declaration', () => {
    expect(AETHER_EXEC_DESCRIPTION).toContain(SPACE_SDK_DECLARATION);
  });

  it('the method names the six rules the host must follow', () => {
    for (const rule of ['Restate every criterion', 'Sort and filter', 'Shortlist at least 3', 'space.ask', "risk \"irreversible\"", 'untrusted']) {
      expect(CODEMODE_INSTRUCTIONS).toContain(rule);
    }
  });
});
