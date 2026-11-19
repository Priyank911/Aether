import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLinks, installLinks, uninstallLinks } from '../src/install/skill-links.js';

/*
 * Phase 3.7 (plan 3.2, task 3.7): install-skill and uninstall-skill over a
 * temp home — create, repeat, foreign folder left alone, missing host
 * skipped, and uninstall removes only Aether's own links.
 */

let home: string;
let source: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'aether-links-'));
  source = path.join(home, 'skill-src');
  mkdirSync(source, { recursive: true });
  writeFileSync(path.join(source, 'SKILL.md'), '# aether');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const claudeLink = () => path.join(home, '.claude', 'skills', 'aether');

describe('host skill links (Phase 3.7)', () => {
  it('skips every host that is not installed', () => {
    const reports = installLinks(home, source);
    expect(reports).toHaveLength(6);
    expect(reports.every((report) => report.action === 'skipped')).toBe(true);
    expect(existsSync(path.join(home, '.claude'))).toBe(false);
  });

  it('links into an installed host and is idempotent on a repeat run', () => {
    mkdirSync(path.join(home, '.claude'), { recursive: true });
    const first = installLinks(home, source);
    const claude = first.find((report) => report.host === 'Claude Code');
    expect(claude?.action).toBe('linked');
    expect(lstatSync(claudeLink()).isSymbolicLink()).toBe(true);
    expect(realpathSync(claudeLink())).toBe(realpathSync(source));

    const second = installLinks(home, source);
    expect(second.find((report) => report.host === 'Claude Code')?.action).toBe('already');
    expect(checkLinks(home, source).find((state) => state.host === 'Claude Code')?.status).toBe('linked');
  });

  it('leaves a foreign folder named aether alone and reports it', () => {
    mkdirSync(path.join(home, '.copilot', 'skills', 'aether'), { recursive: true });
    writeFileSync(path.join(home, '.copilot', 'skills', 'aether', 'NOTES.txt'), 'mine');
    const reports = installLinks(home, source);
    const vscode = reports.find((report) => report.host === 'VS Code Copilot');
    expect(vscode?.action).toBe('foreign');
    expect(existsSync(path.join(home, '.copilot', 'skills', 'aether', 'NOTES.txt'))).toBe(true);
    expect(lstatSync(path.join(home, '.copilot', 'skills', 'aether')).isSymbolicLink()).toBe(false);
  });

  it('uninstall removes only Aether links and keeps foreign folders', () => {
    mkdirSync(path.join(home, '.claude'), { recursive: true });
    mkdirSync(path.join(home, '.copilot', 'skills', 'aether'), { recursive: true });
    installLinks(home, source);
    const reports = uninstallLinks(home, source);
    expect(reports.find((report) => report.host === 'Claude Code')?.action).toBe('removed');
    expect(existsSync(claudeLink())).toBe(false);
    const vscode = reports.find((report) => report.host === 'VS Code Copilot');
    expect(vscode?.action).toBe('kept');
    expect(existsSync(path.join(home, '.copilot', 'skills', 'aether'))).toBe(true);
  });
});
