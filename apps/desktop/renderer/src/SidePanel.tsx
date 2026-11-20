import { useEffect, useState } from 'react';
import type { ShellCommand, ShellSnapshot, ShellSpace } from '@aether/shared';
import { Icon } from './chrome';
import DecisionCard from './DecisionCard';
import MemoryPanel from './MemoryPanel';
import './panel.css';

export default function SidePanel({ snapshot, entry, send }: { snapshot: ShellSnapshot; entry: ShellSpace; send: (command: ShellCommand) => void }) {
  const [tab, setTab] = useState<'activity' | 'memory'>('activity');
  const pending = entry.frame?.pending;
  useEffect(() => { if (pending) setTab('activity'); }, [pending?.id]);
  const activity = entry.space.kind === 'human'
    ? snapshot.spaces.filter((space) => space.space.kind === 'agent').flatMap((space) => space.milestones.map((milestone) => ({ ...milestone, spaceName: space.space.name }))).sort((a, b) => a.startedAt - b.startedAt)
    : entry.milestones.map((milestone) => ({ ...milestone, spaceName: entry.space.name }));
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
      <div className="panel-tabs" role="tablist" aria-label="Side panel sections" onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); const next = tab === 'activity' ? 'memory' : 'activity'; setTab(next);
        document.getElementById(`panel-tab-${next}`)?.focus();
      }}>
        {(['activity', 'memory'] as const).map((name) => <button key={name} type="button" role="tab" id={`panel-tab-${name}`} aria-controls={`panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}>{name === 'activity' ? 'Activity' : 'Memory'}</button>)}
      </div>
      <div className="panel-content" id={`panel-${tab}`} role="tabpanel" aria-labelledby={`panel-tab-${tab}`}>
        {tab === 'memory' ? <MemoryPanel listing={snapshot.memory} /> : <>
          {pending && <DecisionCard key={pending.id} pending={pending} spaceId={entry.space.id} />}
          {!activity.length && <div className="panel-empty"><span className="empty-orbit" aria-hidden="true" /><h2>No agent tasks yet</h2><p>No agent tasks yet. Ask your editor to use /aether and progress shows here.</p></div>}
          {activity.length > 0 && <ol className="milestones" aria-label="Task activity">{activity.map((milestone) => <li key={`${milestone.spaceId}:${milestone.id}`} className={`milestone milestone-${milestone.status}`}>
            <span className="milestone-marker" role="img" aria-label={milestone.status}>{milestone.status === 'done' ? '✓' : milestone.status === 'failed' ? '×' : '·'}</span>
            <div><p title={milestone.text}>{milestone.text}</p><small>{entry.space.kind === 'human' ? `${milestone.spaceName} · ` : ''}{milestone.source === 'host' ? 'From your editor' : milestone.source === 'script' ? 'Task update' : 'Browser'}</small></div>
            {milestone.endedAt && <time>{Math.max(0, Math.round((milestone.endedAt - milestone.startedAt) / 1000))}s</time>}
          </li>)}</ol>}
        </>}
      </div>
    </aside>
  );
}
