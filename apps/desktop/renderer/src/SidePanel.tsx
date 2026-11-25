import type { ShellCommand, ShellSnapshot, ShellSpace } from '@aether/shared';
import { Icon } from './chrome';
import DecisionCard from './DecisionCard';
import MemoryPanel from './MemoryPanel';
import './panel.css';

export default function SidePanel({ snapshot, entry, send }: { snapshot: ShellSnapshot; entry: ShellSpace; send: (command: ShellCommand) => void }) {
  const pending = entry.frame?.pending;
  return (
    <aside className="side-panel" aria-label="Aether side panel" style={{ top: snapshot.chromeHeight ?? (snapshot.agentBarVisible ? 108 : 76), width: snapshot.panelWidth }}>
      <hr className="panel-resizer" aria-label="Resize side panel" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={480} aria-valuenow={snapshot.panelWidth} tabIndex={0}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) send({ type: 'panel.resize', width: Math.max(280, Math.min(480, Math.round(innerWidth - event.clientX))) }); }}
        onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); send({ type: 'panel.resize', width: event.key === 'Home' ? 280 : event.key === 'End' ? 480 : Math.max(280, Math.min(480, (snapshot.panelWidth ?? 320) + (event.key === 'ArrowLeft' ? 20 : -20))) }); } }} />
      <header className="panel-header"><div><span className="panel-eyebrow">{entry.space.name}</span><h1>Aether</h1></div>
        <button className="icon-btn" type="button" aria-label="Close side panel" title="Close side panel (Ctrl+\\)" onClick={() => send({ type: 'panel.toggle', open: false })}><Icon id="i-close" /></button>
      </header>
      <div className="panel-content">
        {pending && <DecisionCard key={pending.id} pending={pending} spaceId={entry.space.id} />}
        <MemoryPanel listing={snapshot.memory} />
      </div>
    </aside>
  );
}
