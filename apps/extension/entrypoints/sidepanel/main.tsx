import React from 'react';
import { createRoot } from 'react-dom/client';
import type { HumanReply, RunStateFrame } from '@aether/shared';
import { MemoryTab } from './MemoryTab.js';
import { PendingCard } from './PendingCard.js';
import { useAether } from './use-aether.js';
import './style.css';

const CONNECTION_TEXT: Record<string, string> = {
  no_host: 'Native host missing',
  waiting_engine: 'Waiting for your agent',
  connecting: 'Connecting',
  connected: 'Connected',
};

function stateText(frame: RunStateFrame | undefined): string {
  if (!frame || frame.state === 'idle') return frame?.label ?? 'Idle';
  if (frame.state === 'waiting_human') return 'Waiting for you';
  return 'Working';
}

function time(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function SidePanel() {
  const { snapshot, send } = useAether();
  const { connection, frame, agentTab, recent } = snapshot;
  const [notice, setNotice] = React.useState<string>();
  const [view, setView] = React.useState<'run' | 'memory'>('run');
  const acting = frame?.state === 'acting' || frame?.state === 'resuming';
  const reply = (kind: HumanReply['kind'], text?: string): void => {
    if (frame?.pending) void send({ type: 'aether.reply', id: frame.pending.id, kind, text });
  };

  return (
    <main className={`panel state-${frame?.state ?? 'idle'}`}>
      <header className="head">
        <span className="wordmark">Aether</span>
        <span className={`conn conn-${connection.state}`} title={connection.detail}>
          {CONNECTION_TEXT[connection.state]}
        </span>
      </header>

      {connection.state !== 'connected' && <p className="hint">{connection.detail}</p>}

      <nav className="views" aria-label="Views">
        <button type="button" aria-pressed={view === 'run'} onClick={() => setView('run')}>
          Run
        </button>
        <button type="button" aria-pressed={view === 'memory'} onClick={() => setView('memory')}>
          Memory
        </button>
      </nav>

      {view === 'memory' && <MemoryTab send={send} connected={connection.state === 'connected'} />}
      {view === 'run' && (
        <>

      <section className="tab">
        <p className="eyebrow">Agent tab</p>
        <h1>{agentTab.title}</h1>
        <p className="status">
          <span className="status-dot" />
          {stateText(frame)}
          {frame && frame.state !== 'idle' && <span className="status-label"> · {frame.label}</span>}
        </p>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              void send({ type: 'aether.adopt_tab' }).then((response) => {
                const result = response as { ok?: boolean; error?: string } | undefined;
                setNotice(result?.ok ? 'This tab is now the agent tab.' : (result?.error ?? 'Could not use this tab.'));
              })
            }
          >
            Let Aether use this tab
          </button>
          {acting && (
            <button type="button" onClick={() => void send({ type: 'aether.control', kind: 'takeover' })}>
              Take over
            </button>
          )}
          {frame && frame.state !== 'idle' && (
            <button type="button" className="danger" onClick={() => void send({ type: 'aether.control', kind: 'stop' })}>
              Stop run
            </button>
          )}
        </div>
        {notice && <p className="hint">{notice}</p>}
      </section>

      {frame?.pending && <PendingCard key={frame.pending.id} pending={frame.pending} reply={reply} />}

      <section className="steps" aria-label="Steps">
        <p className="eyebrow">Steps</p>
        {recent.length === 0 ? (
          <p className="empty">When your MCP agent starts, each step appears here.</p>
        ) : (
          <ol>
            {recent.map((entry) => (
              <li key={`${entry.step}-${entry.timestamp}-${entry.state}`} className={`step step-${entry.state}`}>
                <span className="step-n">{entry.step}</span>
                <span className="step-label">{entry.label}</span>
                <time>{time(entry.timestamp)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
        </>
      )}
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Side panel root element is missing');
createRoot(rootElement).render(<SidePanel />);
