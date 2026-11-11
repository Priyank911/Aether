import React from 'react';
import { MemoryListingSchema, type MemoryCommand, type MemoryListing } from '@aether/shared';

interface Props {
  send: (command: MemoryCommand) => Promise<unknown>;
  connected: boolean;
}

/** Everything Aether remembers, editable by the person. Nothing here leaves the machine. */
export function MemoryTab({ send, connected }: Props) {
  const [listing, setListing] = React.useState<MemoryListing>();
  const [key, setKey] = React.useState('');
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    const onMessage = (raw: unknown): void => {
      const parsed = MemoryListingSchema.safeParse(raw);
      if (parsed.success) setListing(parsed.data);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    if (connected) void send({ type: 'aether.memory', op: 'list' });
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [send, connected]);

  if (!connected) return <p className="empty">Memory is available while your agent is connected.</p>;
  if (!listing) return <p className="empty">Loading memory</p>;

  const remove = (kind: 'fact' | 'note' | 'procedure', id: string | number): void => {
    void send({ type: 'aether.memory', op: 'delete', kind, id });
  };

  return (
    <section className="memory">
      <label className="switch">
        <input
          type="checkbox"
          checked={listing.enabled}
          onChange={(event) => void send({ type: 'aether.memory', op: 'set_enabled', enabled: event.target.checked })}
        />
        Remember preferences and site routes
      </label>
      {listing.error && <p className="hint">{listing.error}</p>}

      <p className="eyebrow">Preferences</p>
      <form
        className="answer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!key.trim() || !value.trim()) return;
          void send({ type: 'aether.memory', op: 'save_fact', key: key.trim(), value: value.trim() });
          setKey('');
          setValue('');
        }}
      >
        <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="seat" aria-label="Preference name" />
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="aisle" aria-label="Preference value" />
        <button type="submit" className="primary" disabled={!key.trim() || !value.trim()}>
          Add
        </button>
      </form>
      {listing.facts.length === 0 ? (
        <p className="empty">No preferences yet.</p>
      ) : (
        <ul className="entries">
          {listing.facts.map((fact) => (
            <li key={fact.key}>
              <span>
                <strong>{fact.key}</strong> {fact.value} <span className="muted">{fact.source === 'user' ? 'you' : 'agent, approved'}</span>
              </span>
              <button type="button" onClick={() => remove('fact', fact.key)} aria-label={`Delete ${fact.key}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="eyebrow">Site routes</p>
      {listing.procedures.length === 0 ? (
        <p className="empty">Routes appear after a run finishes successfully.</p>
      ) : (
        <ul className="entries">
          {listing.procedures.map((procedure) => (
            <li key={procedure.id}>
              <details>
                <summary>
                  {procedure.site}: {procedure.goal} <span className="muted">{procedure.stale ? 'stale' : `worked ${procedure.successes}x`}</span>
                </summary>
                <ol className="route">
                  {procedure.steps.map((step, index) => (
                    <li key={`${procedure.id}-${index}`} className="mono">
                      {step}
                    </li>
                  ))}
                </ol>
              </details>
              <button type="button" onClick={() => remove('procedure', procedure.id)} aria-label={`Delete route ${procedure.goal}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="eyebrow">Site notes</p>
      {listing.notes.length === 0 ? (
        <p className="empty">No notes.</p>
      ) : (
        <ul className="entries">
          {listing.notes.map((note) => (
            <li key={note.id}>
              <span>
                <strong>{note.site}</strong> {note.text}
              </span>
              <button type="button" onClick={() => remove('note', note.id)} aria-label={`Delete note for ${note.site}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
