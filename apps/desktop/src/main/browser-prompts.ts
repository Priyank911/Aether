import { EventEmitter } from 'node:events';
import { app, shell, type WebContents } from 'electron';
import type { BrowserPrompt, ShellCommand } from '@aether/shared';
import type { SpaceManager } from './space-manager.js';

type Reply = Extract<ShellCommand, { type: 'browser.reply' }>;
interface PendingPrompt { prompt: BrowserPrompt; finish: (reply?: Reply) => void; timer: NodeJS.Timeout }

function origin(url: string): string {
  try { return new URL(url).origin; } catch { return 'Unknown site'; }
}

/** Short-lived, navigation-bound requests. Credentials never enter snapshots, logs or storage. */
export class BrowserPrompts extends EventEmitter {
  private sequence = 0;
  private readonly pending: PendingPrompt[] = [];
  private readonly grants = new Set<string>();
  private readonly bindings = new Map<number, string>();

  public constructor(private readonly manager: SpaceManager) {
    super();
    app.on('login', (event, contents, request, authInfo, callback) => {
      event.preventDefault();
      if (!contents) { callback(); return; }
      const tab = this.owner(contents);
      if (!tab) { callback(); return; }
      this.bindings.set(contents.id, tab.id);
      const state = manager.frameFor(tab.spaceId)?.state;
      if (tab.kind === 'agent' && (state === 'acting' || state === 'resuming')) {
        tab.authenticationRequired = true;
        callback();
        return;
      }
      this.enqueue({ tabId: tab.id, kind: 'auth', origin: origin(request.url), detail: authInfo.isProxy ? 'The network proxy requires a username and password.' : 'This site requires a username and password.' }, (reply) => {
        if (reply?.allow) callback(reply.username ?? '', reply.password ?? ''); else callback();
      });
    });
    app.on('certificate-error', (event, contents, _url, _error, _certificate, callback) => {
      event.preventDefault();
      const tab = this.owner(contents);
      if (tab?.kind === 'agent') tab.certificateRefused = true;
      callback(false);
    });
    manager.on('external-protocol', (tabId: string, url: string) => this.external(tabId, url));
    const observe = (contents: WebContents) => {
      contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) this.cancel(contents); });
      contents.once('destroyed', () => this.cancel(contents));
    };
    app.on('web-contents-created', (_event, contents) => observe(contents));
    for (const entry of manager.list()) for (const tab of entry.tabs) if (tab.view) observe(tab.view.webContents);
  }

  public current(): BrowserPrompt | undefined {
    const shown = this.manager.shownTab();
    return this.pending.find((entry) => entry.prompt.tabId === shown?.id)?.prompt;
  }

  public requestPermission(contents: WebContents, permission: string, requestingUrl: string, callback: (allow: boolean) => void): void {
    const tab = this.owner(contents);
    if (tab?.kind !== 'human' || tab !== this.manager.shownTab() || !/^https?:/.test(requestingUrl)) { callback(false); return; }
    this.bindings.set(contents.id, tab.id);
    const requestingOrigin = origin(requestingUrl);
    const key = `${contents.id}:${requestingOrigin}:${permission}`;
    if (this.grants.has(key)) { callback(true); return; }
    this.enqueue({ tabId: tab.id, kind: 'permission', origin: requestingOrigin, detail: permission }, (reply) => {
      if (reply?.allow) this.grants.add(key);
      callback(Boolean(reply?.allow));
    });
  }

  public checkPermission(contents: WebContents, permission: string, requestingOrigin: string): boolean {
    return this.owner(contents)?.kind === 'human' && this.grants.has(`${contents.id}:${origin(requestingOrigin)}:${permission}`);
  }

  public reply(reply: Reply): boolean {
    const current = this.current();
    if (!current || current.id !== reply.id) return false;
    const entry = this.pending.find((pending) => pending.prompt.id === reply.id);
    if (!entry) return false;
    this.resolve(entry, reply);
    return true;
  }

  private owner(contents: WebContents) {
    return this.manager.list().flatMap((entry) => entry.tabs).find((tab) => tab.view?.webContents === contents);
  }

  private external(tabId: string, url: string): void {
    const tab = this.manager.tab(tabId);
    if (tab?.kind !== 'human' || tab !== this.manager.shownTab()) return;
    if (!/^(mailto|tel|sms):/i.test(url)) { this.emit('notice', 'This external address type is not supported.'); return; }
    if (tab.view) this.bindings.set(tab.view.webContents.id, tab.id);
    this.enqueue({ tabId, kind: 'external', origin: origin(tab.url), detail: url.slice(0, 4096) }, (reply) => {
      if (reply?.allow) void shell.openExternal(url).catch(() => this.emit('notice', 'The external app could not open. Check your default apps.'));
    });
  }

  private enqueue(prompt: Omit<BrowserPrompt, 'id'>, finish: (reply?: Reply) => void): void {
    const entry: PendingPrompt = { prompt: { ...prompt, id: ++this.sequence }, finish, timer: setTimeout(() => this.resolve(entry), 120000) };
    this.pending.push(entry);
    this.emit('changed');
  }

  private resolve(entry: PendingPrompt, reply?: Reply): void {
    const index = this.pending.indexOf(entry);
    if (index < 0) return;
    this.pending.splice(index, 1);
    clearTimeout(entry.timer);
    entry.finish(reply);
    this.emit('changed');
  }

  private cancel(contents: WebContents): void {
    const tabId = this.bindings.get(contents.id) ?? this.owner(contents)?.id;
    this.bindings.delete(contents.id);
    for (const entry of [...this.pending]) if (entry.prompt.tabId === tabId) this.resolve(entry);
    for (const key of this.grants) if (key.startsWith(`${contents.id}:`)) this.grants.delete(key);
  }
}
