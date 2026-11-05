import { useState } from 'react';
import { useProjectStore, useSimStore } from '@/store';
import type { GarmentLayer, Panel, Project, Vec2 } from '@/model/types';
import {
  AddSizeCommand, ApplySizeCommand, FilletCornersCommand, ReorderSizesCommand, RemoveSizeCommand,
  RenameSizeCommand, ScalePanelCommand, SetBaseSizeCommand, SetPanelGrainCommand,
  SetPanelMeshResolutionCommand,
} from '@/commands';
import type { Command } from '@/commands';
import { GARMENT_LAYERS } from '@/model';
import { GARMENT_LAYER_LABELS } from '@/ui/optionTables';
import { orderedSizes } from '@/pattern/grading';
import type { SceneNodeKind } from '@/ui/sceneTree';
import { panelSizeCm } from '@/pattern/panel';
import { patchValue, type EngineRef } from '@/ui/sceneCommands';
import {
  ButtonRow, CheckRow, FlexSelect, Hint, InlineText, Row, Section, SelectRow, SliderRow,
  SmallButton, TextRow,
} from '@/ui/widgets/propertyRows';
import { NumberField } from '@/ui/widgets/numberField';
import { reportActionError } from '@/ui/widgets/toast';
import { panelCollisionLayer } from '@/model';
import { styles } from '@/ui/panels/properties/styles';
import { AvatarData } from '@/ui/panels/properties/avatarSections';
import {
  CameraData, EnvironmentData, LightData, ReferenceData,
} from '@/ui/panels/properties/sceneSections';
export { LightPlacementData } from '@/ui/panels/properties/sceneSections';
import { SeamData } from '@/ui/panels/properties/seamSections';
import { PointData } from '@/ui/panels/properties/pointSections';
import { EdgeData } from '@/ui/panels/properties/edgeSections';
import {
  AnnotationData, DartData, InternalLineData, NotchData,
} from '@/ui/panels/properties/elementSections';
import {
  MeasurementData, PrintData, TopstitchData, TrimData,
} from '@/ui/panels/properties/productionSections';

/** The rows a kind adds beyond identity and transform. */
export function ObjectData({ project, nodeId, kind, engineRef }: {
  project: Project; nodeId: string; kind: SceneNodeKind; engineRef: EngineRef;
}) {
  switch (kind) {
    case 'panel': return <PanelData project={project} panelId={nodeId} />;
    case 'avatar': return <AvatarData project={project} engineRef={engineRef} />;
    case 'reference': return <ReferenceData project={project} nodeId={nodeId} engineRef={engineRef} />;
    case 'light': return <LightData project={project} nodeId={nodeId} />;
    case 'seam': return <SeamData project={project} nodeId={nodeId} />;
    case 'environment': return <EnvironmentData project={project} engineRef={engineRef} />;
    case 'camera': return <CameraData engineRef={engineRef} />;
    case 'point': return <PointData project={project} nodeId={nodeId} />;
    case 'edge': return <EdgeData project={project} nodeId={nodeId} />;
    case 'internal': return <InternalLineData project={project} nodeId={nodeId} />;
    case 'dart': return <DartData project={project} nodeId={nodeId} />;
    case 'notch': return <NotchData project={project} nodeId={nodeId} />;
    case 'annotation': return <AnnotationData project={project} nodeId={nodeId} />;
    case 'measurement': return <MeasurementData project={project} nodeId={nodeId} />;
    case 'print': return <PrintData project={project} nodeId={nodeId} />;
    case 'topstitch': return <TopstitchData project={project} nodeId={nodeId} />;
    case 'trim': return <TrimData project={project} nodeId={nodeId} />;
    default: return <Hint>这个对象类型没有额外的属性。</Hint>;
  }
}

