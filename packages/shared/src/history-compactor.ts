import type { HistoryStep } from './schemas.js';

export interface HistoryCompactorOptions {
  windowSize?: number;
  maxUncompactedSteps?: number;
}

export class HistoryCompactor {
  private readonly steps: HistoryStep[] = [];
  private readonly windowSize: number;
  private readonly maxUncompactedSteps: number;
  private runningSummary: string | null = null;
  private foldedUpToStep = 0;

  constructor(options: HistoryCompactorOptions = {}) {
    this.windowSize = options.windowSize ?? 8;
    this.maxUncompactedSteps = options.maxUncompactedSteps ?? 12;
  }

  /**
   * Append a step record to history. Folds older steps in batches when threshold is crossed.
   */
  public addStep(step: HistoryStep): void {
    this.steps.push(step);
    if (this.steps.length - this.foldedUpToStep >= this.maxUncompactedSteps) {
      this.fold();
    }
  }

  /**
   * Fold history older than the recent window into a compact summary line.
   */
  public fold(): void {
    const keepStartIndex = Math.max(0, this.steps.length - this.windowSize);
    if (keepStartIndex <= this.foldedUpToStep) return;

    const toFold = this.steps.slice(this.foldedUpToStep, keepStartIndex);
    if (toFold.length === 0) return;

    const summaryParts: string[] = [];
    for (const s of toFold) {
      summaryParts.push(`${s.actor === 'human' ? 'human' : 'agent'}: ${s.action} (${s.outcome})`);
    }
    const chunkSummary = summaryParts.join('; ');
    if (this.runningSummary) {
      this.runningSummary += ` | ${chunkSummary}`;
    } else {
      this.runningSummary = chunkSummary;
    }
    this.foldedUpToStep = keepStartIndex;
  }

  /**
   * Format history for prompt inclusion: append-only running summary plus recent steps verbatim.
   */
  public render(): string {
    const lines: string[] = [];
    if (this.runningSummary) {
      lines.push(`[Summary steps 1-${this.foldedUpToStep}: ${this.runningSummary}]`);
    }
    for (let i = this.foldedUpToStep; i < this.steps.length; i++) {
      const s = this.steps[i];
      if (!s) continue;
      lines.push(`${s.step} ${s.action} -> ${s.outcome}`);
    }
    return lines.join('\n');
  }

  /**
   * Get all raw steps.
   */
  public getSteps(): ReadonlyArray<HistoryStep> {
    return this.steps;
  }

  /**
   * Reset history state.
   */
  public clear(): void {
    this.steps.length = 0;
    this.runningSummary = null;
    this.foldedUpToStep = 0;
  }
}
