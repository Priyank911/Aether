import { useEffect, useRef, useState } from 'react';
import type { ShellCommand, ShellSnapshot, Space } from '@aether/shared';

const labels = { idle: 'Idle', acting: 'Working', waiting_human: 'Needs you', resuming: 'Resuming', done: 'Done' };

export default function SpaceMenu({ snapshot }: { snapshot: ShellSnapshot }) {
  const menu = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const send = (command: ShellCommand) => {
    void window.aether.send(command).then((result) => {
      const reply = result as { ok: boolean; error?: string };
      if (!reply.ok) setError(reply.error ?? 'Could not switch Space. Try again.');
    }).catch(() => setError('Could not reach Aether. Close this menu and try again.'));
  };
  const close = () => send({ type: 'space.menu', open: false });
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, []);

  const row = (space: Space, archived = false) => (
    <button key={space.id} className={`space-menu-row state-${space.kind === 'human' ? 'personal' : space.state}`}
      type="button" role="menuitemradio" aria-checked={snapshot.activeSpaceId === space.id} data-space-id={space.id}
      onClick={() => send({ type: 'space.switch', spaceId: space.id })}>
      <span className="dot" aria-hidden="true" />
      <span className="space-row-name">{space.name}</span>
      <span className="space-status">{archived ? 'Restore' : space.kind === 'human' ? 'Your browsing' : labels[space.state]}</span>
    </button>
  );
  const spaces = [...snapshot.spaces].sort((a, b) => Number(b.space.kind === 'human') - Number(a.space.kind === 'human'));

  return (
    <div className="space-menu-backdrop">
      <button type="button" className="space-menu-dismiss" aria-label="Close Spaces" tabIndex={-1} onMouseDown={close} />
      <div ref={menu} className="space-menu" role="menu" aria-label="Spaces" onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); return; }
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
        const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let index: number;
        if (event.key === 'ArrowDown') index = (from + 1) % buttons.length;
        else if (event.key === 'ArrowUp') index = (from - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[index]?.focus();
      }}>
        <div className="space-menu-heading" role="presentation">Spaces</div>
        {spaces.map((entry) => row(entry.space))}
        <hr className="space-menu-divider" />
        <div className="space-menu-heading" role="presentation">Archived</div>
        {snapshot.archivedSpaces?.length ? snapshot.archivedSpaces.map((space) => row(space, true))
          : <div className="space-menu-empty" role="presentation">No archived Spaces</div>}
        {error && <div className="space-menu-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}
