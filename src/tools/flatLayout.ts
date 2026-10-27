import type { Panel } from '../core/model/types';
import type { BodyLandmarks } from '../avatar/landmarks';
import type { PanelMesh } from '../pattern/panel/panelBuilder';
import { drapePositions } from '../pattern/drape/drapePlacement';

/** One panel and its mesh, in merged simulation order. */
export interface FlatPanelInput {
  panel: Panel;
  mesh: PanelMesh;
}

/** Vertical gap between the body surface and the flat layout plane. */
const FRONT_CLEARANCE_M = 0.12;

/** How far past the shoulder point the flat row may spread before it gets squeezed. */
const FLAT_MAX_REACH_M = 0.10;

/**
 * Lays panels flat in one vertical plane in front of the body: pattern x and y become world x
 * and y, the group is centered on the body axis, and its height matches the wrapped garment.
 * Preview-only staging; the simulation's initial pose comes from the drape wrap.
 */
export function flatLayout(panels: FlatPanelInput[], body: BodyLandmarks): Float32Array[] {
  const extents = measure(panels, body);

  return panels.map(({ mesh }) => {
    const count = mesh.vertexCount;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      out[i * 3] = (mesh.positions2D[i * 2] * 0.01 - extents.flatCenterX) * extents.xScale;
      out[i * 3 + 1] = mesh.positions2D[i * 2 + 1] * 0.01 + extents.yShift;
      out[i * 3 + 2] = extents.frontZ;
    }
    return out;
  });
}

/** Horizontal center of the flat group, height shift and the plane in front of the body. */
function measure(panels: FlatPanelInput[], body: BodyLandmarks): {
  flatCenterX: number; yShift: number; frontZ: number; xScale: number;
} {
  let flatMinX = Infinity;
  let flatMaxX = -Infinity;
  let flatMinY = Infinity;
  let flatMaxY = -Infinity;
  for (const { mesh } of panels) {
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = mesh.positions2D[i * 2] * 0.01;
      const y = mesh.positions2D[i * 2 + 1] * 0.01;
      if (x < flatMinX) flatMinX = x;
      if (x > flatMaxX) flatMaxX = x;
      if (y < flatMinY) flatMinY = y;
      if (y > flatMaxY) flatMaxY = y;
    }
  }

  let wrappedMinY = Infinity;
  let wrappedMaxY = -Infinity;
  let wrappedFrontZ = 0;
  for (const { panel, mesh } of panels) {
    const wrapped = drapePositions(mesh, panel, body);
    for (let i = 0; i < mesh.vertexCount; i++) {
      const y = wrapped[i * 3 + 1];
      const z = wrapped[i * 3 + 2];
      if (y < wrappedMinY) wrappedMinY = y;
      if (y > wrappedMaxY) wrappedMaxY = y;
      if (z > wrappedFrontZ) wrappedFrontZ = z;
    }
  }
  if (!Number.isFinite(wrappedMinY) || !Number.isFinite(wrappedMaxY)) {
    wrappedMinY = flatMinY;
    wrappedMaxY = flatMaxY;
  }

  const flatCenterX = Number.isFinite(flatMinX) ? (flatMinX + flatMaxX) / 2 : 0;
  // Nesting can spread the pieces wider than the viewer; squeeze the row toward the body width.
  const halfWidth = Math.max((flatMaxX - flatMinX) / 2, 1e-3);
  const reach = body.shoulderX + FLAT_MAX_REACH_M;
  return {
    flatCenterX,
    xScale: Math.min(1, reach / halfWidth),
    yShift: (wrappedMinY + wrappedMaxY) / 2 - ((flatMinY + flatMaxY) / 2),
    frontZ: wrappedFrontZ + FRONT_CLEARANCE_M,
  };
}
