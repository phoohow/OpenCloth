import { useLayoutEffect, useRef, useState, useMemo, type ReactNode, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  displayModeOf, useProjectStore, useSimStore, useUIStore, usePerfStore, type DisplayMode, type ToolType,
} from '@/store';
import type { GarmentEngine, CameraPreset } from '@/runtime';
import type { CameraProjection, EditPreviewTier, WireMode } from '@/model/types';
import {
  CompositeCommand, CreateFreeSeamCommand, validateGrading,
} from '@/commands';
import { seamCandidates, type SeamCandidate, type SeamScanResult, type SeamScanSkipped } from '@/pattern/auto';
import { MARK_ITEMS, STRUCTURE_ITEMS, autoPlacePanels, runStructure, type StructureAction } from '@/ui/commands/patternOps';
import { TRIM_KIND_LABELS, TRIM_KINDS } from '@/model';
import type { TrimKind } from '@/model/types';
import { validatePattern } from '@/model';
import { seamWarnings } from '@/pattern/seam';
import { elementNodeId, type PatternElementKind } from '@/model';
import type { DisplayOptions } from '@/ui/viewport2D/render';
import {
  CAMERA_PRESETS, CAMERA_PROJECTIONS, DISPLAY_LAYER_OPTIONS, DISPLAY_MODES, EDIT_PREVIEW_TIERS,
  WIRE_MODES,
  rayTracingUnavailableReason,
} from '@/ui/optionTables';
import { comboOf } from '@/ui/menu/shortcuts';
import { Icon, type IconName } from '@/ui/icons';
import { reportActionError } from '@/ui/widgets/toast';

/**
 * One pattern or pin tool: toolbar glyph, display name and the tool it selects.
 * `hint` states how to operate the tool; leave it out when the name says enough.
 */
type ToolSpec = { key: ToolType; label: string; icon: IconName; hint?: string };

/** Slot-wide 2D tools; the line and shape groups sit between these two blocks. */
const TOOLS_2D: ToolSpec[] = [
  { key: 'select', label: '选择', icon: 'select', hint: '单击选中，Ctrl 加选' },
  { key: 'internalLine', label: '内部线', icon: 'internal-line', hint: '单击版片后逐点单击，Enter 结束' },
  { key: 'dart', label: '省道', icon: 'dart', hint: '依次单击两条相邻轮廓边与省尖' },
  { key: 'seam', label: '缝合', icon: 'seam', hint: '依次单击两条边，再各点一个端点定缝纫方向' },
  { key: 'topstitch', label: '明线', icon: 'topstitch', hint: '单击轮廓边' },
];

/** Vertex tools sharing one toolbar slot; the icon follows the armed tool, as in the other groups. */
const POINT_TOOLS: ToolSpec[] = [
  { key: 'point', label: '增加顶点', icon: 'add-point', hint: '单击轮廓边' },
  { key: 'deletePoint', label: '删除顶点', icon: 'remove-point', hint: '单击顶点' },
];

/** Line tools sharing one toolbar slot. */
const LINE_TOOLS: ToolSpec[] = [
  { key: 'line', label: '直线', icon: 'line', hint: '逐点单击，Enter 闭合，Esc 取消，Backspace 退点' },
  { key: 'curve', label: '曲线', icon: 'curve', hint: '逐点单击，Enter 闭合，Esc 取消' },
];

/** Shape tools sharing one toolbar slot. */
const SHAPE_TOOLS: ToolSpec[] = [
  { key: 'rect', label: '矩形', icon: 'rect', hint: '按住拖动绘制' },
  { key: 'circle', label: '圆', icon: 'circle', hint: '按住拖动绘制' },
  { key: 'ellipse', label: '椭圆', icon: 'ellipse', hint: '按住拖动绘制' },
];

/** Element kinds a marquee rectangle can collect, with their row labels. */
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
  { key: 'pin', label: '打PIN', icon: 'pin', hint: '悬停布料出现圆圈时单击' },
  { key: 'unpin', label: '拔PIN', icon: 'unpin', hint: '单击已有 PIN' },
  { key: 'sketch3d', label: '3D 线稿笔', icon: 'pen', hint: '在布料上拖动，松手后落到所属版片的内部线' },
  { key: 'measure3d', label: '3D 测量', icon: 'ruler', hint: '依次单击布料表面两点' },
];

/** View preset entries shown in the 3D toolbar, each labelled with its keypad combo. */
const VIEW_ITEMS = CAMERA_PRESETS.map(p => ({
  key: p.value,
  label: `${p.label} (${comboOf(p.menuId)})`,
}));

const PROJECTION_ITEMS = CAMERA_PROJECTIONS.map(p => ({ key: p.value, label: p.label }));

const DISPLAY_ITEMS = DISPLAY_MODES.map(m => ({ key: m.value, label: m.label }));
const WIRE_ITEMS = WIRE_MODES.map(m => ({ key: m.value, label: m.label }));

