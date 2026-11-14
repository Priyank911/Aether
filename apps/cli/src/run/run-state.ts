import { randomUUID } from 'node:crypto';
import type { ApprovalDetail, HumanReply, Pending, RunControl, RunStateFrame, RunStateName, WaitReason } from '@aether/shared';

/** How long a tool call is held before it returns a pending handoff id. Below common host tool timeouts. */
export const HOLD_TIMEOUT_MS = 50000;

/** Which replies settle which waits. Anything else is ignored. */
const ACCEPTED: Record<WaitReason, ReadonlyArray<HumanReply['kind']>> = {
  question: ['answer'],
  approval: ['approve', 'deny'],
  must_perform: ['done'],
  captcha: ['done'],
  user_interrupted: ['resume'],
};

/**
 * The one run state machine. Tool results, the page overlay and the side panel
 * all render its frames. Only a human reply that matches the pending request
 * moves it out of waiting_human; a model-supplied argument never does.
 */
export class RunState {
  private name: RunStateName = 'idle';
  private step = 0;
  private label = 'Waiting for the agent';
  private pending?: Pending;
  private readonly settled = new Map<string, HumanReply>();
  private readonly waiters = new Map<string, (reply: HumanReply | undefined) => void>();
  private readonly listeners = new Set<(frame: RunStateFrame) => void>();
  private stopRequested = false;
  public holdTimeoutMs = HOLD_TIMEOUT_MS;

  public get state(): RunStateName {
    return this.name;
  }

  public get waiting(): Pending | undefined {
    return this.pending;
  }

  public onFrame(listener: (frame: RunStateFrame) => void): () => void {
    this.listeners.add(listener);
    listener(this.frame());
    return () => this.listeners.delete(listener);
  }

  public frame(): RunStateFrame {
    return { type: 'aether.state', state: this.name, step: this.step, label: this.label, pending: this.pending, timestamp: Date.now() };
  }

  /** A tool call started. */
  public acting(label: string): void {
    this.name = 'acting';
    this.step++;
    this.label = label.slice(0, 120);
    this.emit();
  }

  public idle(label = 'Run ended'): void {
    this.name = 'idle';
    this.label = label;
    this.pending = undefined;
    this.stopRequested = false;
    this.emit();
  }

  /** Enter waiting_human with one request for the person. */
  public hold(reason: WaitReason, prompt: string, extra: { options?: string[]; approval?: ApprovalDetail } = {}): Pending {
    const pending: Pending = { id: randomUUID().slice(0, 8), reason, prompt: prompt.slice(0, 500), createdAt: Date.now(), ...extra };
    this.pending = pending;
    this.name = 'waiting_human';
    this.label = reason === 'approval' ? 'Waiting for your approval' : reason === 'question' ? 'Waiting for your answer' : 'Waiting for you';
    this.emit();
    return pending;
  }

  /** Wait for the reply to a pending request. Undefined after the timeout; the request stays pending. */
  public async waitFor(id: string, timeoutMs = this.holdTimeoutMs): Promise<HumanReply | undefined> {
    const early = this.settled.get(id);
    if (early) {
      this.settled.delete(id);
      return early;
    }
    if (this.pending?.id !== id) throw new Error(`no pending handoff ${id}`);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolve(undefined);
      }, timeoutMs);
      this.waiters.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
    });
  }

  /** A reply from the person. Returns false when it does not match the pending request. */
  public receive(reply: HumanReply): boolean {
    const pending = this.pending;
    if (!pending || pending.id !== reply.id || !ACCEPTED[pending.reason].includes(reply.kind)) return false;
    this.pending = undefined;
    this.name = 'resuming';
    this.label = 'Picking up where you left off';
    this.emit();
    const waiter = this.waiters.get(reply.id);
    if (waiter) {
      this.waiters.delete(reply.id);
      waiter(reply);
    } else {
      this.settled.set(reply.id, reply);
    }
    return true;
  }

  /**
   * Stop and Take over act at once, not at the agent's next call. Take over
   * moves the run to waiting_human(user_interrupted) right away, so the page
   * unlocks and turns amber; Stop ends the run and releases any held call.
   */
  public control(control: RunControl): void {
    if (control.kind === 'stop') {
      if (this.name === 'idle') return;
      this.stopRequested = true;
      this.pending = undefined;
      this.name = 'idle';
      this.label = 'Stopped by you';
      this.emit();
      for (const waiter of this.waiters.values()) waiter(undefined);
      this.waiters.clear();
      return;
    }
    if (this.name === 'idle' || this.pending) return;
    this.hold('user_interrupted', 'You have control of the tab. Press Resume to hand it back.');
  }

  public consumeStop(): boolean {
    const requested = this.stopRequested;
    this.stopRequested = false;
    return requested;
  }

  /** True while the person has taken over or stopped the run; a running batch stops before its next action. */
  public get interrupted(): boolean {
    return this.stopRequested || this.pending?.reason === 'user_interrupted';
  }

  private emit(): void {
    const frame = this.frame();
    for (const listener of this.listeners) listener(frame);
  }
}
