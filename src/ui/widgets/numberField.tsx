import { useRef, useState } from 'react';
import type { Vec2, Vec3 } from '../../core/model/types';

const AXIS_COLOR = { X: '#e06c5e', Y: '#78c860', Z: '#5f8fd3' } as const;

interface NumberFieldProps {
  value: number;
  /** Value added per horizontal pixel while dragging. */
  step: number;
  precision?: number;
  min?: number;
  max?: number;
  /** Axis letter shown at the left of the cell. */
  axis?: keyof typeof AXIS_COLOR;
  title?: string;
  /** Called while dragging, before the value is committed. */
  onPreview?: (v: number) => void;
  onCommit: (v: number) => void;
}

/** Scrub-drag number cell that turns into a text field on click, like Blender's properties. */
export function NumberField({ value, step, precision = 3, min, max, axis, title, onPreview, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ x: number; from: number; value?: number; moved: boolean } | null>(null);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const shown = clamp(draft ?? value);
  const fmt = (v: number) => v.toFixed(precision);

  const commit = (v: number) => {
    const next = clamp(v);
    setDraft(null);
    if (next !== value) onCommit(next);
  };

  const startEdit = () => {
    setText(value.toFixed(precision));
    setEditing(true);
  };

  if (editing) {
    return (
      <input
        style={styles.edit}
        value={text}
        autoFocus
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') { const p = parseFloat(text); if (!Number.isNaN(p)) commit(p); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => { const p = parseFloat(text); if (!Number.isNaN(p)) commit(p); setEditing(false); }}
      />
    );
  }

  return (
    <div
      style={styles.cell}
      title={title}
      onPointerDown={e => {
        // A finger taps to type; scrubbing needs the pixel precision of a mouse.
        if (e.pointerType === 'touch') { startEdit(); return; }
        drag.current = { x: e.clientX, from: value, moved: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture available */ }
        e.preventDefault();
      }}
      onPointerMove={e => {
        const session = drag.current;
        if (!session) return;
        const dx = e.clientX - session.x;
        if (!session.moved && Math.abs(dx) < 3) return;
        session.moved = true;
        const fine = e.shiftKey ? 0.15 : 1;
        session.value = clamp(session.from + dx * step * fine);
        setDraft(session.value);
        onPreview?.(session.value);
      }}
      onPointerUp={() => {
        const session = drag.current;
        drag.current = null;
        if (!session) return;
        if (!session.moved) { startEdit(); return; }
        setDraft(null);
        if (session.value !== undefined) commit(session.value);
      }}
      onPointerCancel={() => { drag.current = null; setDraft(null); }}
      onWheel={e => {
        const next = clamp(value + (e.deltaY < 0 ? step : -step) * (e.shiftKey ? 0.15 : 1));
        onPreview?.(next);
        commit(next);
      }}
    >
      {axis && <span style={{ ...styles.axis, color: AXIS_COLOR[axis] }}>{axis}</span>}
      <span style={styles.value}>{fmt(shown)}</span>
    </div>
  );
}

interface Vec3FieldProps {
  label: string;
  value: Vec3;
  step: number;
  precision?: number;
  min?: number;
  max?: number;
  /** Unit appended to the row label as `名称(单位)`. */
  unit?: string;
  onPreview?: (v: Vec3) => void;
  onCommit: (v: Vec3) => void;
}

/** Three axis cells editing one vector. */
export function Vec3Field({ label, value, step, precision, min, max, unit, onPreview, onCommit }: Vec3FieldProps) {
  const axes: Array<keyof typeof AXIS_COLOR> = ['X', 'Y', 'Z'];
  const withAxis = (axis: keyof typeof AXIS_COLOR, v: number): Vec3 => ({ ...value, [axis.toLowerCase()]: v });
  return (
    <div style={styles.vecRow}>
      <span style={styles.vecLabel}>{unit ? `${label}(${unit})` : label}</span>
      <div style={styles.vecCells}>
        {axes.map(a => (
          <NumberField
            key={a}
            axis={a}
            value={value[a.toLowerCase() as keyof Vec3]}
            step={step}
            precision={precision}
            min={min}
            max={max}
            onPreview={v => onPreview?.(withAxis(a, v))}
            onCommit={v => onCommit(withAxis(a, v))}
          />
        ))}
      </div>
    </div>
  );
}

interface Vec2FieldProps {
  label: string;
  value: Vec2;
  step: number;
  precision?: number;
  min?: number;
  max?: number;
  title?: string;
  onCommit: (v: Vec2) => void;
}

/** Two axis cells editing one 2D vector. */
export function Vec2Field({ label, value, step, precision, min, max, title, onCommit }: Vec2FieldProps) {
  const axes: Array<keyof typeof AXIS_COLOR> = ['X', 'Y'];
  const withAxis = (axis: keyof typeof AXIS_COLOR, v: number): Vec2 => ({ ...value, [axis.toLowerCase()]: v });
  return (
    <div style={styles.vecRow}>
      <span style={styles.vecLabel}>{label}</span>
      <div style={styles.vecCells}>
        {axes.map(a => (
          <NumberField
            key={a}
            axis={a}
            value={value[a.toLowerCase() as keyof Vec2]}
            step={step}
            precision={precision}
            min={min}
            max={max}
            title={title}
            onCommit={v => onCommit(withAxis(a, v))}
          />
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  cell: {
    flex: 1, minWidth: 0, height: 'var(--oc-h-control)', display: 'flex', alignItems: 'center', gap: 3,
    background: '#26262b', border: '1px solid #3a3a42', borderRadius: 3,
    padding: '0 4px', cursor: 'ew-resize', overflow: 'hidden',
  },
  edit: {
    flex: 1, minWidth: 0, height: 'var(--oc-h-control)', background: '#1c1c20', border: '1px solid #4da6ff',
    borderRadius: 3, color: '#fff', fontSize: 'var(--oc-fs-micro)', padding: '0 4px',
  },
  axis: { fontSize: 'var(--oc-fs-note)', fontWeight: 700, flex: '0 0 auto' },
  value: { fontSize: 'var(--oc-fs-micro)', color: '#ddd', marginLeft: 'auto', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  vecRow: { display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0' },
  vecLabel: { fontSize: 'var(--oc-fs-micro)', color: '#999', width: 'var(--oc-w-field-label)', flex: '0 0 auto' },
  vecCells: { flex: 1, display: 'flex', gap: 3, minWidth: 0 },
};
