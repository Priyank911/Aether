import type { RefObject } from 'react';
import type { ShellCommand, ShellSnapshot, ShellTab } from '@aether/shared';
import { Icon } from './chrome';
import Omnibox from './Omnibox';

interface Props {
  snapshot: ShellSnapshot;
  tab?: ShellTab;
  inputRef: RefObject<HTMLInputElement | null>;
  send(command: ShellCommand): void;
  notice: string;
}

export default function Toolbar({ snapshot, tab, inputRef, send, notice }: Props) {
  const running = snapshot.spaces.filter(({ space }) => space.kind === 'agent' && ['acting', 'resuming', 'waiting_human'].includes(space.state));
  const waiting = running.filter(({ space }) => space.state === 'waiting_human').length;
  const status = `${running.length} running Agent ${running.length === 1 ? 'Space' : 'Spaces'}${waiting ? `, ${waiting} ${waiting === 1 ? 'needs' : 'need'} you` : ''}`;
  return (
    <nav className="toolbar" aria-label="Browser navigation">
      <button className="icon-btn" type="button" aria-label="Back" title="Back (Alt+Left)" disabled={!tab?.canGoBack} onClick={() => send({ type: 'nav.back' })}><Icon id="i-back" size={18} /></button>
      <button className="icon-btn" type="button" aria-label="Forward" title="Forward (Alt+Right)" disabled={!tab?.canGoForward} onClick={() => send({ type: 'nav.forward' })}><Icon id="i-fwd" size={18} /></button>
      <button className="icon-btn" type="button" aria-label={tab?.loading ? 'Stop loading' : 'Reload'} title={tab?.loading ? 'Stop loading' : 'Reload (Ctrl+R)'} onClick={() => send({ type: tab?.loading ? 'nav.stop' : 'nav.reload' })}><Icon id={tab?.loading ? 'i-close' : 'i-reload'} size={18} /></button>
      <Omnibox tab={tab} suggestions={snapshot.omnibox} inputRef={inputRef} />
      <button className={`agent-indicator${waiting ? ' waiting' : running.length ? ' working' : ''}`} type="button"
        aria-label={`${status}. Open Spaces`} title={status} aria-haspopup="menu" aria-expanded={Boolean(snapshot.spaceMenuOpen)} onClick={() => send({ type: 'space.menu', open: true })}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></svg>
        <span>{running.length}</span>
      </button>
      <button className="icon-btn" type="button" aria-label="Side panel" aria-pressed={snapshot.panelOpen} title={'Side panel (Ctrl+\\)'} onClick={() => send({ type: 'panel.toggle' })}>
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M15 4v16" stroke="currentColor" strokeWidth="1.8" /></svg>
      </button>
      <button className="icon-btn" type="button" aria-label="Main menu" aria-haspopup="menu" title="Customize and control Aether" onMouseDown={(event) => event.preventDefault()} onClick={() => send({ type: 'menu.open' })}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="19" r="1.6" fill="currentColor" /></svg>
      </button>
      <span className="sr-only" role="status" aria-live="polite">{notice}</span>
    </nav>
  );
}
