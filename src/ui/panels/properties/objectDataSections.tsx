import type { Command } from '@/commands';
import type { BodyLandmark, FloorConfig, GarmentLayer, Panel, PanelDrape, Project, Vec2 } from '@/model/types';
import type { SceneNodeKind } from '@/ui/sceneTree';

import {
  AddSizeCommand, ApplySizeCommand, FilletCornersCommand, ReorderSizesCommand, RemoveSizeCommand,
  RenameSizeCommand, ScalePanelCommand, SetBaseSizeCommand, SetPanelGrainCommand,
} from '@/commands';
import { panelWrapMode, regionAnchor, wrapDrapeForMode, type PanelWrapMode } from '@/garment';
import {
  FLOOR_GRID_SPACING_MAX, FLOOR_GRID_SPACING_MIN, FLOOR_SIZE_MAX, FLOOR_SIZE_MIN, GARMENT_LAYERS,
  normalizeFloor, readFloorConfig, writeFloorConfig, panelCollisionLayer,
} from '@/model';
import { orderedSizes } from '@/pattern/grading';
import { panelSizeCm } from '@/pattern/panel';
import { useProjectStore, useSimStore } from '@/store';
import { Icon } from '@/ui/icons';
import {
  anchorOptionsFor, GARMENT_LAYER_LABELS, PANEL_WRAP_MODES,
} from '@/ui/optionTables';
import { AvatarData } from '@/ui/panels/properties/avatarSections';
import { EdgeData } from '@/ui/panels/properties/edgeSections';
import {
  AnnotationData, DartData, InternalLineData, NotchData,
} from '@/ui/panels/properties/elementSections';
import { PointData } from '@/ui/panels/properties/pointSections';
import {
  MeasurementData, PrintData, TopstitchData, TrimData,
} from '@/ui/panels/properties/productionSections';
import {
  CameraData, EnvironmentData, LightData, ReferenceData,
} from '@/ui/panels/properties/sceneSections';
import { SeamData } from '@/ui/panels/properties/seamSections';
import { patchValue, type EngineRef } from '@/ui/sceneCommands';
import { NumberField } from '@/ui/widgets/numberField';
import {
  CheckRow, Field, Hint, InlineText, IconButton, Row, Section, SelectRow, SliderRow, SmallButton,
  TextRow,
} from '@/ui/widgets/propertyRows';
import { notify, reportActionError } from '@/ui/widgets/toast';
import { useState } from 'react';

export { LightPlacementData } from '@/ui/panels/properties/sceneSections';

