import { useEffect, useState } from 'react';
import type { MemoryCommand, MemoryListing } from '@aether/shared';

export default function MemoryPanel({ listing }: { listing?: MemoryListing }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const send = async (command: Omit<MemoryCommand, 'type'>) => {
    try {
      const result = await window.aether.send({ type: 'memory', command: { type: 'aether.memory', ...command } }) as { ok: boolean; error?: string };
      setError(result.ok ? '' : result.error ?? 'Could not update memory. Try again.');
      return result.ok;
    } catch { setError('Could not reach local memory. Try again.'); return false; }
  };
  useEffect(() => { void send({ op: 'list' }); }, []);
  return (
    <div className="memory-panel">
      <p className="panel-muted">Preferences, notes and routes stay on this device. Passwords and codes are never stored.</p>
      <label className="memory-toggle"><input type="checkbox" checked={listing?.enabled ?? true} disabled={!listing} onChange={(event) => { void send({ op: 'set_enabled', enabled: event.target.checked }); }} />Let Aether remember</label>
      {!listing && <p role="status">Loading local memory…</p>}
      <h2>Preferences</h2>
      {listing && !listing.facts.length && <p className="panel-muted">No preferences saved. Add something you want Aether to remember.</p>}
      {listing?.facts.map((fact) => <div className="memory-row" key={fact.key}><div><strong>{fact.key}</strong><p>{fact.value}</p><small>{fact.source === 'user' ? 'Saved by you' : 'Saved with your approval'}</small></div><button type="button" aria-label={`Delete preference ${fact.key}`} onClick={() => { void send({ op: 'delete', kind: 'fact', id: fact.key }); }}>Delete</button></div>)}
      <form className="memory-form" onSubmit={(event) => { event.preventDefault(); void send({ op: 'save_fact', key: name.trim(), value: value.trim() }).then((ok) => { if (ok) { setName(''); setValue(''); } }); }}>
        <label>Preference name<input maxLength={80} placeholder="For example, preferred currency" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Value<input maxLength={500} placeholder="For example, INR" value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <button className="primary" type="submit" disabled={!listing?.enabled || !name.trim() || !value.trim()}>Save preference</button>
      </form>
      <h2>Site notes</h2>
      {!listing?.notes.length && <p className="panel-muted">Useful site details will appear here after a task.</p>}
      {listing?.notes.map((note) => <div className="memory-row" key={note.id}><div><strong>{note.site}</strong><p>{note.text}</p></div><button type="button" aria-label={`Delete note for ${note.site}`} onClick={() => { void send({ op: 'delete', kind: 'note', id: note.id }); }}>Delete</button></div>)}
      <h2>Learned routes</h2>
      {!listing?.procedures.length && <p className="panel-muted">Routes from completed tasks will appear here.</p>}
      {listing?.procedures.map((route) => <details className="memory-route" key={route.id}><summary>{route.goal}<small>{route.site} · {route.stale ? 'Needs another try' : `${route.successes} successful runs`}</small></summary><ol>{route.steps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol><button type="button" onClick={() => { void send({ op: 'delete', kind: 'procedure', id: route.id }); }}>Delete route</button></details>)}
      {(error || listing?.error) && <p className="panel-error" role="alert">{error || listing?.error}</p>}
    </div>
  );
}
