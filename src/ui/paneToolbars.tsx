import type { CameraProjection, EditPreviewTier, TrimKind } from '@/model/types';
import type { GarmentEngine, CameraPreset } from '@/runtime';
import type { DisplayOptions } from '@/ui/viewport2D/render';

import {
  CompositeCommand, CreateFreeSeamCommand, validateGrading, seamCandidates, type SeamCandidate,
  type SeamScanResult, type SeamScanSkipped,
} from '@/commands';
import { TRIM_KIND_LABELS, TRIM_KINDS, validatePattern, elementNodeId, type PatternElementKind } from '@/model';
import { seamWarnings } from '@/pattern/seam';
import {
  displayModeOf, useProjectStore, useSimStore, useUIStore, usePerfStore, toggleWire, toggleProxy,
  toggleGirthLines, toggleSkeleton, DEFAULT_AUX, type AuxGroupMode, type ActiveAuxMode,
  type DisplayMode, type ToolType,
} from '@/store';
import {
  MARK_ITEMS, STRUCTURE_ITEMS, autoPlacePanels, runStructure, type StructureAction,
} from '@/ui/commands/patternOps';
import { Icon, type IconName } from '@/ui/icons';
import { comboOf } from '@/ui/menu/shortcuts';
import {
  CAMERA_PRESETS, CAMERA_PROJECTIONS, DISPLAY_LAYER_OPTIONS, DISPLAY_MODES, EDIT_PREVIEW_TIERS,
  WIRE_AUX_OPTIONS, PROXY_AUX_OPTIONS, GIRTH_LINES_AUX_OPTIONS, SKELETON_AUX_OPTIONS,
  rayTracingUnavailableReason,
} from '@/ui/optionTables';
import { reportActionError } from '@/ui/widgets/toast';
import { useLayoutEffect, useRef, useState, useMemo, type ReactNode, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';

const TOOLS_2D: ToolSpec[] = [
  { key: 'select', label: '选择', icon: 'select', hint: '单击选中 · Ctrl 加选' },
  { key: 'internalLine', label: '内部线', icon: 'internal-line', hint: '逐点单击 · Enter 结束' },
  { key: 'dart', label: '省道', icon: 'dart', hint: '点两条边与省尖' },
  { key: 'seam', label: '缝合', icon: 'seam', hint: '点两条边与端点' },
  { key: 'topstitch', label: '明线', icon: 'topstitch', hint: '单击轮廓边' },
];

const POINT_TOOLS: ToolSpec[] = [
  { key: 'point', label: '增加顶点', icon: 'add-point', hint: '单击轮廓边 · 靠近中点自动吸附' },
  { key: 'deletePoint', label: '删除顶点', icon: 'remove-point', hint: '单击顶点' },
];

const LINE_TOOLS: ToolSpec[] = [
  { key: 'line', label: '直线', icon: 'line', hint: '逐点单击 · 靠近水平/垂直自动对齐 · Shift 45° · Enter 闭合' },
  { key: 'curve', label: '曲线', icon: 'curve', hint: '逐点单击 · 靠近水平/垂直自动对齐 · Shift 45° · Enter 闭合' },
];

const SHAPE_TOOLS: ToolSpec[] = [
  { key: 'rect', label: '矩形', icon: 'rect', hint: '拖动绘制' },
  { key: 'circle', label: '圆', icon: 'circle', hint: '拖动绘制' },
  { key: 'ellipse', label: '椭圆', icon: 'ellipse', hint: '拖动绘制' },
];

const MARQUEE_KINDS: Array<{ kind: PatternElementKind; label: string }> = [
  { kind: 'panel', label: '版片' },
  { kind: 'point', label: '顶点' },
  { kind: 'edge', label: '轮廓边' },
  { kind: 'internal', label: '内部线' },
  { kind: 'dart', label: '省道' },
  { kind: 'seam', label: '缝合' },
  { kind: 'notch', label: '刀口' },
  { kind: 'annotation', label: '注释' },
  { kind: 'measurement', label: '尺寸线' },
  { kind: 'print', label: '印花' },
  { kind: 'topstitch', label: '明线' },
  { kind: 'trim', label: '辅料' },
];

const TOOLS_3D: Array<{ key: ToolType; label: string; icon: IconName; hint?: string }> = [
  { key: 'pin', label: '打PIN', icon: 'pin', hint: '悬停布料单击' },
  { key: 'unpin', label: '拔PIN', icon: 'unpin', hint: '单击已有 PIN' },
  { key: 'sketch3d', label: '线稿笔', icon: 'pen', hint: '在布料上拖动画线' },
  { key: 'measure3d', label: '测量', icon: 'ruler', hint: '点选布料两点' },
];

const VIEW_ITEMS = CAMERA_PRESETS.map(p => ({
  key: p.value,
  label: `${p.label} (${comboOf(p.menuId)})`,
}));

const PROJECTION_ITEMS = CAMERA_PROJECTIONS.map(p => ({ key: p.value, label: p.label }));

const TRANSFORM_ITEMS = [
  { key: 'translate', label: '平移 (W)' },
  { key: 'rotate', label: '旋转 (E)' },
  { key: 'scale', label: '缩放' },
];

const DISPLAY_ITEMS = DISPLAY_MODES.map(m => ({ key: m.value, label: m.label }));

const EDIT_PREVIEW_ITEMS = EDIT_PREVIEW_TIERS.map(tier => ({ key: tier.value, label: tier.label }));

const MENU_EDGE = 8;

const MENU_MIN_WIDTH = 300;

const MIN_PANEL_SPACE = 160;

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 34, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', background: '#202024', borderBottom: '1px solid #333', overflowX: 'auto', overflowY: 'hidden' },
  spacer: { flex: 1 },
  toolBtn: { flex: '0 0 auto', width: 26, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid transparent', borderRadius: 3, color: '#bbb', cursor: 'pointer' },
  toolBtnActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  toolBtnCounted: { width: 'auto', minWidth: 26, padding: '0 6px', gap: 4 },
  toolCount: { color: '#4da6ff', fontSize: 'var(--oc-fs-note)', fontVariantNumeric: 'tabular-nums' },
  textBtn: { flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 6px', background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)' },
  textBtnActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 900 },
  menuPopup: {
    position: 'fixed', width: 'max-content', minWidth: 140, overflowY: 'auto',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4, zIndex: 901,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', padding: '2px 0',
  },
  menuItem: { padding: '7px 12px', fontSize: 'var(--oc-fs-body)', color: '#ccc', cursor: 'pointer' },
  menuNote: { padding: '6px 12px', fontSize: 'var(--oc-fs-micro)', color: '#8a93a3', cursor: 'default', whiteSpace: 'normal', lineHeight: 1.5, maxWidth: 340 },
  menuItemDisabled: { color: '#666', cursor: 'default' },
  menuItemActive: { color: '#4da6ff', background: '#2a3a4a' },
  menuSep: { height: 1, background: '#3a3a42', margin: '3px 0' },
};

