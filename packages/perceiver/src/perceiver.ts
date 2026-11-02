import type { CDPSession, FrameManager } from '@aether/cdp';
import type { Delta, OutlineSnapshot, ParsedElement } from '@aether/shared';
import { AXExtractor, type RawAXNode } from './extractor.js';
import { RefRegistry } from './registry.js';
import { OutlineSerializer, type FrameElementsData } from './serializer.js';

export class Perceiver {
  public readonly registry: RefRegistry;
  private lastSnapshot?: OutlineSnapshot;

  constructor(registry = new RefRegistry()) {
    this.registry = registry;
  }

  public onNavigation(): void {
    this.registry.resetMappings();
    this.lastSnapshot = undefined;
  }

  public async capture(
    mainSession: CDPSession,
    frameManager: FrameManager,
  ): Promise<OutlineSnapshot> {
    // 1. Get title and URL
    const evalResult = await mainSession.send<{ result: { value: { title: string; url: string } } }>(
      'Runtime.evaluate',
      {
        expression: '({ title: document.title, url: window.location.href })',
        returnByValue: true,
      },
    );
    const pageTitle = evalResult.result.value?.title || '';
    const pageUrl = evalResult.result.value?.url || 'about:blank';

    // 2. Fetch frames
    const allFrames = frameManager.allFrames;
    const framesCount = Math.max(1, allFrames.length);

    const framesData: FrameElementsData[] = [];

    // Main frame (ordinal 0)
    try {
      const mainAxResult = await mainSession.send<{ nodes: RawAXNode[] }>(
        'Accessibility.getFullAXTree',
      );
      const mainElements = AXExtractor.extractFrameElements(
        mainAxResult.nodes || [],
        0,
        this.registry,
      );
      framesData.push({
        frameOrdinal: 0,
        frameUrl: pageUrl,
        elements: mainElements,
      });
    } catch {
      framesData.push({
        frameOrdinal: 0,
        frameUrl: pageUrl,
        elements: [],
      });
    }

    // Child frames (ordinal > 0)
    for (const frame of allFrames) {
      if (frame.ordinal === 0) continue;

      let childElements: ParsedElement[] = [];

      // If frame has its own child session (e.g. OOPIF)
      if (frame.sessionId && frame.sessionId !== mainSession.sessionId) {
        try {
          const childSession = (mainSession as unknown as { client: { getSession: (id: string) => CDPSession | undefined } }).client.getSession(frame.sessionId);
          if (childSession && !childSession.isDetached) {
            const childAxResult = await childSession.send<{ nodes: RawAXNode[] }>(
              'Accessibility.getFullAXTree',
            );
            childElements = AXExtractor.extractFrameElements(
              childAxResult.nodes || [],
              frame.ordinal,
              this.registry,
            );
          }
        } catch {
          // Frame may be dead or navigating
        }
      } else {
        // Same-origin or embedded in main session
        try {
          const axResult = await mainSession.send<{ nodes: RawAXNode[] }>(
            'Accessibility.getFullAXTree',
            { frameId: frame.frameId },
          );
          childElements = AXExtractor.extractFrameElements(
            axResult.nodes || [],
            frame.ordinal,
            this.registry,
          );
        } catch {
          // Fallback or empty if not supported
        }
      }

      framesData.push({
        frameOrdinal: frame.ordinal,
        frameUrl: frame.url || `frame-${frame.ordinal}`,
        elements: childElements,
      });
    }

    // 3. Serialize outline
    const snapshot = OutlineSerializer.serialize(
      pageUrl,
      pageTitle,
      framesCount,
      framesData,
    );

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  public computeDelta(
    current: OutlineSnapshot,
    previous: OutlineSnapshot | undefined = this.lastSnapshot,
    step = 1,
  ): Delta {
    if (!previous) {
      return {
        step,
        status: 'ok',
        urlChanged: true,
        url: current.url,
        added: current.elements,
        changed: [],
        removed: [],
        formattedText: current.formattedText,
        tokenEstimate: current.tokenEstimate,
      };
    }

    const prevMap = new Map<string, ParsedElement>();
    for (const el of previous.elements) {
      prevMap.set(el.ref, el);
    }

    const currMap = new Map<string, ParsedElement>();
    for (const el of current.elements) {
      currMap.set(el.ref, el);
    }

    const added: ParsedElement[] = [];
    const changed: ParsedElement[] = [];
    const removed: string[] = [];

    // Check for added and changed
    for (const [ref, currEl] of currMap.entries()) {
      const prevEl = prevMap.get(ref);
      if (!prevEl) {
        added.push(currEl);
      } else {
        const isDiff =
          prevEl.name !== currEl.name ||
          prevEl.value !== currEl.value ||
          prevEl.role !== currEl.role ||
          JSON.stringify(prevEl.states) !== JSON.stringify(currEl.states);
        if (isDiff) {
          changed.push(currEl);
        }
      }
    }

    // Check for removed
    for (const ref of prevMap.keys()) {
      if (!currMap.has(ref)) {
        removed.push(ref);
      }
    }

    const urlChanged = current.url !== previous.url;
    const frameChanged = current.framesCount !== previous.framesCount;
    const totalCurrent = Math.max(1, current.elements.length);
    const changedRatio = (added.length + changed.length + removed.length) / totalCurrent;

    // Plan section 7.1: Send a full snapshot instead of a delta on navigation,
    // on a frame change, or when more than 40 percent of elements changed.
    if (urlChanged || frameChanged || changedRatio > 0.4) {
      return {
        step,
        status: 'ok',
        urlChanged,
        url: current.url,
        added: current.elements,
        changed: [],
        removed: [],
        formattedText: current.formattedText,
        tokenEstimate: current.tokenEstimate,
      };
    }

    // Build delta formatted text
    const lines: string[] = [];
    const statusLine = `step ${step} ok | ${urlChanged ? `url -> ${current.url}` : 'url unchanged'}`;
    lines.push(statusLine);

    for (const el of added) {
      lines.push(`+ [${el.ref}] ${el.role} "${el.name}"${el.value !== undefined ? ` value="${el.value}"` : ''}`);
    }
    for (const el of changed) {
      lines.push(`~ [${el.ref}] ${el.role} "${el.name}"${el.value !== undefined ? ` value="${el.value}"` : ''}`);
    }
    for (const ref of removed) {
      lines.push(`- [${ref}]`);
    }

    const formattedText = lines.join('\n');
    const tokenEstimate = Math.ceil(formattedText.length / 4);

    return {
      step,
      status: 'ok',
      urlChanged,
      url: current.url,
      added,
      changed,
      removed,
      formattedText,
      tokenEstimate,
    };
  }
}
