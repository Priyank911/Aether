import { Worker } from 'node:worker_threads';
import { CODEMODE_LIMITS, SpaceMethodSchema, type CodeModeErrorCode, type SpaceMethod } from '@aether/shared';
import { CodeModeCallError } from './call-error.js';
import { SANDBOX_PRELUDE, SANDBOX_WORKER_SOURCE } from './worker-source.js';

/*
 * One script in one worker (plan 3.1, section 7.1). A script that keeps making
 * space.* calls is never stopped for running long; it is stopped only when it
 * has no call in flight and nothing has been heard from it for the stall time,
 * which is what an infinite loop looks like from outside.
 */

export type SandboxResult =
  | { status: 'complete'; json: string }
  | { status: 'error'; message: string; line?: number; column?: number; code?: string }
  | { status: 'stopped'; by: 'person' | 'stall'; message: string };

export interface SandboxOptions {
  /** Runs one space.* call. Throw CodeModeCallError to reject it with a code. */
  onCall: (method: SpaceMethod, args: unknown[]) => Promise<unknown>;
  onLog?: (text: string) => void;
  stallMs?: number;
  /** Limit on synchronous work before the first await. */
  syncTimeoutMs?: number;
  heapMb?: number;
}

interface WorkerMessage {
  type: 'ready' | 'call' | 'log' | 'done';
  id?: number;
  method?: string;
  argsJson?: string;
  text?: string;
  ok?: boolean;
  payload?: string;
  line?: number;
  column?: number;
  code?: string;
}

const WATCH_INTERVAL_MS = 250;
const START_TIMEOUT_MS = 15_000;

export class SandboxRun {
  public readonly result: Promise<SandboxResult>;
  private readonly worker: Worker;
  private readonly options: SandboxOptions;
  private readonly inFlight = new Set<number>();
  private lastActivity = Date.now();
  private logBytes = 0;
  private finished = false;
  private ready = false;
  private resolveResult!: (result: SandboxResult) => void;
  private readonly watchdog: NodeJS.Timeout;

  public constructor(code: string, options: SandboxOptions) {
    this.options = options;
    this.result = new Promise<SandboxResult>((resolve) => {
      this.resolveResult = resolve;
    });
    const heapMb = options.heapMb ?? 128;
    this.worker = new Worker(SANDBOX_WORKER_SOURCE, {
      eval: true,
      workerData: { code, prelude: SANDBOX_PRELUDE, syncTimeoutMs: options.syncTimeoutMs ?? 5000 },
      resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: Math.max(8, Math.round(heapMb / 8)), stackSizeMb: 4 },
      env: {},
      stdout: true,
      stderr: true,
    });
    this.worker.on('message', (message: WorkerMessage) => this.onMessage(message));
    this.worker.on('error', (error: Error & { code?: string }) => {
      const message =
        error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? `the script used more than ${heapMb} MB of memory and was stopped`
          : `the script's worker failed: ${error.message}`;
      this.finish({ status: 'error', message });
    });
    this.worker.on('exit', () => this.finish({ status: 'error', message: 'the script ended without a result' }));
    const stallMs = options.stallMs ?? CODEMODE_LIMITS.stallMs;
    const created = Date.now();
    this.watchdog = setInterval(() => {
      // Starting a worker can take a while on a busy machine; the stall clock runs only once the script runs.
      if (!this.ready) {
        if (Date.now() - created > START_TIMEOUT_MS) this.finish({ status: 'error', message: `the sandbox did not start within ${START_TIMEOUT_MS / 1000} s` });
        return;
      }
      if (this.inFlight.size === 0 && Date.now() - this.lastActivity > stallMs) {
        this.finish({ status: 'stopped', by: 'stall', message: `the script made no progress for ${Math.round(stallMs / 1000)} s with no space.* call in flight (an endless loop?) and was stopped` });
      }
    }, WATCH_INTERVAL_MS);
  }

  /** Calls the engine is working on for this script now. */
  public get pendingCalls(): number {
    return this.inFlight.size;
  }

  /** Stop at once. The script's pending calls are abandoned. */
  public stop(by: 'person' | 'stall', message: string): void {
    this.finish({ status: 'stopped', by, message });
  }

  private onMessage(message: WorkerMessage): void {
    if (this.finished) return;
    this.lastActivity = Date.now();
    if (message.type === 'ready') {
      this.ready = true;
      return;
    }
    if (message.type === 'log' && message.text !== undefined) {
      if (this.logBytes < CODEMODE_LIMITS.maxLogBytes) {
        this.logBytes += message.text.length;
        this.options.onLog?.(message.text);
      }
      return;
    }
    if (message.type === 'done') {
      if (message.ok) this.finish({ status: 'complete', json: message.payload ?? '' });
      else
        this.finish({
          status: 'error',
          message: message.payload ?? 'script failed',
          line: message.line || undefined,
          column: message.column || undefined,
          code: message.code || undefined,
        });
      return;
    }
    if (message.type === 'call' && message.id !== undefined) void this.dispatch(message.id, message.method ?? '', message.argsJson ?? '[]');
  }

  private async dispatch(id: number, rawMethod: string, argsJson: string): Promise<void> {
    this.inFlight.add(id);
    try {
      const method = SpaceMethodSchema.safeParse(rawMethod);
      if (!method.success) throw new CodeModeCallError('invalid_args', `space.${rawMethod} does not exist`);
      let args: unknown;
      try {
        args = JSON.parse(argsJson);
      } catch {
        throw new CodeModeCallError('invalid_args', `space.${rawMethod}: arguments were not valid JSON`);
      }
      const value = await this.options.onCall(method.data, Array.isArray(args) ? args : []);
      this.reply(id, true, value === undefined ? '' : JSON.stringify(value));
    } catch (error) {
      const code: CodeModeErrorCode = error instanceof CodeModeCallError ? error.code : 'engine';
      const text = error instanceof Error ? error.message : String(error);
      this.reply(id, false, JSON.stringify({ code, message: text }));
    } finally {
      this.inFlight.delete(id);
      this.lastActivity = Date.now();
    }
  }

  private reply(id: number, ok: boolean, json: string): void {
    if (this.finished) return;
    try {
      this.worker.postMessage({ type: 'reply', id, ok, json });
    } catch {
      // The worker is gone; its exit handler reports the end.
    }
  }

  private finish(result: SandboxResult): void {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.watchdog);
    this.resolveResult(result);
    void this.worker.terminate().catch(() => undefined);
  }
}
