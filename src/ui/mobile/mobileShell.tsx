import { useEffect, useState, type MutableRefObject } from 'react';
import { Viewport3D } from '../viewport3D';
import { MobileSheet, type MobileSheetId } from './mobileSheets';
import { MenuDialogs } from '../menu/menuDialogs';
import { Icon, type IconName } from '../icons';
import { nextSpeed } from './mobileUi';
import { normalizeRayTracing } from '../../core/model/defaults';
import { usePerfStore, useProjectStore, useSimStore, useUIStore } from '../../store/stores';
import { rayTraceStateLabel } from '../optionTables';
import type { MenuActions } from '../menu/actions';
import type { GarmentEngine } from '../../core/engine/garmentEngine';
import type { RendererContext } from '../../render/renderer/rendererContext';

/** Phone layout: one full-bleed 3D pane between a top bar and the action dock. */
export function MobileShell({ actions, engineRef, onEngineReady, ready }: {
  actions: MenuActions;
  engineRef: MutableRefObject<GarmentEngine | null>;
  onEngineReady: (engine: GarmentEngine, ctx: RendererContext) => void;
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
          <FloatButton icon="camera" label="视角" onClick={() => setSheet('camera')} />
          <FloatButton icon="aperture" label="显示" onClick={() => setSheet('display')} />
          <FloatButton icon="expand-all" label="适应" onClick={() => engineRef.current?.frameScene()} />
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
  const isDraped = useSimStore(s => s.isDraped);
  const isDraping = useSimStore(s => s.isDraping);
  const currentFrame = useSimStore(s => s.currentFrame);
  const renderMode = useUIStore(s => s.renderMode);
  const fps3D = usePerfStore(s => s.fps['3d']);
  const samples3D = usePerfStore(s => s.samples3D);
  const rayState3D = usePerfStore(s => s.rayState3D);

  const status = isDraping
    ? { text: '缝合着装中', color: '#4da6ff' }
    : !isDraped
      ? { text: '未着装', color: '#e0a040' }
      : isPlaying
        ? { text: '模拟中', color: '#50c878' }
        : { text: '已暂停', color: '#8a8a94' };

  return (
    <div style={styles.topBar}>
      <div style={styles.topRow}>
        <button style={styles.menuBtn} onClick={onOpenMenu}>菜单</button>
        <span style={styles.projectName}>{projectName}</span>
        <span style={styles.readout}>
          {renderMode === 'raytraced'
            ? `SPP ${samples3D}/${maxSamples}${samples3D === 0 ? ` · ${rayTraceStateLabel(rayState3D)}` : ''}`
            : `FPS ${fps3D}`}
          <span style={styles.readoutDim}> · 帧 {currentFrame}</span>
        </span>
      </div>
      <div style={styles.statusRow}>
        <span style={{ ...styles.status, color: status.color }}>{status.text}</span>
        <button style={styles.selectionChip} onClick={onOpenProps}>
          {selectedPanel ? `选中 ${selectedPanel} · 参数` : '轻点布料选片 · 参数'}
        </button>
      </div>
    </div>
  );
}

/** Thumb-reach actions: dress the garment, run the simulation, change its speed, edit properties. */
function Dock({ actions, onOpenProps }: { actions: MenuActions; onOpenProps: () => void }) {
  const isPlaying = useSimStore(s => s.isPlaying);
  const isDraping = useSimStore(s => s.isDraping);
  const speed = useSimStore(s => s.speed);
  const setSpeed = useSimStore(s => s.setSpeed);

  return (
    <nav style={styles.dock}>
      <DockButton
        icon="t-shirt"
        label={isDraping ? '着装中…' : '自动着装'}
        primary
        disabled={isDraping}
        onClick={actions.drape}
      />
      <DockButton
        icon={isPlaying ? 'pause' : 'play'}
        label={isPlaying ? '暂停' : '播放'}
        onClick={actions.playPause}
      />
      <DockButton icon="reset" label="重置" onClick={actions.resetSim} />
      <DockButton
        icon="atom"
        label={`${speed}x 速度`}
        active={speed !== 1}
        title="点击切换模拟速度"
        onClick={() => setSpeed(nextSpeed(speed))}
      />
      <DockButton icon="cube" label="参数" onClick={onOpenProps} />
    </nav>
  );
}

function DockButton({ icon, label, primary, active, disabled, title, onClick }: {
  icon: IconName;
  label: string;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      style={{
        ...styles.dockBtn,
        ...(primary ? styles.dockBtnPrimary : null),
        ...(active ? styles.dockBtnActive : null),
        ...(disabled ? styles.dockBtnDisabled : null),
      }}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={19} />
      <span style={styles.dockLabel}>{label}</span>
    </button>
  );
}

/** Round viewport button that opens one of the small sheets. */
function FloatButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button style={styles.floatBtn} title={label} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span style={styles.floatLabel}>{label}</span>
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
    flex: '0 0 auto', padding: '6px 12px', background: '#2a2a30',
    border: '1px solid #3a3a42', borderRadius: 5, color: '#ddd', fontSize: 14, cursor: 'pointer',
  },
  projectName: {
    flex: '1 1 auto', minWidth: 0, fontSize: 14, color: '#eee',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  readout: {
    flex: '0 0 auto', fontSize: 12, color: '#4da6ff',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  },
  readoutDim: { color: '#8a94a6' },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  status: { flex: '0 0 auto', fontSize: 12 },
  selectionChip: {
    flex: '1 1 auto', minWidth: 0, textAlign: 'right', padding: '2px 0',
    background: 'transparent', border: 'none', color: '#9ab', fontSize: 12,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  stage: { flex: '1 1 auto', minHeight: 0, position: 'relative', overflow: 'hidden', background: '#252528' },
  floatColumn: {
    position: 'absolute', right: 10, bottom: 14, zIndex: 5,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  floatBtn: {
    width: 48, height: 48, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 1,
    background: 'rgba(32,32,36,0.9)', border: '1px solid #3a3a42',
    borderRadius: 24, color: '#ccc', cursor: 'pointer',
  },
  floatLabel: { fontSize: 10, color: '#9ab' },
  dock: {
    flex: '0 0 auto', display: 'flex', alignItems: 'stretch', gap: 6, padding: '8px 8px',
    paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
    background: '#202024', borderTop: '1px solid #333',
  },
  dockBtn: {
    flex: '1 1 0', minWidth: 0, minHeight: 54, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 3,
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 8,
    color: '#ccc', cursor: 'pointer',
  },
  dockBtnPrimary: { flex: '1.4 1 0', background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  dockBtnActive: { border: '1px solid #4da6ff', color: '#fff' },
  dockBtnDisabled: { opacity: 0.4, cursor: 'default' },
  dockLabel: { fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' },
  loading: {
    position: 'absolute', inset: 0, zIndex: 6, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 14, color: '#888', fontSize: 14,
    background: 'rgba(26,26,30,0.88)',
  },
  spinner: {
    width: 30, height: 30, border: '3px solid #333', borderTopColor: '#4da6ff',
    borderRadius: '50%', animation: 'spin 1s linear infinite',
  },
};
