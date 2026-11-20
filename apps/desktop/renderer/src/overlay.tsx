import { useEffect, useRef, useState } from 'react';
import type { ShellSnapshot } from '@aether/shared';
import SpaceMenu from './SpaceMenu';
import OmniboxSuggestions from './OmniboxSuggestions';
import BrowserRequest from './BrowserRequest';

export default function Overlay() {
  const [snap, setSnap] = useState<ShellSnapshot | null>(null);
  const [hint, setHint] = useState(0);
  const [targetVisible, setTargetVisible] = useState(false);
  const [findText, setFindText] = useState('');
  const findInput = useRef<HTMLInputElement>(null);
  const entry = snap?.spaces.find((space) => space.space.id === snap.activeSpaceId);
  const acting = entry?.space.kind === 'agent' && (entry.frame?.state === 'acting' || entry.frame?.state === 'resuming');
  const full = acting || Boolean(snap?.spaceMenuOpen) || Boolean(snap?.omnibox);
  const target = snap?.actionTarget;

  useEffect(() => {
    const unsubscribe = window.aether.onSnapshot(setSnap);
    void window.aether.send({ type: 'shell.ready' }).catch(() => {});
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!snap?.find) return;
    setFindText(snap.find.text);
    findInput.current?.focus(); findInput.current?.select();
  }, [snap?.find?.focus]);
  useEffect(() => {
    setTargetVisible(Boolean(target));
    const timer = setTimeout(() => setTargetVisible(false), Math.max(0, (target?.timestamp ?? 0) + 1500 - Date.now()));
    return () => clearTimeout(timer);
  }, [target?.timestamp]);
  const find = (text: string, forward = true) => { void window.aether.send({ type: 'find.start', text, forward }); };
  const closeFind = () => { void window.aether.send({ type: 'find.stop' }); };

  return (
    <div className={`ovl${full ? ' full' : ''}`}>
      {acting && <button type="button" className="input-shield" aria-label="Aether is working. Press Take over or Esc." onClick={() => setHint((count) => count + 1)}>
        <span key={hint} className="shield-hint">Aether is working. Press Take over or <kbd>Esc</kbd>.</span>
      </button>}
      {acting && target && targetVisible && <div className="ghost-target" aria-hidden="true" style={{ transform: `translate(${target.x + 2}px, ${target.y + 2}px)` }}>
        <span className="target-reticle" /><svg className="ghost-cursor" aria-hidden="true" viewBox="0 0 20 20"><path d="M3 2v14l4-4 3 6 3-1-3-6h6Z" /></svg>
      </div>}
      {snap?.browserPrompt && <BrowserRequest key={snap.browserPrompt.id} prompt={snap.browserPrompt} />}
      {snap?.find && !snap.browserPrompt && <form className="find-bar" aria-label="Find in page" onSubmit={(event) => { event.preventDefault(); if (findText) find(findText); }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); closeFind(); }
        else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); if (findText) find(findText, false); }
      }}>
        <input ref={findInput} type="text" aria-label="Find in page" maxLength={500} placeholder="Find in page" value={findText} onChange={(event) => { setFindText(event.target.value); find(event.target.value); }} />
        <output aria-live="polite">{snap.find.active}/{snap.find.total}</output>
        <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!findText} onClick={() => find(findText, false)}>↑</button>
        <button type="submit" aria-label="Next match" title="Next match (Enter)" disabled={!findText}>↓</button>
        <button type="button" aria-label="Close Find" title="Close Find (Esc)" onClick={closeFind}>×</button>
      </form>}
      {snap?.toast && !snap.browserPrompt && (!snap.find || full) && <div className="overlay-toast" role="status"><p>{snap.toast.text}</p><button type="button" aria-label="Dismiss notification" onClick={() => { if (snap.toast) void window.aether.send({ type: 'toast.dismiss', id: snap.toast.id }); }}>×</button></div>}
      {snap?.omnibox && !snap.spaceMenuOpen && <OmniboxSuggestions state={snap.omnibox} />}
      {snap?.spaceMenuOpen && <SpaceMenu snapshot={snap} />}
    </div>
  );
}
