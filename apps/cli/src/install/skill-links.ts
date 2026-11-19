import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Host skill links (plan 3.2, section 8.0 and task 3.7). One folder,
 * skills/aether, is linked into every installed host's skills directory so
 * the person configures nothing per host. On Windows the link is a junction
 * (no admin rights); elsewhere a directory symlink. A host whose folder is
 * missing is skipped, never created; a folder named `aether` that is not our
 * link is left alone and reported.
 */

export interface LinkPlan {
  host: string;
  /** The host's own folder; the link is skipped when it does not exist. */
  hostDir: string;
  /** Where the `aether` link goes. */
  link: string;
}

/** host name, the folder that proves the host is installed, and the link path, all under the home directory. */
const HOSTS: ReadonlyArray<readonly [string, string[], string[]]> = [
  ['Claude Code', ['.claude'], ['.claude', 'skills', 'aether']],
  ['VS Code Copilot', ['.copilot'], ['.copilot', 'skills', 'aether']],
  ['Agent skills', ['.agents'], ['.agents', 'skills', 'aether']],
  ['Antigravity config', ['.gemini'], ['.gemini', 'config', 'skills', 'aether']],
  ['Antigravity CLI', ['.gemini', 'antigravity-cli'], ['.gemini', 'antigravity-cli', 'skills', 'aether']],
  ['opencode', ['.config', 'opencode'], ['.config', 'opencode', 'skills', 'aether']],
];

export function linkPlans(home: string): LinkPlan[] {
  return HOSTS.map(([host, hostDir, link]) => ({
    host,
    hostDir: path.join(home, ...hostDir),
    link: path.join(home, ...link),
  }));
}

/** The shipped skill folder: <repo>/skills/aether, resolved from this file's location. */
export function skillSourceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/cli/{src,dist}/install -> apps/cli -> apps -> repo root
  return path.resolve(here, '..', '..', '..', '..', 'skills', 'aether');
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Where a symlink or junction points, without requiring the target to exist. */
function linkTarget(link: string): string | undefined {
  try {
    return path.resolve(path.dirname(link), readlinkSync(link));
  } catch {
    return undefined;
  }
}

function isOurLink(link: string, source: string): boolean {
  try {
    if (!lstatSync(link).isSymbolicLink()) return false;
  } catch {
    return false;
  }
  const target = linkTarget(link);
  if (!target) return false;
  if (samePath(target, source)) return true;
  try {
    return samePath(realpathSync(target), realpathSync(source));
  } catch {
    return false;
  }
}

export type LinkStatus = 'missing-host' | 'linked' | 'missing' | 'foreign' | 'broken';

export interface LinkState extends LinkPlan {
  status: LinkStatus;
}

/** Classify every host link without changing anything. */
export function checkLinks(home: string, source: string): LinkState[] {
  return linkPlans(home).map((plan) => {
    if (!existsSync(plan.hostDir)) return { ...plan, status: 'missing-host' };
    if (!existsSync(plan.link) && !isSymlink(plan.link)) return { ...plan, status: 'missing' };
    if (isOurLink(plan.link, source)) return { ...plan, status: 'linked' };
    // A link that dangles, or a real folder: either way it is not ours to touch.
    return { ...plan, status: lstatSync(plan.link).isSymbolicLink() ? 'broken' : 'foreign' };
  });
}

function isSymlink(link: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink();
  } catch {
    return false;
  }
}

export interface LinkReport {
  host: string;
  link: string;
  action: 'linked' | 'already' | 'skipped' | 'foreign' | 'removed' | 'kept' | 'missing-host';
  detail?: string;
}

/** Create the links for every installed host. Idempotent. */
export function installLinks(home: string, source: string): LinkReport[] {
  const reports: LinkReport[] = [];
  for (const plan of checkLinks(home, source)) {
    if (plan.status === 'missing-host') {
      reports.push({ host: plan.host, link: plan.link, action: 'skipped', detail: 'host not installed' });
      continue;
    }
    if (plan.status === 'linked') {
      reports.push({ host: plan.host, link: plan.link, action: 'already' });
      continue;
    }
    if (plan.status === 'foreign' || plan.status === 'broken') {
      reports.push({ host: plan.host, link: plan.link, action: 'foreign', detail: 'a folder or link that is not Aether\'s was left alone' });
      continue;
    }
    mkdirSync(path.dirname(plan.link), { recursive: true });
    symlinkSync(source, plan.link, process.platform === 'win32' ? 'junction' : 'dir');
    reports.push({ host: plan.host, link: plan.link, action: 'linked' });
  }
  return reports;
}

/** Remove only the links that point at our skill folder. */
export function uninstallLinks(home: string, source: string): LinkReport[] {
  const reports: LinkReport[] = [];
  for (const plan of linkPlans(home)) {
    if (!existsSync(plan.link) && !isSymlink(plan.link)) continue;
    if (isOurLink(plan.link, source)) {
      rmSync(plan.link, { force: true });
      reports.push({ host: plan.host, link: plan.link, action: 'removed' });
    } else {
      reports.push({ host: plan.host, link: plan.link, action: 'kept', detail: 'not Aether\'s link' });
    }
  }
  return reports;
}

export function userHome(): string {
  return homedir();
}
