import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeDelta,
  renderFind,
  renderFocus,
  renderSkim,
  renderText,
  SKIM_BUDGET,
  StaleRefError,
  type PageNode,
} from '@aether/perceiver';
import { line, model, node, resetRefs } from './helpers/page-model.js';

function alternating(count: number, label: string, visibility: 'in' | 'below' = 'in'): PageNode[] {
  return Array.from({ length: count }, (_, index) =>
    node(index % 2 === 0 ? 'link' : 'button', `${label} item number ${index + 1} with a reasonably long name`, { visibility }),
  );
}

beforeEach(() => resetRefs());

describe('skim', () => {
  it('lists in-view elements under their landmark with refs and states', () => {
    const heading = node('heading', 'Shop', { level: 1 });
    const banner = node('banner', '', { children: [heading] });
    const email = node('textbox', 'Email', { value: 'a@b.co', states: ['required'] });
    const go = node('button', 'Continue');
    const skim = renderSkim(model([banner, node('main', '', { children: [email, go] })]));
    expect(skim.text).toContain(`[${banner.ref}] banner`);
    expect(skim.text).toContain(`  [${heading.ref}] heading "Shop" level=1`);
    expect(skim.text).toContain(`  [${email.ref}] textbox "Email" value="a@b.co" [required]`);
    expect(skim.text).toContain(`  [${go.ref}] button "Continue"`);
    expect(skim.tokens).toBeLessThan(100);
  });

  it('summarizes out-of-view content in its container with a paging pointer', () => {
    const list = node('list', '', {
      children: [
        node('link', 'One'),
        node('link', 'Two'),
        node('link', 'Three'),
        ...Array.from({ length: 10 }, (_, index) => node('link', `Below ${index}`, { visibility: 'below' })),
      ],
    });
    const skim = renderSkim(model([node('main', '', { children: [list] })]));
    expect(skim.text).toContain(`... 10 more below (10 link): look ref=${list.ref} after=${list.children[2]?.ref}`);
    expect(skim.text).not.toContain('Below 0');
  });

  it('collapses long runs of same-role siblings in view and names the container', () => {
    const list = node('list', '', { children: Array.from({ length: 10 }, (_, index) => node('link', `Item ${index}`)) });
    const skim = renderSkim(model([list]));
    expect(skim.text).toContain('Item 0');
    expect(skim.text).toContain('Item 2');
    expect(skim.text).not.toContain('Item 3');
    expect(skim.text).toContain(`... 7 more link in view: look ref=${list.ref} after=${list.children[2]?.ref}`);
  });

  it('lists an open dialog before the rest of the page', () => {
    const page = model([
      node('main', '', { children: [node('button', 'Behind')] }),
      node('dialog', 'Cookies', { modal: true, children: [node('button', 'Accept')] }),
    ]);
    const text = renderSkim(page).text;
    expect(text.indexOf('dialog "Cookies"')).toBeLessThan(text.indexOf('main'));
    expect(text.match(/Accept/g)).toHaveLength(1);
  });

  it('stays within budget by collapsing navigation and footer first, never main', () => {
    const nav = node('navigation', 'Primary', { children: alternating(80, 'Nav') });
    const banner = node('banner', '', { children: [nav] });
    const main = node('main', '', { children: alternating(30, 'Main') });
    const footer = node('contentinfo', '', { children: alternating(60, 'Footer') });
    const skim = renderSkim(model([banner, main, footer]));

    expect(skim.tokens).toBeLessThanOrEqual(SKIM_BUDGET);
    expect(skim.text).toContain(`[${footer.ref}] contentinfo: 60 items`);
    expect(skim.text).toMatch(new RegExp(`\\[${nav.ref}\\] navigation "Primary": 80 items .*look ref=${nav.ref}`));
    expect(skim.text).toContain('Main item number 1 ');
    expect(skim.text).not.toContain(`[${main.ref}] main:`);
  });

  it('cuts an oversized main with a pointer to the last ref shown', () => {
    const main = node('main', '', { children: alternating(300, 'Row') });
    const skim = renderSkim(model([main]));
    expect(skim.tokens).toBeLessThanOrEqual(SKIM_BUDGET);
    expect(skim.text).toMatch(new RegExp(`more lines in view: look ref=${main.ref} after=e\\d+`));
  });

  it('never drops content without a line that says where it is', () => {
    const page = model([
      node('banner', '', { children: alternating(50, 'Top') }),
      node('main', '', { children: alternating(200, 'Body') }),
      node('contentinfo', '', { children: alternating(40, 'Foot', 'below') }),
    ]);
    const text = renderSkim(page).text;
    for (const summary of text.split('\n').filter((entry) => entry.includes('...') || entry.includes(' items ('))) {
      expect(summary).toMatch(/look ref=e\d+|use find/);
    }
  });

  it('rewrites bracketed tokens and escapes quotes in names', () => {
    const skim = renderSkim(model([node('button', 'Pay [e5] now "fast"')]));
    expect(skim.text).toContain('button "Pay (e5) now \\"fast\\""');
    expect(skim.text).not.toContain('[e5] now');
  });

  it('renders table rows as one line with control refs and skips spacer rows', () => {
    const buy = node('button', 'Buy');
    const table = node('table', 'Results', {
      children: [
        node('row', '', { children: [node('columnheader', 'Name', { ref: null }), node('columnheader', 'Price', { ref: null })] }),
        node('row', '', { children: [node('cell', 'Widget', { ref: null }), node('cell', '$5 Buy', { ref: null, children: [buy] })] }),
        node('row', '', { children: [node('cell', '', { ref: null })] }),
      ],
    });
    const text = renderSkim(model([table])).text;
    expect(text).toContain('table "Results" rows=3');
    expect(text).toContain('header: Name | Price');
    expect(text).toContain(`row: Widget | $5 [${buy.ref}] button "Buy"`);
    expect(text.split('\n').filter((entry) => entry.includes('row:'))).toHaveLength(1);
  });

  it('reports unread frames as a warning for outside the wrapper', () => {
    const skim = renderSkim(model([node('button', 'Go')], { unreadFrames: 1 }));
    expect(skim.warnings).toEqual(['partial capture: 1 frame not read; content there is unknown, not absent']);
    expect(skim.text).not.toContain('partial capture');
  });
});