export function ObjectData({ project, nodeId, kind, engineRef }: {
  project: Project; nodeId: string; kind: SceneNodeKind; engineRef: EngineRef;
}) {
  switch (kind) {
    case 'panel': return <PanelData project={project} panelId={nodeId} />;
    case 'avatar': return <AvatarData project={project} engineRef={engineRef} />;
    case 'reference': return <ReferenceData project={project} nodeId={nodeId} engineRef={engineRef} />;
    case 'light': return <LightData project={project} nodeId={nodeId} />;
    case 'floor': return <FloorData project={project} />;
    case 'seam': return <SeamData project={project} nodeId={nodeId} />;
    case 'environment': return <EnvironmentData project={project} engineRef={engineRef} />;
    case 'camera': return <CameraData project={project} engineRef={engineRef} />;
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

function FloorData({ project }: { project: Project }) {
  const floor = readFloorConfig(project);

  const set = (label: string, patch: Partial<FloorConfig>) => patchValue(
    label,
    p => readFloorConfig(p),
    (ctx, value) => writeFloorConfig(ctx.project, value),
    normalizeFloor({ ...floor, ...patch }),
  );

  return (
    <>
      <Section title="尺寸">
        <Row label="轮廓" tip="地板宽 × 长（m）">
          <Field>
            <NumberField value={floor.width} step={0.5} precision={2}
              min={FLOOR_SIZE_MIN} max={FLOOR_SIZE_MAX}
              onCommit={v => set('修改地板宽度', { width: v })} />
            <NumberField value={floor.depth} step={0.5} precision={2}
              min={FLOOR_SIZE_MIN} max={FLOOR_SIZE_MAX}
              onCommit={v => set('修改地板长度', { depth: v })} />
          </Field>
        </Row>
      </Section>
      <Section title="参考网格">
        <CheckRow label="显示网格" checked={floor.gridVisible}
          onChange={v => set(v ? '显示地板网格' : '隐藏地板网格', { gridVisible: v })} />
        <Row label="网格间距" tip={floor.gridVisible ? '每格边长（m）' : '先勾选「显示网格」再调整间距'}
          disabled={!floor.gridVisible}>
          <Field>
            <NumberField value={floor.gridSpacing} step={0.1} precision={2}
              min={FLOOR_GRID_SPACING_MIN} max={FLOOR_GRID_SPACING_MAX}
              disabled={!floor.gridVisible}
              onCommit={v => set('修改地板网格间距', { gridSpacing: v })} />
          </Field>
        </Row>
      </Section>
    </>
  );
}

function PanelData({ project, panelId }: { project: Project; panelId: string }) {
  const [keepRatio, setKeepRatio] = useState(true);
  const [cornerRadius, setCornerRadius] = useState(1);
  const panel = project.pattern.panels[panelId];
  if (!panel) return <Hint>版片已删除。</Hint>;
  const size = panelSizeCm(project.pattern, panelId);

  const setPanel = (label: string, patch: Partial<Panel>) => patchValue(
    label,
    p => p.pattern.panels[panelId],
    (ctx, value) => {
      ctx.project.pattern.panels[panelId] = { ...value };
    },
    { ...panel, ...patch },
  );

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
        <SliderRow label="缝份量" tip="cm" min={0} max={2} step={0.05} value={panel.seamAllowanceCm} commitOnRelease
          onChange={v => setPanel('修改缝份量', { seamAllowanceCm: v })} />
        <Row label="对称">{panel.symmetry ? `轴 ${panel.symmetry.axisEdgeId}` : '无'}</Row>
        <Row label="镂空">{(panel.holes ?? []).length}</Row>
      </Section>
      <Section title="尺寸">
        <Row label="轮廓" tip={size ? '外框宽 × 高(cm)' : '版片没有轮廓，无法调整尺寸'} disabled={!size}>
          <Field>
            <NumberField value={size?.width ?? 0} step={0.5} precision={2} disabled={!size}
              onCommit={v => resize(v, null)} />
            <NumberField value={size?.height ?? 0} step={0.5} precision={2} disabled={!size}
              onCommit={v => resize(null, v)} />
          </Field>
        </Row>
        <CheckRow label="等比缩放" tip={size ? '改一边时另一边按外框比例跟随' : '版片没有轮廓，无法缩放'}
          checked={keepRatio} disabled={!size} onChange={setKeepRatio} />
      </Section>
      <Section title="倒圆角">
        <Row label="半径" tip="倒圆使用的半径(cm)">
          <Field>
            <NumberField value={cornerRadius} step={0.5} precision={2}
              onCommit={v => setCornerRadius(v)} />
            <SmallButton compact disabled={cornerRadius <= 0} onClick={roundCorners}
              title={cornerRadius > 0 ? '按半径把当前版片的所有尖角倒圆' : '先把半径调到大于 0'}>倒圆</SmallButton>
          </Field>
        </Row>
      </Section>
      <Section title="生产">
        <SliderRow label="布纹角度" tip="°" min={-180} max={180} step={1} value={panel.grainAngleDeg ?? 0} commitOnRelease
          onChange={v => setGrain({ angleDeg: v })} />
        <Row label="布纹位置" tip="相对版片中心(cm)">
          <Field>
            <NumberField value={panel.grainOffset?.x ?? 0} step={0.5} precision={2}
              onCommit={v => setGrain({ offset: { x: v, y: panel.grainOffset?.y ?? 0 } })} />
            <NumberField value={panel.grainOffset?.y ?? 0} step={0.5} precision={2}
              onCommit={v => setGrain({ offset: { x: panel.grainOffset?.x ?? 0, y: v } })} />
          </Field>
        </Row>
        <Row label="布纹长度" tip="0 表示按版片自动(cm)">
          <Field>
            <NumberField value={panel.grainLengthCm ?? 0} step={0.5} precision={2}
              onCommit={v => setGrain({ lengthCm: v })} />
          </Field>
        </Row>
      </Section>
    </>
  );
}

export function PanelManageRows({ panel }: { panel: Panel }) {
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

export function PanelCollisionData({ project, panelId }: { project: Project; panelId: string }) {
  const panel = project.pattern.panels[panelId];
  if (!panel) return <Hint>版片已删除。</Hint>;

  const setPanel = (label: string, patch: Partial<Panel>) => patchValue(
    label,
    p => p.pattern.panels[panelId],
    (ctx, value) => {
      ctx.project.pattern.panels[panelId] = { ...value };
    },
    { ...panel, ...patch },
  );

  return (
    <Section title="碰撞">
      <SelectRow label="结构层" tip="决定版片的碰撞与叠放层次" value={panel.layer ?? ''}
        options={[
          { value: '', label: '未指定' },
          ...GARMENT_LAYERS.map(layer => ({ value: layer, label: GARMENT_LAYER_LABELS[layer] })),
        ]}
        onChange={v => setPanel(
          v ? '设置结构层' : '清除结构层',
          v ? { layer: v as GarmentLayer, collisionLayer: undefined } : { layer: undefined },
        )} />
      <Row label="碰撞层" tip="数值越大越靠外，0 为最内层">
        <Field>
          <NumberField value={panelCollisionLayer(panel)} step={1} precision={0} min={0} max={9}
            onCommit={v => setPanel('修改碰撞层', { collisionLayer: Math.round(v) })} />
        </Field>
      </Row>
    </Section>
  );
}

export function PanelDrapeData({ project, panelId }: { project: Project; panelId: string }) {
  const panel = project.pattern.panels[panelId];
  if (!panel) return <Hint>版片已删除。</Hint>;
  const drape = panel.drape;
  const mode = panelWrapMode(drape);
  const region = drape?.region;

  const setDrape = (next: PanelDrape | undefined, label: string) => {
    patchValue(
      label,
      p => p.pattern.panels[panelId]?.drape,
      (ctx, value) => {
        const target = ctx.project.pattern.panels[panelId];
        if (!target) return;
        if (value) target.drape = value; else delete target.drape;
      },
      next,
    );
  };

  const chooseMode = (next: PanelWrapMode) => {
    if (next === mode) return;
    setDrape(wrapDrapeForMode(next, drape), '修改环绕方式');
  };
  const anchor: BodyLandmark = drape?.anchor ?? (region ? regionAnchor(region) : 'shoulderTop');

  return (
    <Section title="环绕">
      <SelectRow label="方式" tip="版片环绕身体的方式" value={mode} options={PANEL_WRAP_MODES} onChange={chooseMode} />
      {drape && region && (
        <>
          {region !== 'head' && (
            <>
              <SelectRow label="高度" tip="环绕贴合的位置" value={anchor} options={anchorOptionsFor(region)}
                onChange={value => setDrape({ ...drape, anchor: value }, '调整环绕高度')} />
              <Row label="偏移" tip="正数向上(cm)">
                <Field>
                  <NumberField value={drape.anchorOffsetCm ?? 0} step={0.1} precision={2}
                    onCommit={value => setDrape({ ...drape, anchorOffsetCm: value }, '调整环绕偏移')} />
                </Field>
              </Row>
            </>
          )}
          {region === 'head' && <Hint>头部高度由头形决定。</Hint>}
          <CheckRow label="反向" tip="把环绕方向反过来" checked={drape.flip ?? false}
            onChange={value => setDrape({ ...drape, flip: value }, '翻转环绕方向')} />
        </>
      )}
      {panel.placement && <Row label="手动放置">平面摆放</Row>}
      {!drape && <Hint>版片平放，不参与环绕。</Hint>}
    </Section>
  );
}

export function SizeChart({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const order = orderedSizes(project);
  const baseSize = order.find(s => s.isBase);
  const activeId = project.activeSizeId ?? baseSize?.id;
  const empty = order.length === 0;
  const chartTip = (tip: string) => (empty ? '还没有尺码，先在下方「尺码」行新增' : tip);

  const exec = (cmd: Command) => useProjectStore.getState().executeCommand(cmd);

  const [newSizeName, setNewSizeName] = useState('');
  const defaultSizeName = String.fromCharCode(65 + order.length % 26);
  const addSize = () => {
    const name = newSizeName.trim() || defaultSizeName;
    if (order.some(size => size.label === name)) {
      notify(`已存在尺码「${name}」`);
      return;
    }

    exec(new AddSizeCommand(name));
    setNewSizeName('');
  };

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

  const applySize = (sizeId: string) => {
    useProjectStore.getState().executeCommand(new ApplySizeCommand(sizeId));
    engineRef.current?.resetSimulation();
    useSimStore.getState().reset();
  };

  return (
    <Section title="尺码表">
      <SelectRow label="基码" tip={chartTip('放码的基准，其余码按档差推出')} value={baseSize?.id ?? ''}
        disabled={empty} options={order.map(s => ({ value: s.id, label: s.label }))}
        onChange={v => exec(new SetBaseSizeCommand(v))} />
      <SelectRow label="当前码" tip={chartTip('切换到这一码查看版型')} value={activeId ?? ''}
        disabled={empty} options={order.map(s => ({ value: s.id, label: s.label }))}
        onChange={v => { if (v !== activeId) applySize(v); }} />
      {order.map((s, index) => (
        <Row key={s.id} label="名称">
          <Field>
            <InlineText value={s.label} onChange={v => rename(s.id, v)} />
            <IconButton onClick={() => move(s.id, -1)} disabled={index === 0} title="上移">↑</IconButton>
            <IconButton onClick={() => move(s.id, 1)} disabled={index === order.length - 1} title="下移">↓</IconButton>
            <IconButton onClick={() => exec(new RemoveSizeCommand(s.id))} title="删除">−</IconButton>
          </Field>
        </Row>
      ))}
      <Row label="尺码" tip="输入名称后点 + 新增，留空则用默认名">
        <Field>
          <InlineText value={newSizeName} placeholder={defaultSizeName}
            onChange={setNewSizeName} />
          <IconButton title="新增尺码" onClick={addSize}><Icon name="plus" size={10} /></IconButton>
        </Field>
      </Row>
    </Section>
  );
}
