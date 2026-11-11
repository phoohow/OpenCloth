/** Floating CPU frame profile opened from Help ▸ 调试. */

import { useEffect, useState } from 'react';
import { frameProfiler, type ProfileSnapshot } from '@/base/perf';
import { useUIStore } from '@/store';

/** Snapshot read cadence; reading per frame would re-render React at frame rate. */
const REFRESH_MS = 250;

/** Chinese names of the profiler keys the frame loop and solver emit. */
const LABELS: Record<string, string> = {
  'loop.animation': '身体动画',
  'loop.sync': '状态同步',
  'loop.preview': '编辑预览',
  'sim.step': '模拟步进',
  'sim.submit': '模拟提交',
  'sim.readback': '模拟回读',
  'sim.map': '回读等待',
  'sim.unpack': '回读解包',
  'sim.selfCollision': '自碰撞',
  'sim.seams': '缝线撕裂',
  'sim.present': '结果上屏',
  'present.cloth': '服装网格',
  'present.overlays': '缝线 / 线迹 / 辅料',
  'present.avatar': '身体形变',
  'present.pressure': '动态压力采样',
  'present.markers': '标记同步',
  'analysis.fit': '合身场刷新',
  'analysis.strain': '应变场刷新',
  'analysis.pressure': '压力场刷新',
  'render.frame': '视图渲染',
  'render.drawList': '绘制列表',
  'render.snapshot': '场景快照',
  'render.apply': '场景同步',
};

/** Chinese names of the frame graph passes. */
const PASS_LABELS: Record<string, string> = {
  raster: '光栅',
  trace: '光追',
  denoise: '降噪',
  composite: '合成',
  post: '色调映射',
  heatmap: '热图',
  wire: '线框',
  overlay: 'gizmo 覆盖',
  present: '呈现',
};

/** Row text of one profiler key; unknown keys stay visible as-is. */
function rowLabel(key: string): string {
  if (key.startsWith('pass:')) return `通道 · ${PASS_LABELS[key.slice(5)] ?? key.slice(5)}`;
  return LABELS[key] ?? key;
}

/** Millisecond cell; a dash marks a phase the newest frame did not run. */
function cell(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

/** Per-frame CPU breakdown with last, average and peak columns. */
export function PerfPanel() {
  const toggle = useUIStore(s => s.togglePerfPanel);
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);

  useEffect(() => {
    frameProfiler.setEnabled(true);
    const read = () => setSnapshot(frameProfiler.snapshot());
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      frameProfiler.setEnabled(false);
    };
  }, []);

  const fps = snapshot && snapshot.lastIntervalMs > 0
    ? Math.round(1000 / snapshot.lastIntervalMs)
    : 0;

  return (
    <div style={styles.panel} data-testid="perf-panel">
      <div style={styles.header}>
        <span style={styles.title}>3D 帧 CPU 耗时</span>
        {snapshot && (
          <span style={styles.meta}>
            {fps} fps · 间隔 {snapshot.lastIntervalMs.toFixed(1)} ms
          </span>
        )}
        <button style={styles.close} title="关闭" onClick={toggle}>×</button>
      </div>

      {snapshot ? (
        <>
          <div
            style={styles.summary}
            title="CPU 提交耗时，不含 GPU 执行与呈现等待；帧率由 CPU、GPU 与呈现中最慢的一段决定"
          >
            CPU 工作 <b style={styles.value}>{snapshot.lastWorkMs.toFixed(1)}</b> ms
            · 平均 {snapshot.avgWorkMs.toFixed(1)}
            · 峰值 {snapshot.maxWorkMs.toFixed(1)}
            · 采样 {snapshot.frames} 帧
          </div>
          <div style={styles.headRow}>
            <span>阶段</span>
            <span style={styles.number}>本次</span>
            <span style={styles.number}>平均</span>
            <span style={styles.number}>峰值</span>
          </div>
          <div style={styles.rows}>
            {snapshot.spans.map(span => (
              <div key={span.label} style={styles.row} title={`${span.label} · ${span.samples} 帧`}>
                <span style={{ ...styles.label, paddingLeft: 6 + span.depth * 12 }}>
                  {rowLabel(span.label)}
                </span>
                <span style={styles.number}>{cell(span.lastMs)}</span>
                <span style={styles.number}>{cell(span.avgMs)}</span>
                <span style={styles.number}>{cell(span.maxMs)}</span>
              </div>
            ))}
          </div>
          <div style={styles.footer}>
            <span>毫秒 · CPU 提交 · 平均/峰值取最近 240 帧 · 每 {REFRESH_MS} ms 刷新</span>
            <button
              style={styles.reset}
              onClick={() => { frameProfiler.reset(); setSnapshot(null); }}
            >重置</button>
          </div>
        </>
      ) : (
        <div style={styles.empty}>等待 3D 帧</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed', top: 48, right: 16, width: 400, zIndex: 950,
    maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column',
    background: 'rgba(22, 24, 29, 0.94)', border: '1px solid #3a3a42', borderRadius: 6,
    boxShadow: '0 8px 28px rgba(0,0,0,0.5)', color: '#ccc', overflow: 'hidden',
    fontVariantNumeric: 'tabular-nums',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    background: '#242832', borderBottom: '1px solid #3a3a42',
  },
  title: { fontSize: 'var(--oc-fs-body)', color: '#e6f2ff', fontWeight: 600 },
  meta: { marginLeft: 'auto', fontSize: 'var(--oc-fs-micro)', color: '#7d8b99' },
  close: {
    width: 20, height: 20, padding: 0, border: 'none', borderRadius: 3,
    background: 'transparent', color: '#9aa5b1', cursor: 'pointer', fontSize: 16, lineHeight: '18px',
  },
  summary: {
    padding: '6px 10px', fontSize: 'var(--oc-fs-micro)', color: '#8f9aa6',
    borderBottom: '1px solid #2e323b',
  },
  value: { color: '#bde7ff', fontWeight: 600 },
  headRow: {
    display: 'grid', gridTemplateColumns: '1fr 52px 52px 52px', gap: 4,
    padding: '5px 10px', fontSize: 'var(--oc-fs-micro)', color: '#6f7b87',
    borderBottom: '1px solid #2e323b',
  },
  rows: { overflowY: 'auto', flex: 1, minHeight: 40 },
  row: {
    display: 'grid', gridTemplateColumns: '1fr 52px 52px 52px', gap: 4,
    padding: '3px 10px', fontSize: 'var(--oc-fs-micro)', color: '#c7ced6',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  number: { textAlign: 'right' },
  footer: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
    fontSize: 'var(--oc-fs-micro)', color: '#6f7b87', borderTop: '1px solid #2e323b',
  },
  reset: {
    marginLeft: 'auto', padding: '2px 8px', borderRadius: 3, border: '1px solid #3a3a42',
    background: '#2a2f38', color: '#9aa5b1', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  empty: { padding: '18px 10px', fontSize: 'var(--oc-fs-body)', color: '#7d8b99', textAlign: 'center' },
};
