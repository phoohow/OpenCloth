import type { Panel, PanelDrape, BodyLandmark } from '../../core/model/types';
import { landmarkY, type BodyEllipse, type BodyLandmarks } from '../../avatar/landmarks';
import type { PanelMesh } from '../panel/panelBuilder';
import { inferDrape } from './drapeInfer';

const DEG = Math.PI / 180;

/** Landmark each region hangs from unless the panel overrides it. */
const REGION_ANCHOR: Record<PanelDrape['region'], BodyLandmark> = {
  torso: 'shoulderTop',
  arm: 'shoulder',
  leg: 'hip',
  neck: 'neckTop',
};

/** Default angular span: a torso panel covers the front half, a limb panel a full turn. */
const REGION_SWEEP: Record<PanelDrape['region'], number> = {
  torso: 180,
  arm: 360,
  leg: 360,
  neck: 360,
};

/** Default radial gap in centimeters between the panel and the body surface. */
const REGION_EASE: Record<PanelDrape['region'], number> = {
  torso: 1.4,
  arm: 1.2,
  leg: 1.2,
  neck: 0.8,
};

/** Fully specified wrap of one panel, with every default resolved. */
export interface ResolvedDrape {
  region: PanelDrape['region'];
  anchor: BodyLandmark;
  anchorOffsetCm: number;
  startDeg: number;
  sweepDeg: number;
  side: 'left' | 'right';
  easeCm: number;
  pinTop: boolean;
}

/** Completes a panel's drape, inferring one from the panel name for hand-drawn patterns. */
export function resolveDrape(panel: Panel): ResolvedDrape {
  const drape = panel.drape ?? inferDrape(panel.name);
  const region = drape.region;
  return {
    region,
    anchor: drape.anchor ?? REGION_ANCHOR[region],
    anchorOffsetCm: drape.anchorOffsetCm ?? 0,
    startDeg: drape.startDeg ?? (region === 'torso' ? -90 : 0),
    sweepDeg: drape.sweepDeg ?? REGION_SWEEP[region],
    side: drape.side ?? 'right',
    easeCm: drape.easeCm ?? REGION_EASE[region],
    pinTop: drape.pinTop ?? region !== 'arm',
  };
}

/** Flat mesh extent in centimeters; `maxY` is the top edge, `minY` the bottom edge. */
interface PanelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function boundsOf(mesh: PanelMesh): PanelBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2];
    const y = mesh.positions2D[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Wraps a panel's flat mesh around the body and returns initial positions in meters. Each region
 * bends the piece around one vertical axis: the torso around the body's elliptic cross-section,
 * arm, leg and neck around a tube. Vertices keep their depth below the top edge.
 */
export function drapePositions(mesh: PanelMesh, panel: Panel, body: BodyLandmarks): Float32Array {
  const drape = resolveDrape(panel);
  const bounds = boundsOf(mesh);
  switch (drape.region) {
    case 'torso': return wrapTorso(mesh, drape, body, bounds);
    case 'arm': return wrapArm(mesh, drape, body, bounds);
    case 'leg': return wrapLeg(mesh, drape, body, bounds);
    case 'neck': return wrapNeck(mesh, drape, body, bounds);
  }
}

/** Angle of a vertex: the panel's full width spreads evenly over the declared sweep. */
function columnAngle(x: number, bounds: PanelBounds, drape: ResolvedDrape): number {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const u = Math.min(Math.max((x - bounds.minX) / width, 0), 1);
  const centerRad = (drape.startDeg + drape.sweepDeg / 2) * DEG;
  const sign = Math.sign(drape.sweepDeg) || 1;
  return centerRad + sign * (u - 0.5) * Math.abs(drape.sweepDeg) * DEG;
}

/** Height of a vertex in meters: the top edge sits at the anchor and fabric depth hangs below. */
function vertexHeight(topY: number, bounds: PanelBounds, y: number): number {
  return topY - (bounds.maxY - y) * 0.01;
}

/** Height the panel's top edge sits at. */
function anchorHeight(drape: ResolvedDrape, body: BodyLandmarks): number {
  return landmarkY(body, drape.anchor) + drape.anchorOffsetCm * 0.01;
}

/** Widest torso cross-section over a height span, so nothing inside the piece pokes through it. */
function widestRing(body: BodyLandmarks, topY: number, bottomY: number): BodyEllipse {
  const steps = 8;
  let rx = 0;
  let rz = 0;
  for (let s = 0; s <= steps; s++) {
    const ring = body.torsoEllipseAt(topY + (bottomY - topY) * (s / steps));
    rx = Math.max(rx, ring.rx);
    rz = Math.max(rz, ring.rz);
  }
  return { rx, rz };
}

/**
 * Bends a torso panel around an elliptic cylinder: the widest body cross-section under the anchor,
 * eased outward. The radius grows from the body at the top edge to whatever the panel's width
 * needs at the hem, so the piece hugs the body and flares instead of being squeezed.
 */
function wrapTorso(mesh: PanelMesh, drape: ResolvedDrape, body: BodyLandmarks, bounds: PanelBounds): Float32Array {
  const out = new Float32Array(mesh.vertexCount * 3);
  const topY = anchorHeight(drape, body);
  const depth = Math.max((bounds.maxY - bounds.minY) * 0.01, 1e-3);
  const ring = widestRing(body, topY, topY - depth);
  const centerX = body.torsoCenterXAt(topY);
  const ease = drape.easeCm * 0.01;
  const meanR = Math.max((ring.rx + ring.rz) / 2, 1e-3);
  const sweepRad = Math.max(Math.abs(drape.sweepDeg) * DEG, DEG);
  const topR = meanR + ease;
  const hemR = Math.max((bounds.maxX - bounds.minX) * 0.01 / sweepRad, topR);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const wy = vertexHeight(topY, bounds, mesh.positions2D[i * 2 + 1]);
    const theta = columnAngle(mesh.positions2D[i * 2], bounds, drape);
    const scale = (topR + (hemR - topR) * (topY - wy) / depth) / meanR;
    out[i * 3] = centerX + ring.rx * scale * Math.sin(theta);
    out[i * 3 + 1] = wy;
    out[i * 3 + 2] = ring.rz * scale * Math.cos(theta);
  }
  return out;
}

