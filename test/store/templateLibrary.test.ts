import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePatternFile, GARMENT_TEMPLATES, PRESET_KEYS, presetPattern } from '@/pattern/template';

/** In-memory stand-in for the local template asset store. */
const state = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/io/storage', () => ({
  listPatternTemplateAssets: async () => [...state.records.values()],
  savePatternTemplateAsset: async (asset: Record<string, unknown>) => {
    state.records.set(asset.id as string, asset);
  },
  deletePatternTemplateAsset: async (id: string) => { state.records.delete(id); },
}));

beforeEach(() => {
  state.records.clear();
  vi.resetModules();
});

describe('template library', () => {
  it('starts with the file-backed built-ins and keeps them after hydration', async () => {
    const lib = await import('@/store/templateLibrary');
    expect(lib.getTemplates().map(template => template.key))
      .toEqual(GARMENT_TEMPLATES.map(template => template.key));
    expect(lib.readBundledTemplates().map(template => template.key).sort())
      .toEqual([...PRESET_KEYS].sort());

    let notified = 0;
    const unsubscribe = lib.subscribeTemplates(() => { notified += 1; });
    await lib.hydrateTemplates();

    const keys = lib.getTemplates().map(template => template.key);
    expect(keys).toEqual([...PRESET_KEYS]);
    expect(lib.getTemplates().every(template => template.source === 'file')).toBe(true);
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
  });

  it('imports, replaces and removes user templates', async () => {
    const lib = await import('@/store/templateLibrary');
    const text = encodePatternFile(presetPattern('dress'), { name: '我的连衣裙', key: 'my-dress' });

    const first = await lib.importPatternTexts([{ name: 'my-dress.ocpat', text }]);
    expect(first.added).toEqual(['我的连衣裙']);
    expect(first.errors).toEqual([]);

    const mine = lib.getTemplates().find(template => template.key === 'my-dress');
    expect(mine?.source).toBe('user');
    expect(mine?.assetId).toBeDefined();

    const again = await lib.importPatternTexts([{ name: 'my-dress.ocpat', text }]);
    expect(again.added).toEqual(['我的连衣裙']);
    expect(lib.getTemplates().filter(template => template.key === 'my-dress')).toHaveLength(1);
    expect(state.records.size).toBe(1);

    const clash = await lib.importPatternTexts([{
      name: 'clash.ocpat',
      text: encodePatternFile(presetPattern('dress'), { name: '冲突', key: 'tshirt' }),
    }]);
    expect(clash.errors[0]).toContain('重复');

    const invalid = await lib.importPatternTexts([{ name: 'bad.ocpat', text: '{}' }]);
    expect(invalid.errors[0]).toContain('key');

    await lib.removeUserTemplate(mine!.assetId!);
    expect(lib.getTemplates().some(template => template.key === 'my-dress')).toBe(false);
  });
});