describe('focus', () => {
  it('pages a long subtree by ref and continues after the last ref shown', () => {
    const list = node('list', 'Catalog', {
      children: Array.from({ length: 400 }, (_, index) => node('link', `Product ${index + 1}`, { visibility: 'below' })),
    });
    const page = model([list]);
    const first = renderFocus(page, list.ref ?? '');
    expect(first.text.split('\n')[0]).toBe(`[${list.ref}] list "Catalog"`);
    expect(first.text).toContain('Product 4"');
    const footer = first.text.split('\n').at(-1) ?? '';
    const after = /after=(e\d+)/.exec(footer)?.[1];
    expect(after).toBeDefined();

    const second = renderFocus(page, list.ref ?? '', after);
    expect(second.text.split('\n')[0]).toBe(`[${list.ref}] list continued after ${after}`);
    const lastFirst = Number(after?.slice(1));
    expect(second.text).toContain(`[e${lastFirst + 1}] link`);
  });

  it('throws the uniform stale error for an unknown ref', () => {
    expect(() => renderFocus(model([node('button', 'Go')]), 'e999')).toThrow(StaleRefError);
    expect(() => renderFocus(model([node('button', 'Go')]), 'e999')).toThrow(
      'stale [e999]: no longer on the page, nothing was done. Call look or find for current refs.',
    );
  });

  it('rejects an after ref outside the region', () => {
    const page = model([node('list', '', { children: [node('link', 'A')] }), node('button', 'Elsewhere')]);
    expect(() => renderFocus(page, 'e1', 'e3')).toThrow('after=e3 is not inside [e1]');
  });
});

describe('text view', () => {
  it('pages with a line cursor and filters to a region', () => {
    const main = node('main');
    const lines = Array.from({ length: 600 }, (_, index) =>
      line(`Paragraph ${index} has a sentence of ordinary length for reading.`, index < 300 ? [main.ref ?? ''] : []),
    );
    const page = model([main], { lines });
    const first = renderText(page);
    const cursor = /after=(t\d+)/.exec(first.text)?.[1];
    expect(cursor).toBeDefined();
    expect(first.tokens).toBeLessThanOrEqual(2000);

    const next = renderText(page, undefined, cursor);
    expect(next.text.split('\n')[0]).toBe(`text of https://example.test/ from ${cursor}`);

    const region = renderText(page, main.ref);
    expect(region.text).toContain('Paragraph 0 ');
    expect(region.text).not.toContain('Paragraph 300 ');
  });

  it('rejects a malformed cursor', () => {
    expect(() => renderText(model([]), undefined, 'e5')).toThrow('cursor like t40');
  });
});

