import type { GarmentEngine, MeshStats } from '@/runtime';

import { frameProfiler, type ProfileSnapshot } from '@/base/perf';
import { useUIStore } from '@/store';
import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from 'react';

const REFRESH_MS = 250;

const PANEL_WIDTH = 400;

let savedPos: { x: number; y: number } | null = null;

const LABELS: Record<string, string> = {
  'loop.animation': '身体动画',
  'loop.sync': '状态同步',
  'loop.preview': '编辑预览',
  'sim.step': '模拟步进',
  'sim.submit': '模拟提交',
  'sim.readback': '模拟回读',
  'sim.map': '回读等待',
  'sim.unpack': '回读解包',
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

const COLUMNS = '1fr 60px 60px';

const SPAN_COLUMNS = '1fr 52px 52px 52px';

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed', top: 48, right: 16, width: PANEL_WIDTH, zIndex: 950,
    maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column',
    background: 'rgba(22, 24, 29, 0.94)', border: '1px solid #3a3a42', borderRadius: 6,
    boxShadow: '0 8px 28px rgba(0,0,0,0.5)', color: '#ccc', overflow: 'hidden',
    fontVariantNumeric: 'tabular-nums',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    background: '#242832', borderBottom: '1px solid #3a3a42',
    cursor: 'move', userSelect: 'none', touchAction: 'none',
  },
  title: { fontSize: 'var(--oc-fs-body)', color: '#e6f2ff', fontWeight: 600, marginRight: 'auto' },
  meta: { fontSize: 'var(--oc-fs-micro)', color: '#7d8b99' },
  close: {
    width: 20, height: 20, padding: 0, marginLeft: 6, border: 'none', borderRadius: 3,
    background: 'transparent', color: '#9aa5b1', cursor: 'pointer', fontSize: 16, lineHeight: '18px',
  },
  body: { flex: 1, minHeight: 0, overflowY: 'auto' },
  section: {
    padding: '5px 10px', fontSize: 'var(--oc-fs-micro)', color: '#8fa6bd', letterSpacing: 1,
    background: '#1f232b', borderBottom: '1px solid #2e323b', borderTop: '1px solid #2e323b',
  },
  summary: {
    padding: '6px 10px', fontSize: 'var(--oc-fs-micro)', color: '#8f9aa6',
    borderBottom: '1px solid #2e323b',
  },
  value: { color: '#bde7ff', fontWeight: 600 },
  headRow: {
    display: 'grid', gridTemplateColumns: COLUMNS, gap: 4,
    padding: '5px 10px', fontSize: 'var(--oc-fs-micro)', color: '#6f7b87',
    borderBottom: '1px solid #2e323b',
  },
  spanHeadRow: {
    display: 'grid', gridTemplateColumns: SPAN_COLUMNS, gap: 4,
    padding: '5px 10px', fontSize: 'var(--oc-fs-micro)', color: '#6f7b87',
    borderBottom: '1px solid #2e323b',
  },
  row: {
    display: 'grid', gridTemplateColumns: COLUMNS, gap: 4,
    padding: '3px 10px', fontSize: 'var(--oc-fs-micro)', color: '#c7ced6',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  },
  spanRow: {
    display: 'grid', gridTemplateColumns: SPAN_COLUMNS, gap: 4,
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

interface MeshRow {
  label: string;
  note: string;
  vertices: number | null;
  triangles: number | null;
}

function rowLabel(key: string): string {
  if (key.startsWith('pass:')) return `通道 · ${PASS_LABELS[key.slice(5)] ?? key.slice(5)}`;
  return LABELS[key] ?? key;
}

function cell(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

function count(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function meshRows(stats: MeshStats | null): MeshRow[] {
  return [
    {
      label: '模特',
      note: '身体表面与眼球；导入的模型不计',
      vertices: stats?.avatar?.vertices ?? null,
      triangles: stats?.avatar?.triangles ?? null,
    },
    {
      label: '版片',
      note: '各版片三角化后合并的模拟网格',
      vertices: stats?.panels.vertices ?? null,
      triangles: stats?.panels.triangles ?? null,
    },
    {
      label: '缝线 / 明线',
      note: '缝合线与明线的端点，按线段绘制',
      vertices: stats?.threadVertices ?? null,
      triangles: null,
    },
  ];
}

export function PerfPanel({ engineRef }: { engineRef: MutableRefObject<GarmentEngine | null> }) {
  const toggle = useUIStore(s => s.togglePerfPanel);
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [meshes, setMeshes] = useState<MeshStats | null>(null);
  const [pos, setPos] = useState(() => (savedPos
    ? {
      x: clamp(savedPos.x, 0, window.innerWidth - PANEL_WIDTH),
      y: clamp(savedPos.y, 0, window.innerHeight - 160),
    }
    : null));
  const drag = useRef<{ dx: number; dy: number; height: number } | null>(null);

  useEffect(() => {
    frameProfiler.setEnabled(true);
    const read = () => {
      setSnapshot(frameProfiler.snapshot());
      setMeshes(engineRef.current?.meshStats() ?? null);
    };
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      frameProfiler.setEnabled(false);
    };
  }, [engineRef]);

  const fps = snapshot && snapshot.lastIntervalMs > 0
    ? Math.round(1000 / snapshot.lastIntervalMs)
    : 0;

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const box = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!box) return;
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, height: box.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const grabbed = drag.current;
    if (!grabbed) return;
    savedPos = {
      x: clamp(e.clientX - grabbed.dx, 0, window.innerWidth - PANEL_WIDTH),
      y: clamp(e.clientY - grabbed.dy, 0, window.innerHeight - grabbed.height),
    };
    setPos(savedPos);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      style={{ ...styles.panel, ...(pos ? { left: pos.x, top: pos.y, right: 'auto' } : null) }}
      data-testid="perf-panel"
    >
      <div
        style={styles.header}
        title="拖动可移动面板"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span style={styles.title}>性能监测</span>
        {snapshot && (
          <span style={styles.meta}>
            {fps} fps · 间隔 {snapshot.lastIntervalMs.toFixed(1)} ms
          </span>
        )}
        <button style={styles.close} title="关闭" onClick={toggle}>×</button>
      </div>

      <div style={styles.body}>
        <div style={styles.section}>静态几何</div>
        <div style={styles.headRow}>
          <span>项目</span>
          <span style={styles.number}>顶点</span>
          <span style={styles.number}>三角</span>
        </div>
        {meshRows(meshes).map(row => (
          <div key={row.label} style={styles.row} title={row.note}>
            <span style={styles.label}>{row.label}</span>
            <span style={styles.number}>{count(row.vertices)}</span>
            <span style={styles.number}>{count(row.triangles)}</span>
          </div>
        ))}

        <div style={styles.section}>帧耗时</div>
        {snapshot ? (
          <>
            <div
              style={styles.summary}
              title="CPU 提交耗时（不含 GPU 与呈现）；帧率取最慢一段"
            >
              CPU 工作 <b style={styles.value}>{snapshot.lastWorkMs.toFixed(1)}</b> ms
              · 平均 {snapshot.avgWorkMs.toFixed(1)}
              · 峰值 {snapshot.maxWorkMs.toFixed(1)}
              · 采样 {snapshot.frames} 帧
            </div>
            <div style={styles.spanHeadRow}>
              <span>阶段</span>
              <span style={styles.number}>本次</span>
              <span style={styles.number}>平均</span>
              <span style={styles.number}>峰值</span>
            </div>
            {snapshot.spans.map(span => (
              <div key={span.label} style={styles.spanRow} title={`${span.label} · ${span.samples} 帧`}>
                <span style={{ ...styles.label, paddingLeft: span.depth * 12 }}>
                  {rowLabel(span.label)}
                </span>
                <span style={styles.number}>{cell(span.lastMs)}</span>
                <span style={styles.number}>{cell(span.avgMs)}</span>
                <span style={styles.number}>{cell(span.maxMs)}</span>
              </div>
            ))}
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
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
