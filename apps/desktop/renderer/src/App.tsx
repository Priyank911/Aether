import { useEffect, useRef, useState } from 'react';
import type { ShellCommand, ShellSnapshot } from '@aether/shared';
import AgentBar from './AgentBar';
import { Icon, shownUrl, SvgDefs, Tab } from './chrome';

export default function App() {
  const [snap, setSnap] = useState<ShellSnapshot | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const omniboxRef = useRef<HTMLInputElement>(null);

  const snapRef = useRef<ShellSnapshot | null>(null);
  snapRef.current = snap;

  const send = (command: ShellCommand) => {
    void window.aether.send(command).then((result) => {
      const r = result as { ok?: boolean; error?: string } | undefined;
      setNotice(r && r.ok === false ? (r.error ?? 'failed') : '');
    }).catch(() => setNotice('shell command failed'));
  };

  useEffect(() => {
    window.aether.onSnapshot(setSnap);
    send({ type: 'shell.ready' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 't' && !e.shiftKey) { send({ type: 'tab.new' }); omniboxRef.current?.focus(); }
      else if (mod && e.shiftKey && k === 't') send({ type: 'tab.reopen' });
      else if (mod && k === 'w') {
        const s = snapRef.current;
        const e = s?.spaces.find((x) => x.space.id === s.activeSpaceId);
        const t = e?.tabs.find((x) => x.id === e.activeTabId);
        if (t) send({ type: 'tab.close', tabId: t.id });
      }
      else if ((mod && k === 'l') || e.key === 'F6') { e.preventDefault(); omniboxRef.current?.focus(); omniboxRef.current?.select(); }
      else if (mod && k === '\\') send({ type: 'panel.toggle' });
      else if ((mod && k === 'r') || e.key === 'F5') send({ type: 'nav.reload', hard: e.shiftKey });
      else if (e.altKey && e.key === 'ArrowLeft') send({ type: 'nav.back' });
      else if (e.altKey && e.key === 'ArrowRight') send({ type: 'nav.forward' });
      else if (mod && (e.key === '=' || e.key === '+')) send({ type: 'zoom', delta: 1 });
      else if (mod && e.key === '-') send({ type: 'zoom', delta: -1 });
      else if (mod && e.key === '0') send({ type: 'zoom', delta: 0 });
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!snap) return;
    document.body.classList.toggle('win', snap.platform === 'win32');
    document.body.classList.toggle('mac', snap.platform === 'darwin');
  }, [snap]);

  const entry = snap?.spaces.find((s) => s.space.id === snap.activeSpaceId);
  if (!snap || !entry) return <div className="window" />;

  const agent = entry.space.kind === 'agent';
  const frame = entry.frame;
  const waiting = Boolean(frame?.pending);
  const activeTab = entry.tabs.find((t) => t.id === entry.activeTabId);
  const secure = activeTab?.url?.startsWith('https://') ?? false;

  return (
    <div className="window">
      <SvgDefs />
      <div className="strip" role="tablist" aria-label="Tabs">
        <label className="space-chip" title="Switch Space">
          <span className={`dot${agent ? ' agent' : ''}${waiting ? ' wait' : ''}`} aria-hidden="true" />
          <select aria-label="Switch Space" value={snap.activeSpaceId}
            onChange={(e) => send({ type: 'space.switch', spaceId: e.target.value })}>
            {snap.spaces.map((s) => <option key={s.space.id} value={s.space.id}>{s.space.name}</option>)}
          </select>
          <svg className="chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </label>
        <div className="tabs">
          {entry.tabs.map((tab) => (
            <Tab key={tab.id} tab={tab} active={tab.id === entry.activeTabId}
              onActivate={() => send({ type: 'tab.activate', tabId: tab.id })}
              onClose={() => send({ type: 'tab.close', tabId: tab.id })} />
          ))}
        </div>
        <button className="icon-btn strip-btn" type="button" aria-label="New tab" title="New tab (Ctrl+T)" onClick={() => { send({ type: 'tab.new' }); omniboxRef.current?.focus(); }}>
          <Icon id="i-plus" size={16} />
        </button>
      </div>
      <div className="toolbar">
        <button className="icon-btn" type="button" aria-label="Back" title="Back (Alt+Left)" disabled={!activeTab?.canGoBack} onClick={() => send({ type: 'nav.back' })}>
          <Icon id="i-back" size={18} />
        </button>
        <button className="icon-btn" type="button" aria-label="Forward" title="Forward (Alt+Right)" disabled={!activeTab?.canGoForward} onClick={() => send({ type: 'nav.forward' })}>
          <Icon id="i-fwd" size={18} />
        </button>
        <button className="icon-btn" type="button" aria-label="Reload" title="Reload (Ctrl+R)" onClick={() => send({ type: 'nav.reload' })}>
          <Icon id="i-reload" size={18} />
        </button>
        <form className={`omnibox${secure ? ' secure' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            const input = draft.trim();
            if (!input) return;
            setEditing(false);
            omniboxRef.current?.blur();
            send({ type: 'nav.go', input });
          }}>
          <span className="omni-icon"><Icon id={secure ? 'i-lock' : 'i-globe'} size={14} /></span>
          <input ref={omniboxRef} type="text" spellCheck={false} autoComplete="off" aria-label="Address and search"
            placeholder="Search Google or type a web address"
            value={editing ? draft : activeTab ? shownUrl(activeTab.url) : ''}
            onFocus={() => { setEditing(true); setDraft(activeTab ? shownUrl(activeTab.url) : ''); requestAnimationFrame(() => omniboxRef.current?.select()); }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setEditing(false)} />
        </form>
        <button className="icon-btn" type="button" aria-label="Side panel" title="Side panel (Ctrl+\)" onClick={() => send({ type: 'panel.toggle' })}>
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M15 4v16" stroke="currentColor" strokeWidth="1.8" /></svg>
        </button>
        <span className="notice" role="status" aria-live="polite">{notice}</span>
      </div>
      <AgentBar entry={entry} send={send} />
    </div>
  );
}