function PanelData({ project, panelId }: { project: Project; panelId: string }) {
  const [keepRatio, setKeepRatio] = useState(true);
  const [cornerRadius, setCornerRadius] = useState(1);
  const panel = project.pattern.panels[panelId];
  if (!panel) return <Hint>版片已删除。</Hint>;
  const size = panelSizeCm(project.pattern, panelId);

  /** Replaces the panel record and rebuilds the views keyed on the pattern. */
  const setPanel = (label: string, patch: Partial<Panel>) => patchValue(
    label,
    p => p.pattern.panels[panelId],
    (ctx, value) => {
      ctx.project.pattern.panels[panelId] = { ...value };
    },
    { ...panel, ...patch },
  );

  /** Scales the panel to the target box; the other axis follows when 等比缩放 is on. */
  const resize = (width: number | null, height: number | null) => {
    if (!size) return;
    const ratio = size.width / size.height;
    let w = width ?? size.width;
    let h = height ?? size.height;
    if (keepRatio && width !== null) h = width / ratio;
    if (keepRatio && height !== null) w = height * ratio;
    if (Math.abs(w - size.width) < 1e-6 && Math.abs(h - size.height) < 1e-6) return;
    useProjectStore.getState().executeCommand(new ScalePanelCommand(panelId, w, h));
  };

  /** Rounds every sharp outline corner this panel owns. */
  const roundCorners = () => {
    const owned = [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()];
    const ids = new Set(owned.flatMap(edgeId => {
      const edge = project.pattern.edges[edgeId];
      return edge ? [edge.startPointId, edge.endPointId] : [];
    }));
    const sharp = [...ids].filter(id => (project.pattern.points[id]?.kind ?? 'corner') === 'corner');
    if (sharp.length === 0 || !(cornerRadius > 0)) return;
    useProjectStore.getState().executeCommand(new FilletCornersCommand(sharp, cornerRadius));
  };

  /** Writes the grain line, keeping whichever fields this row does not touch. */
  const setGrain = (patch: { angleDeg?: number; offset?: Vec2; lengthCm?: number }) => {
    try {
      useProjectStore.getState().executeCommand(new SetPanelGrainCommand(
        panel.id,
        patch.angleDeg ?? panel.grainAngleDeg ?? 0,
        patch.offset,
        patch.lengthCm,
      ));
    } catch (err) {
      reportActionError(err);
    }
  };

  return (
    <>
      <Section title="版型">
        <Row label="轮廓边">{panel.outlineEdgeIds.length}</Row>
        <Row label="省道">{panel.dartIds.length}</Row>
        <Row label="内部线">{panel.internalLineIds.length}</Row>
        <SliderRow label="缝份量（本片默认）" min={0} max={2} step={0.05} unit="cm" value={panel.seamAllowanceCm} commitOnRelease
          onChange={v => setPanel('修改缝份量', { seamAllowanceCm: v })} />
        <Row label="对称">{panel.symmetry ? `轴 ${panel.symmetry.axisEdgeId}` : '无'}</Row>
        <Row label="镂空">{(panel.holes ?? []).length}</Row>
      </Section>
      <Section title="尺寸">
        <Row label="轮廓(cm)">{size ? `${size.width.toFixed(2)} × ${size.height.toFixed(2)}` : '—'}</Row>
        <Row label="目标尺寸(cm)">
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <NumberField value={size?.width ?? 0} step={0.5} precision={2} title="版片宽"
              onCommit={v => resize(v, null)} />
            <NumberField value={size?.height ?? 0} step={0.5} precision={2} title="版片高"
              onCommit={v => resize(null, v)} />
          </span>
        </Row>
        <CheckRow label="等比缩放" checked={keepRatio} onChange={setKeepRatio} />
        <div style={styles.note}>尺寸按包围盒等比或拉伸缩放，控制柄、圆弧圆心与半径、内部线、省尖和注释一起跟随。圆弧边只能等比缩放；与其它片共用顶点的片需先断开。</div>
      </Section>
      <Section title="倒圆角">
        <Row label="半径(cm)">
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <NumberField value={cornerRadius} step={0.5} precision={2} title="圆角半径"
              onCommit={v => setCornerRadius(v)} />
            <SmallButton onClick={roundCorners} title="给该片当前所有尖角倒成切弧">倒圆角</SmallButton>
          </span>
        </Row>
        <div style={styles.note}>倒圆角把当前所有尖角切成圆弧；之后再点只处理剩下的尖角。</div>
      </Section>
      <Section title="生产">
        <SliderRow label="布纹线角度" min={-180} max={180} step={1} unit="°" value={panel.grainAngleDeg ?? 0} commitOnRelease
          onChange={v => setGrain({ angleDeg: v })} />
        <Row label="布纹线位置(cm)">
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <NumberField value={panel.grainOffset?.x ?? 0} step={0.5} precision={2} title="横向偏离包围盒中心"
              onCommit={v => setGrain({ offset: { x: v, y: panel.grainOffset?.y ?? 0 } })} />
            <NumberField value={panel.grainOffset?.y ?? 0} step={0.5} precision={2} title="纵向偏离包围盒中心"
              onCommit={v => setGrain({ offset: { x: panel.grainOffset?.x ?? 0, y: v } })} />
          </span>
        </Row>
        <Row label="布纹线长度(cm)">
          <NumberField value={panel.grainLengthCm ?? 0} step={0.5} precision={2} title="0 为按轮廓自动"
            onCommit={v => setGrain({ lengthCm: v })} />
        </Row>
      </Section>
    </>
  );
}