type ToolSpec = { key: ToolType; label: string; icon: IconName; hint?: string };

type CheckIssue = {
  code: string;
  targetId: string;
  message: string;
  kind: 'topology' | 'grading';
  severity?: 'error' | 'warning';
};

function displayItems(unavailable: string | null) {
  if (!unavailable) return DISPLAY_ITEMS;
  return DISPLAY_ITEMS.map(item => item.key === 'raytraced'
    ? { ...item, label: `${item.label}（不支持）`, disabled: true, note: unavailable }
    : item);
}

export function Toolbar2D() {
  const activeTool = useUIStore(s => s.activeTool);
  const setTool = useUIStore(s => s.setTool);
  const displayOptions = useUIStore(s => s.displayOptions);
  const setDisplayOption = useUIStore(s => s.setDisplayOption);
  const marqueeKinds = useUIStore(s => s.marqueeKinds);
  const setMarqueeKinds = useUIStore(s => s.setMarqueeKinds);
  const trimKind = useUIStore(s => s.trimKind);
  const setTrimKind = useUIStore(s => s.setTrimKind);
  const hiddenLayers = DISPLAY_LAYER_OPTIONS.filter(l => !displayOptions[l.key]);

  return (
    <div style={styles.bar}>
      {TOOLS_2D.slice(0, 1).map(t => (
        <ToolButton key={t.key} tool={t} active={activeTool === t.key} onPick={setTool} />
      ))}
      <ToolGroup tools={POINT_TOOLS} activeTool={activeTool} onPick={setTool} />
      <ToolGroup tools={LINE_TOOLS} activeTool={activeTool} onPick={setTool} />
      <ToolGroup tools={SHAPE_TOOLS} activeTool={activeTool} onPick={setTool} />
      {TOOLS_2D.slice(1).map(t => (
        <ToolButton key={t.key} tool={t} active={activeTool === t.key} onPick={setTool} />
      ))}
      <TrimTool
        active={activeTool === 'trim'}
        kind={trimKind}
        onPick={k => { setTrimKind(k); setTool('trim'); }}
      />
      <Dropdown
        label="结构"
        items={STRUCTURE_ITEMS.map(i => ({
          key: i.key,
          label: `${structureChecked(i.key, activeTool) ? '✓ ' : '　'}${i.label}`,
          note: i.hint,
        }))}
        onPick={key => void runStructure(key as StructureAction)}
      />
      <Dropdown
        label="标记"
        items={MARK_ITEMS.map(m => ({
          key: m.key,
          label: `${activeTool === m.key ? '✓ ' : '　'}${m.label}`,
          note: m.hint,
        }))}
        onPick={key => setTool(key as ToolType)}
      />

      <ProblemMenu />
      <AutoMenu />
      <div style={styles.spacer} />
      <ToggleMenu
        icon="marquee"
        label="框选"
        title={marqueeKinds.length === 0 ? '框选：不收集对象' : `框选 · ${marqueeLabels(marqueeKinds)}`}
        items={MARQUEE_KINDS.map(({ kind, label }) => ({ key: kind, label, checked: marqueeKinds.includes(kind) }))}
        onToggle={key => {
          const kind = key as PatternElementKind;
          setMarqueeKinds(marqueeKinds.includes(kind)
            ? marqueeKinds.filter(k => k !== kind)
            : [...marqueeKinds, kind]);
        }}
      />
      <ToggleMenu
        icon="eye"
        label="图层"
        title={hiddenLayers.length === 0 ? '图层 · 全部显示' : `图层 · 已隐藏：${hiddenLayers.map(l => l.label).join('、')}`}
        items={DISPLAY_LAYER_OPTIONS.map(l => ({ key: l.key, label: l.label, checked: displayOptions[l.key] }))}
        onToggle={key => setDisplayOption(key as keyof DisplayOptions, !displayOptions[key as keyof DisplayOptions])}
      />
    </div>
  );
}

