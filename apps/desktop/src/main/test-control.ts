import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { app } from 'electron';
import type { CDPClient, CDPSession } from '@aether/cdp';
import type { CodeModeHost } from '@aether/codemode';
import type { SpaceStore } from '@aether/memory';
import { Perceiver, renderSkim } from '@aether/perceiver';
import type { MemoryReading } from './concurrency.js';
import type { MemoryWatchdog } from './memory-watchdog.js';
import type { DesktopSpaceEngine } from './service/desktop-engine.js';
import type { SpaceManager } from './space-manager.js';

/*
 * Test control (plan 3.1, Step 2 exit tests). Exists only when the app is
 * started with AETHER_TEST_CONTROL=<file>: a loopback socket whose port and
 * random token are written to that file, taking one JSON request per line.
 * It drives the Space manager directly, checks the engine path through the
 * Electron CDP transport, and runs Code Mode scripts. The daemon for hosts
 * arrives in Phase 3.4.
 */

export interface TestControlDeps {
  manager: SpaceManager;
  store: SpaceStore;
  watchdog: MemoryWatchdog;
  client: CDPClient;
  slots: () => number;
  engine: DesktopSpaceEngine;
  codeMode: CodeModeHost;
  /** Replace the machine's memory reading, or restore it with undefined. */
  setMemory: (reading: MemoryReading | undefined) => void;
  filtered: { blocked: number };
}

type Args = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected a string argument');
  return value;
}

