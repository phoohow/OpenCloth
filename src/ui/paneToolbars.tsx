import { useLayoutEffect, useRef, useState, useMemo, type ReactNode, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useSimStore, useUIStore, usePerfStore, type ToolType } from '../store/stores';
import type { GarmentEngine, CameraPreset } from '../core/engine/garmentEngine';
import type { CameraProjection, EditPreviewTier, RenderMode } from '../core/model/types';
import {
  BreakPointCommand, BlendSeamJointCommand, CompositeCommand, ConnectPointsCommand, CreateFreeSeamCommand,
  CreateMultiSeamCommand, CreatePanelFromEdgesCommand, FilletCornersCommand,
  MergeCollinearEdgesCommand, MirrorPanelCommand, MergePanelsCommand, MovePanelsCommand,
  OffsetInternalLineCommand, PanelFromInternalLoopCommand, RhombusDartCommand, SimplifyCurveCommand,
  SyncMirrorCommand, validateGrading, type MirrorAxis, type SeamPart,
} from '../core/command/patternCommands';
import { placePanelsAuto } from '../pattern/auto/autoPlace';
import { seamCandidates, type SeamCandidate, type SeamScanResult, type SeamScanSkipped } from '../pattern/auto/autoSeam';
import { validatePattern } from '../core/model/validatePattern';
import { seamWarnings } from '../pattern/seam/seamWarnings';
import { elementNodeId, idsOfKind, type PatternElementKind } from './elementSelection';
import type { DisplayOptions } from './viewport2D/render';
import { CAMERA_PRESETS, CAMERA_PROJECTIONS, EDIT_PREVIEW_TIERS, RENDER_MODES, rayTracingUnavailableReason } from './optionTables';
import { comboOf } from './menu/shortcuts';
import { Icon, type IconName } from './icons';
import { reportActionError } from './widgets/toast';

/** One pattern or pin tool: toolbar glyph, tooltip and the tool it selects. */
const TOOLS_2D: Array<{ key: ToolType; label: string; icon: IconName }> = [
  { key: 'select', label: '选择 (点击/Ctrl加选)', icon: 'select' },
  { key: 'point', label: '线上加点', icon: 'add-point' },
  { key: 'line', label: '直线 (Enter闭合/Esc取消/Backspace退点)', icon: 'line' },
  { key: 'curve', label: '曲线 (Ctrl+单击插入曲线点)', icon: 'curve' },
  { key: 'rect', label: '矩形', icon: 'rect' },
  { key: 'circle', label: '圆', icon: 'circle' },
  { key: 'ellipse', label: '椭圆', icon: 'ellipse' },
  { key: 'internalLine', label: '内部线', icon: 'internal-line' },
  { key: 'dart', label: '省道', icon: 'dart' },
  { key: 'seam', label: '缝合', icon: 'seam' },
];

/** Drafting display layers toggled without touching the model. */
type DisplayLayer = keyof DisplayOptions;

const DISPLAY_LAYERS: Array<{ key: DisplayLayer; label: string }> = [
  { key: 'internal', label: '内部线' },
  { key: 'darts', label: '省道' },
  { key: 'seamAllowance', label: '缝份' },
  { key: 'notches', label: '刀口' },
  { key: 'grain', label: '布纹线' },
  { key: 'annotations', label: '注释' },
  { key: 'measurements', label: '尺寸线' },
  { key: 'gradingOverlay', label: '齐码套叠' },
  { key: 'seamJoin', label: '拼接预览' },
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
];

/** Tools that mark production information onto existing geometry. */
const MARK_TOOLS: Array<{ key: ToolType; label: string }> = [
  { key: 'notch', label: '刀口：单击轮廓边' },
  { key: 'annotation', label: '文字注释：单击版片' },
  { key: 'measure', label: '尺寸线：单击两个点' },
];

/** Structure operations, some arming a tool and some acting on the current selection. */
type StructureAction =
  | 'split' | 'hole'
  | 'mirror-y' | 'mirror-x' | 'mirror-edge' | 'sync-mirror' | 'merge' | 'from-edges' | 'multi-seam'
  | 'fillet' | 'break' | 'connect' | 'merge-collinear' | 'simplify' | 'offset-line' | 'loop-panel'
  | 'rhombus-dart' | 'blend-start' | 'blend-end';

