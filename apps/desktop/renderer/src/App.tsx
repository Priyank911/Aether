import { useEffect, useRef, useState } from 'react';
import type { ShellCommand, ShellSnapshot } from '@aether/shared';
import AgentBar from './AgentBar';
import SidePanel from './SidePanel';
import BookmarksBar from './BookmarksBar';
import SettingsPage from './SettingsPage';
import { SvgDefs } from './chrome';
import Toolbar from './Toolbar';
import TabStrip from './TabStrip';

export default function App() {
  const [snap, setSnap] = useState<ShellSnapshot | null>(null);

  const [notice, setNotice] = useState('');
  const omniboxRef = useRef<HTMLInputElement>(null);
  const focusAfterNewTab = useRef<{ previous?: string } | null>(null);

  const snapRef = useRef<ShellSnapshot | null>(null);
  snapRef.current = snap;

  const send = (command: ShellCommand) => {
    void window.aether.send(command).then((result) => {
      const r = result as { ok?: boolean; error?: string } | undefined;
      setNotice(r && r.ok === false ? (r.error ?? 'failed') : '');
    }).catch(() => setNotice('shell command failed'));
  };

  const newTab = () => {
    const current = snapRef.current;
    focusAfterNewTab.current = { previous: current?.spaces.find((entry) => entry.space.id === current.activeSpaceId)?.activeTabId };
    void window.aether.send({ type: 'tab.new' }).then((result) => {
      const response = result as { ok?: boolean; error?: string } | undefined;
      if (response?.ok === false) { setNotice(response.error ?? 'failed'); return; }
      const visible = snapRef.current?.spaces.find((entry) => entry.space.id === snapRef.current?.activeSpaceId);
      if (visible?.frame?.pending) return;
      requestAnimationFrame(() => { omniboxRef.current?.focus(); omniboxRef.current?.select(); });
    }).catch(() => setNotice('shell command failed'));
  };

  useEffect(() => {
    const visible = snap?.spaces.find((entry) => entry.space.id === snap.activeSpaceId);
    if (snap?.focusOmnibox && !visible?.frame?.pending) requestAnimationFrame(() => { omniboxRef.current?.focus(); omniboxRef.current?.select(); });
  }, [snap?.focusOmnibox]);

  useEffect(() => {
    const current = snap?.spaces.find((entry) => entry.space.id === snap.activeSpaceId);
    if (focusAfterNewTab.current && current?.activeTabId && current.activeTabId !== focusAfterNewTab.current.previous) {
      focusAfterNewTab.current = null;
      requestAnimationFrame(() => omniboxRef.current?.focus());
    }
  }, [snap]);

  useEffect(() => {
    const unsubscribe = window.aether.onSnapshot(setSnap);
    send({ type: 'shell.ready' });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && e.shiftKey && /^[1-9]$/.test(e.code.replace('Digit', ''))) {
        const spaces = snapRef.current?.spaces;
        const target = spaces?.[Number(e.code.slice(-1)) - 1];
        if (target) send({ type: 'space.switch', spaceId: target.space.id });
      }
      else if (mod && k === 't' && !e.shiftKey) newTab();
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


  const activeTab = entry.tabs.find((t) => t.id === entry.activeTabId);


  return (
    <div className="window" onPointerDownCapture={(event) => {
      if (snap.spaceMenuOpen && event.target instanceof Element && !event.target.closest('.space-chip, .agent-indicator')) send({ type: 'space.menu', open: false });
    }}>
      <SvgDefs />
      <TabStrip snapshot={snap} entry={entry} send={send} onNewTab={newTab} />
      <Toolbar snapshot={snap} tab={activeTab} inputRef={omniboxRef} send={send} notice={notice} />
      <BookmarksBar snapshot={snap} send={send} />
      {snap.settings && <SettingsPage key={activeTab?.id} settings={snap.settings} browserImport={snap.browserImport} top={snap.chromeHeight ?? 76} right={snap.panelWidth ?? 0} />}
      {activeTab?.state === 'crashed' && <main className="tab-crashed" style={{ top: snap.chromeHeight ?? 76, right: snap.panelWidth ?? 0 }}><div><h1>This tab stopped working</h1><p>Your other tabs are still available. Reload to open this page again.</p><button type="button" onClick={() => send({ type: 'nav.reload' })}>Reload page</button></div></main>}
      <AgentBar entry={entry} send={send} visible={snap.agentBarVisible} />
      {entry.space.kind === 'agent' && entry.frame && ['acting', 'resuming', 'waiting_human'].includes(entry.frame.state) && <div className={`viewport-frame ${entry.frame.state === 'waiting_human' ? 'waiting' : 'acting'}`} aria-hidden="true" style={{ top: snap.chromeHeight ?? (snap.agentBarVisible ? 108 : 76), right: snap.panelWidth ?? 0 }} />}
      {snap.panelOpen && <SidePanel snapshot={snap} entry={entry} send={send} />}
    </div>
  );
}
