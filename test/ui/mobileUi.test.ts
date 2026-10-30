import { describe, expect, it } from 'vitest';
import {
  PHONE_SHORT_SIDE_MAX, SPEED_STEPS, TAP_MAX_MS, TAP_MOVE_SLOP_PX,
  isTapGesture, nextSpeed, resolveUiMode,
} from '../../src/ui/mobile/mobileUi';

describe('resolveUiMode', () => {
  it('picks the phone shell for a coarse pointer within the short-side limit', () => {
    expect(resolveUiMode({ width: 390, height: 844, coarsePointer: true })).toBe('mobile');
    expect(resolveUiMode({ width: 844, height: 390, coarsePointer: true })).toBe('mobile');
    expect(resolveUiMode({
      width: PHONE_SHORT_SIDE_MAX,
      height: 900,
      coarsePointer: true,
    })).toBe('mobile');
  });

  it('keeps the desktop shell for a mouse or a large touch screen', () => {
    expect(resolveUiMode({ width: 390, height: 844, coarsePointer: false })).toBe('desktop');
    expect(resolveUiMode({ width: 1024, height: 768, coarsePointer: true })).toBe('desktop');
  });

  it('lets the ?ui override win over the measurements', () => {
    expect(resolveUiMode({ width: 1920, height: 1080, coarsePointer: false, forced: 'mobile' })).toBe('mobile');
    expect(resolveUiMode({ width: 390, height: 844, coarsePointer: true, forced: 'desktop' })).toBe('desktop');
  });

  it('ignores an unknown override value', () => {
    expect(resolveUiMode({ width: 390, height: 844, coarsePointer: true, forced: 'tablet' })).toBe('mobile');
  });
});

describe('isTapGesture', () => {
  it('accepts a short, nearly still touch', () => {
    expect(isTapGesture(0, 0, 120)).toBe(true);
    expect(isTapGesture(TAP_MOVE_SLOP_PX, -TAP_MOVE_SLOP_PX, TAP_MAX_MS)).toBe(true);
  });

  it('rejects a drag or a long press', () => {
    expect(isTapGesture(TAP_MOVE_SLOP_PX + 1, 0, 100)).toBe(false);
    expect(isTapGesture(0, 30, 100)).toBe(false);
    expect(isTapGesture(0, 0, TAP_MAX_MS + 1)).toBe(false);
  });

  it('rejects a nonsensical duration', () => {
    expect(isTapGesture(0, 0, -1)).toBe(false);
  });
});

describe('nextSpeed', () => {
  it('advances through the dock speeds and wraps', () => {
    expect(SPEED_STEPS.map(nextSpeed)).toEqual([0.5, 1, 2, 0.25]);
  });

  it('returns the following step for an unlisted speed', () => {
    expect(nextSpeed(3)).toBe(0.25);
  });
});
