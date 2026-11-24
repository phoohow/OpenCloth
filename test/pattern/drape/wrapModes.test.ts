import { describe, expect, it } from 'vitest';
import { panelWrapMode, regionAnchor, resolveWrap, wrapDrapeForMode } from '@/garment';
import { createStarterProject } from '@/app';

describe('panel wrap modes', () => {
  it('reads the mode of a stored drape', () => {
    expect(panelWrapMode(undefined)).toBe('flat');
    expect(panelWrapMode({ region: 'torso', zone: 'back' })).toBe('torso-back');
    expect(panelWrapMode({ region: 'arm', side: 'left' })).toBe('arm-left');
    expect(panelWrapMode({ region: 'leg', side: 'right' })).toBe('leg-right');
    expect(panelWrapMode({ region: 'neck', zone: 'left' })).toBe('neck-left');
    expect(panelWrapMode({ region: 'neck' })).toBe('neck');
  });

  it('keeps the height and direction when only the sector changes', () => {
    const next = wrapDrapeForMode('torso-back', {
      region: 'torso', zone: 'front', anchor: 'waist', anchorOffsetCm: 4, flip: true,
    })!;
    expect(next).toEqual({
      region: 'torso', zone: 'back', anchor: 'waist', anchorOffsetCm: 4, flip: true,
    });
  });

  it('drops a torso anchor when the piece moves to a limb', () => {
    const next = wrapDrapeForMode('arm-left', {
      region: 'torso', zone: 'front', anchor: 'waist', anchorOffsetCm: 4,
    })!;
    expect(next).toEqual({ region: 'arm', zone: 'full', side: 'left' });
  });

  it('offers a flat panel and both neck halves', () => {
    expect(wrapDrapeForMode('flat', { region: 'torso' })).toBeUndefined();
    expect(wrapDrapeForMode('neck-left')!.zone).toBe('left');
    expect(wrapDrapeForMode('neck-right')!.zone).toBe('right');
  });
});

describe('region anchor', () => {
  it('is the anchor a resolved wrap hangs from', () => {
    const project = createStarterProject();
    const panel = Object.values(project.pattern.panels)[0]!;
    for (const region of ['torso', 'arm', 'leg', 'neck', 'head'] as const) {
      panel.drape = { region };
      expect(regionAnchor(region)).toBe(resolveWrap(panel).anchor);
    }
  });
});
