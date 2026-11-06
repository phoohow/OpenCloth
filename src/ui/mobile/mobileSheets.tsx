import { useEffect, useState, type ReactNode } from 'react';
import type { MenuActions } from '@/ui/menu/actions';
import { formatSavedAt } from '@/ui/timeFormat';
import { CAMERA_PRESETS, CAMERA_PROJECTIONS, DISPLAY_MODES, PROP_TAB_OPTIONS, rayTracingUnavailableReason } from '@/ui/optionTables';
import { usePropsTarget } from '@/ui/panels/propertiesEditor';
import { Icon } from '@/ui/icons';
import { displayModeOf, usePerfStore, useProjectStore, useSimStore, useUIStore } from '@/store';
import type { PropTab } from '@/store';
import { DEFAULT_COMPRESSION_LIMIT, DEFAULT_STRETCH_LIMIT, normalizeRayTracing } from '@/model';
import type { CameraProjection } from '@/model/types';
import type { CameraPreset } from '@/runtime';
import { DEFAULT_PRESSURE_KPA_PER_MM, fitReportCsv, pressureReportCsv, strainReportCsv } from '@/analysis';
import { downloadTextFile } from '@/io/serialization';
import { setRayTracingConfig, type EngineRef } from '@/ui/sceneCommands';

/** Sheets the phone shell can slide up; null keeps the viewport full screen. */
export type MobileSheetId = 'menu' | 'view' | 'display' | 'props' | null;

/** The properties tabs offered on the phone, in rail order. */
const MOBILE_PROP_TAB_KEYS: PropTab[] = ['object', 'material', 'simulator', 'transform', 'project'];

/** Modes with controls in this sheet keep it open; the remaining modes close after selection. */
const IN_PLACE_MODES: ReadonlySet<string> = new Set(['raytraced', 'fitHeatmap', 'strainHeatmap', 'pressureHeatmap']);

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
          <button style={styles.closeBtn} onClick={onClose} title="关闭" aria-label="关闭">
            <span style={styles.closeBtnFace}><Icon name="close" size={18} /></span>
          </button>
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

/** Full-width action inside a sheet section, sized for touch. */
function WideAction({ label, onClick }: { label: string; onClick: () => void }) {
  return <button style={styles.wideAction} onClick={onClick}>{label}</button>;
}