function marqueeLabels(kinds: PatternElementKind[]): string {
  return MARQUEE_KINDS.filter(k => kinds.includes(k.kind)).map(k => k.label).join('、');
}

function structureChecked(action: StructureAction, activeTool: ToolType): boolean {
  return action === 'split' ? activeTool === 'split' : action === 'hole' ? activeTool === 'hole' : false;
}

function ProblemMenu() {
  const [issues, setIssues] = useState<CheckIssue[] | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const open = () => {
    const project = useProjectStore.getState().project;
    setIssues([
      ...validatePattern(project.pattern).map(i => ({ ...i, kind: 'topology' as const })),
      ...seamWarnings(project.pattern).map(i => ({ ...i, kind: 'topology' as const })),
      ...validateGrading(project.pattern, project.sizes ?? []).map(i => ({ ...i, kind: 'grading' as const, code: 'grading' })),
    ]);
  };

  const pick = (issue: CheckIssue) => {
    const pattern = useProjectStore.getState().project.pattern;
    const row = pattern.edges[issue.targetId]
      ? elementNodeId('edge', issue.targetId)
      : pattern.panels[issue.targetId] ? issue.targetId
        : pattern.seams[issue.targetId] ? elementNodeId('seam', issue.targetId)
          : pattern.darts[issue.targetId] ? elementNodeId('dart', issue.targetId)
            : issue.targetId;
    useUIStore.getState().select([row]);
  };

  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button style={styles.textBtn} title="检查问题" onClick={() => (issues === null ? open() : setIssues(null))}>
        问题<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} />
      </button>
      <MenuPopup open={issues !== null} anchor={anchorRef} onClose={() => setIssues(null)}>
        {issues?.length === 0 && <div style={styles.menuItem}>未发现问题</div>}
        {issues?.map((issue, i) => (
          <div key={`${issue.code}-${issue.targetId}-${i}`} style={styles.menuItem} title={issue.message}
            onClick={() => { pick(issue); setIssues(null); }}>
            {issue.severity === 'warning' ? '警告：' : ''}{issue.message}
          </div>
        ))}
      </MenuPopup>
    </div>
  );
}

