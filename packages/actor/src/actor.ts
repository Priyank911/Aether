import type { CDPSession } from '@aether/cdp';
import {
  computeDelta,
  nodeLine,
  renderSkim,
  StaleRefError,
  type PageDelta,
  type PageModel,
  type PageNode,
  type Perceiver,
  type RefTarget,
} from '@aether/perceiver';
import { ActParamsSchema, type ActionItem } from '@aether/shared';
import { fill } from './fill.js';
import { ActionBlockedError, announceAgentInput, assertReachable, centreOf, type Point } from './geometry.js';
import { parseChord, pressChord } from './keys.js';
import { clickAt, moveTo, wheelAt } from './mouse.js';
import type { OpenDialog, PageWatcher } from './page-watch.js';
import { waitForSettle } from './settle.js';
import { uploadFile } from './upload.js';
import path from 'node:path';

const BETWEEN_ACTIONS_MS = 80;
const NEEDS_REF = new Set(['click', 'fill', 'hover', 'upload']);

export type StopReason = 'navigation' | 'dialog' | 'person';

export interface ActionResult {
  success: boolean;
  executedCount: number;
  total: number;
  error?: string;
  stoppedBy?: StopReason;
  settled: boolean;
  /** Undefined while a dialog blocks the page; nothing can be captured then. */
  delta?: PageDelta;
  model: PageModel;
  dialog?: OpenDialog;
  notes: string[];
  /** The result as the model receives it, before the untrusted wrapper. */
  text: string;
}

interface LayoutMetrics {
  cssLayoutViewport: { clientWidth: number; clientHeight: number };
}

export function describeDialog(dialog: OpenDialog): string {
  const message = dialog.message.replace(/\s+/g, ' ').trim().slice(0, 200);
  return `dialog ${dialog.type} "${message}" is open: answer with act op=dialog value=accept or value=dismiss`;
}

function isMissingNode(error: unknown): boolean {
  return error instanceof Error && /No node with given id|Could not find node|Node with given id does not belong/i.test(error.message);
}

/** Runs a batch of grounded actions against the latest capture and reports what changed. */
export class Actor {
  private readonly perceiver: Perceiver;
  private readonly watcher: PageWatcher;

  constructor(perceiver: Perceiver, watcher: PageWatcher) {
    this.perceiver = perceiver;
    this.watcher = watcher;
  }

  /** `interrupted` is checked before each action; when it returns true the batch stops and the person has control. */
  public async execute(rawParams: unknown, step = 1, interrupted: () => boolean = () => false): Promise<ActionResult> {
    const params = ActParamsSchema.parse(rawParams);
    const before = this.perceiver.last ?? (await this.perceiver.capture());
    const labels = new Map<string, PageNode>();
    for (const node of before.byRef.values()) labels.set(`${node.frameOrdinal}:${node.backendDOMNodeId}`, node);

    const navigationsBefore = this.watcher.navigations;
    const notes: string[] = [];
    let executedCount = 0;
    let error: string | undefined;
    let stoppedBy: StopReason | undefined;

    for (const [index, action] of params.actions.entries()) {
      if (this.watcher.dialog && action.op !== 'dialog') {
        stoppedBy = 'dialog';
        break;
      }
      if (interrupted()) {
        stoppedBy = 'person';
        break;
      }
      try {
        const note = await this.run(action, before, labels);
        if (note) notes.push(`${index + 1}: ${note}`);
        executedCount++;
      } catch (caught) {
        error = this.explain(caught, action);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_ACTIONS_MS));
      if (this.watcher.dialog) {
        stoppedBy = 'dialog';
        break;
      }
      if (this.watcher.navigations !== navigationsBefore && index < params.actions.length - 1) {
        stoppedBy = 'navigation';
        break;
      }
    }

    const total = params.actions.length;
    const header = (delta: PageDelta | undefined, settled: boolean): string => {
      const parts = [`step ${step} ${error ? 'failed' : 'ok'} ${executedCount}/${total}`];
      if (delta) {
        parts.push(delta.urlChanged ? `url -> ${delta.url}` : 'url unchanged');
        if (delta.scrollFrom !== delta.scrollTo) parts.push(`scroll ${delta.scrollFrom}% -> ${delta.scrollTo}%`);
      }
      if (stoppedBy && executedCount < total) parts.push(`stopped by ${stoppedBy}, ${total - executedCount - (error ? 1 : 0)} not run`);
      if (!settled) parts.push('page still changing');
      return parts.join(' | ');
    };

    if (this.watcher.dialog) {
      const lines = [header(undefined, true)];
      if (error) lines.push(`error: ${error}`);
      lines.push(...notes, describeDialog(this.watcher.dialog));
      return { success: !error, executedCount, total, error, stoppedBy: 'dialog', settled: true, model: before, dialog: this.watcher.dialog, notes, text: lines.join('\n') };
    }