/** Edit-preview tiers; the coarse entry spells out the re-drape that follows the drag. */
const EDIT_PREVIEW_ITEMS = EDIT_PREVIEW_TIERS.map(tier => ({
  key: tier.value,
  label: tier.label,
  note: tier.value === 'low' ? '粗网格跟随拖动，松手后布料重新垂坠；全精度沿用当前垂坠状态。' : undefined,
}));

/** Display modes, with the ray-traced entry locked once the probe has rejected this GPU. */
function displayItems(unavailable: string | null) {
  if (!unavailable) return DISPLAY_ITEMS;
  return DISPLAY_ITEMS.map(item => item.key === 'raytraced'
    ? { ...item, label: `${item.label}（不支持）`, disabled: true, note: unavailable }
    : item);
}

/** Tool row that sits above the 2D pattern pane. */
export function Toolbar2D() {
  const activeTool = useUIStore(s => s.activeTool);
  const setTool = useUIStore(s => s.setTool);
  const requestFit = useUIStore(s => s.requestFit);
  const displayOptions = useUIStore(s => s.displayOptions);
  const setDisplayOption = useUIStore(s => s.setDisplayOption);
  const marqueeKinds = useUIStore(s => s.marqueeKinds);
  const setMarqueeKinds = useUIStore(s => s.setMarqueeKinds);
  const trimKind = useUIStore(s => s.trimKind);
  const setTrimKind = useUIStore(s => s.setTrimKind);

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
        onPick={key => runStructure(key as StructureAction)}
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
      <Dropdown
        label="框选"
        items={MARQUEE_KINDS.map(({ kind, label }) => ({
          key: kind,
          label: `${marqueeKinds.includes(kind) ? '✓ ' : '　'}${label}`,
        }))}
        onPick={key => {
          const kind = key as PatternElementKind;
          setMarqueeKinds(marqueeKinds.includes(kind)
            ? marqueeKinds.filter(k => k !== kind)
            : [...marqueeKinds, kind]);
        }}
      />
      <Dropdown
        label="显示"
        items={DISPLAY_LAYER_OPTIONS.map(l => ({ key: l.key, label: `${displayOptions[l.key] ? '✓ ' : '　'}${l.label}` }))}
        onPick={key => setDisplayOption(key as keyof DisplayOptions, !displayOptions[key as keyof DisplayOptions])}
      />
      <button style={styles.textBtn} title="单击适配版型范围 (F)" onClick={requestFit}>适应</button>
    </div>
  );
}

/** Structure entries that arm a tool show their active state. */
function structureChecked(action: StructureAction, activeTool: ToolType): boolean {
  return action === 'split' ? activeTool === 'split' : action === 'hole' ? activeTool === 'hole' : false;
}

/** Topology and grading problems, computed when the list opens; a row selects the offending object. */
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
      <button style={styles.textBtn} title="单击展开问题列表" onClick={() => (issues === null ? open() : setIssues(null))}>
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

/** One reported problem, tagged with the check that produced it. */
type CheckIssue = {
  code: string;
  targetId: string;
  message: string;
  kind: 'topology' | 'grading';
  severity?: 'error' | 'warning';
};

/** Auto-layout and auto-seam suggestions; each accepted row is one undo step. */
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
      <button style={styles.textBtn} title="单击展开自动排位与缝合建议" onClick={toggle}>
        自动<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} />
      </button>
      <MenuPopup open={scan !== null} anchor={anchorRef} onClose={() => setScan(null)}>
        <div style={styles.menuItem} onClick={() => { autoPlacePanels(); setScan(null); }}>自动排位</div>
        {candidates?.length === 0 && <div style={styles.menuItem}>没有可匹配的缝合建议</div>}
        {candidates?.length === 0 && scan && <div style={styles.menuNote}>{seamEmptyHint(scan.skipped)}</div>}
        {candidates !== null && candidates.length > 0 && (
          <div style={styles.menuNote}>省道与内部线不参与自动缝合；过度分割的片、插肩袖和多层结构容易配错，候选需人工核对。</div>
        )}
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

/** One line listing what the auto-seam scan skipped, or null when nothing was. */
function seamSkippedNote(skipped: SeamScanSkipped): string | null {
  const parts: string[] = [];
  if (skipped.alreadySeamed > 0) parts.push(`${skipped.alreadySeamed} 条已有缝口的边`);
  if (skipped.unlabeled > 0) parts.push(`${skipped.unlabeled} 条未标注语义的边`);
  if (skipped.multiEdge > 0) parts.push(`${skipped.multiEdge} 组配对因保留最高分未纳入`);
  return parts.length > 0 ? `已跳过：${parts.join('、')}` : null;
}

/** Explains an empty candidate list and points at the semantic control that fixes it. */
function seamEmptyHint(skipped: SeamScanSkipped): string {
  if (skipped.unlabeled > 0) return '多数边没有语义标注；选中边后在属性面板的「语义」下拉中设置，再试一次。';
  if (skipped.alreadySeamed > 0) return '可匹配的边都已有缝口；请先删除旧缝口或检查边的语义标注。';
  return '边已标注语义，但长度与方向差异过大，暂无可用建议。';
}

