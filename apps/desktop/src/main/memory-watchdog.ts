import { freemem, totalmem } from 'node:os';
import { underPressure, type MemoryReading } from './concurrency.js';
import type { SpaceManager } from './space-manager.js';

/*
 * Memory watchdog (plan 3.1, section 5.2): no tab limit while free memory is
 * above the reserve; under it, the least recently viewed live tab that nobody
 * is looking at goes to sleep, a few per check, until memory recovers or none
 * is left. The tab on screen is never put to sleep.
 */

export interface MemoryProbe {
  read(): MemoryReading;
}

/** The machine's memory. On Windows os.freemem() is available physical memory. */
export const systemMemory: MemoryProbe = { read: () => ({ free: freemem(), total: totalmem() }) };

const PER_CHECK = 3;

export class MemoryWatchdog {
  private readonly manager: SpaceManager;
  private readonly probe: () => MemoryProbe;
  private readonly reserveRatio: () => number;
  private timer?: NodeJS.Timeout;
  private checking = false;
  public slept = 0;

  public constructor(manager: SpaceManager, probe: () => MemoryProbe, reserveRatio: () => number) {
    this.manager = manager;
    this.probe = probe;
    this.reserveRatio = reserveRatio;
  }

  public start(intervalMs = 5000): void {
    this.stop();
    this.timer = setInterval(() => void this.check(), intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One check; returns how many tabs went to sleep. `now` lets tests stand later in time. */
  public async check(now = Date.now()): Promise<number> {
    if (this.checking) return 0;
    this.checking = true;
    let count = 0;
    try {
      while (count < PER_CHECK && underPressure(this.probe().read(), this.reserveRatio())) {
        const oldest = this.manager.sleepCandidates(now)[0];
        if (!oldest) break;
        await this.manager.hibernateTab(oldest.id);
        count++;
      }
    } finally {
      this.checking = false;
    }
    this.slept += count;
    return count;
  }
}
