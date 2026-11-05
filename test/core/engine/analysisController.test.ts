import { describe, expect, it, vi } from 'vitest';
import { AnalysisController, type AnalysisHost } from '../../../src/core/engine/analysisController';
import type { ClothSurface } from '../../../src/render/clothSurface';

/** A harness with no cloth, so every pass returns null and only the dispatch is observable. */
function harness() {
  const collider = vi.fn(() => null);
  const revealCloth = vi.fn();
  const host: AnalysisHost = {
    lastGoodPositions: () => new Float32Array(0),
    initialPositions: () => new Float32Array(0),
    restPositions: () => new Float32Array(0),
    clothInput: () => null,
    collider,
    contact: () => null,
    revealCloth,
  };
  const overlay = {
    setVisible: vi.fn(),
    setSlotCount: vi.fn(),
    update: vi.fn(),
    updateStrain: vi.fn(),
    updateStrainBounds: vi.fn(),
    updatePressure: vi.fn(),
    dispose: vi.fn(),
  };
  const surface = { overlay } as unknown as ClothSurface;
  const controller = new AnalysisController(host);
  controller.attach(surface);
  return { controller, overlay, revealCloth, collider };
}

describe('AnalysisController', () => {
  it('lets only one channel own the shared overlay', () => {
    const { controller, overlay, revealCloth, collider } = harness();
    expect(controller.active).toBe(false);

    controller.setFit(true, 0.5, 2.5);
    expect(controller.active).toBe(true);
    expect(overlay.setVisible).toHaveBeenLastCalledWith(true);
    expect(revealCloth).toHaveBeenLastCalledWith(false);
    expect(collider).toHaveBeenCalledTimes(1);

    controller.setStrain(true, -0.1, 0.1);
    expect(controller.refreshFit(0.5, 2.5, true)).toBeNull();
    expect(collider).toHaveBeenCalledTimes(1);
    expect(controller.active).toBe(true);

    controller.setStrain(false, -0.1, 0.1);
    expect(controller.active).toBe(false);
    expect(overlay.setVisible).toHaveBeenLastCalledWith(false);
    expect(revealCloth).toHaveBeenLastCalledWith(true);
  });

  it('skips five frames between two passes of the active channel', () => {
    const { controller, collider } = harness();
    controller.setFit(true, 0.5, 2.5);
    expect(collider).toHaveBeenCalledTimes(1);

    for (let frame = 0; frame < 5; frame++) {
      expect(controller.refreshFit(0.5, 2.5)).toBeNull();
    }
    expect(collider).toHaveBeenCalledTimes(1);

    controller.refreshFit(0.5, 2.5);
    expect(collider).toHaveBeenCalledTimes(2);
  });

  it('drops the active channel and its overlay on reset', () => {
    const { controller, overlay, revealCloth, collider } = harness();
    controller.setPressure(true, 8);
    expect(controller.active).toBe(true);

    controller.resetFlags();
    expect(controller.active).toBe(false);
    expect(controller.refreshPressure(8, true)).toBeNull();

    controller.detach();
    controller.resetTimers();
    expect(revealCloth).toHaveBeenLastCalledWith(true);
    // A detached overlay belongs to the caller now; the controller must not write to it.
    expect(overlay.setVisible).toHaveBeenCalledTimes(1);
    expect(collider).toHaveBeenCalledTimes(0);
  });
});
