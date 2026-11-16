import { useEffect, useState, type RefObject } from 'react';
import type { Vec3 } from '@/model/types';
import { AXIS_X, AXIS_Y, AXIS_Z, dot3, scale3 } from '@/base/math';
import { cameraBasis } from '@/render/common';
import type { GarmentEngine, Viewport, CameraPreset } from '@/runtime';
import { AXIS_COLORS } from '@/ui/viewport3D/axisTheme';

/** Axis letters and the camera view each direction snaps to. */
const AXES = [
  { name: 'X', vector: { x: 1, y: 0, z: 0 }, plus: 'right', minus: 'left' },
  { name: 'Y', vector: { x: 0, y: 1, z: 0 }, plus: 'top', minus: 'bottom' },
  { name: 'Z', vector: { x: 0, y: 0, z: 1 }, plus: 'front', minus: 'back' },
] as const;

/** Widget size and the projected length of one axis, in CSS pixels. */
const SIZE = 82;
const CENTER = SIZE / 2;
const AXIS_LENGTH = 29;

type AxisPreset = typeof AXES[number]['plus'] | typeof AXES[number]['minus'];

interface AxisIndicatorProps {
  viewportRef: RefObject<Viewport | null>;
  engineRef: RefObject<GarmentEngine | null>;
}

/** Orientation compass of the 3D viewport; clicking an axis end snaps to that view. */
export function AxisIndicator({ viewportRef, engineRef }: AxisIndicatorProps) {
  const [camera, setCamera] = useState<{
    position: Vec3; target: Vec3; up: Vec3;
  } | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    const read = () => {
      const state = viewport.camera.snapshot();
      setCamera({ position: state.position, target: state.target, up: state.up });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; read(); });
    };
    const unsubscribe = viewport.camera.onChange(schedule);
    read();
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [viewportRef]);

  if (!camera) return null;
  const basis = cameraBasis(camera) ?? { right: AXIS_X, up: AXIS_Y, back: AXIS_Z, forward: scale3(AXIS_Z, -1) };

  /** Ends sorted back to front, so the axes pointing at the viewer stay on top. */
  const ends = AXES.flatMap((axis, index) => ([1, -1] as const).map(sign => {
    const vector = scale3(axis.vector, sign);
    return {
      axis,
      sign,
      color: AXIS_COLORS[index]!,
      depth: dot3(vector, basis.back),
      x: CENTER + dot3(vector, basis.right) * AXIS_LENGTH,
      y: CENTER - dot3(vector, basis.up) * AXIS_LENGTH,
      preset: (sign > 0 ? axis.plus : axis.minus) as AxisPreset,
    };
  })).sort((a, b) => a.depth - b.depth);

  const snap = (preset: AxisPreset) => engineRef.current?.setCameraPreset(preset as CameraPreset);

  return (
    <div
      title="坐标轴 · 单击切换视角"
      style={{
        position: 'absolute', left: 8, bottom: 26, width: SIZE, height: SIZE,
        pointerEvents: 'auto', userSelect: 'none', zIndex: 2,
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="坐标轴">
        <circle cx={CENTER} cy={CENTER} r={CENTER - 2} fill="rgba(20,22,28,0.62)" stroke="#3a3a42" strokeWidth={1} />
        {ends.map(end => {
          const near = end.depth >= 0;
          return (
            <g key={`${end.axis.name}-${end.sign}`} onClick={() => snap(end.preset)} style={{ cursor: 'pointer' }}>
              <line
                x1={CENTER} y1={CENTER} x2={end.x} y2={end.y}
                stroke={end.color} strokeWidth={near ? 2.5 : 1.5} opacity={near ? 1 : 0.42}
              />
              <circle cx={end.x} cy={end.y} r={end.sign > 0 ? 9 : 6}
                fill={end.sign > 0 ? end.color : '#20232a'}
                stroke={end.color} strokeWidth={1.4} opacity={near ? 1 : 0.45} />
              {end.sign > 0 && (
                <text x={end.x} y={end.y + 3.4} textAnchor="middle"
                  fontSize={10} fontWeight={700} fill="#12151b" opacity={near ? 1 : 0.5}
                  style={{ pointerEvents: 'none' }}>{end.axis.name}</text>
              )}
              {/* Invisible hit area keeps the small labels clickable. */}
              <circle cx={end.x} cy={end.y} r={12} fill="transparent" />
            </g>
          );
        })}
        <circle cx={CENTER} cy={CENTER} r={2.6} fill="#c8ced9" />
      </svg>
    </div>
  );
}