function AutoMenu() {
  const [scan, setScan] = useState<SeamScanResult | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const candidates = scan?.candidates ?? null;

  const accept = (candidate: SeamCandidate) => {
    try {
      useProjectStore.getState().executeCommand(new CreateFreeSeamCommand(
        candidate.a.edgeId, candidate.a.t0, candidate.a.t1,
        candidate.b.edgeId, candidate.b.t0, candidate.b.t1,
        { ...(candidate.flip ? { flip: true } : {}), ...(candidate.gatherRatio ? { gatherRatio: candidate.gatherRatio } : {}) },
      ));
    } catch (err) {
      reportActionError(err);
    }
  };

  const acceptAll = () => {
    if (!candidates) return;
    const cmds = candidates.map(c => new CreateFreeSeamCommand(
      c.a.edgeId, c.a.t0, c.a.t1, c.b.edgeId, c.b.t0, c.b.t1,
      { ...(c.flip ? { flip: true } : {}), ...(c.gatherRatio ? { gatherRatio: c.gatherRatio } : {}) },
    ));
    setScan(null);
    if (cmds.length === 0) return;
    try {
      useProjectStore.getState().executeCommand(new CompositeCommand('自动缝合全部建议', cmds));
    } catch (err) {
      reportActionError(err);
    }
  };

  const toggle = () => {
    if (scan !== null) { setScan(null); return; }
    const pattern = useProjectStore.getState().project.pattern;
    try {
      setScan(seamCandidates(pattern, { skipExistingSeams: true }));
    } catch (err) {
      reportActionError(err);
      setScan({ candidates: [], skipped: { unlabeled: 0, alreadySeamed: 0, multiEdge: 0 } });
    }
  };

  const skippedNote = scan ? seamSkippedNote(scan.skipped) : null;

  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button style={styles.textBtn} title="自动排位与缝合" onClick={toggle}>
        自动<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} />
      </button>
      <MenuPopup open={scan !== null} anchor={anchorRef} onClose={() => setScan(null)}>
        <div style={styles.menuItem} onClick={() => { autoPlacePanels(); setScan(null); }}>自动排位</div>
        {candidates?.length === 0 && <div style={styles.menuItem}>没有可匹配的缝合建议</div>}
        {candidates?.length === 0 && scan && <div style={styles.menuNote}>{seamEmptyHint(scan.skipped)}</div>}
        {candidates !== null && candidates.length > 0 && skippedNote && (
          <div style={styles.menuNote}>{skippedNote}</div>
        )}
        {candidates !== null && candidates.length > 1 && (
          <div style={styles.menuItem} onClick={acceptAll}>全部接受（{candidates.length} 条）</div>
        )}
        {candidates?.map((c, i) => (
          <div key={`${c.a.edgeId}-${c.b.edgeId}-${i}`} style={styles.menuItem} title={`${c.reason}｜评分 ${c.score.toFixed(2)}`}
            onClick={() => { accept(c); setScan(null); }}>
            {c.reason} · {c.score.toFixed(2)}
          </div>
        ))}
      </MenuPopup>
    </div>
  );
}

function seamSkippedNote(skipped: SeamScanSkipped): string | null {
  const parts: string[] = [];
  if (skipped.alreadySeamed > 0) parts.push(`${skipped.alreadySeamed} 条已有缝口的边`);
  if (skipped.unlabeled > 0) parts.push(`${skipped.unlabeled} 条无语义标注的边`);
  if (skipped.multiEdge > 0) parts.push(`${skipped.multiEdge} 组配对仅取最高分`);
  return parts.length > 0 ? `已跳过：${parts.join('、')}` : null;
}