/** Camera presets, projection and framing — the controls the floating 视图 button opens. */
function ViewSheet({ actions, engineRef, onClose }: {
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

/** Shading mode, ray tracing and the three analysis heatmaps — the floating 显示 button. */
function DisplaySheet({ onClose }: { onClose: () => void }) {
  const displayMode = useUIStore(displayModeOf);
  const setDisplayMode = useUIStore(s => s.setDisplayMode);
  const rayUnavailable = rayTracingUnavailableReason(usePerfStore(s => s.rayUnsupported3D));
  const fitOn = displayMode === 'fitHeatmap';
  const fitTightCm = useUIStore(s => s.fitTightCm);
  const fitLooseCm = useUIStore(s => s.fitLooseCm);
  const setFitThresholds = useUIStore(s => s.setFitThresholds);
  const fitStats = useSimStore(s => s.fitStats);
  const strainOn = displayMode === 'strainHeatmap';
  const strainMin = useUIStore(s => s.strainMin);
  const strainMax = useUIStore(s => s.strainMax);
  const setStrainRange = useUIStore(s => s.setStrainRange);
  const strainByFabric = useUIStore(s => s.strainByFabric);
  const setStrainByFabric = useUIStore(s => s.setStrainByFabric);
  const strainStats = useSimStore(s => s.strainStats);
  const pressureOn = displayMode === 'pressureHeatmap';
  const pressureMaxKpa = useUIStore(s => s.pressureMaxKpa);
  const setPressureMaxKpa = useUIStore(s => s.setPressureMaxKpa);
  const pressureStats = useSimStore(s => s.pressureStats);
  const project = useProjectStore(s => s.project);
  const [rayOpen, setRayOpen] = useState(false);
  const ray = normalizeRayTracing(project.scene.render.rayTracing);
  const fabricLimits = Object.values(project.fabrics).map(fabric => ({
    name: fabric.name,
    stretchLimit: fabric.physics.stretchLimit ?? DEFAULT_STRETCH_LIMIT,
    compressionLimit: fabric.physics.compressionLimit ?? DEFAULT_COMPRESSION_LIMIT,
  }));

  return (
    <>
      <SheetGroup title="显示模式">
        {DISPLAY_MODES.map(mode => (
          <SheetButton
            key={mode.value}
            label={mode.value === 'raytraced' && rayUnavailable ? `${mode.label}（不支持）` : mode.label}
            hint={mode.value === 'raytraced' ? rayUnavailable ?? undefined : undefined}
            disabled={mode.value === 'raytraced' && !!rayUnavailable}
            active={displayMode === mode.value}
            onClick={() => {
              setDisplayMode(mode.value);
              if (!IN_PLACE_MODES.has(mode.value)) onClose();
            }}
          />
        ))}
      </SheetGroup>
      {displayMode === 'raytraced' && (
        <div style={styles.advanced}>
          <button
            style={styles.advancedHead}
            aria-expanded={rayOpen}
            onClick={() => setRayOpen(open => !open)}
          >
            <Icon name={rayOpen ? 'chevron-down' : 'chevron-right'} size={16} />
            <span>光线追踪高级</span>
          </button>
          {rayOpen && (
            <>
              <label style={styles.rangeRow}>
                <span>最大弹射次数 {ray.maxBounces}</span>
                <input type="range" min={1} max={16} step={1} value={ray.maxBounces}
                  onChange={e => setRayTracingConfig('修改光追弹射次数', { maxBounces: Number(e.target.value) })} />
              </label>
              <label style={styles.rangeRow}>
                <span>每帧路径预算 {Math.round(ray.frameBudget / 1000)}k</span>
                <input type="range" min={50} max={1000} step={10} value={ray.frameBudget / 1000}
                  onChange={e => setRayTracingConfig('修改光追每帧预算', { frameBudget: Math.round(Number(e.target.value) * 1000) })} />
              </label>
            </>
          )}
        </div>
      )}
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
            <>
              <SheetNote>
                穿透 {fitStats.penetration} · 贴近 {fitStats.tight} · 合适 {fitStats.ideal} · 宽松 {fitStats.loose}
                ；间隙 {fitStats.minCm.toFixed(2)} / {fitStats.meanCm.toFixed(2)} / {fitStats.maxCm.toFixed(2)} cm。
              </SheetNote>
              <WideAction
                label="导出合身报告 CSV"
                onClick={() => downloadTextFile(
                  `${project.meta.name}-合身报告.csv`,
                  '\ufeff' + fitReportCsv(project.meta.name, fitStats, { tightCm: fitTightCm, looseCm: fitLooseCm }),
                  'text/csv;charset=utf-8',
                )}
              />
            </>
          )}
        </>
      )}
      {strainOn && (
        <>
          <label style={{ ...styles.rangeRow, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={strainByFabric} onChange={e => setStrainByFabric(e.target.checked)} />
            <span>按面料上限着色</span>
          </label>
          {!strainByFabric && (
            <>
              <label style={styles.rangeRow}>
                <span>色标下限 {strainMin.toFixed(2)}</span>
                <input type="range" min={-1} max={0} step={0.05} value={strainMin}
                  onChange={e => setStrainRange(Number(e.target.value), strainMax)} />
              </label>
              <label style={styles.rangeRow}>
                <span>色标上限 {strainMax.toFixed(2)}</span>
                <input type="range" min={0} max={1} step={0.05} value={strainMax}
                  onChange={e => setStrainRange(strainMin, Number(e.target.value))} />
              </label>
            </>
          )}
          {strainStats && (
            <>
              <SheetNote>
                应变 最小/最大/平均 {strainStats.min.toFixed(4)} / {strainStats.max.toFixed(4)} / {strainStats.meanAbs.toFixed(4)}
                {strainByFabric && `；超限 拉伸/压缩 ${strainStats.overStretch} / ${strainStats.overCompression}`}
              </SheetNote>
              <WideAction
                label="导出应变报告 CSV"
                onClick={() => downloadTextFile(
                  `${project.meta.name}-应变报告.csv`,
                  '\ufeff' + strainReportCsv(
                    project.meta.name, strainStats, { min: strainMin, max: strainMax },
                    { mode: strainByFabric ? 'fabric' : 'manual', fabrics: fabricLimits },
                  ),
                  'text/csv;charset=utf-8',
                )}
              />
            </>
          )}
        </>
      )}
      {pressureOn && (
        <>
          <label style={styles.rangeRow}>
            <span>色标上限 {pressureMaxKpa.toFixed(1)} kPa</span>
            <input type="range" min={0.5} max={20} step={0.5} value={pressureMaxKpa}
              onChange={e => setPressureMaxKpa(Number(e.target.value))} />
          </label>
          {pressureStats && (
            <>
              <SheetNote>
                顶点/接触 {pressureStats.vertices} / {pressureStats.contactVertices}
                ；压力 最小/平均/最大 {pressureStats.minKpa.toFixed(2)} / {pressureStats.meanKpa.toFixed(2)} / {pressureStats.maxKpa.toFixed(2)} kPa。
              </SheetNote>
              <WideAction
                label="导出压力报告 CSV"
                onClick={() => downloadTextFile(
                  `${project.meta.name}-压力报告.csv`,
                  '\ufeff' + pressureReportCsv(project.meta.name, pressureStats, {
                    maxKpa: pressureMaxKpa,
                    kpaPerMm: DEFAULT_PRESSURE_KPA_PER_MM,
                    panelNames: Object.fromEntries(
                      Object.values(project.pattern.panels).map(panel => [panel.id, panel.name]),
                    ),
                  }),
                  'text/csv;charset=utf-8',
                )}
              />
            </>
          )}
        </>
      )}
      <SheetNote>着色为常规预览；光线追踪按渐进采样出图，手机上建议先暂停模拟再看收敛结果。三种热图（合身 / 应变 / 压力）按各自阈值或色标上限着色，切回其它显示模式即恢复面料材质。</SheetNote>
    </>
  );
}