    const settled = await waitForSettle(this.perceiver.session, this.watcher);
    const model = await this.perceiver.capture();
    const delta = computeDelta(before, model);
    const lines = [header(delta, settled)];
    if (error) lines.push(`error: ${error}`);
    lines.push(...notes);
    if (delta.full) lines.push(`page changed (${delta.reason}):`, renderSkim(model).text);
    else if (delta.lines.length > 0) lines.push(...delta.lines);
    else lines.push('no page change observed');

    return { success: !error, executedCount, total, error, stoppedBy, settled, delta, model, notes, text: lines.join('\n') };
  }

  private explain(caught: unknown, action: ActionItem): string {
    if (caught instanceof StaleRefError) return caught.message;
    if (isMissingNode(caught) && action.ref) return new StaleRefError(action.ref).message;
    const message = caught instanceof Error ? caught.message : String(caught);
    const subject = action.ref ? `${action.op} [${action.ref}]` : action.op;
    if (/delivery is unverified/.test(message)) {
      return `${subject} unverified: the connection dropped before Chrome replied, so it may have reached the page. Look before retrying.`;
    }
    return caught instanceof ActionBlockedError ? `${subject} not done: ${message}` : `${subject} failed: ${message}`;
  }

  private async run(action: ActionItem, before: PageModel, labels: Map<string, PageNode>): Promise<string | undefined> {
    if (NEEDS_REF.has(action.op) && !action.ref) throw new ActionBlockedError(`${action.op} needs a ref`);
    // An open dialog blocks page scripts, so the overlay cannot be told; the dialog answer needs no page input anyway.
    if (action.op !== 'dialog') await announceAgentInput(this.perceiver.session);
    const target = action.ref ? this.perceiver.target(action.ref, before) : undefined;
    const labelIn = (ordinal: number) => (backendId: number): string | undefined => {
      const node = labels.get(`${ordinal}:${backendId}`);
      return node?.ref ? nodeLine(node) : undefined;
    };
    const reachableClick = async (resolved: RefTarget): Promise<void> => {
      const point = await centreOf(resolved.session, resolved.backendDOMNodeId);
      await assertReachable(resolved.session, resolved.backendDOMNodeId, point, labelIn(resolved.frameOrdinal));
      await clickAt(resolved.session, point);
    };

    switch (action.op) {
      case 'click':
        if (target) await reachableClick(target);
        return undefined;
      case 'fill':
        if (!target) return undefined;
        return fill(
          { session: target.session, backendNodeId: target.backendDOMNodeId, node: target.node, click: () => reachableClick(target) },
          action.value ?? '',
        );
      case 'hover':
        if (target) await moveTo(target.session, await centreOf(target.session, target.backendDOMNodeId));
        return undefined;
      case 'key': {
        const chord = parseChord(action.value ?? 'Enter');
        if (target) await target.session.send('DOM.focus', { backendNodeId: target.backendDOMNodeId });
        await pressChord(target?.session ?? this.perceiver.session, chord);
        return undefined;
      }
      case 'scroll':
        await this.scroll(target, action.value ?? 'down');
        return undefined;
      case 'dialog':
        await this.answerDialog(action.value ?? 'accept');
        return undefined;
      case 'upload':
        if (target) await uploadFile(target.session, target.backendDOMNodeId, action.value ?? '');
        return action.value ? `attached ${path.basename(action.value)}` : undefined;
    }
  }

  private async scroll(target: RefTarget | undefined, direction: string): Promise<void> {
    const session: CDPSession = target?.session ?? this.perceiver.session;
    const metrics = await this.perceiver.session.send<LayoutMetrics>('Page.getLayoutMetrics');
    const height = metrics.cssLayoutViewport.clientHeight;
    const distances: Record<string, number> = { down: height * 0.8, up: -height * 0.8, bottom: 1e6, top: -1e6 };
    const deltaY = distances[direction.trim().toLowerCase()];
    if (deltaY === undefined) throw new ActionBlockedError(`scroll takes up, down, top or bottom, got "${direction}"`);
    const point: Point = target
      ? await centreOf(target.session, target.backendDOMNodeId)
      : { x: Math.round(metrics.cssLayoutViewport.clientWidth / 2), y: Math.round(height / 2) };
    await wheelAt(session, point, deltaY);
  }

  private async answerDialog(value: string): Promise<void> {
    if (!this.watcher.dialog) throw new ActionBlockedError('no dialog is open');
    const [choice = '', ...rest] = value.split(':');
    const answer = choice.trim().toLowerCase();
    if (answer !== 'accept' && answer !== 'dismiss') throw new ActionBlockedError(`dialog takes accept, dismiss or accept:text, got "${value}"`);
    await this.perceiver.session.send('Page.handleJavaScriptDialog', {
      accept: answer === 'accept',
      ...(rest.length > 0 ? { promptText: rest.join(':') } : {}),
    });
    this.watcher.dialog = undefined;
  }
}
