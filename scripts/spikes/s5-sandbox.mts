/**
 * Spike S5 (docs/PLAN.md section 7.1 and 14).
 *
 * Question: which Code Mode boundary holds?
 *   A. a worker_threads worker running the script in a vm context with
 *      string code generation off, frozen intrinsics and closure-only bridges;
 *   B. a blank Chromium page driven over CDP, with every request failed by
 *      the Fetch domain and calls carried by Runtime.addBinding.
 * For each: known escape attempts, stopping an infinite loop, and the cost of
 * one space.* round trip.
 *
 * Run: pnpm exec tsx scripts/spikes/s5-sandbox.mts
 */
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { CDPClient, ChromeLauncher, type CDPSession } from '../../packages/cdp/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Outcome {
  ok: boolean;
  payload: string;
  line?: number;
  logs: string[];
  calls: number;
  ms: number;
}

/** Design A: run one script; every call is answered with `echo` after `delayMs`. */
function runA(code: string, options: { stallMs?: number; reply?: (method: string, args: unknown[]) => unknown } = {}): Promise<Outcome> {
  const started = performance.now();
  return new Promise((resolve) => {
    const worker = new Worker(path.join(here, 's5', 'vm-worker.cjs'), {
      workerData: { code, syncTimeoutMs: 2000 },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      env: {},
      stdout: true,
      stderr: true,
    });
    const logs: string[] = [];
    let calls = 0;
    let last = performance.now();
    let settled = false;
    const end = (outcome: Omit<Outcome, 'logs' | 'calls' | 'ms'>): void => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      void worker.terminate();
      resolve({ ...outcome, logs, calls, ms: Math.round(performance.now() - started) });
    };
    const stallMs = options.stallMs ?? 1500;
    const watchdog = setInterval(() => {
      if (performance.now() - last > stallMs) end({ ok: false, payload: `stalled: no progress for ${stallMs} ms; worker terminated` });
    }, 50);
    worker.on('message', (message: { type: string; id: number; method: string; argsJson: string; text: string; ok: boolean; payload: string; line?: number }) => {
      last = performance.now();
      if (message.type === 'log') logs.push(message.text);
      if (message.type === 'done') end({ ok: message.ok, payload: message.payload, line: message.line });
      if (message.type === 'call') {
        calls++;
        const args = JSON.parse(message.argsJson) as unknown[];
        if (message.method === 'open' && args[0] === 'x') {
          // The engine rejects an invalid URL; the script receives an error built inside the sandbox.
          worker.postMessage({ type: 'reply', id: message.id, ok: false, json: JSON.stringify({ code: 'invalid_args', message: 'space.open: Invalid url (argument 1)' }) });
          return;
        }
        const value = options.reply ? options.reply(message.method, args) : { echo: message.method };
        worker.postMessage({ type: 'reply', id: message.id, ok: true, json: JSON.stringify(value) });
      }
    });
    worker.on('error', (error) => end({ ok: false, payload: `worker error: ${error.message}` }));
    worker.on('exit', (exitCode) => end({ ok: false, payload: `worker exited ${exitCode}` }));
  });
}

