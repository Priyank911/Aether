import { CODEMODE_LIMITS } from '@aether/shared';

/*
 * Structured returns pass through whole (plan 3.1, section 7.4). Only a
 * runaway blob is refused, with a message asking for fewer fields; nothing is
 * ever cut in the middle.
 */

function largestString(value: unknown, depth = 0): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (depth > 64 || value === null || typeof value !== 'object') return 0;
  let largest = 0;
  for (const entry of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    largest = Math.max(largest, largestString(entry, depth + 1));
  }
  return largest;
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** Returns the problem in words, or undefined when the JSON text may be returned as it is. */
export function returnProblem(json: string): string | undefined {
  const total = Buffer.byteLength(json, 'utf8');
  if (total > CODEMODE_LIMITS.maxReturnBytes) {
    return `the return value is ${kb(total)}, over the ${kb(CODEMODE_LIMITS.maxReturnBytes)} limit; return only the fields you need (for example titles, prices and refs) instead of whole page text`;
  }
  const largest = largestString(JSON.parse(json));
  if (largest > CODEMODE_LIMITS.maxStringBytes) {
    return `one returned string is ${kb(largest)}, over the ${kb(CODEMODE_LIMITS.maxStringBytes)} limit; return a slice or the parts you need`;
  }
  return undefined;
}
