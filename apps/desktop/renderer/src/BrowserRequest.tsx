import { useEffect, useRef, useState } from 'react';
import type { BrowserPrompt } from '@aether/shared';

const permissions: Record<string, string> = { media: 'Use your camera or microphone', geolocation: 'Know your location', notifications: 'Show notifications', 'clipboard-read': 'Read your clipboard', midi: 'Use MIDI devices', midiSysex: 'Control MIDI devices', 'speaker-selection': 'Select an audio output' };

export default function BrowserRequest({ prompt }: { prompt: BrowserPrompt }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => { (first.current ?? primary.current)?.focus(); }, []);
  const reply = async (allow: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.aether.send({ type: 'browser.reply', id: prompt.id, allow, ...(prompt.kind === 'auth' && allow ? { username, password } : {}) }) as { ok: boolean; error?: string };
      if (!result.ok) { setError(result.error ?? 'The request closed. Try again on the current page.'); setBusy(false); }
    } catch { setError('Could not answer this request. Try again.'); setBusy(false); }
  };
  return <form className="browser-request" role="dialog" aria-labelledby="browser-request-title" aria-describedby="browser-request-origin" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void reply(true); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); void reply(false); } }}>
    <h2 id="browser-request-title">{prompt.kind === 'auth' ? 'Sign in to this site' : prompt.kind === 'external' ? 'Open an external app?' : 'Allow this site to use a feature?'}</h2>
    <p id="browser-request-origin" className="request-origin">{prompt.origin}</p>
    <p>{prompt.kind === 'permission' ? permissions[prompt.detail] ?? prompt.detail : prompt.detail}</p>
    {prompt.kind === 'auth' && <><label>Username<input ref={first} autoComplete="username" maxLength={256} value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Password<input type="password" autoComplete="off" maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} /></label></>}
    <div className="request-actions"><button ref={primary} className="request-primary" type="submit" disabled={busy}>{prompt.kind === 'auth' ? 'Sign in' : prompt.kind === 'external' ? 'Open app' : 'Allow this time'}</button><button type="button" disabled={busy} onClick={() => { void reply(false); }}>{prompt.kind === 'permission' ? 'Block' : 'Cancel'}</button></div>
    {error && <p className="request-error" role="alert">{error}</p>}
  </form>;
}
