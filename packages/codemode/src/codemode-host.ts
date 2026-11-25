import { randomBytes } from 'node:crypto';
import {
  CODEMODE_LIMITS,
  execParamsProblem,
  parseSpaceCall,
  spaceIdFromName,
  type AetherExecParams,
  type ExecOutcome,
  type SpaceMethod,
  type WaitReason,
} from '@aether/shared';
import { CodeModeCallError } from './call-error.js';
import { returnProblem } from './return-guard.js';
import { SandboxRun, type SandboxResult } from './sandbox.js';
import { transpile } from './transpile.js';

/*
 * Runs aether_exec (plan 3.1, sections 7 and 8.1). Engine-agnostic: the
 * engine behind `space.*` is given as a SpaceEngine. One run per Space at a
 * time; a run still going after the hold time answers the host with a token,
 * keeps running, and hands its result to `wait` later.
 */

/** What a run tells the engine about itself. */
export interface RunContext {
  readonly spaceId: string;
  readonly spaceName: string;
  /** The engine read a page from this origin; the result becomes untrusted. */
  markRead(origin: string): void;
}

export interface SpaceEngine {
  /** One validated call. Throw CodeModeCallError to reject it with a code. */
  call(method: SpaceMethod, args: unknown[], run: RunContext): Promise<unknown>;
  /** Why the Space is waiting for the person, if it is. */
  pendingHuman(spaceId: string): { reason: Exclude<WaitReason, never>; prompt: string } | undefined;
  /** A run starts: show the thought as the current step. */
  runStarted(run: RunContext, thought: string): void;
  /** A run ended, however it ended. */
  runEnded(run: RunContext, outcome: ExecOutcome): void;
}

export interface CodeModeHostOptions {
  holdReturnMs?: number;
  heldResultTtlMs?: number;
  stallMs?: number;
  /** Debug output from console.log in scripts. */
  onLog?: (spaceId: string, text: string) => void;
}

/** A finished run as the connectors need it. */
export interface ExecReport {
  spaceId: string;
  spaceName: string;
  outcome: ExecOutcome;
  logs: string[];
}

interface ActiveRun {
  context: RunContext;
  sandbox: SandboxRun;
  origins: Set<string>;
  logs: string[];
  startedAt: number;
  done: Promise<ExecReport>;
  token?: string;
}

function newToken(): string {
  return randomBytes(12).toString('hex');
}

export class CodeModeHost {
  private readonly engine: SpaceEngine;
  private readonly options: Required<Omit<CodeModeHostOptions, 'onLog'>> & Pick<CodeModeHostOptions, 'onLog'>;
  private readonly active = new Map<string, ActiveRun>();
  private readonly held = new Map<string, { spaceId: string; spaceName: string; done: Promise<ExecReport>; expires?: NodeJS.Timeout }>();
  private readonly state = new Map<string, Map<string, { text: string; origins: string[] }>>();

  public constructor(engine: SpaceEngine, options: CodeModeHostOptions = {}) {
    this.engine = engine;
    this.options = {
      holdReturnMs: options.holdReturnMs ?? CODEMODE_LIMITS.holdReturnMs,
      heldResultTtlMs: options.heldResultTtlMs ?? CODEMODE_LIMITS.heldResultTtlMs,
      stallMs: options.stallMs ?? CODEMODE_LIMITS.stallMs,
      onLog: options.onLog,
    };
  }

  /** Run code, or keep waiting on a held run. Never throws for script or engine problems; they come back as outcomes. */
  public async exec(params: AetherExecParams): Promise<ExecReport> {
    const spaceName = params.space?.trim() || 'Task';
    const spaceId = spaceIdFromName(spaceName);
    const problem = execParamsProblem(params);
    if (problem) return this.failure(spaceId, spaceName, problem);
    if (params.wait) return this.waitFor(params.wait, spaceId, spaceName);

    const busy = this.active.get(spaceId);
    if (busy) {
      return this.failure(spaceId, spaceName, `the Space "${spaceName}" is still running a script${busy.token ? ` (held as ${busy.token}; wait with that token)` : ''}; wait for it or use another Space`);
    }
    const source = params.code ?? '';
    if (Buffer.byteLength(source, 'utf8') > CODEMODE_LIMITS.maxCodeBytes) {
      return this.failure(spaceId, spaceName, `the script is larger than ${CODEMODE_LIMITS.maxCodeBytes / 1024} KB; split the work into smaller runs`);
    }
    const compiled = transpile(source);
    if (!compiled.ok) return this.failure(spaceId, spaceName, compiled.message);

    const origins = new Set<string>();
    const logs: string[] = [];
    const context: RunContext = { spaceId, spaceName, markRead: (origin) => origins.add(origin) };
    const sandbox = new SandboxRun(compiled.code, {
      stallMs: this.options.stallMs,
      onCall: (method, args) => this.call(context, method, args),
      onLog: (text) => {
        logs.push(text);
        this.options.onLog?.(spaceId, text);
      },
    });
    const run: ActiveRun = { context, sandbox, origins, logs, startedAt: Date.now(), done: Promise.resolve(undefined as unknown as ExecReport) };
    run.done = sandbox.result.then((result) => this.complete(run, result));
    this.active.set(spaceId, run);
    this.engine.runStarted(context, params.thought);
    return this.raceHold(run.done, () => {
      run.token ??= newToken();
      this.held.set(run.token, { spaceId, spaceName, done: run.done });
      return run.token;
    }, spaceId, spaceName);
  }

