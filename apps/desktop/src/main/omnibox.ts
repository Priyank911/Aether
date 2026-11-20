/*
 * What the person typed in the address bar, as a URL to load. A full http(s)
 * URL loads as it is; something that looks like a host gets https:// (or
 * http:// for localhost and plain IP addresses); anything else is a search.
 * Other schemes (file:, javascript:, data:, chrome:) are never loaded from
 * the address bar in this step.
 */

export const SEARCH_URL = 'https://www.google.com/search?q=';

const HOST_LIKE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i;
const LOCAL = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:[/?#].*)?$/i;
const IP = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/;

export type OmniboxResult = { kind: 'url'; url: string } | { kind: 'search'; url: string } | { kind: 'refused'; reason: string };

export function resolveInput(raw: string): OmniboxResult {
  const text = raw.trim();
  if (!text) return { kind: 'refused', reason: 'nothing typed' };
  if (/^aether:\/\/(newtab|history|about|settings)\/?$/i.test(text)) return { kind: 'url', url: `${text.replace(/\/$/, '').toLowerCase()}/` };
  if (/^about:blank$/i.test(text)) return { kind: 'url', url: 'about:blank' };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try {
      return { kind: 'url', url: new URL(text).href };
    } catch {
      return { kind: 'search', url: `${SEARCH_URL}${encodeURIComponent(text)}` };
    }
  }
  if (!/\s/.test(text)) {
    if (LOCAL.test(text) || IP.test(text)) return { kind: 'url', url: new URL(`http://${text}`).href };
    if (HOST_LIKE.test(text)) return { kind: 'url', url: new URL(`https://${text}`).href };
  }
  if (scheme && !/\s/.test(text) && !/^[a-z0-9-]+:\d/i.test(text)) {
    return { kind: 'refused', reason: `${scheme}: addresses are not opened from the address bar` };
  }
  return { kind: 'search', url: `${SEARCH_URL}${encodeURIComponent(text)}` };
}
