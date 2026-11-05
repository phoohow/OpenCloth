import type { Project, Seam, SeamType } from '@/model/types';
import { SEAM_TYPES, SEAM_TYPE_LABELS } from '@/model';
import { seamJoint, type SeamJointEnd } from '@/pattern/seam';
import { seamNumber } from '@/pattern/seam';
import { patchValue } from '@/ui/sceneCommands';
import { seamObjectId } from '@/model';
import { seamPanelNames } from '@/ui/sceneTree';
import {
  CheckRow, ColorRow, Hint, Row, Section, SelectRow, SliderRow,
} from '@/ui/widgets/propertyRows';
import { styles } from '@/ui/panels/properties/styles';

export function SeamData({ project, nodeId }: { project: Project; nodeId: string }) {
  const seamId = seamObjectId(nodeId);
  const seam = project.pattern.seams[seamId];
  if (!seam) return <Hint>缝纫线已删除。</Hint>;
  const [nameA, nameB] = seamPanelNames(project, seam);
  const seamNo = seamNumber(project.pattern, seam.id);

  /** Replaces the seam record; pairing changes rebuild the cloth. */
  const setSeam = (label: string, patch: Partial<Seam>) => patchValue(
    label,
    p => p.pattern.seams[seamId],
    (ctx, value) => {
      ctx.project.pattern.seams[seamId] = { ...value };
    },
    { ...seam, ...patch },
  );

  return (
    <>
      {/* The section heading carries the number, so it reads as the same seam the canvas labels. */}
      <Section title={seamNo === null ? '缝纫线' : `缝纫线 ${seamNo}`}>
        <Row label="甲边">{nameA}</Row>
        <Row label="乙边">{nameB}</Row>
      </Section>
      <Section title="缝合">
        <SelectRow label="缝型" value={seam.type}
          options={SEAM_TYPES.map(t => ({ value: t, label: SEAM_TYPE_LABELS[t] }))}
          onChange={v => setSeam('修改缝型', { type: v as SeamType })} />
        <SliderRow label="缝合强度" min={0.05} max={1} step={0.05} value={seam.strength} commitOnRelease
          onChange={v => setSeam('修改缝合强度', { strength: v })} />
        <CheckRow label="乙边反向" checked={seam.flip}
          onChange={v => setSeam(v ? '反转乙边配对' : '恢复乙边配对', { flip: v })} />
        <Row label="甲区间">{`${(seam.a.t0 * 100).toFixed(0)}% – ${(seam.a.t1 * 100).toFixed(0)}%`}</Row>
        <Row label="乙区间">{`${(seam.b.t0 * 100).toFixed(0)}% – ${(seam.b.t1 * 100).toFixed(0)}%`}</Row>
        <SliderRow label="甲起点" min={0} max={1} step={0.01} value={seam.a.t0} commitOnRelease
          onChange={v => setSeam('修改甲区间', { a: { ...seam.a, t0: Math.min(v, seam.a.t1 - 0.01) } })} />
        <SliderRow label="甲终点" min={0} max={1} step={0.01} value={seam.a.t1} commitOnRelease
          onChange={v => setSeam('修改甲区间', { a: { ...seam.a, t1: Math.max(v, seam.a.t0 + 0.01) } })} />
        <SliderRow label="乙起点" min={0} max={1} step={0.01} value={seam.b.t0} commitOnRelease
          onChange={v => setSeam('修改乙区间', { b: { ...seam.b, t0: Math.min(v, seam.b.t1 - 0.01) } })} />
        <SliderRow label="乙终点" min={0} max={1} step={0.01} value={seam.b.t1} commitOnRelease
          onChange={v => setSeam('修改乙区间', { b: { ...seam.b, t1: Math.max(v, seam.b.t0 + 0.01) } })} />
        {seam.type === 'gather' && (
          <SliderRow label="缩缝比例" min={0.5} max={1} step={0.01} value={seam.gatherRatio ?? 1} commitOnRelease
            onChange={v => setSeam('修改缩缝比例', { gatherRatio: v })} />
        )}
        <CheckRow label="对位点" checked={seam.a.anchorT !== undefined}
          onChange={v => setSeam(v ? '添加对位点' : '取消对位点', {
            a: { ...seam.a, anchorT: v ? (seam.a.t0 + seam.a.t1) / 2 : undefined },
            b: { ...seam.b, anchorT: v ? (seam.b.t0 + seam.b.t1) / 2 : undefined },
          })} />
        {seam.a.anchorT !== undefined && (
          <>
            <SliderRow label="甲对位" min={seam.a.t0} max={seam.a.t1} step={0.01} value={seam.a.anchorT} commitOnRelease
              onChange={v => setSeam('移动甲对位点', { a: { ...seam.a, anchorT: v } })} />
            <SliderRow label="乙对位" min={seam.b.t0} max={seam.b.t1} step={0.01} value={seam.b.anchorT ?? (seam.b.t0 + seam.b.t1) / 2} commitOnRelease
              onChange={v => setSeam('移动乙对位点', { b: { ...seam.b, anchorT: v } })} />
          </>
        )}
        <ColorRow label="线色" value={seam.threadColor} onChange={v => setSeam('修改线色', { threadColor: v })} />
        <div style={styles.note}>区间、对位点与缝型改动都只重排约束，顶点布局不变时不重建布料、不重置模拟；缩缝比例改写该缝的静止长度。对位点需甲乙两侧同时给定才会参与配对。画布上每条缝按序号配色并标注同一个数字，改线色后改用所设颜色。</div>
      </Section>
      <Section title="接角">
        <JointRow project={project} seamId={seamId} end="start" />
        <JointRow project={project} seamId={seamId} end="end" />
        <div style={styles.note}>数值是缝合后从接角伸出的两条轮廓边之间的夹角：180° 表示两片在这处顺直接过去，小于则这里折出一个角，两片互相压住时标「重叠」。显示层的「拼接预览」画出缝合后的形状，圆顺在「结构」菜单里做。</div>
      </Section>
    </>
  );
}

/** One seam-end joint angle as a number, or a hint when the seam does not stop on an outline corner. */
function JointRow({ project, seamId, end }: { project: Project; seamId: string; end: SeamJointEnd }) {
  const joint = seamJoint(project.pattern, seamId, end);
  const label = end === 'start' ? '起点' : '终点';
  if (!joint) return <Row label={label}>缝合端不在角点</Row>;
  const note = joint.bendDeg < 0.1 ? (joint.overlap ? '重叠' : '顺直')
    : joint.overlap ? `重叠 ${joint.bendDeg.toFixed(1)}°` : `弯折 ${joint.bendDeg.toFixed(1)}°`;
  return <Row label={label}>{`${joint.angleDeg.toFixed(1)}° ${note}`}</Row>;
}
