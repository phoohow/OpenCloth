import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import type { CameraState } from '@/render/common';
import type { Commands } from '@/render/backend/commands';
import type { ProgramLibrary } from '@/render/backend/programs';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import { DenoiseEngine, type DenoiseFrame } from '@/render/backend/denoise/denoiseEngine';
import type { TargetHandle } from '@/render/backend/types';

/** Stands in for the OIDN pass: records the calls the engine makes and when it finishes. */
class FakeDenoiser {
  running = false;
  complete = false;
  texture: THREE.Texture | null = null;
  starts = 0;
  resets = 0;

  update(): THREE.Texture | null {
    this.starts += 1;
    this.running = true;
    return null;
  }

  reset(): void {
    this.running = false;
    this.complete = false;
    this.texture = null;
    this.resets += 1;
  }

  setScene(): void { }

  dispose(): void { }

  /** Ends the pass the way the library does, with a texture holding the cleaned image. */
  finish(): void {
    this.running = false;
    this.complete = true;
    this.texture = new THREE.Texture();
  }
}

/** Engine wired to a fake denoiser, counting the copies it publishes. */
function setup() {
  const radiance = new THREE.RenderTarget(8, 8) as unknown as TargetHandle;
  const blits: number[] = [];
  const programs = { blit: () => { blits.push(1); } } as unknown as ProgramLibrary;
  const commands = { cameraFor: () => ({}) } as unknown as Commands;
  const scene = { traceSceneRoot: {} } as unknown as SceneStore;
  const engine = new DenoiseEngine({} as THREE.WebGPURenderer, commands, programs);
  const denoiser = new FakeDenoiser();
  (engine as unknown as { denoiser: FakeDenoiser }).denoiser = denoiser;

  const frame = (samples: number, patch: Partial<DenoiseFrame> = {}): DenoiseFrame => ({
    radiance, samples, weight: 1, accumulating: true, restarted: false, ...patch,
  });
  const run = (samples: number, patch: Partial<DenoiseFrame> = {}) =>
    engine.run(scene, {} as CameraState, frame(samples, patch));

  return { engine, denoiser, blits, run };
}

describe('DenoiseEngine', () => {
  it('waits for the raster blend-in before the first pass', () => {
    const { denoiser, run } = setup();

    expect(run(8, { weight: 0.25 })).toBeNull();
    expect(run(31, { weight: 0.97 })).toBeNull();
    expect(denoiser.starts).toBe(0);

    run(32);
    expect(denoiser.starts).toBe(1);
  });

  it('cleans once as the blend ends, then once per interval', () => {
    const { denoiser, blits, run } = setup();
    run(32);
    denoiser.finish();
    expect(run(40)).not.toBeNull();
    expect(blits).toHaveLength(1);

    // The cadence counts from the frame the previous pass finished on.
    for (let i = 0; i < 31; i++) run(48 + i);
    expect(denoiser.starts).toBe(1);
    run(80);
    expect(denoiser.starts).toBe(2);
  });

  it('keeps the image of a pass that outlives the interval', () => {
    const { denoiser, blits, run } = setup();
    run(32);

    // A pass that takes longer than the interval is due again the moment it ends, so asking the
    // cadence first would reset the denoiser and throw the finished image away.
    for (let i = 0; i < 40; i++) run(33 + i);
    expect(denoiser.starts).toBe(1);

    denoiser.finish();
    expect(run(74)).not.toBeNull();
    expect(blits).toHaveLength(1);
    expect(denoiser.starts).toBe(1);
  });

  it('cleans once more when the sampler settles, then stops', () => {
    const { denoiser, blits, run } = setup();
    run(30);
    denoiser.finish();
    run(32);

    run(64, { accumulating: false });
    expect(denoiser.starts).toBe(2);
    denoiser.finish();
    run(64, { accumulating: false });
    expect(blits).toHaveLength(2);

    // The samples stopped advancing, so the settled image is not cleaned again.
    run(64, { accumulating: false });
    expect(denoiser.starts).toBe(2);
  });

  it('drops the image when the accumulator restarts', () => {
    const { denoiser, blits, run } = setup();
    run(32);
    denoiser.finish();
    run(40);
    expect(blits).toHaveLength(1);

    expect(run(0, { restarted: true, weight: 0 })).toBeNull();
    expect(denoiser.resets).toBeGreaterThan(0);
    // The camera it stopped at has to accumulate again before anything is cleaned.
    expect(run(8, { weight: 0.25 })).toBeNull();
    expect(denoiser.starts).toBe(1);
    run(32);
    expect(denoiser.starts).toBe(2);
  });
});
