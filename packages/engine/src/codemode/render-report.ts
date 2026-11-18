import type { ExecReport } from '@aether/codemode';
import { wrapUntrustedOrigins } from '@aether/policy';

/*
 * An aether_exec run as tool text (plan 3.1, section 7.3). Engine facts
 * (status, timing, codes, line numbers) stay outside the wrapper. The script's
 * return value, its error message and its console output go inside the
 * wrapper whenever the run read a page, because a script can copy page text
 * into any of them.
 */

export interface RenderedReport {
  text: string;
  isError: boolean;
  meta: Record<string, unknown>;
}

function pretty(json: string): string {
  try {
    const text = JSON.stringify(JSON.parse(json), null, 1);
    return text.length <= json.length * 1.6 ? text : json;
  } catch {
    return json;
  }
}

export function renderReport(report: ExecReport): RenderedReport {
  const { outcome } = report;
  const space = `Space "${report.spaceName}"`;
  const meta: Record<string, unknown> = { space: report.spaceId, status: outcome.status };
  const logs = report.logs.length > 0 ? `\nconsole:\n${report.logs.join('\n')}` : '';

  if (outcome.status === 'held') {
    meta.token = outcome.token;
    meta.reason = outcome.reason;
    const why = outcome.reason === 'working' ? 'the script is still working' : `waiting for the person (${outcome.reason.replace('_', ' ')})`;
    return {
      text: `held in ${space}: ${why}. Call aether_exec with space "${report.spaceName}" and wait "${outcome.token}" to keep waiting for the result.`,
      isError: false,
      meta,
    };
  }
  if (outcome.status === 'stopped') {
    return {
      text: outcome.by === 'person' ? `stopped in ${space}: the person stopped this run. Do not continue; call aether_done with what you have.` : `stopped in ${space}: ${outcome.message}.`,
      isError: true,
      meta,
    };
  }
  if (outcome.status === 'error') {
    const where = outcome.line ? ` at line ${outcome.line}${outcome.column ? `:${outcome.column}` : ''}` : '';
    const head = `error in ${space}${where}:`;
    const body = `${outcome.message}${logs}`;
    return { text: outcome.untrusted ? `${head}\n${wrapUntrustedOrigins(body, outcome.origins)}` : `${head} ${body}`, isError: true, meta };
  }
  meta.durationMs = outcome.durationMs;
  const head = `done in ${space} in ${(outcome.durationMs / 1000).toFixed(1)} s`;
  if (outcome.json === undefined && !logs) return { text: `${head}; the script returned nothing.`, isError: false, meta };
  const body = `${outcome.json === undefined ? '(no return value)' : pretty(outcome.json)}${logs}`;
  return { text: outcome.untrusted ? `${head}:\n${wrapUntrustedOrigins(body, outcome.origins)}` : `${head}:\n${body}`, isError: false, meta };
}
