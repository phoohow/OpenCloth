import type { Vec2, Vec3 } from '@/model/types';

import { clamp as clampValue } from '@/base/math';
import { useState } from 'react';

const AXIS_COLOR = { X: '#e06c5e', Y: '#78c860', Z: '#5f8fd3' } as const;

const styles: Record<string, React.CSSProperties> = {
  cell: {
    flex: 1, minWidth: 0, height: 'var(--oc-h-control)', display: 'flex', alignItems: 'center', gap: 3,
    background: '#1d1d22', border: '1px solid #3a3a42', borderRadius: 3, padding: '0 5px', overflow: 'hidden',
  },
  cellDense: { padding: '0 3px', gap: 0 },
  cellDisabled: { opacity: 0.45, cursor: 'default' },
  input: {
    flex: '1 1 auto', minWidth: 0, width: 0, height: '100%', background: 'transparent', border: 'none', outline: 'none',
    color: '#eee', fontSize: 'var(--oc-fs-micro)', textAlign: 'right', padding: 0,
    fontVariantNumeric: 'tabular-nums',
  },
  inputDisabled: { color: '#888' },
  axis: { fontSize: 'var(--oc-fs-note)', fontWeight: 700, flex: '0 0 auto' },
  vecRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 0' },
  vecLabel: {
    fontSize: 'var(--oc-fs-micro)', color: '#999', flex: '0 1 auto', minWidth: 'var(--oc-w-field-label)',
    textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  vecPair: { display: 'flex', gap: 4, flex: '0 0 auto', width: 'var(--oc-w-field)', minWidth: 0 },
  vecTriple: { display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0 },
};

interface NumberFieldProps {
  value: number;
  step: number;
  precision?: number;
  min?: number;
  max?: number;
  axis?: keyof typeof AXIS_COLOR;
  dense?: boolean;
  disabled?: boolean;
  onCommit: (v: number) => void;
}

interface Vec3FieldProps {
  label: string;
  value: Vec3;
  step: number;
  precision?: number;
  min?: number;
  max?: number;
  tip?: string;
  disabled?: boolean;
  onCommit: (v: Vec3) => void;
}

interface Vec2FieldProps {
  label: string;
  value: Vec2;
  step: number;
  precision?: number;
  min?: number;
  max?: number;
  tip?: string;
  onCommit: (v: Vec2) => void;
}

export function NumberField({
  value, step, precision = 3, min, max, axis, dense, disabled, onCommit,
}: NumberFieldProps) {
  const [text, setText] = useState<string | null>(null);

  const clamp = (v: number) => clampValue(v, min ?? -Infinity, max ?? Infinity);
  const snap = (v: number) => clamp(Number((Math.round(v / step) * step).toFixed(precision)));

  const commit = () => {
    if (text === null) return;
    const parsed = Number.parseFloat(text);
    setText(null);
    if (!Number.isFinite(parsed)) return;
    const next = snap(parsed);
    if (next !== value) onCommit(next);
  };

  return (
    <span style={{ ...styles.cell, ...(dense ? styles.cellDense : null), ...(disabled ? styles.cellDisabled : null) }}>
      {axis && <span style={{ ...styles.axis, color: AXIS_COLOR[axis] }}>{axis}</span>}
      <input
        type="text" inputMode="decimal" spellCheck={false} disabled={disabled}
        style={{ ...styles.input, ...(disabled ? styles.inputDisabled : null) }}
        value={text ?? clamp(value).toFixed(precision)}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') setText(null);
        }}
      />
    </span>
  );
}

export function Vec3Field({ label, tip, value, step, precision, min, max, disabled, onCommit }: Vec3FieldProps) {
  const axes: Array<keyof typeof AXIS_COLOR> = ['X', 'Y', 'Z'];
  const withAxis = (axis: keyof typeof AXIS_COLOR, v: number): Vec3 => ({ ...value, [axis.toLowerCase()]: v });
  return (
    <div style={styles.vecRow} title={tip}>
      <span style={styles.vecLabel}>{label}</span>
      <div style={styles.vecTriple}>
        {axes.map(a => (
          <NumberField
            key={a}
            axis={a}
            dense
            value={value[a.toLowerCase() as keyof Vec3]}
            step={step}
            precision={precision}
            min={min}
            max={max}
            disabled={disabled}
            onCommit={v => onCommit(withAxis(a, v))}
          />
        ))}
      </div>
    </div>
  );
}

export function Vec2Field({ label, tip, value, step, precision, min, max, onCommit }: Vec2FieldProps) {
  const axes: Array<keyof typeof AXIS_COLOR> = ['X', 'Y'];
  const withAxis = (axis: keyof typeof AXIS_COLOR, v: number): Vec2 => ({ ...value, [axis.toLowerCase()]: v });
  return (
    <div style={styles.vecRow} title={tip}>
      <span style={styles.vecLabel}>{label}</span>
      <div style={styles.vecPair}>
        {axes.map(a => (
          <NumberField
            key={a}
            axis={a}
            value={value[a.toLowerCase() as keyof Vec2]}
            step={step}
            precision={precision}
            min={min}
            max={max}
            onCommit={v => onCommit(withAxis(a, v))}
          />
        ))}
      </div>
    </div>
  );
}
