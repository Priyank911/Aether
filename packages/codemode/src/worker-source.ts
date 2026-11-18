/*
 * The sandbox worker, kept as source text so it runs the same from dist and
 * under the test runner (`new Worker(source, { eval: true })`). Design A from
 * spike S5 (docs/SPIKES.md):
 * - the script runs in a vm context with string and wasm code generation off;
 * - intrinsics and their prototypes are frozen, and each global is locked
 *   (the vm global object itself cannot be frozen);
 * - host functions live only in closures made by the prelude, which also
 *   keeps its own JSON, Promise, Map and error classes;
 * - only JSON strings and primitives cross in either direction.
 * Rule from S5: no host object, function or error may ever enter the context.
 */

const PRELUDE = String.raw`
'use strict';
(() => {
  const h = globalThis.__h, l = globalThis.__l, d = globalThis.__d;
  const J = JSON, P = Promise, M = Map, E = Error, TE = TypeError, S = String, A = Array;
  const stackLine = /aether-script\.ts:(\d+):(\d+)/;
  delete globalThis.__h; delete globalThis.__l; delete globalThis.__d;
  for (const name of ['WebAssembly', 'SharedArrayBuffer', 'Atomics', 'FinalizationRegistry', 'WeakRef']) delete globalThis[name];
  const pending = new M();
  let next = 1;
  const call = (method, args) => new P((resolve, reject) => {
    const id = next++;
    let json;
    try { json = J.stringify(args); } catch { reject(new TE('space.' + method + ': arguments must be plain JSON (no functions, cycles, BigInt or class instances)')); return; }
    pending.set(id, { resolve, reject });
    h(id, method, json);
  });
  const settle = (id, ok, json) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) { entry.resolve(json === undefined || json === '' ? undefined : J.parse(json)); return; }
    const info = J.parse(json);
    const error = new E(info.message);
    error.code = info.code;
    entry.reject(error);
  };
  const method = (name) => (...args) => call(name, args);
  const names = ['open', 'openTabs', 'switchTab', 'tabs', 'skim', 'focus', 'text', 'items', 'survey', 'find', 'act', 'logStep', 'ask', 'memory'];
  const api = {};
  for (const name of names) api[name] = method(name);
  api.mapPages = async (urls, fn) => {
    if (!A.isArray(urls)) throw new TE('space.mapPages: the first argument must be an array of URLs');
    if (typeof fn !== 'function') throw new TE('space.mapPages: the second argument must be a function (page) => data');
    return P.all(urls.map(async (url) => {
      try {
        const page = await call('mapPage', [url]);
        return { url, data: await fn(page) };
      } catch (error) {
        if (error && error.code === 'stopped') throw error;
        return { url, error: S(error && error.message !== undefined ? error.message : error) };
      }
    }));
  };
  api.state = Object.freeze({ get: method('stateGet'), set: method('stateSet') });
  const space = Object.freeze(api);
  const show = (part) => { try { return typeof part === 'string' ? part : S(J.stringify(part)); } catch { return S(part); } };
  const consoleObject = Object.freeze({ log: (...parts) => l(parts.map(show).join(' ')) });
  const finish = (promise) => {
    promise.then(
      (value) => {
        let json;
        try { json = value === undefined ? '' : J.stringify(value); } catch (error) { d(false, 'the return value is not plain JSON: ' + S(error && error.message), 0, 0, ''); return; }
        d(true, json === undefined ? '' : json, 0, 0, '');
      },
      (error) => {
        let message = 'script failed';
        let line = 0, column = 0, code = '';
        try {
          message = S(error && error.message !== undefined ? error.message : error);
          code = S((error && error.code) || '');
          const match = stackLine.exec(S(error && error.stack));
          if (match) { line = Number(match[1]); column = Number(match[2]); }
        } catch { /* the message stays generic */ }
        d(false, message, line, column, code);
      },
    );
  };
  Object.defineProperty(globalThis, 'space', { value: space, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(globalThis, 'console', { value: consoleObject, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(globalThis, '__settle', { value: settle, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(globalThis, '__finish', { value: finish, enumerable: false, writable: false, configurable: false });
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    const value = globalThis[name];
    if ((typeof value === 'function' || (typeof value === 'object' && value !== null)) && name !== 'globalThis') {
      Object.freeze(value);
      if (typeof value === 'function' && value.prototype) Object.freeze(value.prototype);
    }
  }
  Object.freeze(Object.getPrototypeOf(async function () {}));
  Object.freeze(Object.getPrototypeOf(function* () {}));
  Object.freeze(Object.getPrototypeOf(async function* () {}));
  Object.freeze(Object.getPrototypeOf([][Symbol.iterator]()));
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    try { Object.defineProperty(globalThis, name, { writable: false, configurable: false }); } catch { /* accessor or already locked */ }
  }
})();
`;

const WORKER = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const context = vm.createContext(Object.create(null), { name: 'aether-script', codeGeneration: { strings: false, wasm: false } });
function post(message) { try { parentPort.postMessage(message); } catch { /* never let a host error reach the context */ } }
context.__h = function (id, method, argsJson) { post({ type: 'call', id: Number(id), method: String(method), argsJson: String(argsJson) }); };
context.__l = function (text) { post({ type: 'log', text: String(text).slice(0, 2000) }); };
context.__d = function (ok, payload, line, column, code) { post({ type: 'done', ok: Boolean(ok), payload: String(payload), line: Number(line) || 0, column: Number(column) || 0, code: String(code || '') }); };
vm.runInContext(workerData.prelude, context, { filename: 'aether-prelude.js' });
const settle = context.__settle;
const finish = context.__finish;
post({ type: 'ready' });
parentPort.on('message', function (message) {
  if (message && message.type === 'reply') settle(message.id, message.ok, message.json);
});
try {
  const wrapped = '(async () => {\n\'use strict\';\n' + workerData.code + '\n})()';
  const script = new vm.Script(wrapped, { filename: 'aether-script.ts', lineOffset: -2 });
  finish(script.runInContext(context, { timeout: workerData.syncTimeoutMs, breakOnSigint: false }));
} catch (error) {
  const text = error && typeof error.message === 'string' ? error.message : 'the script failed to start';
  const match = /aether-script\.ts:(\d+)/.exec(String(error && error.stack));
  post({ type: 'done', ok: false, payload: text, line: match ? Number(match[1]) : 0, column: 0, code: '' });
}
`;

export const SANDBOX_WORKER_SOURCE = WORKER;
export const SANDBOX_PRELUDE = PRELUDE;
