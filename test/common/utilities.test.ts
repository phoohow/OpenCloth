import { describe, expect, it, vi } from 'vitest';
import { createIdFactory, genId } from '@/common/id';
import { csvCell, csvTable, formatClockTime, formatSavedAt } from '@/common/text';
import { assert, deepClone, err, ok } from '@/common/result';
import { seededRandom } from '@/common/random';
import { createSignal } from '@/common/events';
import { debounce, throttle, timeAsync } from '@/common/time';

describe('common/id', () => {
  it('produces reproducible ids from an injected clock', () => {
    const first = createIdFactory(() => 1000);
    const second = createIdFactory(() => 1000);
    const a1 = first('panel');
    expect(a1).toBe(second('panel'));
    expect(first('panel')).not.toBe(a1);
  });

  it('generates unique default ids', () => {
    expect(genId()).not.toBe(genId());
  });
});

describe('common/text', () => {
  it('quotes CSV cells containing separators, quotes or newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvTable([['a', 'b'], ['c,d']])).toBe('a,b\r\n"c,d"');
  });

  it('returns empty text for invalid timestamps', () => {
    expect(formatSavedAt('not-a-date')).toBe('');
    expect(formatClockTime('not-a-date')).toBe('');
    expect(formatSavedAt('2026-01-02T03:04:00')).toBe('01-02 03:04');
  });
});

describe('common/result', () => {
  it('carries success and failure explicitly', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    expect(err('bad')).toEqual({ ok: false, error: 'bad' });
    expect(() => assert(false, 'broken')).toThrow('broken');
  });

  it('clones nested data without sharing references', () => {
    const source = { nested: { value: 1 } };
    const copy = deepClone(source);
    copy.nested.value = 2;
    expect(source.nested.value).toBe(1);
  });
});

describe('common/random and common/events', () => {
  it('replays the same sequence for the same seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('unsubscribes and clears signal listeners', () => {
    const signal = createSignal<number>();
    const listener = vi.fn();
    const subscription = signal.subscribe(listener);
    signal.emit(1);
    subscription.dispose();
    signal.emit(2);
    expect(listener).toHaveBeenCalledTimes(1);
    signal.subscribe(listener);
    signal.clear();
    signal.emit(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('common/time', () => {
  it('skips measurement and logging when disabled', async () => {
    const log = vi.fn();
    await expect(timeAsync('task', async () => 7, { enabled: false, log })).resolves.toBe(7);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs one measurement when enabled', async () => {
    const log = vi.fn();
    await timeAsync('task', async () => 7, { enabled: true, log });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('[time] task');
  });

  it('debounces and throttles calls', () => {
    vi.useFakeTimers();
    try {
      const debounced = vi.fn();
      const run = debounce(debounced, 20);
      run(); run(); run();
      vi.advanceTimersByTime(20);
      expect(debounced).toHaveBeenCalledTimes(1);

      const throttled = vi.fn();
      const tick = throttle(throttled, 100);
      tick(); tick();
      expect(throttled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