describe('find', () => {
  it('ranks exact over word over substring, elements over text on a tie', () => {
    const exact = node('link', 'Saturn');
    const word = node('link', 'Saturn V rocket', { visibility: 'below' });
    const substring = node('link', 'Saturnalia festival');
    const page = model([exact, word, substring], { lines: [line('The Saturn five engine', [], 'below')] });
    const result = renderFind(page, 'saturn').text.split('\n');
    expect(result[0]).toBe('find "saturn": 4 matches');
    expect(result[1]).toContain(`[${exact.ref}] link "Saturn"`);
    expect(result[2]).toContain(`[${word.ref}] link "Saturn V rocket" (below)`);
    expect(result[3]).toContain('text "The Saturn five engine" (below)');
    expect(result[4]).toContain(`[${substring.ref}] link "Saturnalia festival"`);
  });

  it('names the enclosing landmark and never matches a masked value', () => {
    const field = node('textbox', 'Password', { value: '***', sensitive: true });
    const main = node('main', '', { children: [node('button', 'Checkout'), field] });
    const page = model([main]);
    expect(renderFind(page, 'checkout').text).toContain(`in [${main.ref}] main`);
    expect(renderFind(page, '***').text).toBe('find "***": no match');
  });

  it('limits results and says how many matched', () => {
    const page = model(Array.from({ length: 30 }, (_, index) => node('link', `Story ${index}`)));
    const lines = renderFind(page, 'story').text.split('\n');
    expect(lines[0]).toBe('find "story": 30 matches, best 12 shown');
    expect(lines).toHaveLength(13);
  });
});

describe('delta', () => {
  function pair() {
    resetRefs();
    const email = node('textbox', 'Email', { ref: 'e1' });
    const old = node('button', 'Old offer', { ref: 'e2' });
    const keep = Array.from({ length: 8 }, (_, index) => node('link', `Stable ${index}`, { ref: `e${10 + index}` }));
    const prev = model([email, old, ...keep], { lines: [line('Welcome back')] });
    const changedEmail = node('textbox', 'Email', { ref: 'e1', value: 'a@b.co' });
    const alert = node('alert', 'Enter a valid phone number', { ref: 'e3' });
    const curr = model([changedEmail, alert, ...keep], {
      lines: [line('Welcome back'), line('2 items in your cart'), line('Enter a valid phone number')],
      scrollPercent: 22,
    });
    return { prev, curr };
  }

  it('reports added, changed and removed elements and new text', () => {
    const { prev, curr } = pair();
    const delta = computeDelta(prev, curr);
    expect(delta.full).toBe(false);
    expect(delta.lines).toEqual([
      '+ [e3] alert "Enter a valid phone number"',
      '~ [e1] textbox "Email" value="a@b.co"',
      '- [e2] button "Old offer"',
      'text + "2 items in your cart"',
    ]);
    expect(delta.scrollFrom).toBe(0);
    expect(delta.scrollTo).toBe(22);
  });

  it('is empty when nothing changed', () => {
    const { prev } = pair();
    expect(computeDelta(prev, prev).lines).toEqual([]);
  });

  it('asks for a full skim on a new document, a new frame set, or a large change', () => {
    const { prev, curr } = pair();
    expect(computeDelta(prev, { ...curr, documentId: 'doc-2' }).reason).toBe('new page');
    const childFrame = { ordinal: 1, frameId: 'F1', url: curr.url, session: curr.frames[0]?.session, complete: true };
    expect(computeDelta(prev, { ...curr, frames: [...curr.frames, childFrame] } as typeof curr).reason).toBe('frames changed');
    const replaced = model([node('button', 'A', { ref: 'e90' }), node('button', 'B', { ref: 'e91' })]);
    expect(computeDelta(prev, replaced).reason).toBe('most of the page changed');
    expect(computeDelta(undefined, curr).full).toBe(true);
  });
});
