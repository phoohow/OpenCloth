/** Active render mode: the resolved spec, the wire overlay and the diagnostic fills. */

import type { RenderConfig } from '@/model/types';
import { resolveSpec, type RenderModeSpec } from '@/render/modes/spec';
import { disposeFillOverrides, fillOverride } from '@/render/modes/overrides';
import { WireLayer } from '@/render/modes/wire';
import type { SceneMgr } from '@/render/scene/manager';

/** Owns what the current frame should look like and the objects that carry a mode. */
export class ModeRegistry {
  private spec: RenderModeSpec;
  private readonly wire: WireLayer;

  constructor(private readonly sceneMgr: SceneMgr, initial: RenderConfig) {
    this.wire = new WireLayer(sceneMgr);
    this.spec = resolveSpec(initial);
    this.wire.setMode(initial.wire, initial.wireOptions);
  }

  /** Description of the frame currently being drawn. */
  get current(): RenderModeSpec {
    return this.spec;
  }

  /** Applies new render settings; returns the spec the next frame uses. */
  applyConfig(config: RenderConfig): RenderModeSpec {
    this.spec = resolveSpec(config);
    this.wire.setMode(config.wire, config.wireOptions);
    return this.spec;
  }

  /** Refreshes the wire overlay against the pattern surfaces; called once per frame. */
  sync(): void {
    this.wire.sync();
  }

  /**
   * Substitutes the diagnostic fill on the pattern surface and hides it when the mode draws edges
   * only. Returns the function that puts the scene back.
   *
   * Only the meshes registered as the surface are touched: the body, the reference models and the
   * heatmap overlay keep their own materials, so a uv or normal fill is a read of the pattern
   * rather than a change of the whole subject layer.
   */
  applySurfaceOverride(): () => void {
    const spec = this.spec;
    const restore: (() => void)[] = [];
    const surfaces = this.sceneMgr.surfaceMeshes();

    if (!spec.fillsSurface) {
      for (const mesh of surfaces) {
        const wasVisible = mesh.visible;
        if (!wasVisible) continue;
        mesh.visible = false;
        restore.push(() => { mesh.visible = wasVisible; });
      }
      return () => runRestore(restore);
    }

    if (spec.fill === 'physical') return () => { };

    for (const mesh of surfaces) {
      const original = mesh.material;
      // Same shape as the original: three skips a mesh whose material is an array but whose
      // geometry has no groups, so a one-element array would hide a single-material surface.
      const override = fillOverride(spec.fill, original);
      if (!override) continue;
      mesh.material = override;
      restore.push(() => { mesh.material = original; });
    }
    return () => runRestore(restore);
  }

  dispose(): void {
    this.wire.dispose();
    disposeFillOverrides();
  }
}

/** Runs restore callbacks in reverse order. */
function runRestore(restore: readonly (() => void)[]): void {
  for (let i = restore.length - 1; i >= 0; i--) restore[i]!();
}
