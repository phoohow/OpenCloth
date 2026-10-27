import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY, pickPrefs, readPrefs, writePrefs, type PreferencesStorage } from '../../src/store/prefs';

function fakeStorage(initial: Record<string, string> = {}): PreferencesStorage & { dump: () => Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    dump: () => Object.fromEntries(data),
  };
}

describe('readPrefs', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readPrefs(fakeStorage())).toEqual(DEFAULT_PREFS);
  });

  it('reads back what was written', () => {
    const prefs = {
      ...DEFAULT_PREFS,
      layout: 'split2d3d' as const,
      showTimeline: false,
      autoSaveSeconds: 60,
      leftPanelWidth: 300,
      sceneRatio: 0.4,
    };
    const storage = fakeStorage();
    writePrefs(prefs, storage);
    expect(readPrefs(storage)).toEqual(prefs);
  });

  it('falls back on unreadable content', () => {
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: '{ not json' }))).toEqual(DEFAULT_PREFS);
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: '"a string"' }))).toEqual(DEFAULT_PREFS);
  });

  it('ignores unknown enum values but keeps the valid ones', () => {
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({
        layout: 'quad', focus: '2d', renderMode: 'raytrace', propTab: 'audio', cameraProjection: 'isometric',
      }),
    });
    const prefs = readPrefs(storage);
    expect(prefs.layout).toBe(DEFAULT_PREFS.layout);
    expect(prefs.renderMode).toBe(DEFAULT_PREFS.renderMode);
    expect(prefs.propTab).toBe(DEFAULT_PREFS.propTab);
    expect(prefs.cameraProjection).toBe(DEFAULT_PREFS.cameraProjection);
    expect(prefs.focus).toBe('2d');
  });

  it('keeps an orthographic camera choice across reloads', () => {
    const storage = fakeStorage({ [PREFS_KEY]: JSON.stringify({ cameraProjection: 'orthographic' }) });
    expect(readPrefs(storage).cameraProjection).toBe('orthographic');
  });

  it('clamps a share outside the draggable range', () => {
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ splitRatio: 2.5 }) })).splitRatio).toBe(0.85);
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ splitRatio: -3 }) })).splitRatio).toBe(0.15);
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ sceneRatio: 9 }) })).sceneRatio).toBe(0.6);
  });

  it('clamps a panel width outside the draggable range', () => {
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ leftPanelWidth: 40 }) })).leftPanelWidth).toBe(160);
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ rightPanelWidth: 4000 }) })).rightPanelWidth).toBe(560);
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ leftPanelWidth: 'wide' }) })).leftPanelWidth)
      .toBe(DEFAULT_PREFS.leftPanelWidth);
  });

  it('rejects a non-numeric or unexpected autosave period', () => {
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ autoSaveSeconds: 7 }) })).autoSaveSeconds).toBe(0);
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ autoSaveSeconds: '30' }) })).autoSaveSeconds).toBe(0);
    expect(readPrefs(fakeStorage({ [PREFS_KEY]: JSON.stringify({ autoSaveSeconds: 300 }) })).autoSaveSeconds).toBe(300);
  });

  it('survives a storage that refuses to be read', () => {
    const hostile: PreferencesStorage = {
      getItem: () => { throw new Error('disabled'); },
      setItem: () => { throw new Error('full'); },
    };
    expect(readPrefs(hostile)).toEqual(DEFAULT_PREFS);
    expect(() => writePrefs(DEFAULT_PREFS, hostile)).not.toThrow();
  });
});

describe('pickPrefs', () => {
  it('carries only the persisted fields', () => {
    const live = {
      ...DEFAULT_PREFS,
      selection: ['panel1'],
      sceneRatio: 0.4,
      fitToken: 3,
      activeTool: 'dart',
    };
    const picked = pickPrefs(live);
    expect(picked).not.toHaveProperty('selection');
    expect(picked).not.toHaveProperty('fitToken');
    expect(picked).not.toHaveProperty('activeTool');
    expect(picked.splitRatio).toBe(DEFAULT_PREFS.splitRatio);
  });

  it('defaults to an even split and an even right column', () => {
    expect(DEFAULT_PREFS.splitRatio).toBe(0.5);
    expect(DEFAULT_PREFS.sceneRatio).toBe(0.5);
  });
});
