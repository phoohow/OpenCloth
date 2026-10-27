import { describe, it, expect } from 'vitest';
import type { Panel } from '../../../src/core/model/types';
import { resolveDrape } from '../../../src/pattern/drape/drapePlacement';

function panel(name: string, drape?: Panel['drape']): Panel {
  return {
    id: name, name, outlineEdgeIds: [], dartIds: [], internalLineIds: [],
    seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3, drape, visible: true, locked: false,
  };
}

describe('resolveDrape', () => {
  it('补全区域默认值', () => {
    const resolved = resolveDrape(panel('前裙片', { region: 'torso', anchor: 'waist' }));
    expect(resolved.anchor).toBe('waist');
    expect(resolved.startDeg).toBe(-90);
    expect(resolved.sweepDeg).toBe(180);
    expect(resolved.pinTop).toBe(true);
    expect(resolved.rowWrap).toBe(false);
  });

  it('袖片从名称推断并垂挂于袖山', () => {
    const resolved = resolveDrape(panel('左袖'));
    expect(resolved.region).toBe('arm');
    expect(resolved.side).toBe('left');
    expect(resolved.sweepDeg).toBe(360);
    expect(resolved.pinTop).toBe(false);
  });

  it('后片名称推断出背面半圈', () => {
    const resolved = resolveDrape(panel('后片'));
    expect(resolved.startDeg).toBe(270);
    expect(resolved.sweepDeg).toBe(-180);
  });

  it('drape 优先于名称推断', () => {
    const resolved = resolveDrape(panel('后袖', { region: 'torso', startDeg: 0, sweepDeg: 90 }));
    expect(resolved.region).toBe('torso');
    expect(resolved.startDeg).toBe(0);
    expect(resolved.sweepDeg).toBe(90);
  });

  it('rowWrap 让收窄的片沿整行闭合', () => {
    const resolved = resolveDrape(panel('前裙片1', { region: 'torso', anchor: 'waist', rowWrap: true }));
    expect(resolved.rowWrap).toBe(true);
  });
});
