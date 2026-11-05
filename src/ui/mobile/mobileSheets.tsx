import { useEffect, type ReactNode } from 'react';
import type { MenuActions } from '../menu/actions';
import { AUTO_SAVE_ITEMS } from '../menu/menuModel';
import { formatSavedAt } from '../timeFormat';
import { CAMERA_PRESETS, CAMERA_PROJECTIONS, DISPLAY_MODES, PROP_TAB_OPTIONS, rayTracingUnavailableReason, SIM_STEP_OPTIONS, simStepLabel } from '../optionTables';
import { usePropsTarget } from '../panels/propertiesEditor';
import { Icon } from '../icons';
import { setSimulationConfig, type EngineRef } from '../sceneCommands';
import { displayModeOf, usePerfStore, useProjectStore, useSimStore, useUIStore } from '../../store/stores';
import type { PropTab } from '../../store/stores';
import type { CameraProjection } from '../../core/model/types';
import type { CameraPreset } from '../../core/engine/garmentEngine';

/** Sheets the phone shell can slide up; null keeps the viewport full screen. */
export type MobileSheetId = 'menu' | 'camera' | 'display' | 'props' | null;

/** Bottom sheet with a grabber, a title row and its own scrolling body. */
export function Sheet({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div style={styles.sheet} role="dialog" aria-label={title}>
        <div style={styles.grabber} />
        <div style={styles.sheetHead}>
          <span style={styles.sheetTitle}>{title}</span>
          <button style={styles.closeBtn} onClick={onClose}>关闭</button>
        </div>
        <div style={styles.sheetBody}>{children}</div>
      </div>
    </>
  );
}

/** Full-width labelled action inside a sheet. */
function SheetButton({ label, hint, active, disabled, onClick }: {
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      style={{ ...styles.cell, ...(active ? styles.cellActive : null), ...(disabled ? styles.cellDisabled : null) }}
      disabled={disabled}
      onClick={onClick}
    >
      <span style={styles.cellLabel}>{label}</span>
      {hint && <span style={styles.cellHint}>{hint}</span>}
    </button>
  );
}

/** Group heading above a sheet grid. */
function SheetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={styles.group}>
      <div style={styles.groupTitle}>{title}</div>
      <div style={styles.grid}>{children}</div>
    </section>
  );
}

function SheetNote({ children }: { children: ReactNode }) {
  return <div style={styles.note}>{children}</div>;
}

/** Camera, projection and view-fitting actions. */
function CameraSheet({ actions, engineRef, onClose }: {
  actions: MenuActions;
  engineRef: EngineRef;
  onClose: () => void;
}) {
  const projection = useUIStore(s => s.cameraProjection);

  const pick = (run: () => void) => () => { run(); onClose(); };

  return (
    <>
      <SheetGroup title="视角">
        {CAMERA_PRESETS.map(preset => (
          <SheetButton
            key={preset.value}
            label={preset.label}
            onClick={pick(() => actions.camera(preset.value as CameraPreset))}
          />
        ))}
      </SheetGroup>
      <SheetGroup title="投影">
        {CAMERA_PROJECTIONS.map(option => (
          <SheetButton
            key={option.value}
            label={option.label}
            active={projection === option.value}
            onClick={pick(() => actions.cameraProjection(option.value as CameraProjection))}
          />
        ))}
      </SheetGroup>
      <SheetGroup title="构图">
        <SheetButton label="适应当前视角" onClick={pick(() => engineRef.current?.frameScene())} />
      </SheetGroup>
      <SheetNote>单指拖拽旋转，双指捏合缩放，双指同时拖动平移。</SheetNote>
    </>
  );
}