/** Object, material, simulator, transform and project properties for the selected thing. */
function PropsSheet({ engineRef }: { engineRef: EngineRef }) {
  const setPropTab = useUIStore(s => s.setPropTab);
  const target = usePropsTarget(engineRef, MOBILE_PROP_TAB_KEYS);

  return (
    <>
      <div style={styles.tabStrip}>
        {PROP_TAB_OPTIONS
          .filter(option => MOBILE_PROP_TAB_KEYS.includes(option.key))
          .map(option => {
            const enabled = target.allowedTabs.includes(option.key);
            const active = enabled && target.tab === option.key;
            return (
              <button
                key={option.key}
                style={{ ...styles.tab, ...(active ? styles.tabActive : null), ...(enabled ? null : styles.tabDisabled) }}
                disabled={!enabled}
                title={option.label}
                aria-label={option.label}
                aria-pressed={active}
                onClick={() => setPropTab(option.key as PropTab)}
              >
                <Icon name={option.icon} size={20} />
              </button>
            );
          })}
      </div>
      <div style={styles.propsObjectName}>{target.objectName}</div>
      <div key={target.bodyKey}>{target.body}</div>
    </>
  );
}

/** Everything that is not a dock action: files, recent projects, scene, selection, export and help. */
function MenuSheet({ actions, onClose }: { actions: MenuActions; onClose: () => void }) {
  const project = useProjectStore(s => s.project);
  const recent = useProjectStore(s => s.recent);
  const history = useProjectStore(s => s.history);
  const selection = useUIStore(s => s.selection);
  const lastAutosaveAt = useUIStore(s => s.lastAutosaveAt);

  const panels = project.pattern.panels;
  const panelIds = Object.keys(panels);

  return (
    <>
      <SheetGroup title="文件">
        <SheetButton label="打开" onClick={() => { actions.openProject(); onClose(); }} />
        <SheetButton label="保存" onClick={actions.saveProject} />
        <SheetButton label="另存为" onClick={actions.saveProjectAs} />
        <SheetButton
          label={lastAutosaveAt ? `从快照恢复（${formatSavedAt(lastAutosaveAt)}）` : '从快照恢复'}
          disabled={!lastAutosaveAt}
          onClick={() => { actions.restoreAutosave(); onClose(); }}
        />
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
      <SheetGroup title="场景">
        <SheetButton label="模特模型" onClick={actions.importAvatar} />
        <SheetButton label="参考物体" onClick={actions.importReference} />
        <SheetButton label="环境贴图" onClick={actions.importEnvironment} />
      </SheetGroup>
      <SheetGroup title="选择 · 编辑">
        <SheetButton label="撤销" hint={history.lastLabel ?? undefined} disabled={!history.canUndo} onClick={actions.undo} />
        <SheetButton label="重做" hint={history.nextLabel ?? undefined} disabled={!history.canRedo} onClick={actions.redo} />
        <SheetButton label="全选版片" disabled={panelIds.length === 0} onClick={actions.selectAllPanels} />
        <SheetButton label="取消选择" disabled={selection.length === 0} onClick={actions.clearSelection} />
        <SheetButton label="删除选中" disabled={selection.length === 0} onClick={actions.deleteSelection} />
      </SheetGroup>
      <SheetGroup title="导出">
        <SheetButton label="服装 GLB" onClick={actions.exportGlb} />
        <SheetButton label="服装 OBJ" onClick={actions.exportObj} />
        <SheetButton label="截图 PNG" onClick={actions.screenshot} />
        <SheetButton label="动画 WebM" onClick={actions.exportAnimation} />
      </SheetGroup>
      <SheetGroup title="帮助">
        <SheetButton label="关于" onClick={() => { actions.showAbout(); onClose(); }} />
      </SheetGroup>
      <SheetNote>手机专注试衣调参；改版、打 PIN 与工程管理请用电脑端打开同一个 .ocproj.json 工程。</SheetNote>
    </>
  );
}