/** Each probe passes when the attempt fails inside the sandbox; the script returns what it saw. */
const ESCAPES: Array<{ name: string; code: string; safe: (outcome: Outcome) => boolean }> = [
  { name: 'globals: process, require, fetch, Buffer, WebAssembly, SharedArrayBuffer', code: `return [typeof process, typeof require, typeof fetch, typeof Buffer, typeof WebAssembly, typeof SharedArrayBuffer, typeof setTimeout].join(',');`, safe: (o) => o.ok && o.payload === JSON.stringify('undefined,undefined,undefined,undefined,undefined,undefined,undefined') },
  { name: 'eval and Function constructor', code: `const out = []; try { eval('1'); out.push('eval ran'); } catch (e) { out.push(e.name); } try { Function('return 1')(); out.push('Function ran'); } catch (e) { out.push(e.name); } return out.join(',');`, safe: (o) => o.payload === JSON.stringify('EvalError,EvalError') },
  { name: 'constructor chain from globalThis', code: `try { return typeof this.constructor.constructor('return process')(); } catch (e) { return e.name; }`, safe: (o) => o.payload !== JSON.stringify('object') },
  { name: 'constructor chain from a space method', code: `try { return typeof space.open.constructor.constructor('return process')(); } catch (e) { return e.name; }`, safe: (o) => o.payload === JSON.stringify('EvalError') },
  { name: 'constructor chain from a reply value', code: `const v = await space.tabs(); try { return typeof v.constructor.constructor('return process')(); } catch (e) { return e.name; }`, safe: (o) => o.payload === JSON.stringify('EvalError') },
  { name: 'constructor chain from a rejected call error', code: `try { await space.open('x'); return 'no error'; } catch (e) { try { return typeof e.constructor.constructor('return process')(); } catch (inner) { return inner.name; } }`, safe: (o) => o.payload === JSON.stringify('EvalError') },
  { name: 'Error.prepareStackTrace hook', code: `try { Error.prepareStackTrace = (e, frames) => frames.map((f) => typeof f.getThis()); return 'set'; } catch (e) { return e.name; }`, safe: (o) => o.payload === JSON.stringify('TypeError') },
  { name: 'prototype pollution', code: `try { Object.prototype.polluted = 1; return 'polluted'; } catch (e) { return e.name; }`, safe: (o) => o.payload === JSON.stringify('TypeError') },
  { name: 'replace a space method', code: `try { space.open = () => 1; return 'replaced'; } catch (e) { return e.name; }`, safe: (o) => o.payload === JSON.stringify('TypeError') },
  { name: 'overwrite the reply hook', code: `try { globalThis.__settle = () => 1; return 'replaced'; } catch (e) { return e.name; }`, safe: (o) => o.payload === JSON.stringify('TypeError') },
  { name: 'dynamic import of node:fs', code: `try { await import('node:fs'); return 'imported'; } catch (e) { return e.code || e.name; }`, safe: (o) => o.ok && o.payload !== JSON.stringify('imported') },
  { name: 'function.caller walk', code: `function f() { try { return typeof f.caller; } catch (e) { return e.name; } } return f();`, safe: (o) => o.payload === JSON.stringify('TypeError') },
  { name: 'Proxy as call argument', code: `const p = new Proxy({}, { get: () => { throw new Error('trap ran in host'); } }); try { await space.find(p); return 'sent'; } catch (e) { return e.message; }`, safe: (o) => o.ok },
  { name: 'getter that throws in the return value', code: `return { get x() { throw new Error('getter'); } };`, safe: (o) => !o.ok && o.payload.includes('not plain JSON') },
  { name: 'BigInt return', code: `return 10n;`, safe: (o) => !o.ok && o.payload.includes('not plain JSON') },
  { name: 'circular return', code: `const a = {}; a.a = a; return a;`, safe: (o) => !o.ok && o.payload.includes('not plain JSON') },
];

async function designA(): Promise<string[]> {
  const report: string[] = ['## Design A: worker + vm'];
  let escapes = 0;
  for (const probe of ESCAPES) {
    const outcome = await runA(probe.code);
    const safe = probe.safe(outcome);
    if (!safe) escapes++;
    report.push(`- ${safe ? 'held' : 'ESCAPED'}: ${probe.name} -> ${outcome.ok ? 'returned' : 'failed'} ${outcome.payload.slice(0, 120)}`);
  }
  const syntax = await runA('return (');
  report.push(`- syntax error reported: ${!syntax.ok} (${syntax.payload.slice(0, 60)})`);
  const thrown = await runA('const a = 1;\nconst b = 2;\nnull.x;\n');
  report.push(`- runtime error line: ${thrown.line} for an error on line 3 (${thrown.payload})`);
  const syncLoop = await runA('while (true) {}');
  report.push(`- sync infinite loop: stopped=${!syncLoop.ok} in ${syncLoop.ms} ms (${syncLoop.payload.slice(0, 70)})`);
  const asyncLoop = await runA('await space.tabs();\nwhile (true) {}', { stallMs: 1500 });
  report.push(`- infinite loop after await: stopped=${!asyncLoop.ok} in ${asyncLoop.ms} ms (${asyncLoop.payload.slice(0, 70)})`);
  const memory = await runA('const parts = []; while (true) parts.push(new Array(1e6).fill(1));');
  report.push(`- memory bomb: stopped=${!memory.ok} in ${memory.ms} ms (${memory.payload.slice(0, 70)})`);
  const busy = await runA('let n = 0; for (let i = 0; i < 400; i++) { await space.tabs(); n++; } return n;', { stallMs: 1500 });
  report.push(`- long active script (400 calls) not killed: ${busy.ok} returned ${busy.payload}`);
  const timed = await runA('const t = Date.now(); for (let i = 0; i < 2000; i++) await space.tabs(); return Date.now() - t;');
  report.push(`- round trip: ${(Number(timed.payload) / 2000).toFixed(3)} ms per space.* call over 2000 calls`);
  const logged = await runA('console.log("hello", { a: 1 }); return 1;');
  report.push(`- console.log reaches the trace: ${JSON.stringify(logged.logs)}`);
  report.push(`- escapes: ${escapes} of ${ESCAPES.length}`);
  return report;
}