/** Viewport display modes, the same set the desktop toolbar offers minus the strain and pressure heatmaps. */
function DisplaySheet({ onClose }: { onClose: () => void }) {
  const displayMode = useUIStore(displayModeOf);
  const setDisplayMode = useUIStore(s => s.setDisplayMode);
  const rayUnavailable = rayTracingUnavailableReason(usePerfStore(s => s.rayUnsupported3D));
  const fitOn = displayMode === 'fitHeatmap';
  const fitTightCm = useUIStore(s => s.fitTightCm);
  const fitLooseCm = useUIStore(s => s.fitLooseCm);
  const setFitThresholds = useUIStore(s => s.setFitThresholds);
  const fitStats = useSimStore(s => s.fitStats);

  return (
    <>
      <SheetGroup title="显示模式">
        {DISPLAY_MODES
          .filter(mode => mode.value !== 'strainHeatmap' && mode.value !== 'pressureHeatmap')
          .map(mode => (
            <SheetButton
              key={mode.value}
              label={mode.value === 'raytraced' && rayUnavailable ? `${mode.label}（不支持）` : mode.label}
              hint={mode.value === 'raytraced' ? rayUnavailable ?? undefined : undefined}
              disabled={mode.value === 'raytraced' && !!rayUnavailable}
              active={displayMode === mode.value}
              onClick={() => { setDisplayMode(mode.value); onClose(); }}
            />
          ))}
      </SheetGroup>
      {fitOn && (
        <>
          <label style={styles.rangeRow}>
            <span>贴近阈值 {fitTightCm.toFixed(1)} cm</span>
            <input type="range" min={0} max={3} step={0.1} value={fitTightCm}
              onChange={e => setFitThresholds(Number(e.target.value), fitLooseCm)} />
          </label>
          <label style={styles.rangeRow}>
            <span>宽松阈值 {fitLooseCm.toFixed(1)} cm</span>
            <input type="range" min={0.5} max={8} step={0.1} value={fitLooseCm}
              onChange={e => setFitThresholds(fitTightCm, Number(e.target.value))} />
          </label>
          {fitStats && (
            <SheetNote>
              穿透 {fitStats.penetration} · 贴近 {fitStats.tight} · 合适 {fitStats.ideal} · 宽松 {fitStats.loose}
              ；间隙 {fitStats.minCm.toFixed(2)} / {fitStats.meanCm.toFixed(2)} / {fitStats.maxCm.toFixed(2)} cm。
            </SheetNote>
          )}
        </>
      )}
      <SheetNote>光线追踪按渐进采样出图，布料每帧变形都会重新累计采样；手机上建议先暂停模拟再看收敛结果。</SheetNote>
    </>
  );
}

/** Object, material, simulator, transform, render and project properties. */
function PropsSheet({ engineRef }: { engineRef: EngineRef }) {
  const setPropTab = useUIStore(s => s.setPropTab);
  const target = usePropsTarget(engineRef);

  return (
    <>
      <div style={styles.tabStrip}>
        {PROP_TAB_OPTIONS.map(option => {
          const enabled = target.allowedTabs.includes(option.key);
          const active = enabled && target.tab === option.key;
          return (
            <button
              key={option.key}
              style={{ ...styles.tab, ...(active ? styles.tabActive : null), ...(enabled ? null : styles.tabDisabled) }}
              disabled={!enabled}
              onClick={() => setPropTab(option.key as PropTab)}
            >
              <Icon name={option.icon} size={13} />
              <span style={{ marginLeft: 5 }}>{option.label}</span>
            </button>
          );
        })}
      </div>
      <div style={styles.propsObjectName}>{target.objectName}</div>
      <div key={target.bodyKey}>{target.body}</div>
    </>
  );
}

