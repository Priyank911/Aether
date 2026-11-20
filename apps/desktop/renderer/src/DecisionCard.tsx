import { useEffect, useRef, useState } from 'react';
import { isSecretText, type Pending, type ShellCommand } from '@aether/shared';

export default function DecisionCard({ pending, spaceId }: { pending: Pending; spaceId: string }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const primary = useRef<HTMLButtonElement>(null);
  const approval = pending.approval;
  const urls = approval?.urls;
  const title = pending.reason === 'approval' ? urls?.length ? `Open ${urls.length} new sites?` : `Approve this step on ${approval?.site || 'this site'}?`
    : pending.reason === 'question' ? 'Aether has a question'
    : pending.reason === 'user_interrupted' ? 'You have control'
    : pending.reason === 'captcha' ? 'Solve the check on this page' : 'Your turn';
  useEffect(() => { primary.current?.focus(); }, []);
  const reply = async (kind: 'approve' | 'deny' | 'answer' | 'done' | 'resume') => {
    if (busy) return;
    setBusy(true); setError('');
    const command: ShellCommand = { type: 'run.reply', spaceId, reply: { type: 'aether.reply', id: pending.id, kind, ...(kind === 'answer' ? { text: answer.trim() } : {}) } };
    try {
      const result = await window.aether.send(command) as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error ?? 'This request changed. Review the current task and try again.');
    } catch { setError('Could not send your reply. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="decision-card" role="dialog" aria-labelledby="decision-title" aria-describedby="decision-copy" aria-busy={busy}>
      <span className="panel-eyebrow">Needs you</span><h2 id="decision-title">{title}</h2>
      {pending.reason === 'user_interrupted' ? <p id="decision-copy">Aether is paused. Use the page, then hand it back.</p> : <blockquote id="decision-copy">{pending.prompt}</blockquote>}
      {urls?.length ? <ul className="approval-urls">{urls.map((url, index) => <li key={`${index}:${url}`}><code>{url}</code></li>)}</ul> : approval && <blockquote className="approval-element">{approval.element}</blockquote>}
      {approval?.values.length ? <dl className="approval-values">{approval.values.map((value, index) => <div key={`${index}:${value.label}`}><dt>{value.label}</dt><dd>{/password|secret|token|otp|cvv|card|pin/i.test(value.label) || isSecretText(value.value) ? '••••••••' : value.value}</dd></div>)}</dl> : null}
      {approval && <div className="agent-claim"><strong>Aether says</strong><p>{approval.agentReason}</p></div>}
      {pending.reason === 'question' && <form id="answer-form" onSubmit={(event) => { event.preventDefault(); if (answer.trim()) void reply('answer'); }}>
        {pending.options?.length ? <fieldset><legend>Choose an answer</legend>{pending.options.map((option, index) => <label key={`${index}:${option}`}><input type="radio" name="answer" value={option} checked={answer === option} onChange={() => setAnswer(option)} />{option}</label>)}</fieldset>
          : <label>Your answer<textarea maxLength={2000} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer" /></label>}
      </form>}
      <div className="decision-actions">
        {pending.reason === 'approval' ? <><button ref={primary} type="button" className="primary" disabled={busy} onClick={() => { void reply('approve'); }}>{urls?.length ? 'Open all' : 'Approve'}</button><button type="button" disabled={busy} onClick={() => { void reply('deny'); }}>Deny</button></>
          : <button ref={primary} type={pending.reason === 'question' ? 'submit' : 'button'} form={pending.reason === 'question' ? 'answer-form' : undefined} className="primary" disabled={busy} aria-disabled={pending.reason === 'question' && !answer.trim() ? true : undefined}
            onClick={pending.reason === 'question' ? undefined : () => { void reply(pending.reason === 'user_interrupted' ? 'resume' : 'done'); }}>
            {pending.reason === 'question' ? 'Send answer' : pending.reason === 'user_interrupted' ? 'Hand back to Aether' : "I'm done"}
          </button>}
      </div>
      {error && <p className="panel-error" role="alert">{error}</p>}
    </section>
  );
}