function seamEmptyHint(skipped: SeamScanSkipped): string {
  if (skipped.unlabeled > 0) return '多数边没有语义标注';
  if (skipped.alreadySeamed > 0) return '可匹配的边都已有缝口';
  return '长度与方向差异过大';
}

export function Toolbar3D({ engineRef }: { engineRef: MutableRefObject<GarmentEngine | null> }) {
  const activeTool = useUIStore(s => s.activeTool);
  const toggleTool = useUIStore(s => s.toggleTool);
  const displayMode = useUIStore(displayModeOf);
  const setDisplayMode = useUIStore(s => s.setDisplayMode);
  const projection = useUIStore(s => s.cameraProjection);
  const setCameraProjection = useUIStore(s => s.setCameraProjection);
  const editPreview = useUIStore(s => s.editPreview);
  const setEditPreview = useUIStore(s => s.setEditPreview);
  const transformMode = useUIStore(s => s.transformMode);
  const setTransformMode = useUIStore(s => s.setTransformMode);
  const pinsVersion = useSimStore(s => s.pinsVersion);
  const rayUnavailable = rayTracingUnavailableReason(usePerfStore(s => s.rayUnsupported3D));

  const pinCount = useMemo(
    () => engineRef.current?.getPinMarkers().length ?? 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinsVersion],
  );

  return (
    <div style={styles.bar}>
      <ToolMenu
        icon="move"
        label="变换"
        title={`变换 · ${TRANSFORM_ITEMS.find(item => item.key === transformMode)?.label ?? ''}`}
        options={TRANSFORM_ITEMS.map(item => ({
          key: item.key, label: item.label, disabled: item.key === 'scale',
        }))}
        current={transformMode}
        onPick={key => setTransformMode(key as typeof transformMode)}
      />
      {TOOLS_3D.map(t => (
        <ToolButton
          key={t.key}
          tool={t}
          active={activeTool === t.key}
          onPick={toggleTool}
          toggle
          badge={t.key === 'pin' && pinCount > 0 ? { count: pinCount, label: `已打 ${pinCount} 个` } : undefined}
        />
      ))}
      <div style={styles.spacer} />
      <Dropdown
        label="视角"
        items={VIEW_ITEMS}
        onPick={key => engineRef.current?.setCameraPreset(key as CameraPreset)}
      />
      <Dropdown
        label="投影"
        items={PROJECTION_ITEMS}
        value={projection}
        onPick={key => setCameraProjection(key as CameraProjection)}
      />
      <Dropdown
        label="显示"
        items={displayItems(rayUnavailable)}
        value={displayMode}
        onPick={key => setDisplayMode(key as DisplayMode)}
      />
      <AuxMenu />
      <Dropdown
        label="预览"
        items={EDIT_PREVIEW_ITEMS}
        value={editPreview}
        onPick={key => setEditPreview(key as EditPreviewTier)}
      />
    </div>
  );
}

function ToolButton({ tool, active, onPick, badge, toggle }: {
  tool: { key: ToolType; label: string; icon: IconName; hint?: string };
  active: boolean;
  onPick: (t: ToolType) => void;
  badge?: { count: number; label: string };
  toggle?: boolean;
}) {
  const hover = [tool.label, tool.hint, badge?.label].filter(Boolean).join(' · ');
  return (
    <button
      style={{
        ...styles.toolBtn,
        ...(badge ? styles.toolBtnCounted : null),
        ...(active ? styles.toolBtnActive : null),
      }}
      title={toggle && active ? `${hover} · 再点取消` : hover}
      aria-label={tool.label}
      aria-pressed={active}
      onClick={() => onPick(tool.key)}
    >
      <Icon name={tool.icon} size={15} />
      {badge ? <span style={styles.toolCount}>{badge.count}</span> : null}
    </button>
  );
}

