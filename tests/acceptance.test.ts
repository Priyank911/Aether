import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CDPClient, ChromeLauncher, type CDPSession, type LaunchedBrowser } from '@aether/cdp';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import {
  Perceiver,
  renderFind,
  renderFocus,
  renderSkim,
  renderText,
  SKIM_BUDGET,
  StaleRefError,
  type PageModel,
  type PageNode,
} from '@aether/perceiver';

interface OpenPage {
  session: CDPSession;
  perceiver: Perceiver;
  close: () => Promise<void>;
}

function findNode(model: PageModel, role: string, nameIncludes: string): PageNode {
  for (const candidate of model.byRef.values()) {
    if (candidate.role === role && candidate.name.includes(nameIncludes)) return candidate;
  }
  throw new Error(`No ${role} named like "${nameIncludes}"`);
}

describe('Step 1 perception against live fixtures', () => {
  let fixtures: FixtureServers;
  let browser: LaunchedBrowser;
  let client: CDPClient;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4101, 4102);
    browser = await ChromeLauncher.launch({ headless: true });
    client = await CDPClient.connect(browser.wsEndpoint);
  }, 30000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await browser?.kill();
    await fixtures?.close();
  });

  async function navigate(session: CDPSession, url: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 8000);
      session.once('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await session.send('Page.navigate', { url });
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async function open(path: string): Promise<OpenPage> {
    const { targetId } = await client.sendCommand<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const session = await client.attachToTarget(targetId);
    await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await navigate(session, `${fixtures.mainBaseUrl}/${path}`);
    return {
      session,
      perceiver: new Perceiver(session),
      close: async () => {
        await client.sendCommand('Target.closeTarget', { targetId }).catch(() => undefined);
      },
    };
  }

  it('form: the skim lists every labelled field and the submit button with refs', async () => {
    const page = await open('form.html');
    try {
      const model = await page.perceiver.capture();
      const skim = renderSkim(model);
      expect(skim.text).toMatch(/\[e\d+\] textbox "Full Name:" \[required\]/);
      expect(skim.text).toMatch(/\[e\d+\] textbox "Email Address:" \[required\]/);
      expect(skim.text).toMatch(/\[e\d+\] combobox "Country:" value="United States"/);
      expect(skim.text).toMatch(/\[e\d+\] checkbox "Subscribe to monthly newsletter"/);
      expect(skim.text).toMatch(/\[e\d+\] button "Submit Application"/);
      expect(skim.tokens).toBeLessThan(200);
    } finally {
      await page.close();
    }
  });

  it('nested same-origin iframes: content appears under nested frame lines with their ordinals', async () => {
    const page = await open('nested-iframes.html');
    try {
      const model = await page.perceiver.capture();
      const text = renderSkim(model).text;
      expect(model.frames.map((frame) => frame.ordinal)).toEqual([0, 1, 2]);
      expect(text).toContain('frame 1 "http://localhost:4101/nested-child.html"');
      expect(text).toContain('  frame 2 "http://localhost:4101/nested-grandchild.html"');
      const deep = findNode(model, 'button', 'Deep Nested Action');
      expect(deep.frameOrdinal).toBe(2);
      expect(page.perceiver.target(deep.ref ?? '').frameOrdinal).toBe(2);
    } finally {
      await page.close();
    }
  });

  it('cross-origin iframe: the child frame is read through its own session', async () => {
    const page = await open('cross-origin.html');
    try {
      const model = await page.perceiver.capture();
      expect(renderSkim(model).text).toContain('frame 1 "http://127.0.0.1:4102/cross-origin-child.html"');
      const apply = findNode(model, 'button', 'Apply Now');
      expect(apply.frameOrdinal).toBe(1);
      const target = page.perceiver.target(apply.ref ?? '');
      expect(target.session.sessionId).not.toBe(page.session.sessionId);
      expect(model.unreadFrames).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shadow DOM: a button inside an open shadow root is captured', async () => {
    const page = await open('shadow-dom.html');
    try {
      const model = await page.perceiver.capture();
      expect(renderSkim(model).text).toMatch(/\[e\d+\] button "Shadow Button Action"/);
    } finally {
      await page.close();
    }
  });

  it('500-row list: the skim shows the viewport, find reaches row 482, focus pages the list', async () => {
    const page = await open('long-list.html');
    try {
      const model = await page.perceiver.capture();
      const list = findNode(model, 'list', '');
      const skim = renderSkim(model);
      expect(skim.text).toMatch(new RegExp(`more link in view: look ref=${list.ref} after=e\\d+`));
      expect(skim.text).toMatch(new RegExp(`more below \\(\\d+ link\\): look ref=${list.ref} after=e\\d+`));
      expect(skim.tokens).toBeLessThan(200);

      const found = renderFind(model, 'number 482');
      expect(found.text).toMatch(/\[e\d+\] link "Row item number 482 in catalog" \(below\)/);

      const first = renderFocus(model, list.ref ?? '');
      const after = /after=(e\d+)$/.exec(first.text)?.[1];
      expect(after).toBeDefined();
      const second = renderFocus(model, list.ref ?? '', after);
      expect(second.text.split('\n')[0]).toBe(`[${list.ref}] list continued after ${after}`);
    } finally {
      await page.close();
    }
  });

  it('table: rows render as pipe lines with refs for the controls in their cells', async () => {
    const page = await open('table.html');
    try {
      const model = await page.perceiver.capture();
      const text = renderSkim(model).text;
      expect(text).toMatch(/\[e\d+\] table "Search results" rows=9/);
      expect(text).toMatch(/\[e\d+\] header: Product \| Price \| Rating \| Action/);
      expect(text).toMatch(/\[e\d+\] row: Delta Keyboard \| \$120\.00 \| 4\.8 \| \[e\d+\] button "Add Delta Keyboard to cart"/);
      const found = renderFind(model, 'Delta Keyboard').text.split('\n');
      expect(found[1]).toMatch(/button "Add Delta Keyboard to cart"/);
    } finally {
      await page.close();
    }
  });

  it('overlay: covered controls are marked and the reachable ones are named first', async () => {
    const page = await open('covered.html');
    try {
      const model = await page.perceiver.capture();
      const text = renderSkim(model).text;
      expect(text).toContain('! 4 of 6 controls in view are covered by an overlay');
      expect(text).toMatch(/! reachable: \[e\d+\] button "Accept all" \| \[e\d+\] button "Reject"/);
      expect(findNode(model, 'button', 'View deal one').states).toContain('covered');
      expect(findNode(model, 'button', 'Accept all').states).not.toContain('covered');
    } finally {
      await page.close();
    }
  });

  it('secrets: password and one-time-code values are masked everywhere', async () => {
    const page = await open('injection.html');
    try {
      await page.session.send('Runtime.evaluate', { expression: 'document.getElementById("password").focus()' });
      await page.session.send('Input.insertText', { text: 'hunter2secret' });
      await page.session.send('Runtime.evaluate', { expression: 'document.getElementById("otp").focus()' });
      await page.session.send('Input.insertText', { text: '493817' });
      const model = await page.perceiver.capture();
      const password = findNode(model, 'textbox', 'Master Password');
      const otp = findNode(model, 'textbox', 'One-Time Code');
      expect(password.value).toBe('***');
      expect(password.sensitive).toBe(true);
      expect(otp.value).toBe('***');

      const everything = [renderSkim(model).text, renderText(model).text, renderFocus(model, password.ref ?? '').text].join('\n');
      expect(everything).not.toContain('hunter2secret');
      expect(everything).not.toContain('493817');
      expect(renderFind(model, '493817').text).toBe('find "493817": no match');
    } finally {
      await page.close();
    }
  });

  it('refs and the skim are identical across repeat captures', async () => {
    const page = await open('table.html');
    try {
      const first = await page.perceiver.capture();
      const second = await page.perceiver.capture();
      expect(second.order).toEqual(first.order);
      expect(renderSkim(second).text).toBe(renderSkim(first).text);
    } finally {
      await page.close();
    }
  });

  it('a new document never reuses a ref, and old refs fail with the stale error', async () => {
    const page = await open('form.html');
    try {
      const before = await page.perceiver.capture();
      const oldRef = findNode(before, 'button', 'Submit Application').ref ?? '';
      await navigate(page.session, `${fixtures.mainBaseUrl}/shadow-dom.html`);
      const after = await page.perceiver.capture();
      for (const ref of after.order) expect(before.order).not.toContain(ref);
      expect(() => page.perceiver.target(oldRef)).toThrow(StaleRefError);
    } finally {
      await page.close();
    }
  });

  it('forgetRefs assigns fresh refs on the next capture and the old ones go stale', async () => {
    const page = await open('form.html');
    try {
      const before = await page.perceiver.capture();
      page.perceiver.forgetRefs();
      const after = await page.perceiver.capture();
      expect(after.order.length).toBe(before.order.length);
      for (const ref of after.order) expect(before.order).not.toContain(ref);
      expect(() => page.perceiver.target(before.order[0] ?? '')).toThrow(StaleRefError);
    } finally {
      await page.close();
    }
  });

  it('long page: the skim fits the budget and the text view pages with a cursor', async () => {
    const page = await open('long-page.html');
    try {
      const model = await page.perceiver.capture();
      const skim = renderSkim(model);
      expect(skim.tokens).toBeLessThanOrEqual(SKIM_BUDGET);
      expect(skim.text).toMatch(/\[e\d+\] contentinfo: 60 more below \(60 link\)/);
      expect(skim.text).toMatch(/\[e\d+\] heading "Top stories" level=1/);

      const text = renderText(model);
      expect(text.text).toContain('# Top stories');
      expect(text.tokens).toBeLessThanOrEqual(2000);
      const cursor = /after=(t\d+)$/.exec(text.text)?.[1];
      expect(cursor).toBeDefined();
      expect(renderText(model, undefined, cursor).text.split('\n')[0]).toContain(`from ${cursor}`);
    } finally {
      await page.close();
    }
  });
});
