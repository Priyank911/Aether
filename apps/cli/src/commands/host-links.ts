import { installLinks, skillSourceDir, uninstallLinks, userHome } from '../install/skill-links.js';
import { EXIT } from './aether-home.js';

/*
 * `aether install-skill` / `aether uninstall-skill` (plan 3.2, task 3.7):
 * link skills/aether into every installed host's skills directory, or remove
 * only Aether's own links. Each target is reported; nothing is invented for
 * a host that is not installed.
 */

function print(reports: ReturnType<typeof installLinks>): number {
  let failed = 0;
  for (const report of reports) {
    const line = `${report.action === 'linked' || report.action === 'removed' ? 'ok  ' : report.action === 'already' || report.action === 'skipped' ? '....' : 'warn'}  ${report.host}: ${report.link}${report.detail ? ` (${report.detail})` : ''}`;
    process.stdout.write(`${line}\n`);
    if (report.action === 'foreign') failed++;
  }
  return failed;
}

export function runInstallSkill(): number {
  const source = skillSourceDir();
  const reports = installLinks(userHome(), source);
  const foreign = print(reports);
  const linked = reports.filter((report) => report.action === 'linked' || report.action === 'already').length;
  process.stdout.write(`\n${linked} host${linked === 1 ? '' : 's'} linked to ${source}\n`);
  return foreign > 0 ? EXIT.failed : EXIT.done;
}

export function runUninstallSkill(): number {
  const reports = uninstallLinks(userHome(), skillSourceDir());
  print(reports);
  const removed = reports.filter((report) => report.action === 'removed').length;
  process.stdout.write(`\n${removed} link${removed === 1 ? '' : 's'} removed\n`);
  return EXIT.done;
}