function ToolGroup({ tools, activeTool, onPick }: {
  tools: ToolSpec[];
  activeTool: ToolType;
  onPick: (t: ToolType) => void;
}) {
  const current = tools.find(t => t.key === activeTool) ?? tools[0]!;
  return (
    <ToolMenu
      icon={current.icon}
      title={[current.label, current.hint].filter(Boolean).join(' · ')}
      options={tools.map(t => ({ key: t.key, label: t.label, hint: t.hint }))}
      current={tools.some(t => t.key === activeTool) ? activeTool : ''}
      onPick={key => onPick(key as ToolType)}
    />
  );
}

function TrimTool({ active, kind, onPick }: {
  active: boolean;
  kind: TrimKind;
  onPick: (kind: TrimKind) => void;
}) {
  return (
    <ToolMenu
      icon="trim"
      title={`${TRIM_KIND_LABELS[kind]} · 单击版片`}
      options={TRIM_KINDS.map(k => ({ key: k, label: TRIM_KIND_LABELS[k] }))}
      current={active ? kind : ''}
      onPick={key => onPick(key as TrimKind)}
    />
  );
}

function ToolMenu({ icon, label, title, options, current, onPick }: {
  icon: IconName;
  label?: string;
  title: string;
  options: Array<{ key: string; label: string; hint?: string; disabled?: boolean }>;
  current: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button
        style={{ ...styles.toolBtn, width: 34, ...(current ? styles.toolBtnActive : null) }}
        title={title}
        aria-label={label}
        aria-pressed={current !== ''}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={icon} size={15} />
        <Icon name="chevron-down" size={8} style={{ marginLeft: 1, opacity: 0.75 }} />
      </button>
      <MenuPopup open={open} anchor={anchorRef} onClose={() => setOpen(false)}>
        {options.map(o => (
          <div
            key={o.key}
            title={o.hint}
            style={{
              ...styles.menuItem, ...(o.disabled ? styles.menuItemDisabled : null),
              ...(o.key === current ? styles.menuItemActive : null),
            }}
            onClick={() => { if (o.disabled) return; onPick(o.key); setOpen(false); }}
          >
            {o.key === current ? '✓ ' : '　'}{o.label}
          </div>
        ))}
      </MenuPopup>
    </div>
  );
}

function ToggleMenu({ icon, label, title, items, onToggle }: {
  icon: IconName;
  label: string;
  title: string;
  items: Array<{ key: string; label: string; checked: boolean }>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button
        style={{ ...styles.toolBtn, width: 34 }}
        title={title}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={icon} size={15} />
        <Icon name="chevron-down" size={8} style={{ marginLeft: 1, opacity: 0.75 }} />
      </button>
      <MenuPopup open={open} anchor={anchorRef} onClose={() => setOpen(false)}>
        {items.map(item => (
          <div
            key={item.key}
            style={{ ...styles.menuItem, ...(item.checked ? styles.menuItemActive : null) }}
            onClick={() => onToggle(item.key)}
          >
            {item.checked ? '✓ ' : '　'}{item.label}
          </div>
        ))}
      </MenuPopup>
    </div>
  );
}

function Dropdown({ label, items, value, onPick, title }: {
  label: string;
  items: Array<{ key: string; label: string; disabled?: boolean; note?: string }>;
  value?: string;
  onPick: (key: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button
        style={styles.textBtn}
        title={title ?? label}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
      >
        {label}
        <Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} />
      </button>
      <MenuPopup open={open} anchor={anchorRef} onClose={() => setOpen(false)}>
        {items.map(item => (
          <div
            key={item.key}
            title={item.note}
            style={{ ...styles.menuItem, ...(item.disabled ? styles.menuItemDisabled : null), ...(item.key === value ? styles.menuItemActive : null) }}
            onClick={() => { if (item.disabled) return; onPick(item.key); setOpen(false); }}
          >
            {item.label}
          </div>
        ))}
      </MenuPopup>
    </div>
  );
}

