const BLOCKED_SCHEMES = new Set([
  'chrome:',
  'chrome-extension:',
  'file:',
  'view-source:',
  'devtools:',
  'javascript:',
  'data:',
]);

export interface UrlBoundaryResult {
  allowed: boolean;
  reason?: string;
}

export class UrlBoundary {
  public static check(rawUrl: string): UrlBoundaryResult {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return { allowed: false, reason: 'URL cannot be empty' };
    }

    if (trimmed === 'about:blank') {
      return { allowed: true };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { allowed: false, reason: `Invalid URL format: ${trimmed}` };
    }

    const scheme = parsed.protocol.toLowerCase();

    if (BLOCKED_SCHEMES.has(scheme)) {
      return {
        allowed: false,
        reason: `Access to ${scheme}// protocol is blocked by Aether security policy`,
      };
    }

    if (scheme === 'about:' && trimmed !== 'about:blank') {
      return {
        allowed: false,
        reason: `Access to about: pages other than about:blank is blocked by policy`,
      };
    }

    if (scheme !== 'http:' && scheme !== 'https:') {
      return {
        allowed: false,
        reason: `Navigation is restricted to http, https, and about:blank (got ${scheme})`,
      };
    }

    return { allowed: true };
  }
}
