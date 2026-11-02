import { describe, expect, it } from 'vitest';
import { ReplayCache } from '@aether/actor';
import { HistoryCompactor, type ActionItem, type OutlineSnapshot, type ParsedElement } from '@aether/shared';
import { Perceiver, OutlineSerializer } from '@aether/perceiver';

describe('Step 7 Optimization: Replay, History Compaction, Viewport Filter & Delta Thresholds', () => {
  describe('ReplayCache (Zero-Token Caching)', () => {
    const makeElements = (): ParsedElement[] => [
      { ref: 'e1', backendDOMNodeId: 10, frameOrdinal: 0, role: 'textbox', name: 'Search', states: [] },
      { ref: 'e2', backendDOMNodeId: 11, frameOrdinal: 0, role: 'button', name: 'Submit', states: [] },
    ];

    it('computes a consistent structural hash from elements', () => {
      const elements1 = makeElements();
      const elements2 = makeElements();
      const hash1 = ReplayCache.computeStructureHash(elements1);
      const hash2 = ReplayCache.computeStructureHash(elements2);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(40); // SHA-1 hex
    });

    it('records and returns cached actions for identical site, goal, and structure', () => {
      const cache = new ReplayCache();
      const elements = makeElements();
      const hash = ReplayCache.computeStructureHash(elements);
      const actions: ActionItem[] = [
        { ref: 'e1', op: 'type', value: 'shoes' },
        { ref: 'e2', op: 'click' },
      ];

      cache.record('https://shop.example.com/search', 'search for shoes', hash, actions);
      expect(cache.size()).toBe(1);

      const hit = cache.get('https://shop.example.com/search', 'search for shoes', hash);
      expect(hit).toBeDefined();
      expect(hit).toEqual(actions);
    });

    it('returns undefined when goal or structure hash differs', () => {
      const cache = new ReplayCache();
      const elements = makeElements();
      const hash = ReplayCache.computeStructureHash(elements);
      cache.record('https://shop.example.com/search', 'search shoes', hash, [{ ref: 'e1', op: 'click' }]);

      // Different goal
      expect(cache.get('https://shop.example.com/search', 'search coats', hash)).toBeUndefined();
      // Different hash
      expect(cache.get('https://shop.example.com/search', 'search shoes', 'different_hash')).toBeUndefined();
    });

    it('invalidates cache entries by site', () => {
      const cache = new ReplayCache();
      const hash = ReplayCache.computeStructureHash(makeElements());
      cache.record('https://site-a.com', 'goal 1', hash, [{ ref: 'e1', op: 'click' }]);
      cache.record('https://site-b.com', 'goal 2', hash, [{ ref: 'e1', op: 'click' }]);

      expect(cache.size()).toBe(2);
      const removed = cache.invalidate('https://site-a.com');
      expect(removed).toBe(true);
      expect(cache.size()).toBe(1);
      expect(cache.get('https://site-a.com', 'goal 1', hash)).toBeUndefined();
      expect(cache.get('https://site-b.com', 'goal 2', hash)).toBeDefined();
    });
  });

  describe('HistoryCompactor (Batch Compaction & Window Retention)', () => {
    it('maintains recent window verbatim when under threshold', () => {
      const compactor = new HistoryCompactor({ windowSize: 4, maxUncompactedSteps: 6 });
      compactor.addStep({ step: 1, actor: 'agent', action: 'navigate /home', outcome: 'ok' });
      compactor.addStep({ step: 2, actor: 'agent', action: 'click e1', outcome: 'url /login' });

      const output = compactor.render();
      expect(output).toContain('1 navigate /home -> ok');
      expect(output).toContain('2 click e1 -> url /login');
      expect(output).not.toContain('Summary');
    });

    it('folds older steps into a summary when exceeding threshold while keeping windowSize verbatim', () => {
      const compactor = new HistoryCompactor({ windowSize: 3, maxUncompactedSteps: 5 });

      for (let i = 1; i <= 6; i++) {
        compactor.addStep({
          step: i,
          actor: 'agent',
          action: `action-${i}`,
          outcome: `result-${i}`,
        });
      }

      const output = compactor.render();
      // Steps 1 to 2 folded when threshold 5 was reached
      expect(output).toContain('[Summary steps 1-2:');
      expect(output).toContain('action-1 (result-1)');
      // Recent steps are kept verbatim
      expect(output).toContain('3 action-3 -> result-3');
      expect(output).toContain('4 action-4 -> result-4');
      expect(output).toContain('5 action-5 -> result-5');
      expect(output).toContain('6 action-6 -> result-6');
      expect(output).not.toContain('\n1 action-1 -> result-1');
    });
  });

  describe('Delta Perception Optimization (Section 7.1 Rules)', () => {
    const perceiver = new Perceiver();

    const makeSnapshot = (
      elements: ParsedElement[],
      url = 'https://example.com/page',
      framesCount = 1,
    ): OutlineSnapshot => ({
      url,
      title: 'Test Page',
      framesCount,
      elements,
      formattedText: `page ${url}\n${elements.map((e) => `[${e.ref}] ${e.role} "${e.name}"`).join('\n')}`,
      tokenEstimate: 50,
      truncated: false,
    });

    it('produces compact delta when changes are below 40% threshold', () => {
      const prevElements: ParsedElement[] = [
        { ref: 'e1', backendDOMNodeId: 1, frameOrdinal: 0, role: 'textbox', name: 'Name', states: [] },
        { ref: 'e2', backendDOMNodeId: 2, frameOrdinal: 0, role: 'button', name: 'Submit', states: [] },
        { ref: 'e3', backendDOMNodeId: 3, frameOrdinal: 0, role: 'link', name: 'Help', states: [] },
        { ref: 'e4', backendDOMNodeId: 4, frameOrdinal: 0, role: 'link', name: 'Terms', states: [] },
        { ref: 'e5', backendDOMNodeId: 5, frameOrdinal: 0, role: 'link', name: 'Privacy', states: [] },
      ];
      const prev = makeSnapshot(prevElements);

      // Change only e1 (1 out of 5 = 20% < 40%)
      const currElements: ParsedElement[] = [
        { ref: 'e1', backendDOMNodeId: 1, frameOrdinal: 0, role: 'textbox', name: 'Name', value: 'Alice', states: [] },
        { ref: 'e2', backendDOMNodeId: 2, frameOrdinal: 0, role: 'button', name: 'Submit', states: [] },
        { ref: 'e3', backendDOMNodeId: 3, frameOrdinal: 0, role: 'link', name: 'Help', states: [] },
        { ref: 'e4', backendDOMNodeId: 4, frameOrdinal: 0, role: 'link', name: 'Terms', states: [] },
        { ref: 'e5', backendDOMNodeId: 5, frameOrdinal: 0, role: 'link', name: 'Privacy', states: [] },
      ];
      const curr = makeSnapshot(currElements);

      const delta = perceiver.computeDelta(curr, prev, 2);
      expect(delta.changed.length).toBe(1);
      expect(delta.formattedText).toContain('step 2 ok | url unchanged');
      expect(delta.formattedText).toContain('~ [e1] textbox "Name" value="Alice"');
      expect(delta.formattedText).not.toContain('page https://example.com/page');
    });

    it('sends full snapshot when changes exceed 40% of elements', () => {
      const prevElements: ParsedElement[] = [
        { ref: 'e1', backendDOMNodeId: 1, frameOrdinal: 0, role: 'textbox', name: 'A', states: [] },
        { ref: 'e2', backendDOMNodeId: 2, frameOrdinal: 0, role: 'textbox', name: 'B', states: [] },
        { ref: 'e3', backendDOMNodeId: 3, frameOrdinal: 0, role: 'textbox', name: 'C', states: [] },
        { ref: 'e4', backendDOMNodeId: 4, frameOrdinal: 0, role: 'textbox', name: 'D', states: [] },
      ];
      const prev = makeSnapshot(prevElements);

      // Change 3 of 4 elements (75% > 40%)
      const currElements: ParsedElement[] = [
        { ref: 'e1', backendDOMNodeId: 1, frameOrdinal: 0, role: 'textbox', name: 'A', value: 'v1', states: [] },
        { ref: 'e2', backendDOMNodeId: 2, frameOrdinal: 0, role: 'textbox', name: 'B', value: 'v2', states: [] },
        { ref: 'e3', backendDOMNodeId: 3, frameOrdinal: 0, role: 'textbox', name: 'C', value: 'v3', states: [] },
        { ref: 'e4', backendDOMNodeId: 4, frameOrdinal: 0, role: 'textbox', name: 'D', states: [] },
      ];
      const curr = makeSnapshot(currElements);

      const delta = perceiver.computeDelta(curr, prev, 3);
      // Per section 7.1: falls back to full snapshot formatted text
      expect(delta.formattedText).toBe(curr.formattedText);
      expect(delta.formattedText).toContain('page https://example.com/page');
    });

    it('sends full snapshot when navigation URL changes', () => {
      const elements: ParsedElement[] = [
        { ref: 'e1', backendDOMNodeId: 1, frameOrdinal: 0, role: 'button', name: 'Go', states: [] },
      ];
      const prev = makeSnapshot(elements, 'https://example.com/start');
      const curr = makeSnapshot(elements, 'https://example.com/finish');

      const delta = perceiver.computeDelta(curr, prev, 4);
      expect(delta.urlChanged).toBe(true);
      expect(delta.formattedText).toBe(curr.formattedText);
    });

    it('sends full snapshot when frame count changes', () => {
      const elements: ParsedElement[] = [
        { ref: 'e1', backendDOMNodeId: 1, frameOrdinal: 0, role: 'button', name: 'Go', states: [] },
      ];
      const prev = makeSnapshot(elements, 'https://example.com/page', 1);
      const curr = makeSnapshot(elements, 'https://example.com/page', 2);

      const delta = perceiver.computeDelta(curr, prev, 5);
      expect(delta.formattedText).toBe(curr.formattedText);
    });
  });

  describe('Viewport Filtering (Section 7.1 & Spike S1)', () => {
    it('keeps landmarks and headings while summarizing below-viewport interactive items', () => {
      const elements: ParsedElement[] = [
        // Landmarks and headings (always kept)
        { ref: 'e1', backendDOMNodeId: 1, frameOrdinal: 0, role: 'banner', name: 'Site Header', states: [] },
        { ref: 'e2', backendDOMNodeId: 2, frameOrdinal: 0, role: 'heading', name: 'Main Title', level: 1, states: [] },
        // In viewport element (id 3)
        { ref: 'e3', backendDOMNodeId: 3, frameOrdinal: 0, role: 'button', name: 'Above Fold Button', states: [] },
        // Below viewport elements (ids 4, 5, 6)
        { ref: 'e4', backendDOMNodeId: 4, frameOrdinal: 0, role: 'button', name: 'Below Button 1', states: [] },
        { ref: 'e5', backendDOMNodeId: 5, frameOrdinal: 0, role: 'button', name: 'Below Button 2', states: [] },
        { ref: 'e6', backendDOMNodeId: 6, frameOrdinal: 0, role: 'link', name: 'Below Link 3', states: [] },
      ];

      // Viewport includes only ids 1, 2, 3
      const inViewport = new Set([1, 2, 3]);
      const snapshot = OutlineSerializer.serialize(
        'https://example.com/long',
        'Long Page',
        1,
        [{ frameOrdinal: 0, frameUrl: 'https://example.com/long', elements }],
        { inViewportNodeIds: inViewport },
      );

      expect(snapshot.formattedText).toContain('[e1] banner "Site Header"');
      expect(snapshot.formattedText).toContain('[e2] heading "Main Title" level=1');
      expect(snapshot.formattedText).toContain('[e3] button "Above Fold Button"');
      expect(snapshot.formattedText).not.toContain('[e4]');
      expect(snapshot.formattedText).not.toContain('[e5]');
      expect(snapshot.formattedText).not.toContain('[e6]');
      expect(snapshot.formattedText).toContain('... 3 more below (scroll or find)');
    });
  });
});
