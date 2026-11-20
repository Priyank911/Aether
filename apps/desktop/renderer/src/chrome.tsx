import { useState, type DragEventHandler } from 'react';
import type { ShellTab } from '@aether/shared';


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
        <symbol id="i-speaker" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9ZM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></symbol>
        <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></symbol>
        <symbol id="i-mute" viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></symbol>
        <symbol id="i-warning" viewBox="0 0 24 24"><path d="M12 4 2.8 20h18.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4M12 17.2v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></symbol>
      </defs>
    </svg>
  );
}

export function shownUrl(url: string): string {
  return url === 'about:blank' || /^aether:\/\/newtab\/?$/.test(url) ? '' : url;
}

function TabFavicon({ tab }: { tab: ShellTab }) {
  const [failedSource, setFailedSource] = useState('');
  return (
    <span className="favicon" aria-hidden="true">
      {tab.state === 'crashed' ? <Icon id="i-warning" />
        : tab.loading ? <span className="tab-spinner" />
        : tab.favicon && failedSource !== tab.favicon
          ? <img src={tab.favicon} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailedSource(tab.favicon ?? '')} />
          : <Icon id="i-globe" />}
    </span>
  );
}

interface TabProps {
  tab: ShellTab;
  active: boolean;
  dragging: boolean;
  onActivate(): void;
  onClose(): void;
  onMute(): void;
  onDragStart: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onDragEnd(): void;
}

export function Tab({ tab, active, dragging, onActivate, onClose, onMute, ...drag }: TabProps) {
  const label = tab.title || shownUrl(tab.url) || 'New tab';
  const state = tab.state === 'hibernated' ? 'Sleeping to save memory. Click to load.'
    : tab.state === 'crashed' ? 'This tab stopped working. Click to reload.'
    : tab.loading ? 'Loading' : '';
  return (
    <div className={`tab${active ? ' active' : ''}${tab.state === 'hibernated' ? ' sleeping' : ''}${tab.state === 'crashed' ? ' crashed' : ''}${dragging ? ' dragging' : ''}`}
      role="tab" aria-selected={active} aria-label={`${label}${state ? `. ${state}` : ''}`} aria-busy={tab.loading}
      tabIndex={active ? 0 : -1} title={`${label}${state ? `\n${state}` : ''}`} data-tab-id={tab.id} draggable {...drag}
      onClick={onActivate}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(); } }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
        if (e.key === 'Delete') { e.preventDefault(); onClose(); }
      }}>
      <TabFavicon tab={tab} />
      <span className="title">{label}</span>
      {(tab.audible || tab.muted) && <button className="tab-audio" type="button" title={tab.muted ? 'Unmute tab' : 'Mute tab'}
        aria-label={`${tab.muted ? 'Unmute' : 'Mute'} ${label}`} aria-pressed={tab.muted}
        onClick={(e) => { e.stopPropagation(); onMute(); }}>
        <Icon id={tab.muted ? 'i-mute' : 'i-speaker'} size={14} />
      </button>}
      <button className="close" type="button" aria-label={`Close ${label}`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <Icon id="i-close" size={14} />
      </button>
    </div>
  );
}
