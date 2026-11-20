import { useEffect, useRef, useState } from 'react';
import type { ShellCommand, ShellSnapshot, ShellSpace, ShellTab } from '@aether/shared';

const FAVICON_COLORS = ['#1a73e8', '#ea4335', '#34a853', '#fbbc04', '#9334e6', '#e8710a', '#12b5cb', '#d93025'];

function faviconColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return FAVICON_COLORS[Math.abs(hash) % FAVICON_COLORS.length];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Icon({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

function SvgDefs() {
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

function Tab({ tab, active, onActivate, onClose }: { tab: ShellTab; active: boolean; onActivate: () => void; onClose: () => void }) {
  const shownUrl = (url: string) => (url === 'about:blank' ? '' : url);
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

function AgentBar({ entry, send }: { entry: ShellSpace; send: (c: ShellCommand) => void }) {
  const frame = entry.frame;
  if (!frame || frame.state === 'idle') return null;
  const pending = frame.pending;
  const needsPerson = Boolean(pending);
  const open = entry.tabs.filter((t) => t.state !== 'hibernated').length;
  const sleeping = entry.tabs.length - open;
  const text = needsPerson && pending?.prompt ? `Aether needs you: ${pending.prompt}` : frame.label;
  const spaceId = entry.space.id;
  const control = (kind: 'stop' | 'takeover') => () => send({ type: 'run.control', spaceId, control: { type: 'aether.control', kind } });
  const reply = (kind: 'answer' | 'approve' | 'deny' | 'done' | 'resume', text?: string) => {
    if (!pending) return;
    send({ type: 'run.reply', spaceId, reply: { type: 'aether.reply', id: pending.id, kind, ...(text ? { text } : {}) } });
  };
  const [answer, setAnswer] = useState('');
  let actions: React.ReactNode;
  if (pending?.reason === 'approval') {
    actions = (<><button type="button" className="primary" onClick={() => reply('approve')}>Approve</button><button type="button" onClick={() => reply('deny')}>Deny</button></>);
  } else if (pending?.reason === 'question') {
    actions = (<>
      <input type="text" placeholder="Type your answer" aria-label="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && answer.trim()) { reply('answer', answer.trim()); setAnswer(''); } }} />
      <button type="button" onClick={() => { if (answer.trim()) { reply('answer', answer.trim()); setAnswer(''); } }}>Send</button>
    </>);
  } else if (pending && (pending.reason === 'must_perform' || pending.reason === 'captcha')) {
    actions = <button type="button" className="primary" onClick={() => reply('done')}>I'm done</button>;
  } else if (pending?.reason === 'user_interrupted') {
    actions = <button type="button" className="primary" onClick={() => reply('resume')}>Hand back to Aether</button>;
  } else {
    actions = <button type="button" onClick={control('takeover')}>Take over</button>;
  }
  return (
    <div className={`agentbar${needsPerson ? ' waiting' : ''}`} role="status" aria-live="polite">
      <span className={`dot ${needsPerson ? 'need' : 'act'}`} aria-hidden="true" />
      <span className="aglabel">{text.length > 160 ? `${text.slice(0, 159)}…` : text}</span>
      <span className="agmeta">{open} open · {sleeping} sleeping</span>
      <span className="agactions">{actions}<button type="button" className="stop" onClick={control('stop')}>Stop task</button></span>
    </div>
  );
}

export default function App() {
  const [snap, setSnap] = useState<ShellSnapshot | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const omniboxRef = useRef<HTMLInputElement>(null);

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
      else if (mod && k === 'w') { /* close active tab of active space */ }
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
  const shownUrl = (url: string) => (url === 'about:blank' ? '' : url);
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
