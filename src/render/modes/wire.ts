/** Edge overlay on the pattern surface; the body keeps its own shading. */

import * as THREE from 'three/webgpu';
import type { WireMode, WireOptions } from '@/model/types';
import type { SceneMgr } from '@/render/scene/manager';

/** Wire meshes copy the source geometry, so they follow simulation frames for free. */
interface WireEntry {
  readonly source: THREE.Mesh;
  readonly wire: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

/**
 * Draws the edges of the registered pattern surfaces only. The meshes share the source geometry
 * and differ in material, so a deforming cloth costs no per-frame rebuild; the body, reference
 * models and analysis overlays keep their own shading in every wire mode.
 */
export class WireOverlay {
  private entries: WireEntry[] = [];
  private mode: WireMode = 'off';
  private options: WireOptions = { color: 0x66ccff, depth: 'tested' };
  private builtTopology = -1;
  private builtMode: WireMode = 'off';

  constructor(private readonly sceneMgr: SceneMgr) { }

  /** Applies the mode and its appearance; rebuilds when either changes. */
  setMode(mode: WireMode, options: WireOptions): void {
    this.mode = mode;
    this.options = options;
    if (mode === 'off') {
      this.clear();
      return;
    }
    this.sync();
  }

  /** Keeps the overlay in step with the pattern surfaces; cheap when nothing changed. */
  sync(): void {
    if (this.mode === 'off') return;
    const topology = this.sceneMgr.revisions.topology;
    const sources = this.sceneMgr.patternSurfaceMeshes();
    if (topology === this.builtTopology && this.mode === this.builtMode
      && sameSources(sources, this.entries)) {
      this.mirrorVisibility();
      return;
    }
    this.builtMode = this.mode;
    this.rebuild(sources);
    // Attaching the wire meshes bumps the topology again; record it so the next frame settles.
    this.builtTopology = this.sceneMgr.revisions.topology;
  }

  /** Drops every wire mesh. */
  clear(): void {
    for (const entry of this.entries) {
      this.sceneMgr.slot('edges').remove(entry.wire);
      entry.material.dispose();
    }
    this.entries = [];
    this.builtTopology = -1;
  }

  dispose(): void {
    this.clear();
  }

  /** Creates one wire mesh per pattern surface, in registration order. */
  private rebuild(sources: readonly THREE.Mesh[]): void {
    for (const entry of this.entries) {
      this.sceneMgr.slot('edges').remove(entry.wire);
      entry.material.dispose();
    }
    this.entries = sources.map(source => {
      const slots = Array.isArray(source.material) ? source.material.length : 1;
      const material = new THREE.MeshBasicMaterial({
        color: this.options.color,
        wireframe: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: this.options.depth === 'tested',
        // Coplanar with the surface it traces, so it needs the same bias the heatmap uses.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      // Same shape as the source: a geometry without groups is only drawn when its material is a
      // single material, so a single-material cloth would lose its wireframe otherwise.
      const wire = new THREE.Mesh(
        source.geometry,
        Array.isArray(source.material) ? Array.from({ length: slots }, () => material) : material,
      );
      wire.name = `wire:${source.name || source.uuid}`;
      wire.frustumCulled = false;
      wire.visible = source.visible;
      this.sceneMgr.slot('edges').add(wire);
      return { source, wire, material };
    });
  }

  /** Mirrors per-object visibility, so hiding the garment hides its edges too. */
  private mirrorVisibility(): void {
    for (const entry of this.entries) {
      if (entry.wire.visible !== entry.source.visible) entry.wire.visible = entry.source.visible;
    }
  }
}

/** Whether the existing wire meshes trace exactly the given surfaces, in order. */
function sameSources(sources: readonly THREE.Mesh[], entries: readonly WireEntry[]): boolean {
  return sources.length === entries.length
    && sources.every((source, i) => source === entries[i]!.source);
}
