import { describe, expect, it } from 'vitest';
import { CodeModeCallError, CodeModeHost, type ExecReport, type RunContext, type SpaceEngine } from '@aether/codemode';
import type { ExecOutcome, SpaceMethod } from '@aether/shared';

/** A scripted engine: each method answers from `answers`, optionally after a delay. */
class FakeEngine implements SpaceEngine {
  public readonly calls: Array<{ method: SpaceMethod; args: unknown[] }> = [];
  public readonly started: string[] = [];
  public readonly ended: ExecOutcome[] = [];
  public waiting: { reason: 'approval'; prompt: string } | undefined;
  public delayMs = 0;
  public readonly answers: Partial<Record<SpaceMethod, (args: unknown[], run: RunContext) => unknown>> = {};

  public async call(method: SpaceMethod, args: unknown[], run: RunContext): Promise<unknown> {
    this.calls.push({ method, args });
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const answer = this.answers[method];
    if (!answer) throw new CodeModeCallError('engine', `fake engine has no answer for ${method}`);
    return answer(args, run);
  }

  public pendingHuman(): { reason: 'approval'; prompt: string } | undefined {
    return this.waiting;
  }

  public runStarted(_run: RunContext, thought: string): void {
    this.started.push(thought);
  }

  public runEnded(_run: RunContext, outcome: ExecOutcome): void {
    this.ended.push(outcome);
  }
}

function setup(options: ConstructorParameters<typeof CodeModeHost>[1] = {}): { engine: FakeEngine; host: CodeModeHost } {
  const engine = new FakeEngine();
  engine.answers.tabs = () => [{ id: 't1', title: 'Shop', url: 'https://shop.example/', state: 'live' }];
  engine.answers.open = (args, run) => {
    run.markRead(new URL(String(args[0])).origin);
    return { url: args[0], title: 'Shop', tabId: 't1', archetype: 'listing', landing: [], skim: '[e1] link "Item"' };
  };
  engine.answers.mapPage = (args, run) => {
    const url = String(args[0]);
    if (url.includes('broken')) throw new CodeModeCallError('engine', 'the page did not load');
    run.markRead(new URL(url).origin);
    return { url, title: `Page ${url.slice(-1)}`, tabId: 't2', archetype: 'product', landing: [], skim: '', product: { price: `USD ${url.slice(-1)}0` } };
  };
  return { engine, host: new CodeModeHost(engine, { stallMs: 3000, holdReturnMs: 2000, ...options }) };
}

function complete(report: ExecReport): { json?: string; untrusted: boolean; origins: string[] } {
  if (report.outcome.status !== 'complete') throw new Error(`expected complete, got ${JSON.stringify(report.outcome)}`);
  return report.outcome;
}

function failed(report: ExecReport): { message: string; line?: number } {
  if (report.outcome.status !== 'error') throw new Error(`expected error, got ${JSON.stringify(report.outcome)}`);
  return report.outcome;
}