/** Lock and group rows of one panel, shown inside the object block. */
export function PanelManageRows({ panel }: { panel: Panel }) {
  /** Replaces the panel record and rebuilds the views keyed on the pattern. */
  const setPanel = (label: string, patch: Partial<Panel>) => patchValue(
    label,
    p => p.pattern.panels[panel.id],
    (ctx, value) => {
      ctx.project.pattern.panels[panel.id] = { ...value };
    },
    { ...panel, ...patch },
  );

  return (
    <>
      <CheckRow label="锁定" checked={panel.locked} onChange={v => setPanel(v ? '锁定版片' : '解锁版片', { locked: v })} />
      <TextRow label="分组" value={panel.groupId ?? ''} onChange={v => setPanel('修改版片分组', { ...(v ? { groupId: v } : { groupId: undefined }) })} />
    </>
  );
}

/** Grid density and collision layer of one panel. */
export function PanelMeshData({ project, panelId }: { project: Project; panelId: string }) {
  const panel = project.pattern.panels[panelId];
  if (!panel) return <Hint>版片已删除。</Hint>;

  /** Replaces the panel record; the mesh rebuild follows the geometry signature. */
  const setPanel = (label: string, patch: Partial<Panel>) => patchValue(
    label,
    p => p.pattern.panels[panelId],
    (ctx, value) => {
      ctx.project.pattern.panels[panelId] = { ...value };
    },
    { ...panel, ...patch },
  );

  return (
    <>
      <Section title="布料网格">
        <Row label="网格密度(cm)">
          <NumberField value={panel.meshResolutionCm} step={0.5} precision={2} min={0.5} max={10} title="逐片网格密度；修改只重建当前片"
            onCommit={v => {
              try {
                useProjectStore.getState().executeCommand(new SetPanelMeshResolutionCommand(panelId, v));
              } catch (err) {
                reportActionError(err);
              }
            }} />
        </Row>
      </Section>
      <Section title="碰撞">
        <SelectRow label="结构层" value={panel.layer ?? ''}
          options={[
            { value: '', label: '未指定' },
            ...GARMENT_LAYERS.map(layer => ({ value: layer, label: GARMENT_LAYER_LABELS[layer] })),
          ]}
          onChange={v => setPanel(
            v ? '设置结构层' : '清除结构层',
            v ? { layer: v as GarmentLayer, collisionLayer: undefined } : { layer: undefined },
          )} />
        <Row label="碰撞层">
          <NumberField value={panelCollisionLayer(panel)} step={1} precision={0} min={0} max={9} title="0 为最内层；层差越大，自碰撞把外层推得越远"
            onCommit={v => setPanel('修改碰撞层', { collisionLayer: Math.round(v) })} />
        </Row>
        <div style={styles.note}>结构层决定默认碰撞层（里布 0 / 填充 1 / 外壳 2）与碰撞间隙；手动填写的碰撞层优先。未指定结构层的片沿用工程里的「布料厚度」。</div>
      </Section>
    </>
  );
}

