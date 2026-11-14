import React from 'react';
import { createRoot } from 'react-dom/client';
import type { ConnectionStatus, HumanReply, RunStateFrame } from '@aether/shared';
import { MemoryTab } from './MemoryTab.js';
import { PendingCard } from './PendingCard.js';
import { useAether } from './use-aether.js';
import './style.css';

const CONNECTION_TEXT: Record<ConnectionStatus['state'], string> = {
  no_host: 'Setup needed',
  waiting_engine: 'Agent not running',
  connecting: 'Connecting',
  connected: 'Connected',
};

type Mode = 'idle' | 'working' | 'waiting';

function modeOf(frame: RunStateFrame | undefined): Mode {
  if (!frame || frame.state === 'idle') return 'idle';
  return frame.state === 'waiting_human' ? 'waiting' : 'working';
}

const MODE_TITLE: Record<Mode, string> = { idle: 'Idle', working: 'Working', waiting: 'Needs you' };

function time(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Setup({ connection }: { connection: ConnectionStatus }) {
  if (connection.state === 'connected') return null;
  return (
    <section className="setup" aria-label="Connection">
      <p className="setup-title">{connection.state === 'no_host' ? 'Finish setup' : 'Start your agent'}</p>
      {connection.state === 'no_host' ? (
        <ol>
          <li>Run <code>pnpm setup:build</code> in the Aether folder.</li>
          <li>
            Register the native host: <code>install.ps1 -ExtensionId {chrome.runtime.id}</code>
          </li>
          <li>Reload this extension, then run <code>pnpm doctor</code>.</li>
        </ol>
      ) : (
        <p>Start Aether from your MCP host, for example by sending a message in agent mode. This panel connects by itself.</p>
      )}
      <p className="setup-detail">{connection.detail}</p>
    </section>
  );
}

function SidePanel() {
  const { snapshot, send } = useAether();
  const { connection, frame, agentTab } = snapshot;
  // The idle frame before any run is not a step.
  const recent = snapshot.recent.filter((entry) => entry.step > 0);
  const [notice, setNotice] = React.useState<string>();
  const [view, setView] = React.useState<'run' | 'memory'>('run');
  const mode = modeOf(frame);
  const connected = connection.state === 'connected';
  const reply = (kind: HumanReply['kind'], text?: string): void => {
    if (frame?.pending) void send({ type: 'aether.reply', id: frame.pending.id, kind, text });
  };
  const adopt = (): void => {
    void send({ type: 'aether.adopt_tab' }).then((response) => {
      const result = response as { ok?: boolean; error?: string } | undefined;
      setNotice(result?.ok ? 'This tab is now the agent tab.' : (result?.error ?? 'Could not use this tab.'));
      setTimeout(() => setNotice(undefined), 4000);
    });
  };

  return (
    <main className={`panel mode-${mode}`}>
      <header className="head">
        <img className="logo" src="/icon/48.png" alt="" width="24" height="24" />
        <span className="wordmark">Aether</span>
        <span className={`chip chip-${connection.state}`} title={connection.detail}>
          <span className="chip-dot" />
          {CONNECTION_TEXT[connection.state]}
        </span>
      </header>

      <div className="segmented" role="tablist" aria-label="Views">
        <button type="button" role="tab" aria-selected={view === 'run'} onClick={() => setView('run')}>
          Run
        </button>
        <button type="button" role="tab" aria-selected={view === 'memory'} onClick={() => setView('memory')}>
          Memory
        </button>
      </div>

      {view === 'memory' ? (
        <MemoryTab send={send} connected={connected} />
      ) : (
        <>
          <Setup connection={connection} />

          <section className="status" aria-live="polite">
            <div className="status-top">
              <span className="status-pulse" />
              <span className="status-title">{MODE_TITLE[mode]}</span>
              {frame && frame.step > 0 && <span className="status-step">step {frame.step}</span>}
            </div>
            <p className="status-label">{mode === 'idle' ? 'Waiting for your agent to start a task.' : frame?.label}</p>
            <div className="tab-line">
              <span className="tab-label">Agent tab</span>
              <span className="tab-title" title={agentTab.title}>
                {agentTab.title}
              </span>
            </div>
            <div className="controls">
              {mode === 'working' && (
                <button type="button" className="primary" onClick={() => void send({ type: 'aether.control', kind: 'takeover' })}>
                  Take over
                </button>
              )}
              {mode !== 'idle' && (
                <button type="button" className="danger" onClick={() => void send({ type: 'aether.control', kind: 'stop' })}>
                  Stop run
                </button>
              )}
              <button type="button" className="link" onClick={adopt}>
                Use the current tab
              </button>
            </div>
            {notice && <p className="notice">{notice}</p>}
          </section>

          {frame?.pending && <PendingCard key={frame.pending.id} pending={frame.pending} reply={reply} />}

          <section className="steps" aria-label="Steps">
            <p className="section-title">Steps</p>
            {recent.length === 0 ? (
              <p className="empty">Each step the agent takes appears here, newest first.</p>
            ) : (
              <ol className="timeline">
                {recent.map((entry) => (
                  <li key={`${entry.step}-${entry.timestamp}-${entry.state}`} className={`event event-${modeOf(entry)}`}>
                    <span className="event-dot" />
                    <span className="event-label">{entry.label}</span>
                    <time>{time(entry.timestamp)}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      <footer className="foot">Control stays with you. Approvals only happen here.</footer>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Side panel root element is missing');
createRoot(rootElement).render(<SidePanel />);
