import type { MeshSampling, Pattern } from '../model/types';
import { DEFAULT_MESH_RESOLUTION_CM, DEFAULT_MESH_SAMPLING } from '../model/defaults';
import { buildPanelMesh, type PanelMesh } from '../../pattern/panel/panelBuilder';
import { panelGeometrySignature, type PanelMeshSettings } from '../../pattern/panel/panelMeshSignature';

/** Cached meshes kept at once; the oldest entries fall out first. */
const CACHE_LIMIT = 64;

/**
 * Derived data shared by the 3D engine and the 2D overlay: panel meshes keyed by everything their
 * build reads. One mesh instance per key, so both viewports draw the same geometry.
 */
export class BuildRegistry {
  /** Mesh (or a null for a panel that builds to nothing) per resolved build key. */
  private readonly cache = new Map<string, PanelMesh | null>();
  /**
   * Geometry signatures of one pattern revision and settings object, memoized until either
   * changes. Two settings objects never share a memo, so a sampling or density change cannot
   * read a stale entry.
   */
  private readonly signatures = new WeakMap<Pattern, WeakMap<PanelMeshSettings, Map<string, string>>>();

  /**
   * The key covers the panel geometry signature, the resolved edge length and the sampling mode.
   * An explicit edge length and the same value coming from the panel resolve to one key, so
   * callers that disagree on how they name the density still share the mesh.
   */
  meshOf(
    pattern: Pattern, panelId: string,
    resolutionCm: number | undefined,
    settings: PanelMeshSettings,
  ): PanelMesh | null {
    const panel = pattern.panels[panelId];
    if (!panel) return null;
    const resolved = resolutionCm ?? panel.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM;
    const sampling: MeshSampling = settings.meshSampling ?? DEFAULT_MESH_SAMPLING;
    const key = `${panelId}|${resolved}|${sampling}|${this.signatureOf(pattern, settings, panelId)}`;
    if (this.cache.has(key)) {
      const cached = this.cache.get(key) ?? null;
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const mesh = buildPanelMesh(pattern, panelId, resolved, sampling);
    this.cache.set(key, mesh);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return mesh;
  }

  private signatureOf(pattern: Pattern, settings: PanelMeshSettings, panelId: string): string {
    let perSettings = this.signatures.get(pattern);
    if (!perSettings) {
      perSettings = new WeakMap();
      this.signatures.set(pattern, perSettings);
    }
    let perPanel = perSettings.get(settings);
    if (!perPanel) {
      perPanel = new Map();
      perSettings.set(settings, perPanel);
    }
    let signature = perPanel.get(panelId);
    if (signature === undefined) {
      signature = panelGeometrySignature(pattern, settings, panelId);
      perPanel.set(panelId, signature);
    }
    return signature;
  }
}

/** Registry shared by every viewport; meshes are immutable once built. */
export const buildRegistry = new BuildRegistry();
