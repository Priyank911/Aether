/*
 * How many pages may load at once (plan 3.1, section 5.2), from the machine's
 * real state rather than a fixed cap: free memory above the reserve, divided
 * by what one page takes, bounded by CPU cores. The per-page figure starts at
 * the S7 measurement and is replaced by what this app's pages actually use.
 */

export const DEFAULT_PAGE_BYTES = 150 * 1024 * 1024;

export interface MemoryReading {
  free: number;
  total: number;
}

export interface SlotInput extends MemoryReading {
  reserveRatio: number;
  cores: number;
  pageBytes?: number;
}

export function pageSlots(input: SlotInput): number {
  const spare = input.free - input.total * input.reserveRatio;
  const byMemory = Math.floor(spare / (input.pageBytes ?? DEFAULT_PAGE_BYTES));
  const byCpu = Math.max(1, input.cores - 1);
  return Math.max(1, Math.min(byCpu, byMemory));
}

/** True when free memory is under the reserve, so background tabs should sleep. */
export function underPressure(reading: MemoryReading, reserveRatio: number): boolean {
  return reading.free < reading.total * reserveRatio;
}

/** Waits its turn: at most `limit()` holders at once, re-read on every release. */
export class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly limit: () => number;

  public constructor(limit: () => number) {
    this.limit = limit;
  }

  public async run<T>(body: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await body();
    } finally {
      this.release();
    }
  }

  public get inUse(): number {
    return this.active;
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit()) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => {
      this.active++;
      resolve();
    }));
  }

  private release(): void {
    this.active--;
    while (this.waiting.length > 0 && this.active < this.limit()) this.waiting.shift()?.();
  }
}
