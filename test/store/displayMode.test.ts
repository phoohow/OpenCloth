import { beforeEach, describe, expect, it } from 'vitest';
import { displayModeOf, useUIStore } from '@/store';

/** Puts the viewport axes back to a known mode before every case. */
beforeEach(() => {
  useUIStore.setState({ fill: 'physical', backend: 'raster', fitCheck: false, strainCheck: false, pressureCheck: false });
});

describe('setDisplayMode', () => {
  it('switches a heatmap onto the raster path with the physical fill', () => {
    // The tracer has no samples for a colour derived from the simulation, and a uv or normal
    // override would keep covering the surface the heatmap is meant to colour.
    useUIStore.setState({ fill: 'normal', backend: 'pathtrace' });

    useUIStore.getState().setDisplayMode('strainHeatmap');

    const state = useUIStore.getState();
    expect(state.strainCheck).toBe(true);
    expect(state.fitCheck).toBe(false);
    expect(state.pressureCheck).toBe(false);
    expect(state.fill).toBe('physical');
    expect(state.backend).toBe('raster');
  });

  it('turns every heatmap off when a render preset is picked', () => {
    useUIStore.getState().setDisplayMode('fitHeatmap');

    useUIStore.getState().setDisplayMode('raytraced');

    const state = useUIStore.getState();
    expect(state.fitCheck).toBe(false);
    expect(state.fill).toBe('physical');
    expect(state.backend).toBe('pathtrace');
    expect(displayModeOf(state)).toBe('raytraced');
  });

  it('switches to the vertex-normal preset and clears a heatmap', () => {
    useUIStore.getState().setDisplayMode('fitHeatmap');

    useUIStore.getState().setDisplayMode('vertexNormalVis');

    const state = useUIStore.getState();
    expect(state.fill).toBe('vertexNormal');
    expect(state.backend).toBe('raster');
    expect(state.fitCheck).toBe(false);
    expect(displayModeOf(state)).toBe('vertexNormalVis');
  });

  it('clears a heatmap when the uv check is picked', () => {
    useUIStore.getState().setDisplayMode('pressureHeatmap');

    useUIStore.getState().setDisplayMode('uvCheck');

    const state = useUIStore.getState();
    expect(state.pressureCheck).toBe(false);
    expect(state.fill).toBe('uvCheck');
    expect(state.backend).toBe('raster');
    expect(displayModeOf(state)).toBe('uvCheck');
  });
});
