import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, type PreferencesStorage } from '@/store/prefs';

/** In-memory storage holding one persisted preferences value. */
function storageWith(value: unknown): PreferencesStorage {
  const text = JSON.stringify(value);
  return { getItem: key => (key === PREFS_KEY ? text : null), setItem: () => { } };
}

describe('auxiliary prefs', () => {
  it('reads the two-group shape', () => {
    expect(readPrefs(storageWith({ aux: { wire: 'over', proxy: 'only' } })).aux)
      .toEqual({ wire: 'over', proxy: 'only' });
  });

  it('defaults a missing or invalid group to off', () => {
    expect(readPrefs(storageWith({ aux: { wire: 'bogus', proxy: 'only' } })).aux)
      .toEqual({ wire: 'off', proxy: 'only' });
    expect(readPrefs(storageWith({})).aux).toEqual(DEFAULT_PREFS.aux);
  });

  it('defaults a non-object aux value to the default groups', () => {
    expect(readPrefs(storageWith({ aux: 'wire-only' })).aux).toEqual(DEFAULT_PREFS.aux);
    expect(readPrefs(storageWith({ wire: 'over' })).aux).toEqual(DEFAULT_PREFS.aux);
  });
});