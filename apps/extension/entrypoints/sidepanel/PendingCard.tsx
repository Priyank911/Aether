import React from 'react';
import type { HumanReply, Pending } from '@aether/shared';

interface Props {
  pending: Pending;
  reply: (kind: HumanReply['kind'], text?: string) => void;
}

function QuestionCard({ pending, reply }: Props) {
  const [text, setText] = React.useState('');
  return (
    <>
      <p className="card-prompt">{pending.prompt}</p>
      {pending.options && (
        <div className="choices">
          {pending.options.map((option) => (
            <button key={option} type="button" className="choice" onClick={() => reply('answer', option)}>
              {option}
            </button>
          ))}
        </div>
      )}
      <form
        className="answer"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) reply('answer', text.trim());
        }}
      >
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type an answer" aria-label="Answer" />
        <button type="submit" className="primary" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </>
  );
}

function ApprovalCard({ pending, reply }: Props) {
  const detail = pending.approval;
  return (
    <>
      <p className="card-prompt">{pending.prompt}</p>
      {detail && (
        <dl className="facts">
          <dt>Site</dt>
          <dd>{detail.site}</dd>
          <dt>Element</dt>
          <dd className="mono">{detail.element}</dd>
          {detail.values.length > 0 && (
            <>
              <dt>Will send</dt>
              <dd>
                <ul className="values">
                  {detail.values.map((value) => (
                    <li key={`${value.label}-${value.value}`}>
                      <span>{value.label}</span>
                      <span className="mono">{value.value}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          <dt>Agent says</dt>
          <dd className="claim">{detail.agentReason}</dd>
        </dl>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={() => reply('approve')}>
          Approve
        </button>
        <button type="button" onClick={() => reply('deny')}>
          Deny
        </button>
      </div>
    </>
  );
}

function PerformCard({ pending, reply }: Props) {
  return (
    <>
      <p className="card-prompt">{pending.prompt}</p>
      <button type="button" className="primary" onClick={() => reply('done')}>
        I've done it
      </button>
    </>
  );
}

function ControlCard({ reply }: Props) {
  return (
    <>
      <p className="card-prompt">You have control of the agent tab. The agent waits until you hand it back.</p>
      <button type="button" className="primary" onClick={() => reply('resume')}>
        Resume
      </button>
    </>
  );
}

const TITLES: Record<Pending['reason'], string> = {
  question: 'Question',
  approval: 'Approval needed',
  must_perform: 'Your turn',
  captcha: 'CAPTCHA',
  user_interrupted: 'You took over',
};

/** One card for whatever the run is waiting on. Only these buttons can unlock a held step. */
export function PendingCard(props: Props) {
  const { pending } = props;
  return (
    <section className={`card card-${pending.reason}`} aria-live="polite">
      <p className="card-title">{TITLES[pending.reason]}</p>
      {pending.reason === 'question' && <QuestionCard {...props} />}
      {pending.reason === 'approval' && <ApprovalCard {...props} />}
      {(pending.reason === 'must_perform' || pending.reason === 'captcha') && <PerformCard {...props} />}
      {pending.reason === 'user_interrupted' && <ControlCard {...props} />}
    </section>
  );
}
