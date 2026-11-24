import { useUIStore, type TransformMode } from '@/store';

const MODES: Array<{ key: TransformMode; label: string; disabled?: boolean }> = [
  { key: 'translate', label: '平移' },
  { key: 'rotate', label: '旋转' },
  { key: 'scale', label: '缩放', disabled: true },
];

export function TransformModeSwitch() {
  const mode = useUIStore(s => s.transformMode);
  const setMode = useUIStore(s => s.setTransformMode);
  return (
    <div style={{
      position: 'absolute', top: 8, left: 8, zIndex: 3,
      display: 'flex', gap: 2, padding: 3, borderRadius: 5,
      background: 'rgba(24, 27, 33, 0.88)', border: '1px solid #3a3a42',
    }}>
      {MODES.map(item => (
        <button
          key={item.key}
          title={`${item.label}版片`}
          aria-label={`${item.label}版片`}
          aria-pressed={mode === item.key}
          disabled={item.disabled}
          onClick={() => setMode(item.key)}
          style={{
            padding: '4px 8px', fontSize: 'var(--oc-fs-micro)',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            border: '1px solid transparent', borderRadius: 3,
            color: item.disabled ? '#666' : mode === item.key ? '#fff' : '#bbb',
            background: !item.disabled && mode === item.key ? '#2a4a6a' : 'transparent',
            borderColor: !item.disabled && mode === item.key ? '#4da6ff' : 'transparent',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
