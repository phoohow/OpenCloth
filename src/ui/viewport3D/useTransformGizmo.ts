import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ObjectTransform, Vec3 } from '@/model/types';
import { parseSceneRef } from '@/model';
import type { GarmentEngine, Viewport } from '@/runtime';
import { composeTransforms, identityDelta, isIdentityDelta, type GizmoDelta, type GizmoFrame } from '@/runtime';
import { add3, cross3, dot3, length3, normalize3, scale3, sub3, radToDeg, wrapAngleSigned } from '@/base/math';
import {
  applyMatrix3, axisRotationMatrix3, axisScaleMatrix3, identityMatrix3, rotationAxes3,
} from '@/base/math';
import { intersectRayPlane3 } from '@/base/geom';
import { useProjectStore, useUIStore, type TransformMode } from '@/store';
import { commitPanelTransforms, commitTransform, previewTransform } from '@/ui/sceneCommands';
import { reportActionError } from '@/ui/widgets/toast';
import {
  buildGizmoLayout, hitTestHandle, sameHandle, type GizmoHandle, type GizmoLayout,
} from '@/ui/viewport3D/gizmoLayout';
import { gizmoTargets, type GizmoTarget } from '@/ui/viewport3D/gizmoTargets';

/** Live overlay state of the 3D transform gizmo. */
export interface TransformGizmoState {
  layout: GizmoLayout | null;
  /** Text describing the in-flight delta, shown beside the gizmo. */
  readout: string | null;
  hover: GizmoHandle | null;
  dragging: boolean;
}

/** One in-flight handle drag. */
interface DragState {
  pointerId: number;
  mode: TransformMode;
  handle: GizmoHandle;
  /** Rows being dragged, in the order their base transforms are held. */
  rows: string[];
  kind: 'panel' | 'object';
  bases: ObjectTransform[];
  /** World axes of the primary panel, kept for local-space scaling. */
  worldAxes: [Vec3, Vec3, Vec3];
  layout: GizmoLayout;
  start: { x: number; y: number };
  startAngle: number;
  startRadius: number;
  planeNormal: Vec3 | null;
  startWorld: Vec3 | null;
  delta: GizmoDelta;
}

/** Chinese command label of one gizmo mode on a panel. */
const MODE_LABEL: Record<TransformMode, string> = {
  translate: '3D 平移版片',
  rotate: '3D 旋转版片',
  scale: '3D 缩放版片',
};

/** Command label of one gizmo mode on a scene object. */
const OBJECT_MODE_LABEL: Record<TransformMode, string> = {
  translate: '3D 平移对象',
  rotate: '3D 旋转对象',
  scale: '3D 缩放对象',
};

/** Frame a single scene object's gizmo is drawn around. */
const OBJECT_FRAME_RADIUS_M = 0.06;

/** Panel id behind a panel row: a 2D pick spells it `@panel:`, a 3D pick leaves it bare. */
function panelIdOf(row: string): string {
  const ref = parseSceneRef(row);
  return ref.kind === 'panel' ? ref.id : row;
}

/** Frame a single scene object's gizmo is drawn around: its own world position. */
function objectFrame(targets: GizmoTarget[]): GizmoFrame {
  const centers: Record<string, Vec3> = {};
  for (const target of targets) centers[target.row] = { ...target.transform.position };
  return {
    center: { ...targets[0]!.transform.position },
    radius: OBJECT_FRAME_RADIUS_M,
    centers,
  };
}

/**
 * Pointer interaction of the 3D transform gizmo. A press on a handle owns the gesture until
 * release; every other press falls through to the camera and cloth gestures.
 */
