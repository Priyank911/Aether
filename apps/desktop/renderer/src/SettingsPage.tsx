import { useState } from 'react';
import type { ImportState, ShellSettings } from '@aether/shared';
import ImportSettings from './ImportSettings';
import './settings.css';

export default function SettingsPage({ settings, browserImport, top, right }: { settings: ShellSettings; browserImport?: ImportState; top: number; right: number }) {
  const [cookieBanners, setCookies] = useState(settings.cookieBanners);
  const [reserve, setReserve] = useState(String(Math.round(settings.minFreeMemoryRatio * 100)));
  const [memoryEnabled, setMemory] = useState(settings.memoryEnabled);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const dirty = cookieBanners !== settings.cookieBanners || Number(reserve) / 100 !== settings.minFreeMemoryRatio || memoryEnabled !== settings.memoryEnabled;
  const save = async () => {
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await window.aether.send({ type: 'settings.save', settings: { cookieBanners, minFreeMemoryRatio: Number(reserve) / 100, memoryEnabled } }) as { ok: boolean; error?: string };
      if (result.ok) setStatus('Settings saved. Changes apply to the next browser action.');
      else setError(result.error ?? 'Could not save settings. Check your local config.json and try again.');
    } catch { setError('Could not reach Settings. Try again.'); }
    finally { setBusy(false); }
  };
  return <main className="settings-page" style={{ top, right }}><div className="settings-inner">
    <header><span className="panel-eyebrow">Personal</span><h1>Settings</h1><p>You control these preferences. Websites and agents cannot change them.</p></header>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} aria-busy={busy} onChange={() => { setStatus(''); setError(''); }}>
      <section aria-labelledby="cookies-title"><h2 id="cookies-title">Cookie banners</h2><p>Choose what Aether does when a site asks about optional cookies. If a banner has no matching choice, it stays on the page.</p>
        <label htmlFor="cookie-preference">When a banner appears</label><select id="cookie-preference" value={cookieBanners} onChange={(event) => setCookies(event.target.value as ShellSettings['cookieBanners'])}>
          <option value="reject">Reject optional cookies</option><option value="accept">Accept all</option><option value="off">Leave banners alone</option>
        </select>
      </section>
      <section aria-labelledby="resources-title"><h2 id="resources-title">Memory reserve</h2><p>Keep part of your computer’s memory free. Aether adjusts live tabs and puts background tabs to sleep as memory becomes scarce.</p>
        <label htmlFor="memory-reserve">Free memory to keep (%)</label><input id="memory-reserve" type="number" min="5" max="90" step="1" required value={reserve} onChange={(event) => setReserve(event.target.value)} aria-describedby="reserve-help" /><small id="reserve-help">From 5% to 90%. Default: 20%.</small>
      </section>
      <section aria-labelledby="memory-title"><h2 id="memory-title">Local memory</h2><p>Save preferences, site notes and learned routes on this device. Turning memory off keeps existing entries but stops saving and recalling them.</p>
        <label className="settings-checkbox"><input type="checkbox" checked={memoryEnabled} onChange={(event) => setMemory(event.target.checked)} />Let Aether remember</label><small>Review or delete saved entries in the side panel’s Memory tab. Passwords and codes are never saved there.</small>
      </section>
      <div className="settings-actions"><button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button><span role="status">{status}</span></div>
      {error && <p className="settings-error" role="alert">{error}</p>}
    </form>
    {browserImport && <ImportSettings state={browserImport} />}
  </div></main>;
}