  /** The person pressed Stop: end the Space's script now. */
  public stop(spaceId: string): void {
    this.active.get(spaceId)?.sandbox.stop('person', 'the person stopped this run');
  }

  /** Stop every running script, for an engine with one run for all Spaces. */
  public stopAll(): void {
    for (const run of this.active.values()) run.sandbox.stop('person', 'the person stopped this run');
  }

  /** Spaces with a script running now. */
  public runningSpaces(): string[] {
    return [...this.active.values()].map((run) => run.context.spaceName);
  }

  /** A script is running in this Space. */
  public isRunning(spaceId: string): boolean {
    return this.active.has(spaceId);
  }

  /** Forget a Space's state store, for aether_done. */
  public clearState(spaceId: string): void {
    this.state.delete(spaceId);
  }

  private async waitFor(token: string, spaceId: string, spaceName: string): Promise<ExecReport> {
    const entry = this.held.get(token);
    if (!entry) return this.failure(spaceId, spaceName, `no held run with token ${token}; it finished more than ${Math.round(this.options.heldResultTtlMs / 60000)} minutes ago or never existed`);
    return this.raceHold(entry.done, () => token, entry.spaceId, entry.spaceName);
  }

  /** The run's report if it finishes within the hold time, otherwise a held outcome with a token to wait on. */
  private async raceHold(done: Promise<ExecReport>, tokenFor: () => string, spaceId: string, spaceName: string): Promise<ExecReport> {
    let timer: NodeJS.Timeout | undefined;
    const held = new Promise<'held'>((resolve) => {
      timer = setTimeout(() => resolve('held'), this.options.holdReturnMs);
    });
    const first = await Promise.race([done, held]);
    clearTimeout(timer);
    if (first !== 'held') return first;
    const token = tokenFor();
    const waiting = this.engine.pendingHuman(spaceId);
    return {
      spaceId,
      spaceName,
      logs: [],
      outcome: {
        status: 'held',
        token,
        reason: waiting?.reason ?? 'working',
        prompt: waiting?.prompt ?? 'the script is still working',
      },
    };
  }

  private async call(context: RunContext, method: SpaceMethod, args: unknown[]): Promise<unknown> {
    const parsed = parseSpaceCall(method, args);
    if (!parsed.ok) throw new CodeModeCallError('invalid_args', parsed.message);
    if (method === 'stateGet') {
      const entry = this.state.get(context.spaceId)?.get(String(parsed.args[0]));
      for (const origin of entry?.origins ?? []) context.markRead(origin);
      return entry === undefined ? undefined : JSON.parse(entry.text);
    }
    if (method === 'stateSet') return this.setState(context.spaceId, String(parsed.args[0]), parsed.args[1]);
    return this.engine.call(method, parsed.args, context);
  }

  private setState(spaceId: string, key: string, value: unknown): undefined {
    const store = this.state.get(spaceId) ?? new Map<string, { text: string; origins: string[] }>();
    if (value === undefined) store.delete(key);
    else {
      const text = JSON.stringify(value);
      const size = [...store.entries()].filter(([name]) => name !== key).reduce((sum, [name, stored]) => sum + Buffer.byteLength(name, 'utf8') + Buffer.byteLength(stored.text, 'utf8'), 0);
      if (size + Buffer.byteLength(key, 'utf8') + Buffer.byteLength(text, 'utf8') > CODEMODE_LIMITS.maxStateBytes) {
        throw new CodeModeCallError('invalid_args', `space.state is limited to ${CODEMODE_LIMITS.maxStateBytes / 1024} KB per Space; store ids and short fields, not page text`);
      }
      // Persist the run's provenance with the serialized value, not a mutable run-owned Set.
      store.set(key, { text, origins: [...(this.active.get(spaceId)?.origins ?? [])] });
    }
    this.state.set(spaceId, store);
    return undefined;
  }

  private complete(run: ActiveRun, result: SandboxResult): ExecReport {
    this.active.delete(run.context.spaceId);
    const untrusted = run.origins.size > 0;
    const origins = [...run.origins];
    let outcome: ExecOutcome;
    if (result.status === 'stopped') outcome = { status: 'stopped', by: result.by, message: result.message };
    else if (result.status === 'error' && result.code === 'stopped') outcome = { status: 'stopped', by: 'person', message: 'the person stopped this run' };
    else if (result.status === 'error') outcome = { status: 'error', message: result.message, line: result.line, column: result.column, untrusted, origins };
    else {
      const problem = result.json === '' ? undefined : returnProblem(result.json);
      outcome = problem
        ? { status: 'error', message: problem, untrusted: false, origins: [] }
        : { status: 'complete', json: result.json === '' ? undefined : result.json, untrusted, origins, durationMs: Date.now() - run.startedAt };
    }
    if (run.token) {
      const entry = this.held.get(run.token);
      if (entry) entry.expires = setTimeout(() => this.held.delete(run.token ?? ''), this.options.heldResultTtlMs).unref();
    }
    this.engine.runEnded(run.context, outcome);
    return { spaceId: run.context.spaceId, spaceName: run.context.spaceName, outcome, logs: run.logs };
  }

  private failure(spaceId: string, spaceName: string, message: string): ExecReport {
    return { spaceId, spaceName, logs: [], outcome: { status: 'error', message, untrusted: false, origins: [] } };
  }
}
