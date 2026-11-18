import { CodeModeCallError, type RunContext, type SpaceEngine } from '@aether/codemode';
import { ItemBucket, type BucketItem } from '@aether/perceiver';
import type { ActionItemSchema, ActionRiskSchema, ExecOutcome, PageArchetype, SpaceMethod, WaitReason } from '@aether/shared';
import type { z } from 'zod';
import type { Guarded, MCPBrowserSession, ToolOutput } from '../browser-session.js';

/*
 * space.* over the 2.0 engine (plan 3.1, Step 1), so Code Mode can be tried
 * with today's extension before the Electron app exists. One agent tab, so
 * Spaces share it and mapPages reads pages one after another. Every open and
 * act goes through the session's own policy, approvals and holds.
 */

const RETRY_AFTER_HANDBACK = 3;
const TAB_ID = 't1';

interface PageBrief {
  url: string;
  title: string;
  tabId: string;
  archetype: PageArchetype;
  landing: string[];
  skim: string;
  product?: Record<string, unknown>;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

/** Engine notes are engine text (never page text), so they may appear in an error message. */
function errorCode(text: string): 'denied' | 'refused' | 'stale_ref' | 'engine' {
  if (/denied|chose not to/i.test(text)) return 'denied';
  if (/^refuse/i.test(text)) return 'refused';
  if (/stale \[e\d+\]/.test(text)) return 'stale_ref';
  return 'engine';
}

export class SessionSpaceEngine implements SpaceEngine {
  public readonly session: MCPBrowserSession;
  /** One agent tab: page reads in mapPages take turns. */
  private tabQueue: Promise<unknown> = Promise.resolve();
  private lastBrief?: PageBrief;

  public constructor(session: MCPBrowserSession) {
    this.session = session;
  }

  public async call(method: SpaceMethod, args: unknown[], run: RunContext): Promise<unknown> {
    switch (method) {
      case 'open':
        return this.open(String(args[0]), Boolean((args[1] as { newTab?: boolean } | undefined)?.newTab), run);
      case 'skim':
        return this.skim(run);
      case 'focus': {
        const after = (args[1] as { after?: string } | undefined)?.after;
        return this.pageText(await this.settled(() => this.session.look({ ref: String(args[0]), after })), run);
      }
      case 'text': {
        const after = (args[1] as { after?: string } | undefined)?.after;
        const ref = args[0] === undefined ? undefined : String(args[0]);
        return this.pageText(await this.settled(() => this.session.look({ as: 'text', ref, after })), run);
      }
      case 'items':
        return this.items(run);
      case 'survey':
        return this.survey(args[0] as { query: string; budget?: number; minRating?: number; maxPages?: number }, run);
      case 'find': {
        const found = await this.data(() => this.session.findData(String(args[0]), args[1] === undefined ? undefined : String(args[1])));
        this.markRead(run, found.url);
        return found.matches;
      }
      case 'act':
        return this.act(args[0] as Array<z.infer<typeof ActionItemSchema>>, args[1] as { risk: z.infer<typeof ActionRiskSchema>; why: string }, run);
      case 'ask':
        return this.ask(String(args[0]), args[1] as { options?: string[]; handoff?: boolean } | undefined, run);
      case 'memory': {
        const params = (args[1] ?? {}) as { site?: string; key?: string; value?: string };
        const output = await this.settled(() => this.session.memory({ op: args[0] as 'recall' | 'save', ...params }));
        if (output.page !== undefined) this.markRead(run, output.url);
        return [...output.notes, ...(output.page ? [output.page] : [])].join('\n');
      }
      case 'logStep':
        this.session.setStep(String(args[0]), 'script');
        return undefined;
      case 'tabs': {
        return this.session.listTabs().map((tab) => ({ id: tab.id, title: tab.title, url: tab.url, state: tab.state === 'loading' || tab.state === 'live' ? 'live' : tab.state }));
      }
      case 'openTabs': {
        const options = (args[1] ?? {}) as { lazy?: boolean };
        const receipt = await this.data(() => this.session.openTabsData((args[0] as string[]).map(String), Boolean(options.lazy)));
        return receipt;
      }
      case 'switchTab': {
        const output = await this.settled(() => this.session.switchTabTo(String(args[0])));
        if (output.isError && output.page === undefined) throw new CodeModeCallError(errorCode(output.notes.join(' ')), output.notes.join(' ') || 'the engine refused this call');
        return this.brief({ ...output, notes: [] }, run);
      }
      case 'mapPage':
        // With real Space tabs each page gets its own tab; with the one agent tab the reads take turns.
        return this.exclusive(() => this.open(String(args[0]), this.session.tabs.multiTab, run));
      case 'stateGet':
      case 'stateSet':
        throw new CodeModeCallError('engine', 'space.state is handled by the Code Mode host');
    }
  }

  public pendingHuman(): { reason: WaitReason; prompt: string } | undefined {
    const waiting = this.session.run.waiting;
    return waiting ? { reason: waiting.reason, prompt: waiting.prompt } : undefined;
  }

  public runStarted(_run: RunContext, thought: string): void {
    this.session.setStep(thought, 'host');
  }

  public runEnded(_run: RunContext, _outcome: ExecOutcome): void {
    this.lastBrief = undefined;
    this.session.tabs.runEnded?.();
  }

  private async open(url: string, newTab: boolean, run: RunContext): Promise<PageBrief> {
    const output = await this.settled(() => this.session.open({ url, new_tab: newTab }));
    return this.brief(output, run);
  }

  private async skim(run: RunContext): Promise<PageBrief> {
    const output = await this.settled(() => this.session.look({}));
    // An unchanged page answers in one line; the script still needs the skim it already had.
    if (output.page === undefined && this.lastBrief) return this.lastBrief;
    return this.brief(output, run);
  }

