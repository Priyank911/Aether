/*
 * Hosts whose requests are blocked in Agent Spaces (plan 3.1, section 5.2):
 * ad, tracking and data-sync frames that cost memory and time and that the
 * agent never needs. Hand-kept and short on purpose; no third-party filter
 * list is bundled, because of their licence terms. A host matches itself and
 * every subdomain.
 */

const BLOCKED_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'google-analytics.com',
  'googletagservices.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'scorecardresearch.com',
  'quantserve.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'moatads.com',
  'adsrvr.org',
  'bidswitch.net',
  'demdex.net',
  'everesttech.net',
  'krxd.net',
  'bluekai.com',
  'mathtag.com',
  'hotjar.com',
  'facebook.net',
] as const;

/** True when requests to this URL's host are blocked for Agent Spaces. */
export function isBlockedHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}
