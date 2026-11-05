import type { Avatar, Project, RenderMode } from '../model/types';
import { fabricForPanel, panelPrints } from '../model/fabric';
import { layerThicknessCm } from '../model/layers';
import { panelGeometrySignature } from '../../pattern/panel/panelMeshSignature';
import { FALLBACK_PHYSICS } from './clothConstants';

/**
 * Everything the visible body, its collision capsules and the drape wrap read: measurements,
 * pose and source. Display, name and scene transform only affect drawing.
 */
export function avatarBodySignature(avatar: Avatar): string {
  return JSON.stringify({
    ...avatar, name: undefined, display: undefined, transform: undefined, appearance: undefined,
    softBody: undefined,
  });
}

/** Cloth geometry group, keyed by the index range it draws. */
export interface ClothGroupRange {
  start: number;
  count: number;
  slot: number;
  panelId: string;
}

/** Panel visibility of every cloth group, as one comparable string. */
export function visibilitySignature(groups: ClothGroupRange[], project: Project): string {
  return groups
    .map(g => `${g.start}:${project.pattern.panels[g.panelId]?.visible === false ? 0 : 1}`)
    .join(',');
}

/** Material record and render mode of every panel, as one comparable string. */
export function appearanceSignature(panelIds: string[], project: Project, mode: RenderMode): string {
  if (panelIds.length === 0) return '';
  const perPanel = panelIds.map(id => {
    const fabric = fabricForPanel(project, id);
    return fabric ? JSON.stringify(fabric.appearance) : '-';
  });
  return `${mode}|${perPanel.join(',')}|${printSignature(panelIds, project)}`;
}

/** Visible prints of every panel, as one comparable string. */
export function printSignature(panelIds: string[], project: Project): string {
  if (panelIds.length === 0) return '';
  return panelIds.map(id => JSON.stringify(panelPrints(project, id).map(printKey))).join(',');
}

/** Fields of a print the composed texture reads; the image URL is reduced to a short key. */
function printKey(print: { id: string; imageUrl: string; center: { x: number; y: number }; widthCm: number; heightCm: number; angleDeg: number; opacity: number; repeat: { x: number; y: number } }): unknown[] {
  return [
    print.id, urlKey(print.imageUrl), print.center.x, print.center.y,
    print.widthCm, print.heightCm, print.angleDeg, print.opacity, print.repeat.x, print.repeat.y,
  ];
}

/** Short key of a data URL, so signatures stay small while still tracking image replacement. */
function urlKey(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) | 0;
  return `${url.length}:${hash}`;
}

/** Material physics of every panel, as one comparable string. */
export function physicsSignature(panelIds: string[], project: Project): string {
  if (panelIds.length === 0) return '';
  return panelIds
    .map(id => JSON.stringify(fabricForPanel(project, id)?.physics ?? FALLBACK_PHYSICS))
    .join(',');
}

/**
 * Everything the solver's closing and crease constraint sets are built from: seam pairings, the
 * darts whose legs are being closed and the panel fold lines. Draw-only fields such as thread color
 * stay out, so they do not recompute constraints.
 */
export function constraintSignature(project: Project): string {
  const pattern = project.pattern;
  const seams = Object.values(pattern.seams).map(seam => JSON.stringify(
    [seam.id, seam.type, seam.a, seam.b, seam.flip, seam.gatherRatio ?? null, seam.strength],
  ));
  const darts = Object.values(pattern.darts).map(dart => JSON.stringify(
    [dart.id, dart.tipId, dart.edge1Id, dart.edge2Id, dart.closing === true],
  ));
  const panels = Object.values(pattern.panels).map(panel => JSON.stringify([
    panel.id,
    panel.dartIds,
    panel.internalLineIds.map(lineId => {
      const line = pattern.internalLines[lineId];
      return line ? [lineId, line.kind, line.points] : [lineId];
    }),
  ]));
  return JSON.stringify([seams, darts, panels]);
}

/** Everything the per-particle collision clearance is built from. */
export function layerThicknessSignature(project: Project): string {
  return JSON.stringify([
    layerThicknessCm(project),
    project.scene.simulation.clothThicknessCm ?? null,
    Object.values(project.pattern.panels).map(panel => [panel.id, panel.layer ?? null]),
  ]);
}

/** panelId → geometry signature across the whole pattern. */
export function geometrySignatures(project: Project): Map<string, string> {
  const map = new Map<string, string>();
  for (const panelId of Object.keys(project.pattern.panels)) {
    map.set(panelId, panelGeometrySignature(project.pattern, project.scene.simulation, panelId));
  }
  return map;
}

/** Identity of the merged particle/triangle/seam layout a live solver was built for. */
export function clothLayoutFingerprint(input: {
  particleCount: number;
  triangleCount: number;
  panels: Array<{ panelId: string; vertexOffset: number; mesh: { vertexCount: number } }>;
  seamConstraints?: unknown[];
}, seamPairCount = 0): string {
  return [
    input.particleCount, input.triangleCount, seamPairCount,
    input.panels.map(p => `${p.panelId}@${p.vertexOffset}x${p.mesh.vertexCount}`).join(','),
  ].join('|');
}
