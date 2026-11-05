import {
  BreakPointCommand, BlendSeamJointCommand, CompositeCommand, ConnectPointsCommand,
  CreateMultiSeamCommand, CreatePanelFromEdgesCommand, FilletCornersCommand,
  MergeCollinearEdgesCommand, MirrorPanelCommand, MergePanelsCommand, MovePanelsCommand,
  OffsetInternalLineCommand, PanelFromInternalLoopCommand, RhombusDartCommand, SimplifyCurveCommand,
  SyncMirrorCommand, PanelBooleanCommand, type MirrorAxis, type PanelBooleanOp, type SeamPart,
} from '@/commands';
import { placePanelsAuto } from '@/pattern/auto';
import { useProjectStore, useUIStore, type ToolType } from '@/store';
import { idsOfKind } from '@/model';
import { reportActionError } from '@/ui/widgets/toast';

/** Structure operations offered by the 版型 ▸ 结构 menu and the 2D toolbar slot. */
export type StructureAction =
  | 'split' | 'hole'
  | 'mirror-y' | 'mirror-x' | 'mirror-edge' | 'sync-mirror' | 'merge' | 'from-edges' | 'multi-seam'
  | 'bool-union' | 'bool-intersect' | 'bool-difference'
  | 'fillet' | 'break' | 'connect' | 'merge-collinear' | 'simplify' | 'offset-line' | 'loop-panel'
  | 'rhombus-dart' | 'blend-start' | 'blend-end';

/** One structure entry: what it is called and which selection it needs. */
export interface StructureItem {
  key: StructureAction;
  label: string;
  hint?: string;
}

/** Structure operations in workflow order: shape first, then topology, then seams. */
export const STRUCTURE_ITEMS: StructureItem[] = [
  { key: 'split', label: '轮廓分割', hint: '选中版片后逐点单击画线，Enter 执行' },
  { key: 'hole', label: '开内孔', hint: '选中版片后逐点单击画闭合环，Enter 执行' },
  { key: 'mirror-y', label: '纵向镜像', hint: '选中一个版片' },
  { key: 'mirror-x', label: '横向镜像', hint: '选中一个版片' },
  { key: 'mirror-edge', label: '沿边镜像', hint: '选中一个版片和一条轴边' },
  { key: 'sync-mirror', label: '同步镜像', hint: '选中源版片' },
  { key: 'merge', label: '合并版片', hint: '选中两个版片' },
  { key: 'from-edges', label: '由边成片', hint: '选中三条以上首尾相接的边' },
  { key: 'bool-union', label: '布尔并集', hint: '选中两个版片，生成新片' },
  { key: 'bool-intersect', label: '布尔交集', hint: '选中两个版片，生成新片' },
  { key: 'bool-difference', label: '布尔差集', hint: '选中两个版片，从第一片减去第二片' },
  { key: 'fillet', label: '倒圆角', hint: '选中角点后输入半径' },
  { key: 'break', label: '断开顶点', hint: '选中一个顶点' },
  { key: 'connect', label: '连接端点', hint: '选中两个自由端点' },
  { key: 'merge-collinear', label: '合并共线边', hint: '选中两条以上共线相邻边' },
  { key: 'simplify', label: '简化曲线', hint: '选中曲线边后输入容差' },
  { key: 'offset-line', label: '等距内部线', hint: '选中一条基准边后输入距离' },
  { key: 'loop-panel', label: '内部线成片', hint: '选中一条闭合内部线' },
  { key: 'rhombus-dart', label: '菱形省', hint: '选中一条边后输入省量与省长' },
  { key: 'multi-seam', label: '多段缝合', hint: '按顺序选中一条基准边和多条目标边' },
  { key: 'blend-start', label: '接角圆顺（起）', hint: '选中一条缝合' },
  { key: 'blend-end', label: '接角圆顺（终）', hint: '选中一条缝合' },
];

/** Production marks placed with a tool, shared by the 标记 menu and the 2D toolbar slot. */
export const MARK_ITEMS: Array<{ key: ToolType; label: string; hint: string }> = [
  { key: 'notch', label: '刀口', hint: '单击轮廓边' },
  { key: 'annotation', label: '文字注释', hint: '单击版片' },
  { key: 'measure', label: '标注尺寸', hint: '依次单击两个顶点' },
  { key: 'topstitch', label: '明线', hint: '单击轮廓边' },
  { key: 'trim', label: '辅料', hint: '选中版片后放一个辅料' },
];

/** Prompts one comma-separated number list, e.g. offsets in centimetres. */
function promptNumbers(title: string, initial: string): number[] {
  const raw = prompt(title, initial);
  if (!raw) return [];
  return raw.split(/[,，\s]+/).map(Number).filter(Number.isFinite);
}

/** Runs one structure operation, arming a tool or dispatching a command for the current selection. */
export function runStructure(action: StructureAction): void {
  const setTool = useUIStore.getState().setTool;
  if (action === 'split' || action === 'hole') {
    setTool(action);
    return;
  }
  const pattern = useProjectStore.getState().project.pattern;
  const selection = useUIStore.getState().selection;
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
    } else if (action === 'bool-union' || action === 'bool-intersect' || action === 'bool-difference') {
      if (panels.length !== 2) throw new Error('请选中两个版片');
      const op: PanelBooleanOp = action === 'bool-union' ? 'union'
        : action === 'bool-intersect' ? 'intersect' : 'difference';
      const cmd = new PanelBooleanCommand([panels[0]!, panels[1]!], op);
      execute(cmd);
      useUIStore.getState().select(cmd.resultPanelIds);
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
      const input = prompt('圆角半径(cm)', '1.5');
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
      const [deviation] = promptNumbers('拟合容差(cm)', '0.05');
      execute(new SimplifyCurveCommand(edges, { ...(deviation > 0 ? { maxDeviationCm: deviation } : {}) }));
    } else if (action === 'offset-line') {
      if (edges.length !== 1) throw new Error('请选中一条基准边');
      const distances = promptNumbers('等距距离(cm)，可多个', '1, 2').filter(v => v > 0);
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
      const [intake, length] = promptNumbers('省量与省长(cm)', '2, 8');
      if (!(intake > 0) || !(length > 0)) return;
      execute(new RhombusDartCommand(panel.id, edges[0]!, 0.5, intake, length));
    } else if (action === 'blend-start' || action === 'blend-end') {
      const seams = idsOfKind(selection, 'seam').filter(id => !!pattern.seams[id]);
      if (seams.length !== 1) throw new Error('请选中一条缝合');
      const radius = Number(prompt('圆顺半径(cm)', '1.5'));
      if (!(radius > 0)) return;
      execute(new BlendSeamJointCommand(seams[0]!, action === 'blend-start' ? 'start' : 'end', radius));
    }
  } catch (err) {
    reportActionError(err);
  }
}

/** Groups panels by drape region and moves them as one undo step. */
export function autoPlacePanels(): void {
  const pattern = useProjectStore.getState().project.pattern;
  const offsets = placePanelsAuto(pattern, { gapCm: 4 });
  if (offsets.length === 0) return;
  // A draped panel's height comes from its drape anchor, so its row position is not visible.
  const cmds = offsets
    .map(o => (pattern.panels[o.panelId]?.drape ? { ...o, dy: 0 } : o))
    .filter(o => o.dx !== 0 || o.dy !== 0)
    .map(o => new MovePanelsCommand([o.panelId], { x: o.dx, y: o.dy }));
  if (cmds.length === 0) return;
  try {
    useProjectStore.getState().executeCommand(new CompositeCommand('自动排位', cmds));
  } catch (err) {
    reportActionError(err);
  }
}
