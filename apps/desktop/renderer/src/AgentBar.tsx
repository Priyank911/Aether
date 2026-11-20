import { useState } from 'react';
import type { ShellCommand, ShellSpace } from '@aether/shared';

/* The Agent bar (plan 3.2, task 3.3): run state plus fixed-copy buttons. */
export default function AgentBar({ entry, send }: { entry: ShellSpace; send: (c: ShellCommand) => void }) {
  const frame = entry.frame;
  const [answer, setAnswer] = useState('');
  if (!frame || frame.state === 'idle') return null;
  const pending = frame.pending;
  const needsPerson = Boolean(pending);
  const open = entry.tabs.filter((t) => t.state !== 'hibernated').length;
  const sleeping = entry.tabs.length - open;
  const text = needsPerson && pending?.prompt ? `Aether needs you: ${pending.prompt}` : frame.label;
  const spaceId = entry.space.id;
  const control = (kind: 'stop' | 'takeover') => () => send({ type: 'run.control', spaceId, control: { type: 'aether.control', kind } });
  const reply = (kind: 'answer' | 'approve' | 'deny' | 'done' | 'resume', text?: string) => {
    if (!pending) return;
    send({ type: 'run.reply', spaceId, reply: { type: 'aether.reply', id: pending.id, kind, ...(text ? { text } : {}) } });
  };
  let actions: React.ReactNode;
  if (pending?.reason === 'approval') {
    actions = (<><button type="button" className="primary" onClick={() => reply('approve')}>Approve</button><button type="button" onClick={() => reply('deny')}>Deny</button></>);
  } else if (pending?.reason === 'question') {
    actions = (<>
      <input type="text" placeholder="Type your answer" aria-label="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && answer.trim()) { reply('answer', answer.trim()); setAnswer(''); } }} />
      <button type="button" onClick={() => { if (answer.trim()) { reply('answer', answer.trim()); setAnswer(''); } }}>Send</button>
    </>);
  } else if (pending && (pending.reason === 'must_perform' || pending.reason === 'captcha')) {
    actions = <button type="button" className="primary" onClick={() => reply('done')}>I'm done</button>;
  } else if (pending?.reason === 'user_interrupted') {
    actions = <button type="button" className="primary" onClick={() => reply('resume')}>Hand back to Aether</button>;
  } else {
    actions = <button type="button" onClick={control('takeover')}>Take over</button>;
  }
  return (
    <div className={`agentbar${needsPerson ? ' waiting' : ''}`} role="status" aria-live="polite">
      <span className={`dot ${needsPerson ? 'need' : 'act'}`} aria-hidden="true" />
      <span className="aglabel">{text.length > 160 ? `${text.slice(0, 159)}…` : text}</span>
      <span className="agmeta">{open} open · {sleeping} sleeping</span>
      <span className="agactions">{actions}<button type="button" className="stop" onClick={control('stop')}>Stop task</button></span>
    </div>
  );
}