describe('Code Mode host', () => {
  it('runs TypeScript with top-level await and returns structured data, marked untrusted after a page read', async () => {
    const { engine, host } = setup();
    const report = await host.exec({
      space: 'Shoe hunt',
      thought: 'Open the shop',
      code: `interface Brief { url: string; title: string }\nconst page: Brief = await space.open('https://shop.example/list');\nconst tabs = await space.tabs();\nreturn { title: page.title, tabs: tabs.length };`,
    });
    expect(report.spaceId).toBe('shoe-hunt');
    const outcome = complete(report);
    expect(JSON.parse(outcome.json ?? '')).toEqual({ title: 'Shop', tabs: 1 });
    expect(outcome.untrusted).toBe(true);
    expect(outcome.origins).toEqual(['https://shop.example']);
    expect(engine.started).toEqual(['Open the shop']);
    expect(engine.ended).toHaveLength(1);
  });

  it('is trusted when no page was read, and returns nothing for an undefined result', async () => {
    const { host } = setup();
    const outcome = complete(await host.exec({ thought: 't', code: 'await space.tabs();' }));
    expect(outcome.json).toBeUndefined();
    expect(outcome.untrusted).toBe(false);
  });

  it('reports runtime errors with the line in the host source', async () => {
    const { host } = setup();
    const error = failed(await host.exec({ thought: 't', code: 'const a: number = 1;\nconst b = 2;\nconst c = (null as unknown as { x: number }).x;\nreturn c;' }));
    expect(error.message).toMatch(/Cannot read properties of null/);
    expect(error.line).toBe(3);
  });

  it('refuses TypeScript that needs a transform, and syntax errors, before running anything', async () => {
    const { engine, host } = setup();
    expect(failed(await host.exec({ thought: 't', code: 'enum Size { S, M }\nreturn Size.M;' })).message).toMatch(/enum is not supported.*plain objects/);
    expect(failed(await host.exec({ thought: 't', code: 'const x: = 1;' })).message).toMatch(/^TypeScript syntax error/);
    expect(failed(await host.exec({ thought: 't', code: 'return 1; }\n{' })).message).toMatch(/^syntax error on line 2: Unexpected token/);
    expect(engine.started).toEqual([]);
  });

  it('rejects a bad call inside the script with a catchable error naming the argument', async () => {
    const { engine, host } = setup();
    const outcome = complete(await host.exec({ thought: 't', code: `try { await space.open('not a url'); return 'ran'; } catch (e) { return [e.code, e.message]; }` }));
    expect(JSON.parse(outcome.json ?? '')).toEqual(['invalid_args', 'space.open: Invalid url (argument 1)']);
    expect(engine.calls).toHaveLength(0);
  });

  it('keeps the sandbox closed: no Node globals, no code generation, no prototype changes', async () => {
    const { host } = setup();
    const outcome = complete(
      await host.exec({
        thought: 't',
        code: `const out: string[] = [typeof process, typeof require, typeof fetch, typeof setTimeout];
try { Function('return 1'); out.push('Function ran'); } catch (e) { out.push(e.name); }
try { (space.open as any).constructor.constructor('return process')(); out.push('escaped'); } catch (e) { out.push(e.name); }
try { (Object.prototype as any).x = 1; out.push('polluted'); } catch (e) { out.push(e.name); }
return out;`,
      }),
    );
    expect(JSON.parse(outcome.json ?? '')).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'EvalError', 'EvalError', 'TypeError']);
  });

  it('stops an endless loop but never a script that keeps making calls', async () => {
    const { engine, host } = setup({ stallMs: 2000, holdReturnMs: 15000 });
    const looped = await host.exec({ thought: 't', code: 'await space.tabs();\nwhile (true) {}' });
    expect(looped.outcome).toMatchObject({ status: 'stopped', by: 'stall' });
    engine.delayMs = 250;
    const busy = complete(await host.exec({ thought: 't', code: 'let n = 0;\nfor (let i = 0; i < 5; i++) { await space.tabs(); n++; }\nreturn n;' }));
    expect(busy.json).toBe('5');
  });

  it('answers with a held token after the hold time, keeps running, and hands the result to wait', async () => {
    const { engine, host } = setup({ holdReturnMs: 300 });
    engine.delayMs = 500;
    engine.waiting = { reason: 'approval', prompt: 'Place order on shop.example?' };
    const first = await host.exec({ space: 'Checkout', thought: 'Place the order', code: 'await space.tabs();\nreturn "ordered";' });
    expect(first.outcome).toMatchObject({ status: 'held', reason: 'approval', prompt: 'Place order on shop.example?' });
    const token = first.outcome.status === 'held' ? first.outcome.token : '';
    const busy = failed(await host.exec({ space: 'Checkout', thought: 'again', code: 'return 1;' }));
    expect(busy.message).toContain(`held as ${token}`);
    let second = await host.exec({ space: 'Checkout', thought: 'Waiting', wait: token });
    for (let tries = 0; second.outcome.status === 'held' && tries < 5; tries++) second = await host.exec({ space: 'Checkout', thought: 'Waiting', wait: token });
    expect(complete(second).json).toBe('"ordered"');
    expect(failed(await host.exec({ thought: 't', wait: 'f'.repeat(24) })).message).toMatch(/no held run/);
  });

  it('stops at once when the person presses Stop', async () => {
    const { engine, host } = setup();
    engine.delayMs = 1000;
    const running = host.exec({ space: 'Stop me', thought: 't', code: 'await space.tabs();\nreturn 1;' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(host.isRunning('stop-me')).toBe(true);
    host.stop('stop-me');
    expect((await running).outcome).toMatchObject({ status: 'stopped', by: 'person' });
    expect(host.isRunning('stop-me')).toBe(false);
  });

  it('runs mapPages through the engine one page at a time per call, keeping per-URL errors', async () => {
    const { host } = setup();
    const outcome = complete(
      await host.exec({
        thought: 't',
        code: `const urls = ['https://a.example/p1', 'https://a.example/broken', 'https://b.example/p3'];
return space.mapPages(urls, (page) => ({ title: page.title, price: page.product?.price }));`,
      }),
    );
    expect(JSON.parse(outcome.json ?? '')).toEqual([
      { url: 'https://a.example/p1', data: { title: 'Page 1', price: 'USD 10' } },
      { url: 'https://a.example/broken', error: 'the page did not load' },
      { url: 'https://b.example/p3', data: { title: 'Page 3', price: 'USD 30' } },
    ]);
    expect(outcome.origins.sort()).toEqual(['https://a.example', 'https://b.example']);
  });

  it('keeps space.state across runs in the same Space only, within its size limit', async () => {
    const { host } = setup();
    await host.exec({ space: 'A', thought: 't', code: `await space.state.set('shortlist', [1, 2, 3]);` });
    expect(complete(await host.exec({ space: 'A', thought: 't', code: `return space.state.get('shortlist');` })).json).toBe('[1,2,3]');
    expect(complete(await host.exec({ space: 'B', thought: 't', code: `return space.state.get('shortlist');` })).json).toBeUndefined();
    const big = complete(await host.exec({ space: 'A', thought: 't', code: `try { await space.state.set('big', 'x'.repeat(70000)); return 'stored'; } catch (e) { return e.message; }` }));
    expect(JSON.parse(big.json ?? '')).toMatch(/limited to 64 KB/);
  });

  it('keeps page provenance when stored data is read by a later script, including errors and logs', async () => {
    const { host } = setup();
    await host.exec({ space: 'Saved page', thought: 'Read once', code: "const page = await space.open('https://shop.example/'); await space.state.set('title', page.title);" });
    const restored = complete(await host.exec({ space: 'Saved page', thought: 'Read saved title', code: "return space.state.get('title');" }));
    expect(restored).toMatchObject({ json: '"Shop"', untrusted: true, origins: ['https://shop.example'] });
    const error = await host.exec({ space: 'Saved page', thought: 'Use saved title', code: "const title = await space.state.get('title'); console.log(title); throw new Error(title);" });
    expect(error.outcome).toMatchObject({ status: 'error', untrusted: true, origins: ['https://shop.example'], message: 'Shop' });
    expect(error.logs).toEqual(['Shop']);
    await host.exec({ space: 'Saved page', thought: 'Copy saved title', code: "await space.state.set('copy', await space.state.get('title'));" });
    expect(complete(await host.exec({ space: 'Saved page', thought: 'Read copy', code: "return space.state.get('copy');" })).untrusted).toBe(true);
  });

  it('does not taint another Space or a later trusted replacement, and clears provenance with state', async () => {
    const { host } = setup();
    await host.exec({ space: 'A', thought: 'Read', code: "await space.state.set('literal', 'local'); const page = await space.open('https://shop.example/'); await space.state.set('value', page.title);" });
    expect(complete(await host.exec({ space: 'A', thought: 'Local only', code: "return space.state.get('literal');" })).untrusted).toBe(false);
    expect(complete(await host.exec({ space: 'B', thought: 'Other Space', code: "return space.state.get('value');" })).untrusted).toBe(false);
    await host.exec({ space: 'A', thought: 'Replace with literal', code: "await space.state.set('value', 'replacement');" });
    expect(complete(await host.exec({ space: 'A', thought: 'Read replacement', code: "return space.state.get('value');" })).untrusted).toBe(false);
    host.clearState('a');
    expect(complete(await host.exec({ space: 'A', thought: 'Cleared', code: "return space.state.get('value');" }))).toMatchObject({ json: undefined, untrusted: false });
  });

  it('enforces the state budget in UTF-8 bytes rather than UTF-16 characters', async () => {
    const { host } = setup();
    const outcome = complete(await host.exec({ thought: 'Check budget', code: "try { await space.state.set('value', '界'.repeat(25000)); return 'stored'; } catch (error) { return error.code; }" }));
    expect(outcome.json).toBe('"invalid_args"');
  });

  it('refuses a runaway return value instead of cutting it', async () => {
    const { host } = setup();
    expect(failed(await host.exec({ thought: 't', code: `return 'x'.repeat(300000);` })).message).toMatch(/one returned string is 293 KB, over the 256 KB limit/);
    expect(failed(await host.exec({ thought: 't', code: `return Array.from({ length: 20 }, () => 'y'.repeat(60000));` })).message).toMatch(/over the 1024 KB limit/);
    expect(failed(await host.exec({ thought: 't', code: 'return 10n;' })).message).toMatch(/not plain JSON/);
  });

  it('needs exactly one of code or wait', async () => {
    const { host } = setup();
    expect(failed(await host.exec({ thought: 't' })).message).toMatch(/send code/);
    expect(failed(await host.exec({ thought: 't', code: 'return 1', wait: 'ab'.repeat(12) })).message).toMatch(/not both/);
  });
});