export function useTransformGizmo(
  canvasRef: RefObject<HTMLCanvasElement>,
  containerRef: RefObject<HTMLDivElement>,
  engineRef: RefObject<GarmentEngine | null>,
  viewportRef: RefObject<Viewport | null>,
): TransformGizmoState {
  const [state, setState] = useState<TransformGizmoState>({
    layout: null, readout: null, hover: null, dragging: false,
  });
  const layoutRef = useRef<GizmoLayout | null>(null);
  const lastKeyRef = useRef('');
  const previewRef = useRef<GizmoDelta | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const hoverRef = useRef<GizmoHandle | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    /** Whether the gizmo is shown for this tool, selection and mode. */
    const draggableTargets = (): GizmoTarget[] => {
      const ui = useUIStore.getState();
      if (ui.activeTool !== 'select') return [];
      const targets = gizmoTargets(useProjectStore.getState().project, ui.selection);
      // A light has no orientation of its own, so only translation applies to it.
      if (targets[0]?.translateOnly && ui.transformMode !== 'translate') return [];
      return targets;
    };

    /** Pointer position relative to the pane, in CSS pixels. */
    const localPoint = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /** Camera ray through a pane point, in normalized device coordinates. */
    const rayAt = (x: number, y: number, layout: GizmoLayout) => {
      const camera = viewportRef.current?.camera;
      if (!camera) return null;
      const ndcX = x / layout.width * 2 - 1;
      const ndcY = 1 - y / layout.height * 2;
      return camera.ray(ndcX, ndcY, layout.width / Math.max(1, layout.height));
    };

    /** Rebuilds the overlay when the camera, selection, mode or preview moved. */
    const refresh = () => {
      const engine = engineRef.current;
      const viewport = viewportRef.current;
      if (!engine || !viewport) return;
      const ui = useUIStore.getState();
      const targets = draggableTargets();
      if (targets.length === 0) {
        if (layoutRef.current) {
          layoutRef.current = null;
          lastKeyRef.current = '';
          hoverRef.current = null;
          setState(s => ({ ...s, layout: null, hover: null, readout: null, dragging: false }));
        }
        return;
      }
      const rows = targets.map(target => target.row);
      const panelDrag = targets[0]!.kind === 'panel';
      const frame = panelDrag ? engine.panelGizmoFrame(rows.map(panelIdOf)) : objectFrame(targets);
      if (!frame) return;
      const width = container.clientWidth, height = container.clientHeight;
      const camera = viewport.camera.snapshot(width / Math.max(1, height));
      const bases = targets.map(target => target.transform);
      const delta = previewRef.current;
      const pivot = delta ? add3(frame.center, delta.translation) : frame.center;
      const axes = rotationAxes3(bases[0]!.rotationEuler)
        .map(axis => delta ? applyMatrix3(delta.linear, axis) : axis) as [Vec3, Vec3, Vec3];
      const layout = buildGizmoLayout(camera, pivot, axes, ui.transformMode, width, height, frame);
      if (!layout) return;

      const key = [
        ui.transformMode, rows.join(','), width, height,
        round(camera.position.x), round(camera.position.y), round(camera.position.z),
        round(camera.target.x), round(camera.target.y), round(camera.target.z),
        round(camera.up.x), round(camera.up.y), round(camera.up.z),
        camera.projection, round(camera.viewHeightMeters),
        round(frame.center.x), round(frame.center.y), round(frame.center.z),
        delta ? delta.linear.map(round).join(',') : '',
        delta ? [delta.translation.x, delta.translation.y, delta.translation.z].map(round).join(',') : '',
      ].join('|');
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      layoutRef.current = layout;
      setState(s => ({ ...s, layout }));
    };

    /** World delta produced by dragging the active handle to a pane point. */
    const computeDelta = (
      drag: DragState, point: { x: number; y: number },
    ): { delta: GizmoDelta; readout: string } | null => {
      const layout = drag.layout;
      const zero = { x: 0, y: 0, z: 0 };
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;

      if (drag.mode === 'translate') {
        if (drag.handle.kind === 'axis') {
          const axis = layout.axes[drag.handle.axis]!;
          if (axis.lengthPx < 4) return null;
          const along = (dx * axis.unit.x + dy * axis.unit.y) / axis.lengthPx * layout.worldLength;
          return {
            delta: { linear: identityMatrix3(), translation: scale3(axis.direction, along) },
            readout: `移动 ${(Math.abs(along) * 100).toFixed(1)} cm`,
          };
        }
        const ray = rayAt(point.x, point.y, layout);
        if (!ray || !drag.startWorld || !drag.planeNormal) return null;
        const hit = intersectRayPlane3(ray.origin, ray.direction, layout.pivot, drag.planeNormal);
        if (!hit) return null;
        const translation = sub3(hit, drag.startWorld);
        return {
          delta: { linear: identityMatrix3(), translation },
          readout: `移动 ${(length3(translation) * 100).toFixed(1)} cm`,
        };
      }

      if (drag.mode === 'rotate') {
        if (drag.handle.kind !== 'ring') return null;
        const angle = Math.atan2(point.y - layout.origin.y, point.x - layout.origin.x);
        const screen = wrapAngleSigned(angle - drag.startAngle);
        const axis = layout.axes[drag.handle.axis]!.direction;
        const facing = dot3(axis, layout.viewBack) >= 0 ? 1 : -1;
        const rotation = -screen * facing;
        return {
          delta: { linear: axisRotationMatrix3(axis, rotation), translation: zero },
          readout: `旋转 ${radToDeg(rotation).toFixed(1)}°`,
        };
      }

      let factor = 1;
      if (drag.handle.kind === 'axis') {
        const axis = layout.axes[drag.handle.axis]!;
        if (axis.lengthPx < 4) return null;
        factor = 1 + (dx * axis.unit.x + dy * axis.unit.y) / Math.max(24, axis.lengthPx);
      } else {
        const radius = Math.hypot(point.x - layout.origin.x, point.y - layout.origin.y);
        factor = 1 + (radius - drag.startRadius) / Math.max(30, drag.startRadius);
      }
      factor = Math.max(0.05, Math.min(20, factor));
      const factors = drag.handle.kind === 'axis'
        ? { x: drag.handle.axis === 0 ? factor : 1, y: drag.handle.axis === 1 ? factor : 1, z: drag.handle.axis === 2 ? factor : 1 }
        : { x: factor, y: factor, z: factor };
      return {
        delta: { linear: axisScaleMatrix3(drag.worldAxes, factors), translation: zero },
        readout: `缩放 ×${factor.toFixed(2)}`,
      };
    };

    /** Ends the gesture; a committed drag writes one undoable project command. */
    const endDrag = (commit: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      previewRef.current = null;
      if (drag.kind === 'panel') {
        engineRef.current?.endPanelTransformPreview();
      } else if (!commit) {
        // A scene object has no engine-side preview to unwind, so put it back where it started.
        drag.rows.forEach((row, i) => previewTransform(row, drag.bases[i]!, engineRef));
      }
      if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
      if (commit && !isIdentityDelta(drag.delta)) {
        const next = composeTransforms(drag.bases, drag.delta);
        try {
          if (drag.kind === 'panel') {
            commitPanelTransforms(
              drag.rows.map((row, i) => ({ panelId: panelIdOf(row), transform: next[i]! })),
              MODE_LABEL[drag.mode],
            );
          } else {
            commitTransform(drag.rows[0]!, next[0]!, engineRef, OBJECT_MODE_LABEL[drag.mode]);
          }
        } catch (err) {
          reportActionError(err);
        }
      }
      setState(s => ({ ...s, dragging: false, readout: null }));
      refresh();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || dragRef.current) return;
      // Modifier presses belong to the PIN and camera-pan gestures, not to the gizmo.
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const layout = layoutRef.current;
      if (!layout) return;
      const point = localPoint(e);
      const hit = hitTestHandle(layout, point.x, point.y, e.pointerType === 'touch' ? 14 : 8);
      if (!hit) return;
      const ui = useUIStore.getState();
      const targets = draggableTargets();
      if (targets.length === 0) return;
      const rows = targets.map(target => target.row);
      const kind = targets[0]!.kind;
      const engine = engineRef.current;
      if (kind === 'panel' && !engine?.beginPanelTransformPreview(rows.map(panelIdOf))) return;
      const bases = targets.map(target => target.transform);
      const worldAxes = rotationAxes3(bases[0]!.rotationEuler);
      const drag: DragState = {
        pointerId: e.pointerId,
        mode: ui.transformMode,
        handle: hit.handle,
        rows,
        kind,
        bases,
        worldAxes,
        layout,
        start: point,
        startAngle: Math.atan2(point.y - layout.origin.y, point.x - layout.origin.x),
        startRadius: Math.hypot(point.x - layout.origin.x, point.y - layout.origin.y),
        planeNormal: null,
        startWorld: null,
        delta: identityDelta(),
      };
      if (drag.mode === 'translate' && (hit.handle.kind === 'plane' || hit.handle.kind === 'center')) {
        let normal: Vec3 = layout.viewBack;
        if (hit.handle.kind === 'plane') {
          const planeAxes = hit.handle.axes;
          const crossed = cross3(worldAxes[planeAxes[0]], worldAxes[planeAxes[1]]);
          normal = normalize3(crossed) ?? layout.viewBack;
        }
        const ray = rayAt(point.x, point.y, layout);
        drag.planeNormal = normal;
        drag.startWorld = ray ? intersectRayPlane3(ray.origin, ray.direction, layout.pivot, normal) : null;
      }
      dragRef.current = drag;
      previewRef.current = null;
      hoverRef.current = hit.handle;
      setState(s => ({ ...s, dragging: true, readout: null, hover: hit.handle }));
      canvas.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        if (e.pointerId !== drag.pointerId) return;
        const result = computeDelta(drag, localPoint(e));
        if (result) {
          drag.delta = result.delta;
          previewRef.current = result.delta;
          if (drag.kind === 'panel') {
            engineRef.current?.updatePanelTransformPreview(result.delta);
          } else {
            const next = composeTransforms(drag.bases, result.delta)[0];
            if (next) previewTransform(drag.rows[0]!, next, engineRef);
          }
          setState(s => ({ ...s, readout: result.readout }));
          refresh();
        }
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      const layout = layoutRef.current;
      const point = localPoint(e);
      const next = layout
        ? hitTestHandle(layout, point.x, point.y, e.pointerType === 'touch' ? 14 : 8)?.handle ?? null
        : null;
      if (!sameHandle(next, hoverRef.current)) {
        hoverRef.current = next;
        setState(s => ({ ...s, hover: next }));
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
      endDrag(true);
    };

    const onPointerCancel = () => endDrag(false);
    const onPointerLeave = () => {
      if (dragRef.current) return;
      hoverRef.current = null;
      setState(s => ({ ...s, hover: null }));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) endDrag(false);
    };
    const onWindowBlur = () => endDrag(false);

    container.addEventListener('pointerdown', onPointerDown, true);
    container.addEventListener('pointermove', onPointerMove, true);
    container.addEventListener('pointerup', onPointerUp, true);
    container.addEventListener('pointercancel', onPointerCancel, true);
    container.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);

    let frame = 0;
    const tick = () => { refresh(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true);
      container.removeEventListener('pointermove', onPointerMove, true);
      container.removeEventListener('pointerup', onPointerUp, true);
      container.removeEventListener('pointercancel', onPointerCancel, true);
      container.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
      cancelAnimationFrame(frame);
      dragRef.current = null;
      layoutRef.current = null;
    };
  }, [canvasRef, containerRef, engineRef, viewportRef]);

  return state;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
