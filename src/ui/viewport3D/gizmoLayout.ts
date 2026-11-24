import type { Vec3 } from '@/model/types';
import type { CameraState } from '@/render/common';
import type { GizmoFrame } from '@/runtime';
import type { TransformMode } from '@/store';

import { pointInPolygon, pointSegmentDistance } from '@/base/geom';
import { add3, scale3 } from '@/base/math';
import { cameraBasis, projectWorldToScreen, worldUnitsPerPixel } from '@/render/common';
import { AXIS_COLORS } from '@/ui/viewport3D/axisTheme';

const AXIS_PIXELS = 82;

const RING_RATIO = 0.8;

const RING_SEGMENTS = 48;

const PLANE_OFFSET = 0.3;

const PLANE_HALF = 0.12;

export interface GizmoAxisView {
  direction: Vec3;
  end: { x: number; y: number };
  unit: { x: number; y: number };
  lengthPx: number;
  color: string;
}

export interface GizmoPlaneView {
  axes: [number, number];
  corners: { x: number; y: number }[];
}

export interface GizmoRingView {
  axis: number;
  points: { x: number; y: number }[];
}

export type GizmoHandle =
  | { kind: 'axis'; axis: number }
  | { kind: 'plane'; axes: [number, number] }
  | { kind: 'center' }
  | { kind: 'ring'; axis: number };

export interface GizmoLayout {
  mode: TransformMode;
  origin: { x: number; y: number };
  pivot: Vec3;
  axes: GizmoAxisView[];
  planes: GizmoPlaneView[];
  rings: GizmoRingView[];
  worldLength: number;
  viewBack: Vec3;
  camera: CameraState;
  width: number;
  height: number;
  frame: GizmoFrame;
}

export function buildGizmoLayout(
  camera: CameraState,
  pivot: Vec3,
  axes: readonly Vec3[],
  mode: TransformMode,
  width: number,
  height: number,
  frame: GizmoFrame,
): GizmoLayout | null {
  if (width < 1 || height < 1) return null;
  const origin = projectWorldToScreen(pivot, camera, width, height);
  if (!origin) return null;
  const worldLength = AXIS_PIXELS * worldUnitsPerPixel(camera, pivot, height);
  const projectedAxes: GizmoAxisView[] = axes.map((direction, i) => {
    const end = projectWorldToScreen(add3(pivot, scale3(direction, worldLength)), camera, width, height);
    const dx = (end?.x ?? origin.x) - origin.x;
    const dy = (end?.y ?? origin.y) - origin.y;
    const lengthPx = Math.hypot(dx, dy);
    return {
      direction,
      end: { x: origin.x + dx, y: origin.y + dy },
      unit: lengthPx > 1e-6 ? { x: dx / lengthPx, y: dy / lengthPx } : { x: 0, y: 0 },
      lengthPx,
      color: AXIS_COLORS[i]!,
    };
  });

  const planes: GizmoPlaneView[] = [];
  if (mode === 'translate') {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as [number, number][]) {
      const u = axes[a]!, v = axes[b]!;
      const centre = add3(pivot, add3(scale3(u, worldLength * PLANE_OFFSET), scale3(v, worldLength * PLANE_OFFSET)));
      const hu = scale3(u, worldLength * PLANE_HALF);
      const hv = scale3(v, worldLength * PLANE_HALF);
      const corners = [
        project(centre, hu, hv, 1, 1), project(centre, hu, hv, -1, 1),
        project(centre, hu, hv, -1, -1), project(centre, hu, hv, 1, -1),
      ];
      if (corners.every(c => c !== null)) {
        planes.push({ axes: [a, b], corners: corners as { x: number; y: number }[] });
      }
    }
  }

  const rings: GizmoRingView[] = [];
  if (mode === 'rotate') {
    for (let axis = 0; axis < 3; axis++) {
      const u = axes[(axis + 1) % 3]!;
      const v = axes[(axis + 2) % 3]!;
      const points: { x: number; y: number }[] = [];
      let closed = true;
      for (let step = 0; step <= RING_SEGMENTS; step++) {
        const angle = step / RING_SEGMENTS * Math.PI * 2;
        const world = add3(pivot, add3(
          scale3(u, Math.cos(angle) * worldLength * RING_RATIO),
          scale3(v, Math.sin(angle) * worldLength * RING_RATIO),
        ));
        const point = projectWorldToScreen(world, camera, width, height);
        if (!point) { closed = false; break; }
        points.push({ x: point.x, y: point.y });
      }

      if (closed) rings.push({ axis, points });
    }
  }

  return {
    mode,
    origin: { x: origin.x, y: origin.y },
    pivot,
    axes: projectedAxes,
    planes,
    rings,
    worldLength,
    viewBack: cameraBasis(camera)?.back ?? { x: 0, y: 0, z: 1 },
    camera,
    width,
    height,
    frame,
  };

  function project(centre: Vec3, hu: Vec3, hv: Vec3, su: number, sv: number) {
    return projectWorldToScreen(add3(centre, add3(scale3(hu, su), scale3(hv, sv))), camera, width, height);
  }
}

export function hitTestHandle(
  layout: GizmoLayout, x: number, y: number, tolerance = 8,
): { handle: GizmoHandle; distance: number } | null {
  const origin = layout.origin;
  const centerDistance = Math.hypot(x - origin.x, y - origin.y);
  if (layout.mode !== 'rotate' && centerDistance <= tolerance + 4) {
    return { handle: { kind: 'center' }, distance: centerDistance };
  }

  let best: { handle: GizmoHandle; distance: number } | null = null;
  const consider = (handle: GizmoHandle, distance: number) => {
    if (distance <= tolerance && (!best || distance < best.distance)) best = { handle, distance };
  };

  if (layout.mode === 'translate' || layout.mode === 'scale') {
    layout.axes.forEach((axis, index) => {
      consider({ kind: 'axis', axis: index }, Math.hypot(x - axis.end.x, y - axis.end.y));
    });
  }

  if (layout.mode === 'translate') {
    for (const plane of layout.planes) {
      if (pointInPolygon(plane.corners, { x, y })) consider({ kind: 'plane', axes: plane.axes }, 0);
    }
  }

  if (layout.mode === 'rotate') {
    for (const ring of layout.rings) {
      let distance = Infinity;
      for (let i = 1; i < ring.points.length; i++) {
        distance = Math.min(distance, pointSegmentDistance({ x, y }, ring.points[i - 1]!, ring.points[i]!));
      }

      consider({ kind: 'ring', axis: ring.axis }, distance);
    }
  }

  if (layout.mode === 'translate' || layout.mode === 'scale') {
    layout.axes.forEach((axis, index) => {
      consider({ kind: 'axis', axis: index }, pointSegmentDistance({ x, y }, origin, axis.end));
    });
  }

  return best;
}

export function sameHandle(a: GizmoHandle | null, b: GizmoHandle | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'axis' && b.kind === 'axis') return a.axis === b.axis;
  if (a.kind === 'ring' && b.kind === 'ring') return a.axis === b.axis;
  if (a.kind === 'plane' && b.kind === 'plane') return a.axes[0] === b.axes[0] && a.axes[1] === b.axes[1];
  return true;
}
