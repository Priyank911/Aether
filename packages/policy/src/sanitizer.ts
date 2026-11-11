import { randomBytes } from 'node:crypto';

const WRAPPER_TAG = /<\s*\/?\s*page\s+untrusted[^>]*>/gi;
const ROLE_TOKENS: Array<[RegExp, string]> = [
  [/<\|im_start\|>/gi, '[escaped_im_start]'],
  [/<\|im_end\|>/gi, '[escaped_im_end]'],
  [/\[INST\]/gi, '[escaped_INST]'],
  [/\[\/INST\]/gi, '[escaped_/INST]'],
];

/** Neutralize wrapper tags and chat role tokens inside page-derived text. */
export function sanitizeUntrusted(rawText: string): string {
  if (!rawText) return '';
  let sanitized = rawText.replace(WRAPPER_TAG, (tag) => tag.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  for (const [pattern, replacement] of ROLE_TOKENS) sanitized = sanitized.replace(pattern, replacement);
  return sanitized;
}

function originOf(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? url.split(/[?#]/)[0] ?? 'unknown' : origin;
  } catch {
    return 'unknown';
  }
}

/**
 * Enclose page-derived text in the untrusted wrapper. The random nonce appears
 * on both tags, so text inside cannot close the wrapper even if sanitizing
 * missed a variant.
 */
export function wrapUntrusted(text: string, url?: string, nonce = randomBytes(6).toString('hex')): string {
  return `<page untrusted nonce=${nonce} origin=${originOf(url)}>\n${sanitizeUntrusted(text)}\n</page untrusted nonce=${nonce}>`;
}

export const ContentSanitizer = { sanitize: sanitizeUntrusted, wrapUntrusted };
