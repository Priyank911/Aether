'use strict';
/*
 * Spike S5, design A: the worker side. Runs one script in a vm context with
 * string code generation off, frozen intrinsics and no host object reachable
 * from inside. The only host functions the context holds are captured in
 * closures by the prelude and never exposed; every value crossing in either
 * direction is a JSON string or a primitive.
 */
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

const context = vm.createContext(Object.create(null), {
  name: 'aether-script',
  codeGeneration: { strings: false, wasm: false },
});

function hostCall(id, method, argsJson) {
  try {
    parentPort.postMessage({ type: 'call', id: Number(id), method: String(method), argsJson: String(argsJson) });
  } catch {
    // Never let a host error object reach the context.
  }
}
function hostLog(text) {
  try {
    parentPort.postMessage({ type: 'log', text: String(text).slice(0, 2000) });
  } catch {
    // Same as above.
  }
}
function hostDone(ok, payload, line, column) {
  try {
    parentPort.postMessage({ type: 'done', ok: Boolean(ok), payload: String(payload), line: Number(line) || undefined, column: Number(column) || undefined });
  } catch {
    // Same as above.
  }
}

context.__h = hostCall;
context.__l = hostLog;
context.__d = hostDone;

const PRELUDE = String.raw`
'use strict';
(() => {
  const h = globalThis.__h, l = globalThis.__l, d = globalThis.__d;
  const J = JSON, P = Promise, M = Map, E = Error, TE = TypeError, S = String;
  const stackLine = /aether-script\.ts:(\d+):(\d+)/;
  delete globalThis.__h; delete globalThis.__l; delete globalThis.__d;
  for (const name of ['WebAssembly', 'SharedArrayBuffer', 'Atomics', 'FinalizationRegistry', 'WeakRef']) delete globalThis[name];
  const pending = new M();
  let next = 1;
  const call = (method, args) => new P((resolve, reject) => {
    const id = next++;
    let json;
    try { json = J.stringify(args); } catch { reject(new TE('space.' + method + ': arguments must be plain JSON')); return; }
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
  const names = ['open', 'openTabs', 'mapPage', 'switchTab', 'tabs', 'skim', 'focus', 'text', 'items', 'survey', 'find', 'act', 'logStep', 'ask', 'memory', 'stateGet', 'stateSet'];
  const api = {};
  for (const name of names) api[name] = method(name);
  api.state = Object.freeze({ get: method('stateGet'), set: method('stateSet') });
  const space = Object.freeze(api);
  const show = (part) => { try { return typeof part === 'string' ? part : S(J.stringify(part)); } catch { return S(part); } };
  const consoleObject = Object.freeze({ log: (...parts) => l(parts.map(show).join(' ')) });
  const finish = (promise) => {
    promise.then(
      (value) => {
        let json;
        try { json = value === undefined ? '' : J.stringify(value); } catch (error) { d(false, 'the return value is not plain JSON: ' + S(error && error.message), 0, 0); return; }
        d(true, json === undefined ? '' : json, 0, 0);
      },
      (error) => {
        let message = 'script failed';
        let line = 0, column = 0;
        try {
          message = S(error && error.message !== undefined ? error.message : error);
          const match = stackLine.exec(S(error && error.stack));
          if (match) { line = Number(match[1]); column = Number(match[2]); }
        } catch { /* the message stays generic */ }
        d(false, message, line, column);
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
  // The vm global object itself cannot be frozen; lock each of its properties instead.
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    try { Object.defineProperty(globalThis, name, { writable: false, configurable: false }); } catch { /* accessor or already locked */ }
  }
})();
`;

vm.runInContext(PRELUDE, context, { filename: 'aether-prelude.js' });
const settle = context.__settle;
const finish = context.__finish;

parentPort.on('message', (message) => {
  if (message && message.type === 'reply') settle(message.id, message.ok, message.json);
});

try {
  const wrapped = `(async () => {\n'use strict';\n${workerData.code}\n})()`;
  const script = new vm.Script(wrapped, { filename: 'aether-script.ts', lineOffset: -2 });
  const promise = script.runInContext(context, { timeout: workerData.syncTimeoutMs, breakOnSigint: false });
  finish(promise);
} catch (error) {
  // Syntax errors and sync timeouts come from the host realm; send only their text.
  const text = error && typeof error.message === 'string' ? error.message : 'script failed to start';
  hostDone(false, text, 0, 0);
}
