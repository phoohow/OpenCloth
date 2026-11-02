import type { MeshSampling, Pattern } from '../../core/model/types';
import { DEFAULT_MESH_RESOLUTION_CM, DEFAULT_MESH_SAMPLING } from '../../core/model/defaults';
import { buildPanelMesh, type PanelMesh } from './panelBuilder';
import { panelGeometrySignature, type PanelMeshSettings } from './panelMeshSignature';

/** Cached meshes kept at once; the oldest entries fall out first. */
const CACHE_LIMIT = 64;

/** Mesh (or a null for a panel that builds to nothing) per resolved build key. */
const cache = new Map<string, PanelMesh | null>();

/**
 * Geometry signatures of one pattern revision and settings object, memoized until either changes.
 * Two settings objects never share a memo, so a sampling or density change cannot read a stale entry.
 */
const signatures = new WeakMap<Pattern, WeakMap<PanelMeshSettings, Map<string, string>>>();

function signatureOf(
  pattern: Pattern, settings: PanelMeshSettings, panelId: string,
): string {
  let perSettings = signatures.get(pattern);
  if (!perSettings) {
    perSettings = new WeakMap();
    signatures.set(pattern, perSettings);
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

/**
 * One mesh instance per panel shared by the 3D engine and the 2D wireframe overlay. The key covers
 * everything the build reads: the panel geometry signature, the resolved edge length and the
 * sampling mode. An explicit edge length and the same value coming from the panel resolve to one
 * key, so callers that disagree on how they name the density still share the mesh. Entries beyond
 * the limit fall out oldest first; meshes themselves are treated as immutable after the build.
 */
export function getPanelMesh(
  pattern: Pattern, panelId: string,
  resolutionCm: number | undefined,
  settings: PanelMeshSettings,
): PanelMesh | null {
  const panel = pattern.panels[panelId];
  if (!panel) return null;
  const resolved = resolutionCm ?? panel.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM;
  const sampling: MeshSampling = settings.meshSampling ?? DEFAULT_MESH_SAMPLING;
  const key = `${panelId}|${resolved}|${sampling}|${signatureOf(pattern, settings, panelId)}`;
  if (cache.has(key)) {
    const cached = cache.get(key) ?? null;
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const mesh = buildPanelMesh(pattern, panelId, resolved, sampling);
  cache.set(key, mesh);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return mesh;
}
