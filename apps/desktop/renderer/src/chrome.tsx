import { useState } from 'react';
import type { ShellTab } from '@aether/shared';

export const FAVICON_COLORS = ['#1a73e8', '#ea4335', '#34a853', '#fbbc04', '#9334e6', '#e8710a', '#12b5cb', '#d93025'];

export function faviconColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return FAVICON_COLORS[Math.abs(hash) % FAVICON_COLORS.length];
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function Icon({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-back" viewBox="0 0 24 24"><path d="M15.5 4.5 8 12l7.5 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
        <symbol id="i-fwd" viewBox="0 0 24 24"><path d="m8.5 4.5 7.5 7.5-7.5 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
        <symbol id="i-reload" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M20 3v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
        <symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" /></symbol>
        <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18-3-3.5-3-14.5 0-18Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></symbol>
        <symbol id="i-mute" viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></symbol>
        <symbol id="i-warning" viewBox="0 0 24 24"><path d="M12 4 2.8 20h18.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4M12 17.2v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></symbol>
      </defs>
    </svg>
  );
}

export function shownUrl(url: string): string {
  return url === 'about:blank' ? '' : url;
}

function TabFavicon({ tab }: { tab: ShellTab }) {
  const [failed, setFailed] = useState(false);
  const letter = (tab.title || hostOf(tab.url) || '?').trim().charAt(0).toUpperCase() || '?';
  const color = faviconColor(tab.title || tab.url);
  return (
    <span className="favicon" style={{ background: tab.favicon && !failed ? '#fff' : color }}>
      {tab.favicon && !failed ? (
        <img src={tab.favicon} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        letter
      )}
    </span>
  );
}

export function Tab({ tab, active, onActivate, onClose }: { tab: ShellTab; active: boolean; onActivate: () => void; onClose: () => void }) {
  const label = tab.title || shownUrl(tab.url) || 'New tab';
  const cls = `tab${active ? ' active' : ''}${tab.state === 'hibernated' ? ' sleeping' : ''}${tab.state === 'crashed' ? ' crashed' : ''}`;
  const tip = tab.state === 'hibernated' ? 'Sleeping to save memory. Click to load.' : tab.state === 'crashed' ? 'This tab stopped working. Click to reload.' : label;
  return (
    <div className={cls} role="tab" aria-selected={active} tabIndex={0} title={tip}
      onClick={onActivate}
      onAuxClick={(e) => { if (e.button === 1) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}>
      <TabFavicon tab={tab} />
      <span className="title">{label}</span>
      {tab.audible && !tab.muted && <span className="mute" title="This tab is playing audio"><Icon id="i-mute" size={12} /></span>}
      {tab.state === 'crashed' && <span className="mute" style={{ color: 'var(--wait)' }}><Icon id="i-warning" size={13} /></span>}
      <button className="close" type="button" aria-label={`Close ${label}`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <Icon id="i-close" size={12} />
      </button>
    </div>
  );
}