  private async brief(output: ToolOutput, run: RunContext): Promise<PageBrief> {
    const info = this.session.pageInfo();
    this.markRead(run, output.url ?? info?.url);
    const product = output.landing ? output.landing.product : await this.session.productFacts().catch(() => undefined);
    const landingNotes = new Set(output.landing?.notes ?? []);
    const brief: PageBrief = {
      url: info?.url ?? output.url ?? '',
      title: info?.title ?? '',
      tabId: this.session.currentTabId() ?? TAB_ID,
      archetype: output.landing?.archetype ?? this.lastBrief?.archetype ?? 'other',
      landing: output.landing?.notes ?? [],
      skim: [...output.notes.filter((note) => !landingNotes.has(note)), ...(output.page ? [output.page] : [])].join('\n'),
      ...(product ? { product: { ...product } } : {}),
    };
    this.lastBrief = brief;
    return brief;
  }

  private pageText(output: ToolOutput, run: RunContext): string {
    if (output.page !== undefined) this.markRead(run, output.url);
    return [...output.notes, ...(output.page ? [output.page] : [])].join('\n');
  }

  private async items(run: RunContext): Promise<BucketItem[]> {
    const found = await this.data(() => this.session.itemsData());
    this.markRead(run, found.url);
    const bucket = new ItemBucket();
    bucket.addListingItems(found.items, found.url, 1);
    return bucket.getAll();
  }

  private async survey(criteria: { query: string; budget?: number; minRating?: number; maxPages?: number }, run: RunContext): Promise<unknown> {
    const found = await this.data(() => this.session.surveyData(criteria));
    this.markRead(run, found.url);
    const { result } = found;
    return {
      shortlist: result.shortlist.map((candidate) => ({ item: candidate.item, score: Number(candidate.score.toFixed(3)), highlights: candidate.highlights })),
      pruned: result.pruned,
      stats: { pages: found.pages, harvested: result.stats.totalHarvested },
    };
  }

  private async act(actions: Array<z.infer<typeof ActionItemSchema>>, options: { risk: z.infer<typeof ActionRiskSchema>; why: string }, run: RunContext): Promise<unknown> {
    const output = await this.settled(() => this.session.act({ actions, risk: options.risk, why: options.why }));
    const delta = output.page ?? '';
    if (output.page !== undefined) this.markRead(run, output.url);
    const head = /ok (\d+)\/(\d+)/.exec(delta);
    const stopped = /stopped by (\w+)/.exec(delta)?.[1];
    return {
      ok: Number(head?.[1] ?? 0),
      total: Number(head?.[2] ?? actions.length),
      ...(stopped ? { stoppedBy: stopped === 'navigation' || stopped === 'dialog' || stopped === 'person' ? stopped : 'failure' } : output.isError ? { stoppedBy: 'failure' } : {}),
      delta: [...output.notes, delta].filter(Boolean).join('\n'),
      url: this.session.pageInfo()?.url ?? output.url ?? '',
    };
  }

  private async ask(question: string, options: { options?: string[]; handoff?: boolean } | undefined, run: RunContext): Promise<unknown> {
    const output = await this.settled(() =>
      options?.handoff ? this.session.handOff(question) : this.session.ask({ question, options: options?.options }),
    );
    const replyNote = output.notes.find((note) => note.startsWith('answered: '));
    return { reply: replyNote ? replyNote.slice('answered: '.length) : options?.handoff ? 'done' : '', page: await this.brief({ ...output, notes: [] }, run) };
  }

  /**
   * Turn a tool output into a result for the script: keep waiting through a
   * pending request, re-run a call the person interrupted by taking over,
   * stop on Stop, and reject on a refusal or denial.
   */
  private async settled(call: () => Promise<ToolOutput>): Promise<ToolOutput> {
    let output = await call();
    for (let attempt = 0; ; attempt++) {
      const text = output.notes.join(' ');
      if (/the person stopped this run/.test(text)) throw new CodeModeCallError('stopped', 'the person stopped this run');
      const pending = /(?:pending handoff=|waiting for the person on handoff )([\w-]+)/.exec(text)?.[1];
      if (pending) {
        output = await this.session.ask({ question: '', handoff: pending });
        continue;
      }
      if (/your last call was not run/.test(text) && attempt < RETRY_AFTER_HANDBACK) {
        output = await call();
        continue;
      }
      if (output.isError && output.page === undefined) throw new CodeModeCallError(errorCode(text), text || 'the engine refused this call');
      return output;
    }
  }

  /** The data of a structured view, waiting through holds the same way as settled(). */
  private async data<T>(view: () => Promise<Guarded<T>>): Promise<T> {
    for (let attempt = 0; attempt <= RETRY_AFTER_HANDBACK; attempt++) {
      const result = await view();
      if ('data' in result) return result.data;
      const settled = await this.settled(async () => result.blocked);
      if (settled.page !== undefined && !/your last call was not run/.test(settled.notes.join(' '))) {
        throw new CodeModeCallError('engine', [...settled.notes, 'the page is blocked (an open dialog); answer it with act op=dialog first'].join(' '));
      }
    }
    throw new CodeModeCallError('engine', 'the call was interrupted repeatedly by the person taking over');
  }

  private markRead(run: RunContext, url: string | undefined): void {
    const origin = originOf(url);
    if (origin) run.markRead(origin);
  }

  /** mapPages pages share the one agent tab. */
  private exclusive<T>(body: () => Promise<T>): Promise<T> {
    const next = this.tabQueue.then(body, body);
    this.tabQueue = next.catch(() => undefined);
    return next;
  }
}