/** Everything that does not earn a dock button: simulation, editing, scene, project files, export and help. */
function MenuSheet({ actions, onClose }: { actions: MenuActions; onClose: () => void }) {
  const project = useProjectStore(s => s.project);
  const recent = useProjectStore(s => s.recent);
  const history = useProjectStore(s => s.history);
  const selection = useUIStore(s => s.selection);
  const autoSaveSeconds = useUIStore(s => s.autoSaveSeconds);
  const lastAutosaveAt = useUIStore(s => s.lastAutosaveAt);
  const isPlaying = useSimStore(s => s.isPlaying);
  const dt = project.scene.simulation.dt;

  const panels = project.pattern.panels;
  const panelIds = Object.keys(panels);
  const selectedPanelCount = selection.filter(id => !!panels[id]).length;
  const hiddenPanelCount = panelIds.filter(id => !panels[id].visible).length;
  const referenceCount = (project.scene.referenceObjects ?? []).length;

  return (
    <>
      <SheetGroup title="模拟">
        <SheetButton label={isPlaying ? '暂停' : '播放'} onClick={actions.playPause} />
        <SheetButton label="单步" onClick={actions.stepFrame} />
        <SheetButton label="重置模拟" onClick={actions.resetSim} />
      </SheetGroup>
      <SheetGroup title="模拟步长">
        {SIM_STEP_OPTIONS.map(value => (
          <SheetButton
            key={value}
            label={simStepLabel(value)}
            active={dt === value}
            onClick={() => setSimulationConfig('修改仿真步长', { dt: value })}
          />
        ))}
      </SheetGroup>
      <SheetGroup title="选择与编辑">
        <SheetButton label="撤销" hint={history.lastLabel ?? undefined} disabled={!history.canUndo} onClick={actions.undo} />
        <SheetButton label="重做" hint={history.nextLabel ?? undefined} disabled={!history.canRedo} onClick={actions.redo} />
        <SheetButton label="全选版片" disabled={panelIds.length === 0} onClick={actions.selectAllPanels} />
        <SheetButton label="取消选择" disabled={selection.length === 0} onClick={actions.clearSelection} />
        <SheetButton label="删除选中" disabled={selection.length === 0} onClick={actions.deleteSelection} />
      </SheetGroup>
      <SheetGroup title="版片显示">
        <SheetButton label="显示全部版片" disabled={hiddenPanelCount === 0} onClick={actions.showAllPanels} />
        <SheetButton label="隐藏未选版片" disabled={selectedPanelCount === 0 || selectedPanelCount === panelIds.length} onClick={actions.hideUnselected} />
        <SheetButton label="隐藏选中版片" disabled={selectedPanelCount === 0} onClick={actions.hideSelected} />
      </SheetGroup>
      <SheetGroup title="模特与场景">
        <SheetButton label="模特模型…" onClick={actions.importAvatar} />
        <SheetButton label="参考物体…" onClick={actions.importReference} />
        <SheetButton label="环境贴图…" onClick={actions.importEnvironment} />
        <SheetButton label="恢复内置环境" onClick={actions.resetEnvironment} />
        <SheetButton label="清除全部参考物体" disabled={referenceCount === 0} onClick={actions.clearReferences} />
      </SheetGroup>
      <SheetGroup title="工程">
        <SheetButton label="新建工程" onClick={() => { actions.newProject(); onClose(); }} />
        <SheetButton label="打开…" onClick={() => { actions.openProject(); onClose(); }} />
        <SheetButton label="保存" onClick={actions.saveProject} />
        <SheetButton label="另存为…" onClick={actions.saveProjectAs} />
        <SheetButton label="立即保存快照" onClick={actions.saveSnapshotNow} />
        <SheetButton
          label={lastAutosaveAt ? `从快照恢复（${formatSavedAt(lastAutosaveAt)}）` : '从快照恢复'}
          disabled={!lastAutosaveAt}
          onClick={() => { actions.restoreAutosave(); onClose(); }}
        />
      </SheetGroup>
      <SheetGroup title="自动保存">
        {AUTO_SAVE_ITEMS.map(item => (
          <SheetButton
            key={item.seconds}
            label={item.label}
            active={autoSaveSeconds === item.seconds}
            onClick={() => actions.setAutoSaveSeconds(item.seconds)}
          />
        ))}
      </SheetGroup>
      {recent.length > 0 && (
        <SheetGroup title="最近打开">
          {recent.slice(0, 5).map(item => (
            <SheetButton
              key={item.id}
              label={item.name}
              hint={formatSavedAt(item.savedAt)}
              onClick={() => { actions.reopenRecent(item.id); onClose(); }}
            />
          ))}
        </SheetGroup>
      )}
      <SheetGroup title="导出">
        <SheetButton label="服装 GLB…" onClick={actions.exportGlb} />
        <SheetButton label="服装 OBJ…" onClick={actions.exportObj} />
        <SheetButton label="截图 PNG" onClick={actions.screenshot} />
        <SheetButton label="动画 WebM…" onClick={actions.exportAnimation} />
      </SheetGroup>
      <SheetGroup title="帮助">
        <SheetButton label="快捷键总览…" onClick={() => { actions.showShortcuts(); onClose(); }} />
        <SheetButton label="关于 OpenCloth" onClick={() => { actions.showAbout(); onClose(); }} />
      </SheetGroup>
      <SheetNote>手机端不提供 2D 制版、模板库、PIN 打点与捏布拖拽；需要改版型或在模拟里拉扯布料时请在电脑端打开同一个 .ocproj.json 工程。</SheetNote>
    </>
  );
}

