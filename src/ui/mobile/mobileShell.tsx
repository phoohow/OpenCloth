import type { GarmentEngine } from '@/runtime';
import type { Viewport } from '@/runtime';
import type { MenuActions } from '@/ui/menu/actions';

import { normalizeRayTracing } from '@/model';
import { usePerfStore, useProjectStore, useSimStore, useUIStore } from '@/store';
import { Icon, type IconName } from '@/ui/icons';
import { MenuDialogs } from '@/ui/menu/menuDialogs';
import { MobileSheet, type MobileSheetId } from '@/ui/mobile/mobileSheets';
import { MobileTransport } from '@/ui/mobile/mobileTransport';
import { rayTraceStateLabel } from '@/ui/optionTables';
import { formatElapsed } from '@/ui/timeFormat';
import { Viewport3D } from '@/ui/viewport3D';
import { useEffect, useState, type MutableRefObject } from 'react';

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#1a1a1e', color: '#e0e0e0',
  },
  topBar: {
    flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 3,
    paddingTop: 'calc(6px + env(safe-area-inset-top))', paddingBottom: 6,
    paddingLeft: 10, paddingRight: 10,
    background: '#202024', borderBottom: '1px solid #333',
  },
  topRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  menuBtn: {
    flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, background: 'transparent', border: 'none', color: '#ddd', cursor: 'pointer',
  },
  menuBtnFace: {
    width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 5,
  },
  projectName: {
    flex: '1 1 auto', minWidth: 0, fontSize: 'var(--oc-fs-heading)', color: '#eee',
    textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  readout: {
    flex: '0 1 auto', minWidth: 0, display: 'block', textAlign: 'right',
    fontSize: 'var(--oc-fs-body)', color: '#4da6ff',
    overflow: 'hidden', textOverflow: 'ellipsis',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  status: { flex: '0 0 auto', fontSize: 'var(--oc-fs-body)' },
  frameCount: { flex: '0 0 auto', fontSize: 'var(--oc-fs-body)', color: '#8a94a6', fontVariantNumeric: 'tabular-nums' },
  selectionChip: {
    flex: '1 1 auto', minWidth: 0, textAlign: 'right', padding: '2px 0',
    background: 'transparent', border: 'none', color: '#9ab', fontSize: 'var(--oc-fs-body)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  stage: { flex: '1 1 auto', minHeight: 0, position: 'relative', overflow: 'hidden', background: '#252528' },
  floatColumn: {
    position: 'absolute', right: 10, bottom: 14, zIndex: 5,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  floatBtn: {
    width: 44, height: 44, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(32,32,36,0.9)', border: '1px solid #3a3a42',
    borderRadius: 22, color: '#ccc', cursor: 'pointer',
  },
  loading: {
    position: 'absolute', inset: 0, zIndex: 6, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 14, color: '#888', fontSize: 'var(--oc-fs-heading)',
    background: 'rgba(26,26,30,0.88)',
  },
  spinner: {
    width: 30, height: 30, border: '3px solid #333', borderTopColor: '#4da6ff',
    borderRadius: '50%', animation: 'spin 1s linear infinite',
  },
};

export function MobileShell({ actions, engineRef, onEngineReady, ready }: {
  actions: MenuActions;
  engineRef: MutableRefObject<GarmentEngine | null>;
  onEngineReady: (engine: GarmentEngine, viewport: Viewport) => void;
  ready: boolean;
}) {
  const [sheet, setSheet] = useState<MobileSheetId>(null);

  useEffect(() => {
    useUIStore.getState().setFocus('3d');
  }, []);

  return (
    <div style={styles.root}>
      <TopBar onOpenMenu={() => setSheet('menu')} onOpenProps={() => setSheet('props')} />
      <div style={styles.stage}>
        <Viewport3D onEngineReady={onEngineReady} />
        {!ready && (
          <div style={styles.loading}>
            <div style={styles.spinner} />
            <div>正在初始化 WebGPU 渲染器</div>
          </div>
        )}
        <div style={styles.floatColumn}>
          <FloatButton icon="camera" title="视图" onClick={() => setSheet('view')} />
          <FloatButton icon="aperture" title="显示" onClick={() => setSheet('display')} />
        </div>
      </div>
      <MobileTransport engineRef={engineRef} onOpenProps={() => setSheet('props')} />
      <MobileSheet sheet={sheet} onClose={() => setSheet(null)} actions={actions} engineRef={engineRef} />
      <MenuDialogs actions={actions} />
    </div>
  );
}

function TopBar({ onOpenMenu, onOpenProps }: { onOpenMenu: () => void; onOpenProps: () => void }) {
  const projectName = useProjectStore(s => s.project.meta.name);
  const maxSamples = useProjectStore(s => normalizeRayTracing(s.project.scene.render.rayTracing).maxSamples);
  const pattern = useProjectStore(s => s.project.pattern);
  const selection = useUIStore(s => s.selection);
  const selectedPanel = selection.length === 1
    ? pattern.panels[selection[0]]?.name ?? null
    : null;
  const isPlaying = useSimStore(s => s.isPlaying);
  const isDressed = useSimStore(s => s.isDressed);
  const isDressing = useSimStore(s => s.isDressing);
  const currentFrame = useSimStore(s => s.currentFrame);
  const backend = useUIStore(s => s.backend);
  const fps3D = usePerfStore(s => s.fps['3d']);
  const samples3D = usePerfStore(s => s.samples3D);
  const denoiseCount3D = usePerfStore(s => s.denoiseCount3D);
  const costMs3D = usePerfStore(s => s.costMs3D);
  const rayState3D = usePerfStore(s => s.rayState3D);
  const rayNote = rayTraceStateLabel(rayState3D);

  const status = isDressing
    ? { text: '着装中', color: '#4da6ff' }
    : !isDressed
      ? { text: '未着装', color: '#e0a040' }
      : isPlaying
        ? { text: '模拟中', color: '#50c878' }
        : { text: '已暂停', color: '#8a8a94' };

  return (
    <div style={styles.topBar}>
      <div style={styles.topRow}>
        <button style={styles.menuBtn} onClick={onOpenMenu} title="菜单" aria-label="菜单">
          <span style={styles.menuBtnFace}><Icon name="menu" size={19} /></span>
        </button>
        <span style={styles.projectName}>{projectName}</span>
        <span style={styles.readout}>
          {backend === 'pathtrace'
            ? `SPP ${samples3D}/${maxSamples}${samples3D > 0 ? ` · Oidn ${denoiseCount3D} · Cost ${formatElapsed(costMs3D)}` : ''}${rayNote ? ` · ${rayNote}` : ''}`
            : `FPS ${fps3D}`}
        </span>
      </div>
      <div style={styles.statusRow}>
        <span style={styles.frameCount}>帧 {currentFrame}</span>
        <span style={{ ...styles.status, color: status.color }}>{status.text}</span>
        <button style={styles.selectionChip} onClick={onOpenProps}>
          {selectedPanel ? `选中 ${selectedPanel}` : '轻点布料选片'}
        </button>
      </div>
    </div>
  );
}

function FloatButton({ icon, title, onClick }: { icon: IconName; title: string; onClick: () => void }) {
  return (
    <button style={styles.floatBtn} title={title} aria-label={title} onClick={onClick}>
      <Icon name={icon} size={20} />
    </button>
  );
}