/** Tool row that sits above the 3D try-on pane. */
export function Toolbar3D({ engineRef }: { engineRef: MutableRefObject<GarmentEngine | null> }) {
  const activeTool = useUIStore(s => s.activeTool);
  const setTool = useUIStore(s => s.setTool);
  const displayMode = useUIStore(displayModeOf);
  const setDisplayMode = useUIStore(s => s.setDisplayMode);
  const wire = useUIStore(s => s.wire);
  const setWire = useUIStore(s => s.setWire);
  const projection = useUIStore(s => s.cameraProjection);
  const setCameraProjection = useUIStore(s => s.setCameraProjection);
  const editPreview = useUIStore(s => s.editPreview);
  const setEditPreview = useUIStore(s => s.setEditPreview);
  const pinsVersion = useSimStore(s => s.pinsVersion);
  const rayUnavailable = rayTracingUnavailableReason(usePerfStore(s => s.rayUnsupported3D));

  // The pinned set lives on the solver, so the count refreshes when the version token moves.
  const pinCount = useMemo(
    () => engineRef.current?.getPinMarkers().length ?? 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinsVersion],
  );

  return (
    <div style={styles.bar}>
      {TOOLS_3D.map(t => (
        <ToolButton
          key={t.key}
          tool={t}
          active={activeTool === t.key}
          onPick={setTool}
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
      <Dropdown
        label="线框"
        items={WIRE_ITEMS}
        value={wire}
        onPick={key => setWire(key as WireMode)}
      />
      <Dropdown
        label="拖动预览"
        items={EDIT_PREVIEW_ITEMS}
        value={editPreview}
        onPick={key => setEditPreview(key as EditPreviewTier)}
      />
    </div>
  );
}

function ToolButton({ tool, active, onPick, badge }: {
  tool: { key: ToolType; label: string; icon: IconName; hint?: string };
  active: boolean;
  onPick: (t: ToolType) => void;
  /** Count drawn after the icon; the button widens to hold it. */
  badge?: { count: number; label: string };
}) {
  const hover = [tool.label, tool.hint, badge?.label].filter(Boolean).join(' · ');
  return (
    <button
      style={{
        ...styles.toolBtn,
        ...(badge ? styles.toolBtnCounted : null),
        ...(active ? styles.toolBtnActive : null),
      }}
      title={hover}
      onClick={() => onPick(tool.key)}
    >
      <Icon name={tool.icon} size={15} />
      {badge ? <span style={styles.toolCount}>{badge.count}</span> : null}
    </button>
  );
}

/** A toolbar slot holding several tools behind one dropdown. */
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

/** Trim tool button: the arrow lists the kinds and arms the placement tool. */
function TrimTool({ active, kind, onPick }: {
  active: boolean;
  kind: TrimKind;
  onPick: (kind: TrimKind) => void;
}) {
  return (
    <ToolMenu
      icon="trim"
      title={`${TRIM_KIND_LABELS[kind]} · 单击版片放置`}
      options={TRIM_KINDS.map(k => ({ key: k, label: TRIM_KIND_LABELS[k] }))}
      current={active ? kind : ''}
      onPick={key => onPick(key as TrimKind)}
    />
  );
}

/** Icon button that opens a list of alternatives. */
function ToolMenu({ icon, title, options, current, onPick }: {
  icon: IconName;
  title: string;
  options: Array<{ key: string; label: string; hint?: string }>;
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
            style={{ ...styles.menuItem, ...(o.key === current ? styles.menuItemActive : null) }}
            onClick={() => { onPick(o.key); setOpen(false); }}
          >
            {o.key === current ? '✓ ' : '　'}{o.label}
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
      <button style={styles.textBtn} title={title} onClick={() => setOpen(o => !o)}>{label}<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} /></button>
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

/** Toolbar dropdown panel, portalled to the body so the toolbars' overflow clipping cannot hide it. */
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
  // Right-aligned to the button, but never so close to the left edge that the menu is squeezed.
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

const MENU_EDGE = 8;

/** Narrowest a popup may get when its button sits near the left edge of the window. */
const MENU_MIN_WIDTH = 300;

/** Room below the button under which the panel is flipped to open upwards. */
const MIN_PANEL_SPACE = 160;

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 34, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', background: '#202024', borderBottom: '1px solid #333', overflowX: 'auto', overflowY: 'hidden' },
  spacer: { flex: 1 },
  toolBtn: { flex: '0 0 auto', width: 26, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid transparent', borderRadius: 3, color: '#bbb', cursor: 'pointer' },
  toolBtnActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  toolBtnCounted: { width: 'auto', minWidth: 26, padding: '0 6px', gap: 4 },
  toolCount: { color: '#4da6ff', fontSize: 'var(--oc-fs-note)', fontVariantNumeric: 'tabular-nums' },
  textBtn: { flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 6px', background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)' },
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
};
