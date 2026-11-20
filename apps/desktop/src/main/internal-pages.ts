import type { Session } from 'electron';
import type { NavigationEntry, Space } from '@aether/shared';

const installed = new WeakSet<Session>();

export const NEW_TAB_URL = 'aether://newtab/';
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const glyphs = [
  ['01110','11011','11011','11111','11011','11011','11011'],
  ['00000','00000','01110','11011','11111','11000','01110'],
  ['01100','01100','11110','01100','01100','01101','00110'],
  ['11000','11000','11110','11011','11011','11011','11011'],
  ['00000','00000','01110','11011','11111','11000','01110'],
  ['00000','00000','11010','11101','11000','11000','11000'],
];

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function internalDocument(title: string, body: string, css = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${escapeHtml(title)}</title><style>
  :root{color-scheme:dark;--canvas:#111111;--ink:#ffffff;--muted:#a2a7b0;--line:#333438;--focus:#7aa2ff;--card:#1b1c1f}
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--canvas);color:var(--ink);font:14px/1.6 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}body{min-height:100vh}a{color:inherit}button,a,input{font:inherit}a:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:5px}main.document{max-width:860px;margin:0 auto;padding:64px 32px}h1{font-size:28px;letter-spacing:-.025em}p{color:var(--muted)}.action{display:inline-block;margin:8px 8px 0 0;padding:8px 16px;background:var(--card);border:1px solid var(--line);border-radius:6px;text-decoration:none}li{margin:16px 0;overflow-wrap:anywhere}small{color:var(--muted)}${css}</style></head><body>${body}</body></html>`;
}

/** No script and no preload: internal pages have no shell or Node capabilities. */
export function newTabDocument(spaces: readonly Space[], importOffer = false): string {
  const pixels = glyphs.flatMap((glyph, letter) => glyph.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '1' ? [`M${letter * 6 + x} ${y}h1v1h-1z`] : []))).join('');
  const recent = spaces.filter((space) => space.kind === 'agent').slice(0, 4);
  return internalDocument('New tab', `<main class="newtab"><section class="landing" aria-label="New tab"><h1 aria-label="Aether"><svg viewBox="-2 -2 39 11" role="img" aria-labelledby="wordmark-title" shape-rendering="crispEdges"><title id="wordmark-title">Aether</title><path fill="currentColor" d="${pixels}"/></svg></h1>${recent.length ? `<nav aria-label="Recent Spaces"><h2>Recent Spaces</h2><div class="recent-spaces">${recent.map((space) => `<a href="aether://space/${encodeURIComponent(space.id)}"><span class="space-pixel" aria-hidden="true"></span><span>${escapeHtml(space.name)}</span><small>${space.archived ? 'Restore' : space.state === 'waiting_human' ? 'Needs you' : space.state === 'acting' || space.state === 'resuming' ? 'Working' : 'Open Space'}</small></a>`).join('')}</div></nav>` : ''}${importOffer ? '<div class="import-invitation"><p>Bring your browser data with you</p><a class="action" href="aether://settings/">Choose what to import</a><small>Optional. Your existing browser stays unchanged.</small></div>' : ''}</section></main>`, `
  .import-invitation{margin-top:32px}.import-invitation p{margin:0}.import-invitation small{display:block;margin-top:8px;font-size:11px}.newtab{min-height:100vh;display:grid;place-items:center;padding:32px}.landing{width:min(100%,640px);text-align:center}.landing h1{margin:0;line-height:0;font-size:inherit}.landing svg{display:block;width:clamp(240px,38vw,430px);max-width:100%;height:auto;margin:auto;color:var(--ink);filter:drop-shadow(0 3px 0 #ffffff10)}.landing nav{margin:48px auto 0;max-width:440px;text-align:left}.landing h2{margin:0 0 12px;font-size:11px;line-height:1.4;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.recent-spaces{display:grid;gap:6px}.recent-spaces a{display:flex;align-items:center;gap:12px;min-height:44px;padding:10px 12px;border:1px solid transparent;border-radius:8px;text-decoration:none;transition:background 120ms ease-out,border-color 120ms ease-out}.recent-spaces a:hover{background:var(--card);border-color:var(--line)}.recent-spaces a>span:nth-child(2){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.space-pixel{width:6px;height:6px;background:var(--muted);box-shadow:3px -3px 0 #ffffff20}.recent-spaces small{font-size:11px;white-space:nowrap}@media(prefers-reduced-motion:reduce){.recent-spaces a{transition:none}}`);
}

export interface InternalPageSource {
  spaces(): Space[];
  history(): NavigationEntry[];
  importOffer?(): boolean;
}

export function installInternalPages(target: Session, source: InternalPageSource): void {
  if (installed.has(target)) return;
  installed.add(target);
  target.protocol.handle('aether', (request) => {
    const url = new URL(request.url);
    const document = url.hostname === 'newtab' && url.pathname === '/' ? newTabDocument(source.spaces(), source.importOffer?.() ?? false)
      : url.hostname === 'history' ? internalDocument('History', `<main class="document"><h1>History</h1><p>Recent pages in this Space. Stored only on this device.</p>${source.history().length ? `<ol>${source.history().map((entry) => `<li><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.title || entry.url)}</a><br><small>${escapeHtml(entry.url)}</small></li>`).join('')}</ol>` : '<p>No pages in this Space’s history yet.</p>'}</main>`)
      : url.hostname === 'error' ? internalDocument('Could not load page', `<main class="document"><h1>${Number(url.searchParams.get('code')) <= -200 && Number(url.searchParams.get('code')) >= -299 ? 'This connection is not secure' : 'This page could not load'}</h1><p>${escapeHtml(url.searchParams.get('url') ?? '')}</p><p>${Number(url.searchParams.get('code')) <= -200 && Number(url.searchParams.get('code')) >= -299 ? 'The site’s certificate could not be verified. Aether did not send your information. Check the address or contact the site owner.' : 'Check your connection and the address, then try again.'}</p><small>Error ${escapeHtml(url.searchParams.get('code') ?? 'unknown')}</small><div><a class="action" href="aether://retry/">Try again</a><a class="action" href="aether://newtab/">New tab</a></div></main>`)
      : url.hostname === 'settings' ? internalDocument('Settings', '<main class="document"><h1>Settings</h1><p>Settings are edited in the trusted browser shell, not by websites or agents.</p></main>')
      : url.hostname === 'about' ? internalDocument('About Aether', '<main class="document"><h1>Aether</h1><p>A browser with separate Personal and Agent Spaces.</p><h2>Not supported</h2><ul><li>Chrome extensions</li><li>Password manager integration</li><li>Browser sync</li><li>DRM video (Widevine)</li></ul></main>')
      : internalDocument('Page not found', '<main class="document"><h1>This Aether page is not available</h1><p>Check the address or open a new tab.</p><a class="action" href="aether://newtab/">New tab</a></main>');
    return new Response(document, { status: ['newtab', 'history', 'error', 'about', 'settings'].includes(url.hostname) ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  });
}
