import { useEffect, useState } from 'react';
import type { ShellCommand, ShellSpace } from '@aether/shared';

export default function AgentBar({ entry, send, visible = true }: { entry: ShellSpace; send: (command: ShellCommand) => void; visible?: boolean }) {
  const frame = entry.frame;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!visible || !frame || !['acting', 'resuming'].includes(frame.state)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, frame?.state]);
  if (!visible || !frame || frame.state === 'idle' || entry.space.kind !== 'agent') return null;
  const waiting = frame.state === 'waiting_human';
  const done = frame.state === 'done';
  const reason = { approval: 'approval required', question: 'a question to answer', must_perform: 'your turn on this page', captcha: 'a check to solve', user_interrupted: 'you have control' };
  const label = waiting ? `Aether needs you: ${frame.pending ? reason[frame.pending.reason] : 'review this task'}` : done ? `Done · ${frame.label}` : frame.label;
  const open = entry.tabs.filter((tab) => tab.state !== 'hibernated').length;
  const seconds = Math.max(0, Math.floor((now - (frame.startedAt ?? frame.timestamp)) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const control = (kind: 'stop' | 'takeover') => send({ type: 'run.control', spaceId: entry.space.id, control: { type: 'aether.control', kind } });
  return (
    <div className={`agentbar${waiting ? ' waiting' : ''}${done ? ' done' : ''}`} role="status" aria-live="off">
      <span className={`dot ${waiting ? 'need' : done ? '' : 'act'}`} aria-hidden="true" />
      <span className="aglabel" title={label} aria-live={waiting ? 'off' : 'polite'}>{label}</span>
      {waiting && frame.pending && <span key={frame.pending.id} className="sr-only" role="alert">{label}</span>}
      {!waiting && !done && <span className="agmeta" role="timer" aria-label={`Elapsed ${elapsed}`}>{elapsed}</span>}
      <span className="agmeta">{open} open · {entry.tabs.length - open} sleeping</span>
      <span className="agactions">
        {waiting || done ? <button type="button" className={waiting ? 'primary' : ''} onClick={() => send({ type: 'panel.toggle', open: true })}>{waiting ? 'Review' : 'View activity'}</button>
          : <button type="button" onClick={() => control('takeover')}>Take over</button>}
        {!done && <button type="button" className="stop" onClick={() => control('stop')}>Stop task</button>}
      </span>
    </div>
  );
}
