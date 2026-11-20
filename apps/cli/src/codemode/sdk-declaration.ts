/*
 * The `space` SDK as the host model sees it (plan 3.1, section 7.2). Sent in
 * the aether_exec description and printed by `aether skill`. Keep it short:
 * every token here is paid on every host turn.
 */

export const SPACE_SDK_DECLARATION = `type Ref = string; // e12
interface PageBrief { url: string; title: string; tabId: string; archetype: string; landing: string[]; skim: string; product?: { name?: string; price?: string; availability?: string; rating?: string; seller?: string } }
interface BucketItem { key: string; ref: Ref; title: string; prices: string[]; numericPrice?: number; rating?: string; numericRating?: number; reviews?: string; notes: string[]; isSponsored: boolean; isOutOfStock: boolean; linkUrl?: string; sourceUrl: string; pageNumber: number }
interface SurveyResult { shortlist: Array<{ item: BucketItem; score: number; highlights: string[] }>; pruned: Array<{ key: string; title: string; price?: string; reason: string }>; stats: { pages: number; harvested: number } }
interface FindMatch { ref?: Ref; role: string; name: string; scope?: string }
interface ActionItem { op: 'click' | 'fill' | 'key' | 'hover' | 'scroll' | 'dialog' | 'upload'; ref?: Ref; value?: string }
interface ActDelta { ok: number; total: number; stoppedBy?: 'failure' | 'navigation' | 'dialog' | 'person'; delta: string; url: string }
declare const space: {
  open(url: string, opts?: { newTab?: boolean }): Promise<PageBrief>;
  openTabs(urls: string[], opts?: { lazy?: boolean }): Promise<{ tabIds: string[]; live: number; hibernated: number }>;
  switchTab(tabId: string): Promise<PageBrief>;
  mapPages<T>(urls: string[], fn: (page: PageBrief) => T | Promise<T>): Promise<Array<{ url: string; data?: T; error?: string }>>;
  tabs(): Promise<Array<{ id: string; title: string; url: string; state: string }>>;
  skim(): Promise<PageBrief>;
  focus(ref: Ref, opts?: { after?: string }): Promise<string>;
  text(ref?: Ref, opts?: { after?: string }): Promise<string>;
  items(): Promise<BucketItem[]>;   // scrolls the whole listing first
  survey(opts: { query: string; budget?: number; minRating?: number; maxPages?: number }): Promise<SurveyResult>;
  find(query: string, role?: string): Promise<FindMatch[]>;
  act(actions: ActionItem[], opts: { risk: 'read' | 'reversible' | 'irreversible'; why: string }): Promise<ActDelta>;
  logStep(line: string): Promise<void>;   // shown to the person
  ask(question: string, opts?: { options?: string[]; handoff?: boolean }): Promise<{ reply: string; page: PageBrief }>;
  memory(op: 'recall' | 'save', p?: { site?: string; key?: string; value?: string }): Promise<string>;
  state: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };   // kept across calls in this Space
};`;
