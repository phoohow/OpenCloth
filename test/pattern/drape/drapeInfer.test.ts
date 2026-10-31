import { describe, expect, it } from 'vitest';
import { vec2 } from '../../../src/core/model/types';
import { inferDrape } from '../../../src/pattern/drape/drapeInfer';

/** A rectangle from (0, 0) to (w, h), in centimeters. */
function rect(w: number, h: number) {
  return [vec2(0, 0), vec2(w, 0), vec2(w, h), vec2(0, h)];
}

describe('inferDrape from a panel name', () => {
  it('wraps a sleeve around the arm on the side named in the panel', () => {
    expect(inferDrape('左袖')).toEqual({ region: 'arm', side: 'left', pinTop: false });
    expect(inferDrape('袖片')).toEqual({ region: 'arm', side: 'right', pinTop: false });
  });

  it('wraps trousers and legs around a leg', () => {
    expect(inferDrape('左裤腿')).toEqual({ region: 'leg', side: 'left' });
    expect(inferDrape('右腿片')).toEqual({ region: 'leg', side: 'right' });
  });

  it('wraps a collar around the neck', () => {
    expect(inferDrape('领子')).toEqual({ region: 'neck' });
  });

  it('wraps a back panel over the rear half of the torso', () => {
    expect(inferDrape('后片')).toEqual({ region: 'torso', startDeg: 270, sweepDeg: -180 });
  });

  it('defaults unnamed pieces to the front half of the torso', () => {
    expect(inferDrape('前片')).toEqual({ region: 'torso' });
  });
});

describe('inferDrape from an outline', () => {
  it('wraps a tall narrow piece around a limb', () => {
    expect(inferDrape(rect(10, 40))).toEqual({ region: 'arm', pinTop: false });
  });

  it('wraps a long piece with leg proportions around a leg', () => {
    expect(inferDrape(rect(25, 50))).toEqual({ region: 'leg' });
  });

  it('wraps a wide piece around the torso', () => {
    expect(inferDrape(rect(40, 40))).toEqual({ region: 'torso' });
  });

  it('falls back to the torso for a degenerate outline', () => {
    expect(inferDrape([vec2(5, 5)])).toEqual({ region: 'torso' });
  });
});