/** Drape placement of one panel; the 变换 tab shows it. */
export function PanelDrapeData({ project, panelId }: { project: Project; panelId: string }) {
  const panel = project.pattern.panels[panelId];
  if (!panel) return <Hint>版片已删除。</Hint>;
  return (
    <Section title="环绕">
      <Row label="方式">{panel.drape ? `环绕 ${drapeRegionLabel(panel.drape.region)}` : '自动推断'}</Row>
      {panel.placement && <Row label="手动放置">平面摆放</Row>}
    </Section>
  );
}

const drapeRegionLabel = (region: 'torso' | 'arm' | 'leg' | 'neck'): string =>
  ({ torso: '躯干', arm: '手臂', leg: '腿', neck: '领口' }[region]);

/** Project size chart rows; edits keep the base flag unique and ids stable. */
export function SizeChart({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const order = orderedSizes(project);
  const baseSize = order.find(s => s.isBase);
  /** Size the geometry currently resolves to; no active id means it is still the base size. */
  const activeId = project.activeSizeId ?? baseSize?.id;

  const exec = (cmd: Command) => useProjectStore.getState().executeCommand(cmd);

  const addSize = () => exec(new AddSizeCommand(String.fromCharCode(65 + order.length % 26)));

  const rename = (sizeId: string, label: string) => {
    const next = label.trim();
    if (!next || next === project.sizes?.find(s => s.id === sizeId)?.label) return;
    exec(new RenameSizeCommand(sizeId, next));
  };

  const move = (sizeId: string, delta: number) => {
    try {
      exec(new ReorderSizesCommand(sizeId, delta));
    } catch (err) {
      reportActionError(err);
    }
  };

  /** Resolves the pattern to one size and restarts the drape on the new shape. */
  const applySize = (sizeId: string) => {
    useProjectStore.getState().executeCommand(new ApplySizeCommand(sizeId));
    engineRef.current?.resetSimulation();
    useSimStore.getState().reset();
  };

  return (
    <Section title="尺码">
      {order.length === 0 ? (
        <Row label="尺码表">未建立</Row>
      ) : (
        <>
          <FlexSelect label="基码" value={baseSize?.id ?? ''}
            options={order.map(s => ({ value: s.id, label: s.label }))}
            onChange={v => exec(new SetBaseSizeCommand(v))} />
          <FlexSelect label="当前码" value={activeId ?? ''}
            options={order.map(s => ({ value: s.id, label: s.label }))}
            onChange={v => { if (v !== activeId) applySize(v); }} />
          {order.map(s => (
            <div key={s.id} style={styles.sizeRow}>
              <span style={styles.sizeLabel}>名称</span>
              <InlineText value={s.label} onChange={v => rename(s.id, v)} title="尺码名，回车或失焦提交" />
              <SmallButton compact onClick={() => move(s.id, -1)} title="上移一位，档差方向随顺序变">↑</SmallButton>
              <SmallButton compact onClick={() => move(s.id, 1)} title="下移一位">↓</SmallButton>
              <SmallButton compact onClick={() => exec(new RemoveSizeCommand(s.id))} title="删除这一码">−</SmallButton>
            </div>
          ))}
        </>
      )}
      <ButtonRow><SmallButton onClick={addSize}>添加尺码</SmallButton></ButtonRow>
      <div style={styles.note}>顺序决定档差方向：基码之上的码按 ↑ 排列，改名与调序都不动几何，只有切换「当前码」会解析轮廓并重启模拟。</div>
    </Section>
  );
}