/** Radius that runs the panel's full width around the tube without squeezing it. */
function tubeRadius(drape: ResolvedDrape, bounds: PanelBounds, limbR: number): number {
  const sweepRad = Math.max(Math.abs(drape.sweepDeg) * DEG, DEG);
  const fromWidth = (bounds.maxX - bounds.minX) * 0.01 / sweepRad;
  return Math.max(fromWidth, limbR + drape.easeCm * 0.01);
}

/** Sleeve: a tube along the arm, from the shoulder outward at the arm's rake. */
function wrapArm(mesh: PanelMesh, drape: ResolvedDrape, body: BodyLandmarks, bounds: PanelBounds): Float32Array {
  const sideSign = drape.side === 'left' ? -1 : 1;
  return wrapTube(mesh, drape, bounds, {
    topY: anchorHeight(drape, body),
    radius: tubeRadius(drape, bounds, body.armR),
    axisX: sideSign * body.shoulderX,
    rake: Math.tan(body.armRakeRad) * sideSign,
  });
}

/** Trouser leg: the same tube as the sleeve, hanging from the hip on the leg's rake. */
function wrapLeg(mesh: PanelMesh, drape: ResolvedDrape, body: BodyLandmarks, bounds: PanelBounds): Float32Array {
  const sideSign = drape.side === 'left' ? -1 : 1;
  return wrapTube(mesh, drape, bounds, {
    topY: anchorHeight(drape, body),
    radius: tubeRadius(drape, bounds, body.legR),
    axisX: sideSign * body.hipX,
    rake: Math.tan(body.legRakeRad) * sideSign,
  });
}

/** Collar: a tube standing on the body centreline, around the neck. */
function wrapNeck(mesh: PanelMesh, drape: ResolvedDrape, body: BodyLandmarks, bounds: PanelBounds): Float32Array {
  return wrapTube(mesh, drape, bounds, {
    topY: anchorHeight(drape, body),
    radius: tubeRadius(drape, bounds, body.neckR),
    axisX: 0,
    rake: 0,
  });
}

/** One tube a limb panel wraps on: where its top starts, its radius and how it tilts outward. */
interface LimbTube {
  topY: number;
  radius: number;
  axisX: number;
  rake: number;
}

/** Bends a panel around a vertical tube whose axis shifts outward with depth. */
function wrapTube(mesh: PanelMesh, drape: ResolvedDrape, bounds: PanelBounds, tube: LimbTube): Float32Array {
  const out = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const wy = vertexHeight(tube.topY, bounds, mesh.positions2D[i * 2 + 1]);
    const theta = columnAngle(mesh.positions2D[i * 2], bounds, drape);
    const axis = tube.axisX + tube.rake * Math.max(tube.topY - wy, 0);
    out[i * 3] = axis + tube.radius * Math.cos(theta);
    out[i * 3 + 1] = wy;
    out[i * 3 + 2] = tube.radius * Math.sin(theta);
  }
  return out;
}