function AuxMenu() {
  const aux = useUIStore(s => s.aux);
  const setAux = useUIStore(s => s.setAux);
  const measured = useProjectStore(s => s.project.avatar.source !== 'glb');
  const shown = measured ? aux : { ...aux, girthLines: 'off' as const, skeleton: 'off' as const };
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const active = shown.wire !== 'off' || shown.proxy !== 'off'
    || shown.girthLines !== 'off' || shown.skeleton !== 'off';
  const anySet = aux.wire !== 'off' || aux.proxy !== 'off'
    || aux.girthLines !== 'off' || aux.skeleton !== 'off';
  const summary = [
    shown.wire !== 'off' ? `线框：${auxLabel(WIRE_AUX_OPTIONS, shown.wire)}` : null,
    shown.proxy !== 'off' ? `简模：${auxLabel(PROXY_AUX_OPTIONS, shown.proxy)}` : null,
    shown.girthLines !== 'off' ? `围度线：${auxLabel(GIRTH_LINES_AUX_OPTIONS, shown.girthLines)}` : null,
    shown.skeleton !== 'off' ? `骨架：${auxLabel(SKELETON_AUX_OPTIONS, shown.skeleton)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button
        style={{ ...styles.textBtn, ...(active ? styles.textBtnActive : null) }}
        title={active ? `辅助 · ${summary}` : '辅助：版片线框、模特简模、身体围度线与关节骨架'}
        aria-label="辅助"
        aria-pressed={active}
        onClick={() => setOpen(o => !o)}
      >
        辅助
        <Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} />
      </button>
      <MenuPopup open={open} anchor={anchorRef} onClose={() => setOpen(false)}>
        <AuxGroup options={WIRE_AUX_OPTIONS} current={aux.wire}
          onPick={mode => setAux(toggleWire(aux, mode))} />
        <div style={styles.menuSep} />
        <AuxGroup options={PROXY_AUX_OPTIONS} current={aux.proxy}
          onPick={mode => setAux(toggleProxy(aux, mode))} />
        <div style={styles.menuSep} />
        <AuxGroup options={GIRTH_LINES_AUX_OPTIONS} current={shown.girthLines}
          disabled={!measured} onPick={mode => setAux(toggleGirthLines(aux, mode))} />
        <div style={styles.menuSep} />
        <AuxGroup options={SKELETON_AUX_OPTIONS} current={shown.skeleton}
          disabled={!measured} onPick={mode => setAux(toggleSkeleton(aux, mode))} />
        {!measured && (
          <div style={styles.menuNote}>导入的模特没有测量体，围度线与骨架不可用</div>
        )}
        {anySet && (
          <>
            <div style={styles.menuSep} />
            <div style={styles.menuItem} onClick={() => setAux({ ...DEFAULT_AUX })}>
              {'　'}全部关闭
            </div>
          </>
        )}
      </MenuPopup>
    </div>
  );
}

function AuxGroup({ options, current, onPick, disabled }: {
  options: Array<{ value: AuxGroupMode; label: string }>;
  current: AuxGroupMode;
  onPick: (mode: ActiveAuxMode) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {options.filter(o => o.value !== 'off').map(o => (
        <div
          key={o.value}
          style={{
            ...styles.menuItem,
            ...(disabled ? styles.menuItemDisabled : null),
            ...(!disabled && o.value === current ? styles.menuItemActive : null),
          }}
          onClick={disabled ? undefined : () => onPick(o.value as ActiveAuxMode)}
        >
          {!disabled && o.value === current ? '✓ ' : '　'}{o.label}
        </div>
      ))}
    </>
  );
}

function auxLabel(options: Array<{ value: AuxGroupMode; label: string }>, value: AuxGroupMode): string {
  return options.find(o => o.value === value)?.label ?? '';
}

function MenuPopup({ open, anchor, onClose, children }: {
  open: boolean;
  anchor: MutableRefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open) { setRect(null); return; }
    setRect(anchor.current?.getBoundingClientRect() ?? null);
  }, [open, anchor]);

  if (!open || rect === null) return null;
  const spaceBelow = window.innerHeight - rect.bottom;
  const upward = spaceBelow < MIN_PANEL_SPACE;
  const right = Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_MIN_WIDTH - MENU_EDGE);
  return createPortal(
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div
        style={{
          ...styles.menuPopup,
          right,
          maxWidth: window.innerWidth - right - MENU_EDGE,
          ...(upward
            ? { bottom: window.innerHeight - rect.top + 2, maxHeight: rect.top - MENU_EDGE }
            : { top: rect.bottom + 2, maxHeight: spaceBelow - MENU_EDGE }),
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
