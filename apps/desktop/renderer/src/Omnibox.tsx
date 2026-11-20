import { useEffect, useRef, useState, type RefObject } from 'react';
import type { OmniboxState, ShellCommand, ShellTab } from '@aether/shared';
import { hostOf, Icon, shownUrl } from './chrome';

interface Props {
  tab?: ShellTab;
  suggestions?: OmniboxState;
  inputRef: RefObject<HTMLInputElement | null>;
}

export default function Omnibox({ tab, suggestions, inputRef }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const form = useRef<HTMLFormElement>(null);
  const editEpoch = useRef(0);
  const fullUrl = shownUrl(tab?.url ?? '');
  const shown = editing && suggestions?.query === draft ? suggestions : undefined;
  const expanded = Boolean(shown?.items.length);
  const secure = tab?.url.startsWith('https://');

  const send = async (command: ShellCommand): Promise<boolean> => {
    try {
      const result = await window.aether.send(command) as { ok: boolean; error?: string };
      setError(result.ok ? '' : result.error ?? 'Could not open this address. Check it and try again.');
      return result.ok;
    } catch {
      setError('Could not reach Aether. Try again.');
      return false;
    }
  };
  const update = (query: string, index: number) => {

    const rect = form.current?.getBoundingClientRect();
    if (rect) void send({ type: 'omnibox.update', query, selected: index, left: Math.max(0, rect.left), width: rect.width });
  };
  const close = () => { void send({ type: 'omnibox.close' }); };
  const beginEditing = () => {
    const epoch = ++editEpoch.current;
    setEditing(true); setDraft(fullUrl); setError(''); update(fullUrl, -1);
    requestAnimationFrame(() => {
      if (epoch === editEpoch.current && inputRef.current?.value === fullUrl) inputRef.current.select();
    });
  };
  const submit = async () => {
    if (!draft.trim()) return;
    const epoch = editEpoch.current;
    if (await send({ type: 'omnibox.submit', query: draft }) && epoch === editEpoch.current) {
      setEditing(false); inputRef.current?.blur();
    }
  };

  useEffect(() => {
    // A native tab/Space switch ends the previous tab's address edit session.
    setEditing(false);
    setError('');
    inputRef.current?.blur();
  }, [tab?.id, inputRef]);

  useEffect(() => {
    if (!editing) return;
    const resized = () => {
      const rect = form.current?.getBoundingClientRect();
      if (rect) void window.aether.send({ type: 'omnibox.update', query: draft, selected: suggestions?.query === draft ? suggestions.selected : -1, left: Math.max(0, rect.left), width: rect.width });
    };
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, [editing, draft, suggestions]);

  return (
    <form ref={form} className={`omnibox${error ? ' invalid' : ''}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <span className="omni-icon" title={secure ? 'Connection uses HTTPS' : 'Address and search'}><Icon id={secure ? 'i-lock' : 'i-globe'} size={14} /></span>
      <input ref={inputRef} type="text" role="combobox" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls="omnibox-options" aria-activedescendant={expanded && shown && shown.selected >= 0 ? `omnibox-option-${shown.selected}` : undefined}
        aria-invalid={Boolean(error)} aria-describedby={error ? 'omnibox-error' : undefined}
        spellCheck={false} autoComplete="off" maxLength={4096} aria-label="Address and search"
        placeholder="Search Google or type a web address" value={editing ? draft : fullUrl ? hostOf(fullUrl) || fullUrl : ''}
        onFocus={beginEditing}
        onClick={() => { if (!editing) beginEditing(); }}
        onChange={(event) => { editEpoch.current++; setDraft(event.target.value); setError(''); update(event.target.value, 0); }}
        onBlur={() => {
          setEditing(false);
          // Native overlay pointer input blurs this WebContents before its row can accept.
          // The overlay owns dismissal when focus leaves the shell document.
          if (document.hasFocus()) close();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); close(); setEditing(false); inputRef.current?.blur();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            // Main owns selection so arrows and Enter do not depend on delayed renderer snapshots.
            void send({ type: 'omnibox.move', query: draft, direction: event.key === 'ArrowDown' ? 1 : -1 });
          } else if (event.key === 'Enter') { event.preventDefault(); void submit(); }
        }} />
      {/* ARIA references cannot cross WebContents documents. Keep an accessible mirror beside the focused input. */}
      <div id="omnibox-options" className="sr-only" role="listbox" aria-label="Address suggestions">
        {shown?.items.map((item, index) => <div key={`${item.kind}:${item.input}`} id={`omnibox-option-${index}`} role="option" tabIndex={-1} aria-selected={shown.selected === index}>{item.label}</div>)}
      </div>
      {error && <span id="omnibox-error" className="sr-only" role="alert">{error}</span>}
      {error && <span className="omni-error" title={error}><Icon id="i-warning" size={16} /></span>}
    </form>
  );
}