/** Design B: a blank page in headless Chrome, all requests failed, calls over a CDP binding. */
async function designB(): Promise<string[]> {
  const report: string[] = ['## Design B: blank Chromium page over CDP'];
  const browser = await ChromeLauncher.launch({ headless: true });
  const client = await CDPClient.connect(browser.wsEndpoint);
  try {
    const { targetId } = await client.sendCommand<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const session: CDPSession = await client.attachToTarget(targetId);
    let blocked = 0;
    session.on('Fetch.requestPaused', (event: { requestId: string }) => {
      blocked++;
      void session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => undefined);
    });
    await session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await session.send('Runtime.enable');
    await session.send('Runtime.addBinding', { name: '__aetherCall' });
    session.on('Runtime.bindingCalled', (event: { name: string; payload: string; executionContextId: number }) => {
      const message = JSON.parse(event.payload) as { id: number };
      void session.send('Runtime.evaluate', { expression: `__aetherSettle(${message.id}, true, ${JSON.stringify(JSON.stringify({ echo: true }))})`, contextId: event.executionContextId });
    });
    await session.send('Runtime.evaluate', {
      expression: `(() => { const pending = new Map(); let next = 1;
        window.__aetherSettle = (id, ok, json) => { const p = pending.get(id); pending.delete(id); p && p.resolve(JSON.parse(json)); };
        window.space = { tabs: () => new Promise((resolve) => { const id = next++; pending.set(id, { resolve }); __aetherCall(JSON.stringify({ id, method: 'tabs' })); }) }; })()`,
    });
    const evaluate = async (expression: string): Promise<string> => {
      const result = await session.send<{ result: { value?: unknown }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 5000 });
      return result.exceptionDetails ? `exception ${result.exceptionDetails.text}` : JSON.stringify(result.result.value);
    };
    const network = await evaluate(`(async () => { const out = [];
      try { await fetch('https://example.com/'); out.push('fetch ok'); } catch (e) { out.push('fetch ' + e.name); }
      out.push(await new Promise((r) => { const img = new Image(); img.onload = () => r('image ok'); img.onerror = () => r('image blocked'); img.src = 'https://example.com/x.png'; }));
      out.push(await new Promise((r) => { try { const ws = new WebSocket('wss://example.com/'); ws.onopen = () => r('ws ok'); ws.onerror = () => r('ws blocked'); } catch (e) { r('ws ' + e.name); } }));
      out.push('RTCPeerConnection ' + typeof RTCPeerConnection);
      return out.join(', '); })()`);
    report.push(`- network from the page: ${network}; requests failed by Fetch: ${blocked}`);
    const timed = await evaluate('(async () => { const t = performance.now(); for (let i = 0; i < 500; i++) await space.tabs(); return (performance.now() - t) / 500; })()');
    report.push(`- round trip: ${Number(timed).toFixed(3)} ms per space.* call over 500 calls (binding + evaluate)`);
    const before = blocked;
    await evaluate(`location.href = 'https://example.com/?d=secret'`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const where = await evaluate('location.href');
    report.push(`- navigation attempt: page stayed at ${where}; navigation requests failed: ${blocked - before}`);
    const started = performance.now();
    const loop = session.send('Runtime.evaluate', { expression: 'while (true) {}', awaitPromise: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await session.send('Runtime.terminateExecution');
    const stopped = await loop.then(() => 'returned', (error: Error) => `rejected ${error.message.slice(0, 40)}`);
    report.push(`- infinite loop: Runtime.terminateExecution -> ${stopped} after ${Math.round(performance.now() - started)} ms; page still answers: ${await evaluate('1 + 1')}`);
  } finally {
    await client.close().catch(() => undefined);
    await browser.kill();
  }
  return report;
}

const lines = [...(await designA()), '', ...(await designB())];
console.log(lines.join('\n'));
