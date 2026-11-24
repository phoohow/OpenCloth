import type { MeshSampling, Pattern } from '@/model/types';

import { DEFAULT_MESH_SAMPLING } from '@/model';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { panelGeometrySignature } from '@/scene/cache/signature';
import { meshResolutionOf, type PanelMeshSettings } from '@/scene/common/settings';

const CACHE_LIMIT = 64;

export class BuildRegistry {
  private readonly cache = new Map<string, PanelMesh | null>();
  private readonly signatures = new WeakMap<Pattern, WeakMap<PanelMeshSettings, Map<string, string>>>();

  meshOf(
    pattern: Pattern, panelId: string,
    resolutionCm: number | undefined,
    settings: PanelMeshSettings,
  ): PanelMesh | null {
    const panel = pattern.panels[panelId];
    if (!panel) return null;
    const resolved = resolutionCm ?? meshResolutionOf(settings);
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

export const buildRegistry = new BuildRegistry();