export function startTestControl(file: string, deps: TestControlDeps): Server {
  const token = randomBytes(24).toString('hex');
  const sessions = new Map<string, CDPSession>();
  const sessionFor = async (tabId: string): Promise<CDPSession> => {
    const known = sessions.get(tabId);
    if (known && !known.isDetached) return known;
    const session = await deps.client.attachToTarget(tabId);
    sessions.set(tabId, session);
    return session;
  };

  const ops: Record<string, (args: Args) => Promise<unknown> | unknown> = {
    state: () => ({
      visible: deps.manager.visibleSpaceId,
      spaces: deps.manager.list().map((entry) => ({
        id: entry.record.id,
        kind: entry.record.kind,
        activeTabId: entry.activeTabId,
        tabs: entry.tabs.map((tab) => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          state: tab.state,
          pid: tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents.getOSProcessId() : undefined,
        })),
      })),
    }),
    agentSpace: (args) => deps.manager.agentSpace(text(args.name), args.partition === 'ephemeral' ? 'ephemeral' : 'persist'),
    openTab: (args) => deps.manager.openTab(text(args.spaceId), text(args.url), { activate: Boolean(args.activate), live: Boolean(args.live) }).id,
    openTabs: (args) => deps.manager.openTabs(text(args.spaceId), (args.urls as unknown[]).map(text), { lazy: Boolean(args.lazy) }),
    showSpace: (args) => deps.manager.showSpace(text(args.spaceId)),
    activateTab: (args) => deps.manager.activateTab(text(args.tabId)),
    closeSpace: (args) => deps.manager.closeSpace(text(args.spaceId)),
    hibernate: (args) => deps.manager.hibernateTab(text(args.tabId)),
    crashTab: (args) => {
      const view = deps.manager.tab(text(args.tabId))?.view;
      if (!view) throw new Error('the tab is not live');
      view.webContents.forcefullyCrashRenderer();
      return true;
    },
    eval: async (args) => {
      const view = deps.manager.tab(text(args.tabId))?.view;
      if (!view) throw new Error('the tab is not live');
      return view.webContents.executeJavaScript(text(args.expression));
    },
    setMemory: (args) => deps.setMemory(args.free === undefined ? undefined : { free: Number(args.free), total: Number(args.total) }),
    slots: () => deps.slots(),
    watchdog: (args) => deps.watchdog.check(Date.now() + Number(args.laterMs ?? 0)),
    storeTabs: (args) => ({ rows: deps.store.tabs(text(args.spaceId)).length, bytes: deps.store.tabBytes(text(args.spaceId)) }),
    blocked: () => deps.filtered.blocked,
    metrics: () => app.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type, privateKB: metric.memory.privateBytes ?? metric.memory.workingSetSize })),
    /** Engine path: capture the page through the Electron CDP transport and render the skim. */
    capture: async (args) => {
      const session = await sessionFor(text(args.tabId));
      const model = await new Perceiver(session).capture();
      const skim = renderSkim(model);
      return { url: model.url, tokens: skim.tokens, firstLine: skim.text.split('\n')[0], refs: model.byRef.size };
    },
    /** Engine path: trusted wheel input through the transport. */
    wheel: async (args) => {
      const session = await sessionFor(text(args.tabId));
      for (let index = 0; index < Number(args.times ?? 1); index++) {
        await session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: Number(args.deltaY ?? 1200) });
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return true;
    },
    /** Code Mode (plan 3.2): one aether_exec through the app's host; a wait call carries the held token instead of code. */
    exec: (args) => {
      if (args.wait === undefined && typeof args.code !== 'string') {
        throw new Error('exec needs code (a script) or wait (a held token)');
      }
      return deps.codeMode.exec({
        ...(args.space === undefined ? {} : { space: text(args.space) }),
        thought: text(args.thought),
        ...(args.code === undefined ? {} : { code: text(args.code) }),
        ...(args.wait === undefined ? {} : { wait: text(args.wait) }),
      });
    },
    milestones: (args) => deps.manager.milestonesFor(text(args.spaceId)).map((milestone) => ({ text: milestone.text, source: milestone.source })),
    /** The request the Space's run is waiting on, if any. */
    pending: (args) => {
      const waiting = deps.engine.sessionFor(text(args.spaceId))?.run.waiting;
      return waiting ? { id: waiting.id, reason: waiting.reason, prompt: waiting.prompt } : undefined;
    },
    /** The person answered a pending request in the Space (interim bar path). */
    runReply: (args) => {
      const ok = deps.engine.reply(text(args.spaceId), {
        id: text(args.id),
        kind: args.kind === 'answer' || args.kind === 'approve' || args.kind === 'deny' || args.kind === 'done' || args.kind === 'resume' ? args.kind : 'answer',
        ...(args.text === undefined ? {} : { text: text(args.text) }),
      });
      if (!ok) throw new Error('no pending request matches this reply');
      return true;
    },
    /** Stop or Take over at once, whether or not a call is in flight. */
    runControl: (args) => {
      deps.engine.control(text(args.spaceId), args.kind === 'stop' ? 'stop' : 'takeover');
      if (args.kind === 'stop') deps.codeMode.stop(text(args.spaceId));
      return true;
    },
    quit: () => {
      setTimeout(() => app.quit(), 50);
      return true;
    },
  };

  const server = createServer((socket) => {
    let authorized = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\n');
        let request: { id?: number; token?: string; op?: string; args?: Args };
        try {
          request = JSON.parse(line) as typeof request;
        } catch {
          socket.destroy();
          return;
        }
        if (!authorized) {
          if (request.token !== token) {
            socket.destroy();
            return;
          }
          authorized = true;
        }
        const op = request.op ? ops[request.op] : undefined;
        if (!op) {
          socket.write(`${JSON.stringify({ id: request.id, error: `unknown op ${request.op}` })}\n`);
          continue;
        }
        Promise.resolve()
          .then(() => op(request.args ?? {}))
          .then(
            (result) => socket.write(`${JSON.stringify({ id: request.id, result: result ?? null })}\n`),
            (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              socket.write(`${JSON.stringify({ id: request.id, error: `op ${request.op}: ${message}` })}\n`);
            },
          );
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    writeFileSync(file, JSON.stringify({ port, token }), { mode: 0o600 });
  });
  return server;
}
