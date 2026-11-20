import { useEffect, useState } from 'react';
import type { ImportReason, ImportState, ShellCommand } from '@aether/shared';
import './import.css';

const reasons: Record<ImportReason, string> = {
  'missing-file': 'Data file not found in this profile.',
  'source-busy': 'Chrome is using this data. Close Chrome and try again.',
  'invalid-data': 'Unsupported or invalid entries were left out.',
  'read-failed': 'Some data could not be read. Close Chrome and check profile access.',
  'write-failed': 'Some data could not be saved. Check local storage and try again.',
  'already-present': 'Already present or newer in Aether; left unchanged.',
  expired: 'Expired cookies were left out.',
  'app-bound': 'Chrome App-Bound cookies cannot be imported by this implementation. Sign in once in Aether.',
  'encryption-unavailable': 'Cookie decryption is unavailable for these entries on this device. Sign in once in Aether.',
  'partitioned-cookie': 'Partitioned cookies cannot be transferred safely and were left out.',
};

export default function ImportSettings({ state }: { state: ImportState }) {
  const [profileId, setProfile] = useState('');
  const [selection, setSelection] = useState({ bookmarks: true, history: true, cookies: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!state.profiles.some(profile => profile.id === profileId)) setProfile(state.profiles[0]?.id ?? '');
  }, [state.profiles, profileId]);
  const busy = pending || state.busy;
  const act = async (command: ShellCommand) => {
    setPending(true); setError('');
    try {
      const result = await window.aether.send(command) as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error ?? 'Import could not start. Try again.');
    } catch { setError('Could not reach the import service. Try again.'); }
    finally { setPending(false); }
  };
  return <section id="browser-import" className="browser-import" aria-labelledby="import-title" aria-busy={busy}>
    <div className="import-heading"><div><span className="panel-eyebrow">Your browser, your choice</span><h2 id="import-title">Import browser data</h2></div><span className="import-source">Chrome → Personal</span></div>
    <p>Bring bookmarks, history and supported cookies from a profile on this device. Nothing moves until you choose Import. Chrome stays unchanged.</p>
    {state.offer && <div className="import-offer"><span>New here? Start with your existing browser data, or do this later.</span><button type="button" disabled={busy} onClick={() => { void act({ type: 'import.dismiss' }); }}>Not now</button></div>}
    <div className="import-tools"><button type="button" disabled={busy} onClick={() => { void act({ type: 'import.discover' }); }}>Find Chrome profiles</button><button type="button" disabled={busy} onClick={() => { void act({ type: 'import.choose' }); }}>Choose profile folder…</button></div>
    {state.profiles.length ? <><label htmlFor="import-profile">Chrome profile</label><select id="import-profile" value={profileId} disabled={busy} onChange={event => setProfile(event.target.value)}>{state.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></>
      : <p className="import-empty">Find profiles in this device’s standard Chrome location, or choose a profile folder elsewhere. Close Chrome before importing.</p>}
    <fieldset disabled={busy} className="import-choices"><legend>Choose what to import</legend>{(['bookmarks', 'history', 'cookies'] as const).map(kind => <label key={kind}><input type="checkbox" checked={selection[kind]} onChange={event => setSelection(current => ({ ...current, [kind]: event.target.checked }))} /><span>{kind === 'bookmarks' ? 'Bookmarks' : kind === 'history' ? 'Browsing history' : 'Cookies and supported sign-ins'}</span></label>)}</fieldset>
    <p className="import-privacy">Bookmarks and history are added to Personal. Imported cookies join the session shared with Agent Spaces. Passwords are not imported. Encrypted or unsupported cookies may be skipped; website sign-in compatibility is not guaranteed. Bookmark folders become a flat list.</p>
    <div className="import-actions"><button type="button" className="import-primary" disabled={busy || !profileId || !Object.values(selection).some(Boolean)} onClick={() => { void act({ type: 'import.start', profileId, selection }); }}>{busy ? 'Working…' : 'Import selected data'}</button><span role="status">{busy ? 'Reading local browser data. Keep Chrome closed.' : ''}</span></div>
    {(error || state.error) && <p className="settings-error" role="alert">{error || state.error}</p>}
    {state.report && <div className="import-report" role="status" aria-live="polite"><h3>Import results</h3><dl>{(['bookmarks', 'history', 'cookies'] as const).map(kind => <div key={kind}><dt>{kind === 'history' ? 'History' : kind === 'cookies' ? 'Cookies' : 'Bookmarks'}</dt><dd><strong>{state.report?.[kind].imported}</strong> imported · {state.report?.[kind].skipped} skipped</dd></div>)}</dl>
      {state.report.issues.length > 0 && <ul>{state.report.issues.map(issue => <li key={`${issue.kind}:${issue.reason}`}><strong>{issue.kind}:</strong> {reasons[issue.reason]} <small>{issue.count} {['missing-file', 'source-busy', 'read-failed', 'write-failed'].includes(issue.reason) ? 'reported issue(s)' : 'entry/entries'}</small></li>)}</ul>}
      <p>{state.report.temporaryCopiesRemoved ? 'Temporary profile copies removed. Your Chrome profile was not changed.' : 'Temporary profile copies could not be removed. Close Aether and remove its aether-import-* folders from your OS temporary directory.'}</p></div>}
  </section>;
}