const SHEET_TITLES: Record<Exclude<MobileSheetId, null>, string> = {
  menu: '菜单',
  camera: '视角',
  display: '显示',
  props: '参数',
};

/** The sheet the phone dock and the floating viewport buttons open. */
export function MobileSheet({ sheet, onClose, actions, engineRef }: {
  sheet: MobileSheetId;
  onClose: () => void;
  actions: MenuActions;
  engineRef: EngineRef;
}) {
  if (!sheet) return null;
  return (
    <Sheet title={SHEET_TITLES[sheet]} onClose={onClose}>
      {sheet === 'camera' && <CameraSheet actions={actions} engineRef={engineRef} onClose={onClose} />}
      {sheet === 'display' && <DisplaySheet onClose={onClose} />}
      {sheet === 'props' && <PropsSheet engineRef={engineRef} />}
      {sheet === 'menu' && <MenuSheet actions={actions} onClose={onClose} />}
    </Sheet>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.6)', zIndex: 1200 },
  sheet: {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1201,
    display: 'flex', flexDirection: 'column',
    maxHeight: '78dvh', minHeight: 200,
    background: '#232328', borderTopLeftRadius: 14, borderTopRightRadius: 14,
    borderTop: '1px solid #3a3a42', boxShadow: '0 -12px 32px rgba(0,0,0,0.55)',
    paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
  },
  grabber: { width: 42, height: 4, borderRadius: 2, background: '#4a4a52', margin: '8px auto 2px', flex: '0 0 auto' },
  sheetHead: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
    padding: '4px 14px 8px', borderBottom: '1px solid #333',
  },
  sheetTitle: { flex: 1, fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1 },
  closeBtn: {
    padding: '6px 14px', background: '#2a2a30', border: '1px solid #3a3a42',
    borderRadius: 4, color: '#ccc', fontSize: 'var(--oc-fs-label)', cursor: 'pointer',
  },
  sheetBody: {
    flex: '1 1 auto', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    padding: '4px 12px 12px',
  },
  group: { marginTop: 12 },
  groupTitle: { fontSize: 'var(--oc-fs-body)', color: '#7d7d88', letterSpacing: 1, margin: '0 2px 6px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 6 },
  cell: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 2,
    minHeight: 46, padding: '6px 9px', textAlign: 'left',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 6, color: '#ddd', cursor: 'pointer',
  },
  cellActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  cellDisabled: { opacity: 0.35, cursor: 'default' },
  cellLabel: { fontSize: 'var(--oc-fs-heading)', lineHeight: 1.25 },
  cellHint: { fontSize: 'var(--oc-fs-micro)', color: '#8a94a6' },
  note: { fontSize: 'var(--oc-fs-body)', color: '#8a8a94', lineHeight: 1.6, margin: '14px 2px 4px' },
  rangeRow: {
    display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 2px',
    fontSize: 'var(--oc-fs-body)', color: '#bbb',
  },
  tabStrip: {
    display: 'flex', gap: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
    padding: '10px 0 8px', borderBottom: '1px solid #333',
  },
  tab: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '10px 14px',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 6,
    color: '#ccc', fontSize: 'var(--oc-fs-label)', cursor: 'pointer',
  },
  tabActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  tabDisabled: { opacity: 0.35, cursor: 'default' },
  propsObjectName: {
    fontSize: 'var(--oc-fs-label)', color: '#4da6ff', padding: '8px 2px 6px',
    borderBottom: '1px solid #333', marginBottom: 6,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};
