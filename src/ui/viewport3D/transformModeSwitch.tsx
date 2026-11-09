import { useUIStore, type TransformMode } from '@/store';

/** Compact gizmo mode picker for the phone shell, which has no desktop toolbar. */
const MODES: Array<{ key: TransformMode; label: string }> = [
  { key: 'translate', label: '平移' },
  { key: 'rotate', label: '旋转' },
  { key: 'scale', label: '缩放' },
];

/** Floating mode buttons shown while a panel is selected on a touch screen. */
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
          onClick={() => setMode(item.key)}
          style={{
            padding: '4px 8px', fontSize: 'var(--oc-fs-micro)', cursor: 'pointer',
            border: '1px solid transparent', borderRadius: 3,
            color: mode === item.key ? '#fff' : '#bbb',
            background: mode === item.key ? '#2a4a6a' : 'transparent',
            borderColor: mode === item.key ? '#4da6ff' : 'transparent',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
