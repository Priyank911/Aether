import type { CDPSession } from '@aether/cdp';
import { capturePage, type CaptureState } from './capture/page.js';
import { RefRegistry } from './registry.js';
import { StaleRefError } from './stale.js';
import type { PageModel, PageNode } from './types.js';

export interface RefTarget {
  ref: string;
  node: PageNode;
  session: CDPSession;
  backendDOMNodeId: number;
  frameOrdinal: number;
}

/** Perception for one agent tab: captures page models and resolves refs against the latest one. */
export class Perceiver {
  public readonly registry = new RefRegistry();
  public readonly session: CDPSession;
  private readonly state: CaptureState;
  private latest?: PageModel;

  constructor(session: CDPSession) {
    this.session = session;
    this.state = { registry: this.registry, ordinals: new Map(), nextOrdinal: 1 };
  }

  public get last(): PageModel | undefined {
    return this.latest;
  }

  public async capture(): Promise<PageModel> {
    const model = await capturePage(this.session, this.state);
    this.latest = model;
    return model;
  }

  /**
   * Clear every ref so the next capture assigns fresh ones, for example after a
   * human acted in the tab. The counter keeps rising, so old refs fail loudly.
   */
  public forgetRefs(): void {
    this.state.documentId = undefined;
    this.latest = undefined;
  }

  /** Resolve a ref against the latest capture. Refs never re-bind to another element. */
  public target(ref: string, model: PageModel | undefined = this.latest): RefTarget {
    const node = model?.byRef.get(ref);
    const mapping = this.registry.resolve(ref);
    if (!model || !node || !mapping || mapping.backendDOMNodeId !== node.backendDOMNodeId) throw new StaleRefError(ref);
    const frame = model.frames.find((candidate) => candidate.ordinal === node.frameOrdinal);
    if (!frame || frame.session.isDetached) throw new StaleRefError(ref);
    return { ref, node, session: frame.session, backendDOMNodeId: node.backendDOMNodeId, frameOrdinal: node.frameOrdinal };
  }
}