const SHEET_TITLES: Record<Exclude<MobileSheetId, null>, string> = {
  menu: '菜单',
  view: '视图',
  display: '显示',
  props: '参数',
};

/** The sheet the phone dock and the floating view button open. */
export function MobileSheet({ sheet, onClose, actions, engineRef }: {
  sheet: MobileSheetId;
  onClose: () => void;
  actions: MenuActions;
  engineRef: EngineRef;
}) {
  if (!sheet) return null;
  return (
    <Sheet title={SHEET_TITLES[sheet]} onClose={onClose}>
      {sheet === 'view' && <ViewSheet actions={actions} engineRef={engineRef} onClose={onClose} />}
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
    height: '45dvh', minHeight: 200,
    background: '#232328', borderTopLeftRadius: 14, borderTopRightRadius: 14,
    borderTop: '1px solid #3a3a42', boxShadow: '0 -12px 32px rgba(0,0,0,0.55)',
    paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
  },
  grabber: { width: 42, height: 4, borderRadius: 2, background: '#4a4a52', margin: '8px auto 2px', flex: '0 0 auto' },
  sheetHead: {
    position: 'relative',
    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
    padding: '4px 14px 8px', borderBottom: '1px solid #333',
  },
  sheetTitle: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1,
    pointerEvents: 'none',
  },
  closeBtn: {
    position: 'relative', zIndex: 1, marginLeft: 'auto',
    flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer',
  },
  closeBtnFace: {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 6,
  },
  sheetBody: {
    flex: '1 1 auto', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    padding: '4px 12px 12px',
  },
  group: { marginTop: 12 },
  groupTitle: { fontSize: 'var(--oc-fs-body)', color: '#7d7d88', letterSpacing: 1, margin: '0 2px 6px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 5 },
  cell: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 2,
    minHeight: 44, padding: '6px 5px', textAlign: 'left',
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
  advanced: {
    marginTop: 10, marginBottom: 2, padding: '0 8px 2px',
    background: '#232327', border: '1px solid #333', borderRadius: 6,
  },
  advancedHead: {
    width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 6,
    padding: 0, background: 'transparent', border: 'none', textAlign: 'left',
    color: '#bbb', fontSize: 'var(--oc-fs-heading)', cursor: 'pointer',
  },
  wideAction: {
    width: '100%', minHeight: 44, margin: '8px 0 2px', padding: '0 12px',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 6,
    color: '#ddd', fontSize: 'var(--oc-fs-heading)', textAlign: 'left', cursor: 'pointer',
  },
  tabStrip: {
    display: 'flex', justifyContent: 'center', gap: 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
    padding: '7px 0 5px', borderBottom: '1px solid #333',
  },
  tab: {
    flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 6,
    color: '#ccc', fontSize: 'var(--oc-fs-label)', cursor: 'pointer',
  },
  tabActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  tabDisabled: { opacity: 0.35, cursor: 'default' },
  propsObjectName: {
    fontSize: 'var(--oc-fs-label)', color: '#4da6ff', padding: '6px 2px 5px',
    borderBottom: '1px solid #333', marginBottom: 6,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};
