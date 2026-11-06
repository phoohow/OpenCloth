import { useEffect, useState, type MutableRefObject } from 'react';
import { Viewport3D } from '@/ui/viewport3D';
import { MobileSheet, type MobileSheetId } from '@/ui/mobile/mobileSheets';
import { MenuDialogs } from '@/ui/menu/menuDialogs';
import { Icon, type IconName } from '@/ui/icons';
import { normalizeRayTracing } from '@/model';
import { usePerfStore, useProjectStore, useSimStore, useUIStore } from '@/store';
import { rayTraceStateLabel } from '@/ui/optionTables';
import { formatElapsed } from '@/ui/timeFormat';
import type { MenuActions } from '@/ui/menu/actions';
import type { GarmentEngine } from '@/runtime';
import type { Renderer } from '@/render';

/** Phone layout: one full-bleed 3D pane between a top bar and the action dock. */
export function MobileShell({ actions, engineRef, onEngineReady, ready }: {
  actions: MenuActions;
  engineRef: MutableRefObject<GarmentEngine | null>;
  onEngineReady: (engine: GarmentEngine, renderer: Renderer) => void;
  ready: boolean;
}) {
  const [sheet, setSheet] = useState<MobileSheetId>(null);

  // The stage is the 3D pane, so keyboard-scoped actions reach it. The stored layout is
  // left alone: the same browser profile may also open the desktop shell.
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
            <div>正在初始化 WebGPU 渲染器…</div>
          </div>
        )}
        <div style={styles.floatColumn}>
          <FloatButton icon="camera" title="视图" onClick={() => setSheet('view')} />
          <FloatButton icon="aperture" title="显示" onClick={() => setSheet('display')} />
        </div>
      </div>
      <Dock actions={actions} onOpenProps={() => setSheet('props')} />
      <MobileSheet sheet={sheet} onClose={() => setSheet(null)} actions={actions} engineRef={engineRef} />
      <MenuDialogs />
    </div>
  );
}

/** Project name, the simulation readouts and the 菜单 entry. */
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
  const costMs3D = usePerfStore(s => s.costMs3D);
  const rayState3D = usePerfStore(s => s.rayState3D);
  const rayNote = samples3D === 0 ? rayTraceStateLabel(rayState3D) : '';

  const status = isDressing
    ? { text: '缝合着装中', color: '#4da6ff' }
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
            ? `SPP ${samples3D}/${maxSamples}${samples3D > 0 ? ` · Cost ${formatElapsed(costMs3D)}` : rayNote ? ` · ${rayNote}` : ''}`
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

/** Icon-only timeline controls plus the properties entry, in PC timeline order. */
function Dock({ actions, onOpenProps }: { actions: MenuActions; onOpenProps: () => void }) {
  const isPlaying = useSimStore(s => s.isPlaying);

  return (
    <nav style={styles.dock}>
      <DockButton icon="reset" title="重置" onClick={actions.resetSim} />
      <DockButton
        icon={isPlaying ? 'pause' : 'play'}
        title={isPlaying ? '暂停' : '播放'}
        active={isPlaying}
        onClick={actions.playPause}
      />
      <DockButton icon="step" title="下一帧" onClick={actions.stepFrame} />
      <span style={styles.dockDivider} />
      <DockButton icon="cube" title="参数" label="参数" onClick={onOpenProps} />
    </nav>
  );
}

function DockButton({ icon, title, label, active, onClick }: {
  icon: IconName;
  title: string;
  label?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      style={{
        ...styles.dockBtn,
        ...(active ? styles.dockBtnActive : null),
      }}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon name={icon} size={20} />
      {label && <span style={styles.dockLabel}>{label}</span>}
    </button>
  );
}

/** Round viewport button that opens one of the small sheets. */
function FloatButton({ icon, title, onClick }: { icon: IconName; title: string; onClick: () => void }) {
  return (
    <button style={styles.floatBtn} title={title} aria-label={title} onClick={onClick}>
      <Icon name={icon} size={20} />
    </button>
  );
}

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
  dock: {
    flex: '0 0 auto', display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: 16, padding: '8px 8px',
    paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
    background: '#202024', borderTop: '1px solid #333',
  },
  dockBtn: {
    flex: '0 0 auto', width: 44, height: 44, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 1,
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 8,
    color: '#ccc', cursor: 'pointer',
  },
  dockBtnActive: { border: '1px solid #4da6ff', background: '#2a4a6a', color: '#fff' },
  dockLabel: { fontSize: 'var(--oc-fs-micro)', lineHeight: 1, whiteSpace: 'nowrap' },
  dockDivider: {
    flex: '0 0 auto', alignSelf: 'center', width: 1, height: 22,
    background: '#3a3a42',
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