const STRUCTURE_ITEMS: Array<{ key: StructureAction; label: string }> = [
  { key: 'split', label: '轮廓分割（画切割线后回车）' },
  { key: 'hole', label: '开内孔（画闭合环后回车）' },
  { key: 'mirror-y', label: '沿纵向镜像复制' },
  { key: 'mirror-x', label: '沿横向镜像复制' },
  { key: 'mirror-edge', label: '沿选中边镜像复制' },
  { key: 'sync-mirror', label: '同步镜像片' },
  { key: 'merge', label: '合并选中的两片' },
  { key: 'from-edges', label: '由选中边成片' },
  { key: 'multi-seam', label: '多段缝合（首条边分段对多片边）' },
  { key: 'fillet', label: '选中角点倒圆角' },
  { key: 'break', label: '断开选中顶点' },
  { key: 'connect', label: '连接选中两个端点' },
  { key: 'merge-collinear', label: '合并选中共线边' },
  { key: 'simplify', label: '简化选中曲线' },
  { key: 'offset-line', label: '沿选中边生成等距内部线' },
  { key: 'loop-panel', label: '闭合内部线独立成片' },
  { key: 'rhombus-dart', label: '在选中边上开菱形省' },
  { key: 'blend-start', label: '接角圆顺：选中缝合的起点' },
  { key: 'blend-end', label: '接角圆顺：选中缝合的终点' },
];

/** Prompts one comma-separated number list, e.g. offsets in centimetres. */
function promptNumbers(title: string, initial: string): number[] {
  const raw = prompt(title, initial);
  if (!raw) return [];
  return raw.split(/[,，\s]+/).map(Number).filter(Number.isFinite);
}

const TOOLS_3D: Array<{ key: ToolType; label: string; icon: IconName }> = [
  { key: 'pin', label: '打PIN 固定布料点', icon: 'pin' },
  { key: 'unpin', label: '拔PIN 释放布料点', icon: 'unpin' },
];

/** View preset entries shown in the 3D toolbar, each labelled with its keypad combo. */
const VIEW_ITEMS = CAMERA_PRESETS.map(p => ({
  key: p.value,
  label: `${p.label} (${comboOf(p.menuId)})`,
}));

const PROJECTION_ITEMS = CAMERA_PROJECTIONS.map(p => ({ key: p.value, label: p.label }));

const RENDER_ITEMS = RENDER_MODES.map(m => ({ key: m.value, label: m.label }));

/** Edit-preview tiers; the coarse entry spells out the re-drape that follows the drag. */
const EDIT_PREVIEW_ITEMS = EDIT_PREVIEW_TIERS.map(tier => ({
  key: tier.value,
  label: tier.label,
  note: tier.value === 'low' ? '粗网格跟随拖动，松手后布料重新垂坠；全精度沿用当前垂坠状态。' : undefined,
}));

