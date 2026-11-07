/** Active view mode: the resolved spec, the wire overlay and the diagnostic fills. */

import type { ViewConfig } from '@/model/types';
import { resolveViewMode, type ViewModeSpec } from '@/render/modes/spec';
import { disposeFillOverrides, fillOverride } from '@/render/modes/overrides';
import { WireOverlay } from '@/render/modes/wire';
import type { SceneMgr } from '@/render/scene/manager';

/** Owns what the current frame should look like and the objects that carry a mode. */
export class ViewMode {
  private spec: ViewModeSpec;
  private readonly wire: WireOverlay;

  constructor(private readonly sceneMgr: SceneMgr, initial: ViewConfig) {
    this.wire = new WireOverlay(sceneMgr);
    this.spec = resolveViewMode(initial);
    this.wire.setMode(initial.wire, initial.wireOptions);
  }

  /** Description of the frame currently being drawn. */
  get current(): ViewModeSpec {
    return this.spec;
  }

  /** Applies new view settings; returns the spec the next frame uses. */
  applyConfig(config: ViewConfig): ViewModeSpec {
    this.spec = resolveViewMode(config);
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
   * Only the meshes registered as pattern surfaces are touched: the body, the reference models and the
   * heatmap overlay keep their own materials, so a uv or normal fill is a read of the pattern
   * rather than a change of the whole subject layer.
   */
  applyFillOverride(): () => void {
    const spec = this.spec;
    // The physical fill is the scene's own materials; skip the surface lookup entirely.
    if (spec.fillsSurface && spec.fill === 'physical') return noop;
    const restore: (() => void)[] = [];
    const surfaces = this.sceneMgr.patternSurfaceMeshes();

    if (!spec.fillsSurface) {
      for (const mesh of surfaces) {
        const wasVisible = mesh.visible;
        if (!wasVisible) continue;
        mesh.visible = false;
        restore.push(() => { mesh.visible = wasVisible; });
      }
      return () => runRestore(restore);
    }

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

/** Restore function for a frame that changed nothing. */
function noop(): void { }

/** Runs restore callbacks in reverse order. */
function runRestore(restore: readonly (() => void)[]): void {
  for (let i = restore.length - 1; i >= 0; i--) restore[i]!();
}
