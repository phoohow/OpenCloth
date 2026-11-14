import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUX, auxProxyOnly, auxShowsProxy, auxWire, toggleProxy, toggleWire, type AuxState,
} from '@/store/auxView';

/** Auxiliary state with the given group settings. */
function aux(wire: AuxState['wire'] = 'off', proxy: AuxState['proxy'] = 'off'): AuxState {
  return { wire, proxy };
}

describe('auxiliary display groups', () => {
  it('reads the cloth wire setting from the wire group alone', () => {
    expect(auxWire(aux('only'))).toBe('only');
    expect(auxWire(aux('over'))).toBe('over');
    expect(auxWire(aux('off'))).toBe('off');
    // The proxy group does not leak into the cloth wire setting.
    expect(auxWire(aux('off', 'only'))).toBe('off');
    expect(auxWire(aux('over', 'over'))).toBe('over');
  });

  it('reads the proxy setting from the proxy group alone', () => {
    expect(auxShowsProxy(aux('off', 'only'))).toBe(true);
    expect(auxShowsProxy(aux('off', 'over'))).toBe(true);
    expect(auxShowsProxy(aux('off', 'off'))).toBe(false);
    expect(auxProxyOnly(aux('off', 'only'))).toBe(true);
    expect(auxProxyOnly(aux('off', 'over'))).toBe(false);
    // The wire group does not leak into the proxy setting.
    expect(auxShowsProxy(aux('only', 'off'))).toBe(false);
    expect(auxProxyOnly(aux('only', 'over'))).toBe(false);
  });

  it('toggles a wire mode off when picked again', () => {
    expect(toggleWire(aux('only'), 'only')).toEqual(aux('off'));
    expect(toggleWire(aux('over'), 'over')).toEqual(aux('off'));
    expect(toggleWire(aux('off'), 'only')).toEqual(aux('only'));
  });

  it('keeps the two wire modes mutually exclusive', () => {
    expect(toggleWire(aux('only'), 'over')).toEqual(aux('over'));
    expect(toggleWire(aux('over'), 'only')).toEqual(aux('only'));
  });

  it('toggles a proxy mode off when picked again', () => {
    expect(toggleProxy(aux('off', 'only'), 'only')).toEqual(aux('off', 'off'));
    expect(toggleProxy(aux('off', 'over'), 'over')).toEqual(aux('off', 'off'));
    expect(toggleProxy(aux('off', 'off'), 'only')).toEqual(aux('off', 'only'));
  });

  it('keeps the two proxy modes mutually exclusive', () => {
    expect(toggleProxy(aux('off', 'only'), 'over')).toEqual(aux('off', 'over'));
    expect(toggleProxy(aux('off', 'over'), 'only')).toEqual(aux('off', 'only'));
  });

  it('stacks the wire and proxy groups independently', () => {
    // Toggling one group leaves the other untouched.
    expect(toggleWire(aux('off', 'only'), 'over')).toEqual(aux('over', 'only'));
    expect(toggleProxy(aux('over', 'off'), 'only')).toEqual(aux('over', 'only'));
    // Both groups can be active at once.
    const both = toggleProxy(toggleWire(DEFAULT_AUX, 'only'), 'over');
    expect(both).toEqual(aux('only', 'over'));
    expect(auxWire(both)).toBe('only');
    expect(auxShowsProxy(both)).toBe(true);
    expect(auxProxyOnly(both)).toBe(false);
  });
});