/** Display modes with the ray tracing entry locked once the probe has rejected this GPU. */
function renderItems(unavailable: string | null) {
  if (!unavailable) return RENDER_ITEMS;
  return RENDER_ITEMS.map(item => item.key === 'raytraced'
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
  const selection = useUIStore(s => s.selection);

  /** Runs one structure operation, arming a tool or dispatching a command for the selection. */
  const runStructure = (action: StructureAction) => {
    if (action === 'split' || action === 'hole') {
      setTool(action);
      return;
    }
    const pattern = useProjectStore.getState().project.pattern;
    const execute = useProjectStore.getState().executeCommand;
    const panels = idsOfKind(selection, 'panel').filter(id => !!pattern.panels[id]);
    const edges = idsOfKind(selection, 'edge').filter(id => !!pattern.edges[id]);
    const points = idsOfKind(selection, 'point').filter(id => !!pattern.points[id]);
    try {
      if (action === 'mirror-y' || action === 'mirror-x') {
        if (panels.length !== 1) throw new Error('请先选中一个要镜像的版片');
        execute(new MirrorPanelCommand(panels[0]!, action === 'mirror-y' ? 'y' : 'x'));
      } else if (action === 'mirror-edge') {
        if (panels.length !== 1 || edges.length !== 1) throw new Error('请选中一个版片和一条轴边');
        execute(new MirrorPanelCommand(panels[0]!, edges[0]! as MirrorAxis));
      } else if (action === 'sync-mirror') {
        if (panels.length !== 1) throw new Error('请先选中源版片');
        execute(new SyncMirrorCommand(panels[0]!));
      } else if (action === 'merge') {
        if (panels.length !== 2) throw new Error('请选中两个版片');
        execute(new MergePanelsCommand([panels[0]!, panels[1]!]));
      } else if (action === 'multi-seam') {
        if (edges.length < 3) throw new Error('请选中一条基准边和至少两条目标边');
        const [aId, ...bIds] = edges;
        const parts: SeamPart[] = bIds.map((edgeBId, i) => ({
          edgeBId,
          tB0: 0,
          tB1: 1,
          tA0: i / bIds.length,
          tA1: (i + 1) / bIds.length,
        }));
        execute(new CreateMultiSeamCommand(aId!, parts));
      } else if (action === 'from-edges') {
        if (edges.length < 3) throw new Error('请至少选中三条首尾相接的边');
        execute(new CreatePanelFromEdgesCommand(edges));
      } else if (action === 'fillet') {
        if (points.length === 0) throw new Error('请先选中角点');
        const input = prompt('圆角半径 (cm)', '1.5');
        const radius = Number(input);
        if (!(radius > 0)) return;
        execute(new FilletCornersCommand(points, radius));
      } else if (action === 'break') {
        if (points.length !== 1) throw new Error('请选中一个要断开的顶点');
        execute(new BreakPointCommand(points[0]!));
      } else if (action === 'connect') {
        if (points.length !== 2) throw new Error('请选中两个自由端点');
        execute(new ConnectPointsCommand(points[0]!, points[1]!));
      } else if (action === 'merge-collinear') {
        if (edges.length < 2) throw new Error('请选中两条以上共线相邻边');
        execute(new MergeCollinearEdgesCommand(edges));
      } else if (action === 'simplify') {
        if (edges.length === 0) throw new Error('请选中要简化的曲线边');
        const [deviation] = promptNumbers('拟合容差 (cm)', '0.05');
        execute(new SimplifyCurveCommand(edges, { ...(deviation > 0 ? { maxDeviationCm: deviation } : {}) }));
      } else if (action === 'offset-line') {
        if (edges.length !== 1) throw new Error('请选中一条基准边');
        const distances = promptNumbers('等距距离 (cm)，可多个', '1, 2').filter(v => v > 0);
        if (distances.length === 0) return;
        execute(new OffsetInternalLineCommand(edges[0]!, distances));
      } else if (action === 'loop-panel') {
        const lineIds = idsOfKind(selection, 'internal');
        if (lineIds.length !== 1) throw new Error('请选中一条闭合内部线');
        const owner = Object.values(pattern.panels).find(p => p.internalLineIds.includes(lineIds[0]!));
        if (!owner) throw new Error('内部线没有所属版片');
        execute(new PanelFromInternalLoopCommand(owner.id, lineIds[0]!));
      } else if (action === 'rhombus-dart') {
        if (edges.length !== 1) throw new Error('请选中省所在的边');
        const panel = Object.values(pattern.panels).find(p => p.outlineEdgeIds.includes(edges[0]!));
        if (!panel) throw new Error('这条边不属于任何版片');
        const [intake, length] = promptNumbers('省量与省长 (cm)', '2, 8');
        if (!(intake > 0) || !(length > 0)) return;
        execute(new RhombusDartCommand(panel.id, edges[0]!, 0.5, intake, length));
      } else if (action === 'blend-start' || action === 'blend-end') {
        const seams = idsOfKind(selection, 'seam').filter(id => !!pattern.seams[id]);
        if (seams.length !== 1) throw new Error('请选中一条缝合');
        const radius = Number(prompt('圆顺半径 (cm)', '1.5'));
        if (!(radius > 0)) return;
        execute(new BlendSeamJointCommand(seams[0]!, action === 'blend-start' ? 'start' : 'end', radius));
      }
    } catch (err) {
      reportActionError(err);
    }
  };

  return (
    <div style={styles.bar}>
      {TOOLS_2D.map(t => (
        <ToolButton key={t.key} tool={t} active={activeTool === t.key} onPick={setTool} />
      ))}
      <Dropdown
        label="结构"
        items={STRUCTURE_ITEMS.map(i => ({ key: i.key, label: `${structureChecked(i.key, activeTool) ? '✓ ' : '　'}${i.label}` }))}
        onPick={key => runStructure(key as StructureAction)}
      />
      <Dropdown
        label="标记"
        items={MARK_TOOLS.map(m => ({ key: m.key, label: `${activeTool === m.key ? '✓ ' : '　'}${m.label}` }))}
        onPick={key => setTool(key as ToolType)}
      />
      <CheckMenu />
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
        items={DISPLAY_LAYERS.map(l => ({ key: l.key, label: `${displayOptions[l.key] ? '✓ ' : '　'}${l.label}` }))}
        onPick={key => setDisplayOption(key as DisplayLayer, !displayOptions[key as DisplayLayer])}
      />
      <button style={styles.textBtn} title="适配版型范围 (F)" onClick={requestFit}>居中</button>
    </div>
  );
}

/** Structure entries that arm a tool show their active state. */
function structureChecked(action: StructureAction, activeTool: ToolType): boolean {
  return action === 'split' ? activeTool === 'split' : action === 'hole' ? activeTool === 'hole' : false;
}

/** Topology and grading checks, computed when the menu opens; a row selects the offending object. */
function CheckMenu() {
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
      <button style={styles.textBtn} title="检查轮廓、缝合、省道与放码" onClick={() => (issues === null ? open() : setIssues(null))}>
        检查<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} />
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

  /** Groups panels by drape region and moves them as one undo step. */
  const autoPlace = () => {
    const pattern = useProjectStore.getState().project.pattern;
    const offsets = placePanelsAuto(pattern, { gapCm: 4 });
    if (offsets.length === 0) return;
    const cmds = offsets
      .filter(o => o.dx !== 0 || o.dy !== 0)
      .map(o => new MovePanelsCommand([o.panelId], { x: o.dx, y: o.dy }));
    if (cmds.length === 0) return;
    try {
      useProjectStore.getState().executeCommand(new CompositeCommand('自动排位', cmds));
    } catch (err) {
      reportActionError(err);
    }
  };

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
      <button style={styles.textBtn} title="按布纹区域排位，并给出缝合建议" onClick={toggle}>
        智能<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} />
      </button>
      <MenuPopup open={scan !== null} anchor={anchorRef} onClose={() => setScan(null)}>
        <div style={styles.menuItem} onClick={() => { autoPlace(); setScan(null); }}>自动排位</div>
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
  if (skipped.unlabeled > 0) return '多数边没有语义标注；选中边后在属性编辑器的「语义」下拉中设置，再试一次。';
  if (skipped.alreadySeamed > 0) return '可匹配的边都已有缝口；请先删除旧缝口或检查边的语义标注。';
  return '边已标注语义，但长度与方向差异过大，暂无可用建议。';
}

