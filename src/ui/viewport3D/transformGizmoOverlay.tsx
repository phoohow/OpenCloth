import type { TransformGizmoState } from '@/ui/viewport3D/useTransformGizmo';

import { sub2 } from '@/base/math';
import { AXIS_COLORS, AXIS_NAMES, CENTER_COLOR } from '@/ui/viewport3D/axisTheme';
import { sameHandle, type GizmoHandle } from '@/ui/viewport3D/gizmoLayout';

export function TransformGizmoOverlay({ state }: { state: TransformGizmoState }) {
  const layout = state.layout;
  if (!layout) return null;
  const { origin, axes, mode } = layout;
  const hovered = (handle: GizmoHandle) => sameHandle(state.hover, handle);
  const o = origin;

  return (
    <svg
      width="100%" height="100%"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      aria-hidden="true"
    >
      {mode === 'rotate' && layout.rings.map(ring => (
        <polyline
          key={`ring-${ring.axis}`}
          points={ring.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="none"
          stroke={AXIS_COLORS[ring.axis]}
          strokeWidth={hovered({ kind: 'ring', axis: ring.axis }) ? 4 : 2}
          opacity={hovered({ kind: 'ring', axis: ring.axis }) ? 1 : 0.85}
          strokeLinecap="round"
        />
      ))}

      {mode === 'translate' && layout.planes.map(plane => (
        <polygon
          key={`plane-${plane.axes[0]}-${plane.axes[1]}`}
          points={plane.corners.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill={AXIS_COLORS[plane.axes[0]]}
          fillOpacity={hovered({ kind: 'plane', axes: plane.axes }) ? 0.5 : 0.22}
          stroke={AXIS_COLORS[plane.axes[0]]}
          strokeWidth={hovered({ kind: 'plane', axes: plane.axes }) ? 2 : 1}
        />
      ))}

      {axes.map((axis, index) => {
        const active = hovered({ kind: 'axis', axis: index });
        const head = { x: axis.end.x - axis.unit.x * 8, y: axis.end.y - axis.unit.y * 8 };
        return (
          <g key={`axis-${index}`} opacity={mode === 'rotate' ? 0.35 : 1}>
            <line x1={o.x} y1={o.y} x2={head.x} y2={head.y}
              stroke={axis.color} strokeWidth={active ? 4 : 2} strokeLinecap="round" />
            {mode === 'rotate' ? null : mode === 'scale' ? (
              <rect x={axis.end.x - 6} y={axis.end.y - 6} width={12} height={12} rx={2}
                fill={axis.color} stroke={active ? '#fff' : '#1b1e24'} strokeWidth={active ? 2 : 1} />
            ) : (
              <>
                <polygon
                  points={arrowPoints(axis.end, axis.unit)}
                  fill={axis.color} stroke={active ? '#fff' : '#1b1e24'} strokeWidth={1}
                />
                <text x={axis.end.x} y={axis.end.y + 3.2} textAnchor="middle"
                  fontSize={9} fontWeight={700} fill="#12151b">{AXIS_NAMES[index]}</text>
              </>
            )}
          </g>
        );
      })}

      {mode !== 'rotate' && (
        <rect
          x={o.x - 6} y={o.y - 6} width={12} height={12} rx={2}
          fill={CENTER_COLOR} stroke={hovered({ kind: 'center' }) ? '#fff' : '#1b1e24'}
          strokeWidth={hovered({ kind: 'center' }) ? 2 : 1}
        />
      )}

      {state.readout && (
        <g transform={`translate(${Math.min(layout.width - 150, o.x + 18)}, ${Math.max(18, o.y - 34)})`}>
          <rect x={0} y={0} width={132} height={22} rx={3}
            fill="rgba(18, 24, 32, 0.9)" stroke="#4da6ff" strokeWidth={1} />
          <text x={8} y={15} fontSize={11} fill="#dcecff">{state.readout}</text>
        </g>
      )}
    </svg>
  );
}

function arrowPoints(end: { x: number; y: number }, unit: { x: number; y: number }): string {
  const along = { x: unit.x * 9, y: unit.y * 9 };
  const side = { x: -unit.y * 5.5, y: unit.x * 5.5 };
  const base = sub2(end, along);
  return [
    `${end.x.toFixed(1)},${end.y.toFixed(1)}`,
    `${(base.x + side.x).toFixed(1)},${(base.y + side.y).toFixed(1)}`,
    `${(base.x - side.x).toFixed(1)},${(base.y - side.y).toFixed(1)}`,
  ].join(' ');
}
