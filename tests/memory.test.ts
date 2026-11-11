import { describe, expect, it } from 'vitest';
import { MemoryRefusedError, MemoryStore, openDatabase, RunLog, siteOf, STALE_AFTER_FAILURES } from '@aether/memory';

const fresh = (): MemoryStore => new MemoryStore(openDatabase(':memory:'));

describe('memory store', () => {
  it('keeps facts and returns the person’s own outside the untrusted part', () => {
    const store = fresh();
    store.saveFact('Seat', 'aisle', 'user');
    store.saveFact('home airport', 'AMD', 'agent');
    const recalled = store.recall({});
    expect(recalled.trusted).toEqual(['preference: seat = aisle']);
    expect(recalled.untrusted).toEqual(['saved: home airport = AMD']);
    expect(store.recall({ key: 'seat' }).untrusted).toEqual([]);
  });

  it('refuses passwords, codes and card numbers', () => {
    const store = fresh();
    expect(() => store.saveFact('password', 'hunter2', 'user')).toThrow(MemoryRefusedError);
    expect(() => store.saveFact('card', '4111 1111 1111 1111', 'agent')).toThrow(MemoryRefusedError);
    expect(() => store.saveNote('bank.example', 'the OTP is 493817')).toThrow(MemoryRefusedError);
    expect(store.facts()).toEqual([]);
  });

  it('stores routes per site, advertises them, and marks them stale after repeated failures', () => {
    const store = fresh();
    store.recordSuccess('https://www.trains.example/search', 'search trains', ['open https://trains.example/', 'fill combobox "From"', 'click button "Search"']);
    expect(store.advert('https://trains.example/other')).toBe('memory: 1 known route for trains.example; call memory op=recall site=trains.example');
    const recall = store.recall({ site: 'trains.example' }).untrusted.join('\n');
    expect(recall).toContain('route for "search trains" (worked 1x):');
    expect(recall).toContain('3. click button "Search"');
    for (let index = 0; index < STALE_AFTER_FAILURES; index++) store.recordFailure('trains.example', 'search trains');
    expect(store.procedures('trains.example')[0]?.stale).toBe(true);
    expect(store.advert('trains.example')).toBeUndefined();
    store.recordSuccess('trains.example', 'search trains', ['open https://trains.example/', 'click button "Search"']);
    expect(store.procedures('trains.example')[0]?.stale).toBe(false);
  });

  it('keeps recall near 300 tokens', () => {
    const store = fresh();
    for (let index = 0; index < 60; index++) store.saveNote('big.example', `note number ${index} with some ordinary words in it`);
    const recall = store.recall({ site: 'big.example' });
    const text = [...recall.trusted, ...recall.untrusted].join('\n');
    expect(Math.ceil(text.length / 3.5)).toBeLessThanOrEqual(320);
    expect(recall.untrusted.at(-1)).toMatch(/^\.\.\. \d+ more lines$/);
  });

  it('stores and recalls nothing when memory is off', () => {
    const store = fresh();
    store.saveFact('seat', 'aisle', 'user');
    store.setEnabled(false);
    expect(store.recall({}).trusted).toEqual([]);
    expect(() => store.saveFact('meal', 'vegetarian', 'user')).toThrow('memory is off');
    store.setEnabled(true);
    expect(store.recall({}).trusted).toEqual(['preference: seat = aisle']);
  });

  it('files sites by host without www', () => {
    expect(siteOf('https://www.Example.com/path?q=1')).toBe('example.com');
    expect(siteOf('localhost:4101')).toBe('localhost:4101');
  });
});

describe('run log', () => {
  it('records steps and totals per run', () => {
    const log = new RunLog(openDatabase(':memory:'));
    log.logStep('open', 'Opening shop.example', 120, true);
    log.logStep('act', 'Fill the form', 40, false);
    const summary = log.endRun(true, 'done');
    expect(summary).toMatchObject({ steps: 2, resultTokens: 160, success: true });
    expect(log.runId).toBeUndefined();
  });
});