/** Tool row that sits above the 3D try-on pane. */
export function Toolbar3D({ engineRef }: { engineRef: MutableRefObject<GarmentEngine | null> }) {
  const activeTool = useUIStore(s => s.activeTool);
  const setTool = useUIStore(s => s.setTool);
  const renderMode = useUIStore(s => s.renderMode);
  const setRenderMode = useUIStore(s => s.setRenderMode);
  const projection = useUIStore(s => s.cameraProjection);
  const setCameraProjection = useUIStore(s => s.setCameraProjection);
  const editPreview = useUIStore(s => s.editPreview);
  const setEditPreview = useUIStore(s => s.setEditPreview);
  const pinsVersion = useSimStore(s => s.pinsVersion);
  const bumpPins = useSimStore(s => s.bumpPins);
  const rayUnavailable = rayTracingUnavailableReason(usePerfStore(s => s.rayUnsupported3D));
  const [clearing, setClearing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  // The pinned set lives on the solver, so the counts refresh when the version token moves.
  const pinCounts = useMemo(() => {
    const engine = engineRef.current;
    return {
      marked: engine?.getPinMarkers().length ?? 0,
      pinned: engine?.getPinnedParticles().length ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsVersion]);

  const clearPins = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setClearing(true);
    try {
      await engine.clearPins();
      bumpPins();
    } finally {
      setClearing(false);
    }
  };

  const rebuildCloth = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setRebuilding(true);
    try {
      await engine.initSimulator(useProjectStore.getState().project);
      engine.resetSimulation();
      useSimStore.getState().reset();
      bumpPins();
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div style={styles.bar}>
      {TOOLS_3D.map(t => (
        <ToolButton key={t.key} tool={t} active={activeTool === t.key} onPick={setTool} />
      ))}
      <button style={styles.textBtn} title="释放全部 PIN" disabled={clearing} onClick={() => void clearPins()}>{clearing ? '清除中…' : '清除PIN'}</button>
      <button style={styles.textBtn} title="按当前工程重建布料网格" disabled={rebuilding} onClick={() => void rebuildCloth()}>{rebuilding ? '重建中…' : '重建网格'}</button>
      <span style={styles.pinCount} title="手动打点数 · 固定点总数（含版片顶部假缝带）">
        <Icon name="pin" size={11} /> {pinCounts.marked} · 固定 {pinCounts.pinned}
      </span>
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
        items={renderItems(rayUnavailable)}
        value={renderMode}
        onPick={key => setRenderMode(key as RenderMode)}
      />
      <Dropdown
        label="编辑时预览"
        items={EDIT_PREVIEW_ITEMS}
        value={editPreview}
        onPick={key => setEditPreview(key as EditPreviewTier)}
      />
    </div>
  );
}

function ToolButton({ tool, active, onPick }: {
  tool: { key: ToolType; label: string; icon: IconName };
  active: boolean;
  onPick: (t: ToolType) => void;
}) {
  return (
    <button
      style={{ ...styles.toolBtn, ...(active ? styles.toolBtnActive : null) }}
      title={tool.label}
      onClick={() => onPick(tool.key)}
    >
      <Icon name={tool.icon} size={15} />
    </button>
  );
}

function Dropdown({ label, items, value, onPick }: {
  label: string;
  items: Array<{ key: string; label: string; disabled?: boolean; note?: string }>;
  value?: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button style={styles.textBtn} onClick={() => setOpen(o => !o)}>{label}<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} /></button>
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
  return createPortal(
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div
        style={{
          ...styles.menuPopup,
          right: window.innerWidth - rect.right,
          maxWidth: window.innerWidth - rect.right - MENU_EDGE,
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

/** Room below the button under which the panel is flipped to open upwards. */
const MIN_PANEL_SPACE = 160;

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 30, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', background: '#202024', borderBottom: '1px solid #333', overflow: 'hidden' },
  spacer: { flex: 1 },
  toolBtn: { width: 26, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid transparent', borderRadius: 3, color: '#bbb', cursor: 'pointer' },
  toolBtnActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  textBtn: { flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 6px', background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 11 },
  pinCount: { flex: '0 1 auto', minWidth: 0, padding: '3px 2px', color: '#9ab', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 900 },
  menuPopup: {
    position: 'fixed', width: 'max-content', minWidth: 140, overflowY: 'auto',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4, zIndex: 901,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', padding: '2px 0',
  },
  menuItem: { padding: '7px 12px', fontSize: 12, color: '#ccc', cursor: 'pointer' },
  menuNote: { padding: '6px 12px', fontSize: 11, color: '#8a93a3', cursor: 'default', whiteSpace: 'normal', lineHeight: 1.5, maxWidth: 340 },
  menuItemDisabled: { color: '#666', cursor: 'default' },
  menuItemActive: { color: '#4da6ff', background: '#2a3a4a' },
};
