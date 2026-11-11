import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface RunSummary {
  id: string;
  startedAt: number;
  endedAt?: number;
  success?: boolean;
  steps: number;
  resultTokens: number;
}

/** One row per run and per tool call, for the side panel's step list and for Step 7 measurement. */
export class RunLog {
  private readonly db: Database.Database;
  private current?: string;
  private step = 0;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public get runId(): string | undefined {
    return this.current;
  }

  private ensureRun(): string {
    if (this.current) return this.current;
    this.current = randomUUID();
    this.step = 0;
    this.db.prepare('INSERT INTO runs (id, started_at) VALUES (?, ?)').run(this.current, Date.now());
    return this.current;
  }

  public logStep(tool: string, label: string, resultTokens: number, ok: boolean): void {
    const runId = this.ensureRun();
    this.step++;
    this.db
      .prepare('INSERT INTO run_steps (run_id, step, tool, label, result_tokens, ok, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(runId, this.step, tool, label.slice(0, 200), resultTokens, ok ? 1 : 0, Date.now());
  }

  public endRun(success: boolean, result: string): RunSummary | undefined {
    const runId = this.current;
    if (!runId) return undefined;
    this.db.prepare('UPDATE runs SET ended_at = ?, success = ?, result = ? WHERE id = ?').run(Date.now(), success ? 1 : 0, result.slice(0, 2000), runId);
    this.current = undefined;
    return this.summary(runId);
  }

  public summary(runId: string): RunSummary | undefined {
    const run = this.db.prepare('SELECT id, started_at, ended_at, success FROM runs WHERE id = ?').get(runId) as
      | { id: string; started_at: number; ended_at: number | null; success: number | null }
      | undefined;
    if (!run) return undefined;
    const totals = this.db.prepare('SELECT COUNT(*) AS steps, COALESCE(SUM(result_tokens), 0) AS tokens FROM run_steps WHERE run_id = ?').get(runId) as {
      steps: number;
      tokens: number;
    };
    return {
      id: run.id,
      startedAt: run.started_at,
      endedAt: run.ended_at ?? undefined,
      success: run.success === null ? undefined : run.success === 1,
      steps: totals.steps,
      resultTokens: totals.tokens,
    };
  }
}
