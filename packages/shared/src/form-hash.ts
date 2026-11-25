import { createHash } from 'node:crypto';

/**
 * Deterministic hash for an input field to enable local token-free autofill
 * and field-by-field guided prompt matching.
 */
export function hashFormField(
  site: string,
  formAction: string,
  name: string,
  role: string,
  autocomplete?: string,
): string {
  const normSite = site.trim().toLowerCase().replace(/^www\./, '');
  const normAction = (formAction || '').trim().toLowerCase().split('?')[0] ?? '';
  const normName = (name || '').trim().toLowerCase();
  const normRole = (role || '').trim().toLowerCase();
  const normAuto = (autocomplete ?? '').trim().toLowerCase();
  return createHash('sha256')
    .update(`${normSite}|${normAction}|${normName}|${normRole}|${normAuto}`)
    .digest('hex')
    .slice(0, 16);
}
