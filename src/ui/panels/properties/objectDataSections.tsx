import { useState } from 'react';
import { useProjectStore, useSimStore, useUIStore } from '../../../store/stores';
import type {
  Annotation, Avatar, Dart, EdgeSemantic, EdgeType, InternalLine, LightType, Measurement,
  Notch, Panel, Pattern, PatternEdge, PatternPoint, Print, Project, SceneLight, Seam, SeamType,
  Topstitch, Trim, TrimKind, Vec2,
} from '../../../core/model/types';
import {
  AddSizeCommand, ApplySizeCommand, DeleteAnnotationCommand, DeleteElementsCommand,
  DeleteMeasurementCommand, DeleteNotchCommand,
  FilletCornersCommand, MovePointsCommand, ReorderSizesCommand, RemoveSizeCommand, RenameSizeCommand,
  resolveSize, ScalePanelCommand, SetArcParamsCommand, SetBaseSizeCommand, SetEdgeAngleCommand,
  SetEdgeLengthCommand, SetPanelGrainCommand, SetPanelMeshResolutionCommand, SetPointGradingCommand,
  SetPointsGradingCommand, TransferDartCommand, UpdatePrintCommand, UpdateTopstitchCommand,
  UpdateTrimCommand,
} from '../../../core/command/patternCommands';
import type { Command } from '../../../core/command/command';
import {
  BUNDLED_AVATARS, LIGHT_TYPES, LIGHT_TYPE_LABELS, SEAM_TYPES, SEAM_TYPE_LABELS,
  TRIM_KINDS, TRIM_KIND_LABELS, normalizeLights,
} from '../../../core/model/defaults';
import { edgeLength, measurementValue } from '../../../pattern/geom/edgeSample';
import { arcSpan } from '../../../pattern/geom/arc';
import { gradingPasteMap, orderedSizes } from '../../../pattern/grading/grading';
import { seamJoint, type SeamJointEnd } from '../../../pattern/seam/joinBlend';
import type { SceneNodeKind } from '../../sceneTree';
import { elementNodeId, idsOfKind } from '../../elementSelection';
import {
  edgeLabel, lightObjectId, panelSizeCm, referenceObjectId, seamObjectId, seamPanelNames,
} from '../../sceneTree';
import {
  commitEnvironmentReset, commitReferenceOpacity, patchLight, patchValue, removeLight, removeReference,
  type EngineRef,
} from '../../sceneCommands';
import { importAvatarViaPicker, importEnvironmentViaPicker } from '../../modelImport';
import { ButtonRow, CheckRow, ColorRow, FlexSelect, Hint, IconButton, InlineText, PopupSelect, Row, Section, SelectRow, SliderRow, SmallButton, TextRow } from '../../widgets/propertyRows';
import { Icon } from '../../icons';
import { NumberField, Vec3Field } from '../../widgets/numberField';
import { reportActionError } from '../../widgets/toast';
import { CAMERA_PROJECTIONS } from '../../optionTables';
import { CUSTOM_MODEL, PROCEDURAL_MODEL, toDeg, toRad } from './constants';
import { styles } from './styles';

/** Full-body pose presets: arm rake, leg splay and lateral lean, in degrees. */
const POSE_PRESETS: Array<{
  key: string; label: string; armDeg: number; legDeg: number; leanDeg: number;
}> = [
  { key: 'relaxed', label: '自然', armDeg: 7, legDeg: 2, leanDeg: 0 },
  { key: 'a-pose', label: 'A 型', armDeg: 25, legDeg: 4, leanDeg: 0 },
  { key: 't-pose', label: 'T 型', armDeg: 90, legDeg: 6, leanDeg: 0 },
  { key: 'stance', label: '侧立', armDeg: 7, legDeg: 12, leanDeg: 5 },
];

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
        <Row label="碰撞层">
          <NumberField value={panel.collisionLayer ?? 0} step={1} precision={0} min={0} max={9} title="0 为最内层；层差越大，自碰撞把外层推得越远"
            onCommit={v => setPanel('修改碰撞层', { collisionLayer: Math.round(v) })} />
        </Row>
        <div style={styles.note}>布料自碰撞开启时，碰撞层 0 为最内层，层差每加 1 按「层间距」额外分开一段距离。</div>
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

function AvatarData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const avatar = project.avatar;

  /** Replaces the avatar record so the 3D view rebuilds the body. */
  const setAvatar = (label: string, patch: Partial<Avatar>) => patchValue(
    label,
    p => p.avatar,
    (ctx, value) => { ctx.project.avatar = { ...value }; },
    { ...avatar, ...patch },
  );

  return (
    <>
      <AvatarModelData project={project} engineRef={engineRef} />
      <Section title="体型">
        <SliderRow label="身高" min={140} max={200} step={1} unit="cm" value={avatar.params.heightCm} commitOnRelease
          onChange={v => setAvatar('修改身高', { params: { ...avatar.params, heightCm: v } })} />
        <SliderRow label="胸围" min={60} max={140} step={1} unit="cm" value={avatar.params.chestCm} commitOnRelease
          onChange={v => setAvatar('修改胸围', { params: { ...avatar.params, chestCm: v } })} />
        <SliderRow label="腰围" min={50} max={130} step={1} unit="cm" value={avatar.params.waistCm} commitOnRelease
          onChange={v => setAvatar('修改腰围', { params: { ...avatar.params, waistCm: v } })} />
        <SliderRow label="臀围" min={60} max={150} step={1} unit="cm" value={avatar.params.hipCm} commitOnRelease
          onChange={v => setAvatar('修改臀围', { params: { ...avatar.params, hipCm: v } })} />
      </Section>
      <Section title="姿态">
        <SliderRow label="手臂外展" min={0} max={90} step={1} unit="°" value={toDeg(avatar.params.poseArmAngleRad ?? 0.12)} commitOnRelease
          onChange={v => setAvatar('修改手臂外展', { params: { ...avatar.params, poseArmAngleRad: toRad(v) } })} />
        <SliderRow label="腿部开合" min={0} max={45} step={1} unit="°" value={toDeg(avatar.params.poseLegSpreadRad ?? 0)} commitOnRelease
          onChange={v => setAvatar('修改腿部开合', { params: { ...avatar.params, poseLegSpreadRad: toRad(v) } })} />
        <SliderRow label="躯干倾斜" min={-20} max={20} step={1} unit="°" value={toDeg(avatar.params.poseTorsoLeanRad ?? 0)} commitOnRelease
          onChange={v => setAvatar('修改躯干倾斜', { params: { ...avatar.params, poseTorsoLeanRad: toRad(v) } })} />
        <Row label="姿态预设">
          <ButtonRow>
            {POSE_PRESETS.map(preset => (
              <SmallButton
                key={preset.key}
                title={`手臂 ${preset.armDeg}° · 腿 ${preset.legDeg}° · 躯干 ${preset.leanDeg}°`}
                onClick={() => setAvatar('切换姿态', {
                  params: {
                    ...avatar.params,
                    poseArmAngleRad: toRad(preset.armDeg),
                    poseLegSpreadRad: toRad(preset.legDeg),
                    poseTorsoLeanRad: toRad(preset.leanDeg),
                  },
                })}
              >{preset.label}</SmallButton>
            ))}
          </ButtonRow>
        </Row>
        <div style={styles.note}>体型与姿态改动都会重建模特、布料与模拟状态。</div>
      </Section>
    </>
  );
}

/** Model source of the avatar; selecting a bundled model also adopts its measurements. */
function AvatarModelData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const avatar = project.avatar;
  const bundled = BUNDLED_AVATARS.find(b => b.url === avatar.glbUrl);
  const modelValue = avatar.source === 'procedural'
    ? PROCEDURAL_MODEL
    : bundled ? bundled.url : CUSTOM_MODEL;
  const modelOptions = [
    ...(avatar.source === 'glb' && !bundled ? [{ value: CUSTOM_MODEL, label: `自定义：${avatar.modelName ?? '模型'}` }] : []),
    ...BUNDLED_AVATARS.map(b => ({ value: b.url, label: b.label })),
    { value: PROCEDURAL_MODEL, label: '程序模特' },
  ];

  /** Replaces the avatar record so the 3D view rebuilds the body. */
  const setAvatar = (label: string, patch: Partial<Avatar>) => patchValue(
    label,
    p => p.avatar,
    (ctx, value) => { ctx.project.avatar = { ...value }; },
    { ...avatar, ...patch },
  );

  /** Selecting a bundled model also adopts the measurements that fit its mesh. */
  const chooseModel = (value: string) => {
    if (value === PROCEDURAL_MODEL) setAvatar('恢复程序模特', { source: 'procedural' });
    else if (value !== CUSTOM_MODEL) {
      const model = BUNDLED_AVATARS.find(b => b.url === value);
      if (model) setAvatar('切换模特', {
        source: 'glb', glbUrl: value, modelName: undefined, params: { ...model.params },
      });
    }
  };

  return (
    <Section title="模型来源">
      <SelectRow label="模型" value={modelValue} options={modelOptions} onChange={chooseModel}
        trailing={
          <IconButton title="导入模特" disabled={!engineRef.current}
            onClick={() => engineRef.current && void importAvatarViaPicker()}><Icon name="plus" size={12} /></IconButton>
        } />
    </Section>
  );
}

function ReferenceData({ project, nodeId, engineRef }: {
  project: Project; nodeId: string; engineRef: EngineRef;
}) {
  const refId = referenceObjectId(nodeId);
  const ref = (project.scene.referenceObjects ?? []).find(r => r.id === refId);
  if (!ref) return <Hint>参考物体已删除。</Hint>;
  return (
    <Section title="参考物">
      <Row label="模型">{ref.objectKey ? '已存入本地' : '文件已失效'}</Row>
      <SliderRow label="透明度" min={0.05} max={1} step={0.05} value={ref.opacity} commitOnRelease
        onChange={v => commitReferenceOpacity(refId, v, engineRef)} />
      <ButtonRow>
        <SmallButton disabled={!engineRef.current} onClick={() => removeReference(refId)}>删除参考物体</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Brightness range offered per light type. */
const INTENSITY_RANGE: Record<LightType, { max: number; step: number }> = {
  directional: { max: 10, step: 0.1 },
  point: { max: 300, step: 1 },
  spot: { max: 300, step: 1 },
  area: { max: 60, step: 0.5 },
};

/** Light record addressed by an outliner row id. */
function lightOf(project: Project, nodeId: string): SceneLight | null {
  return normalizeLights(project.scene.lights).find(l => l.id === lightObjectId(nodeId)) ?? null;
}

/** Direction or position and aim of one light; the 变换 tab shows it. */
export function LightPlacementData({ project, nodeId }: { project: Project; nodeId: string }) {
  const light = lightOf(project, nodeId);
  if (!light) return <Hint>光源已删除。</Hint>;
  const aims = light.type !== 'point';

  return (
    <Section title="位置">
      <Vec3Field label={light.type === 'directional' ? '方向' : '位置'} value={light.position}
        step={0.05} precision={2} unit="m"
        onCommit={v => patchLight(light.id, '修改光源位置', { position: v })} />
      {aims && (
        <Vec3Field label="目标" value={light.target} step={0.05} precision={2} unit="m"
          onCommit={v => patchLight(light.id, '修改光源目标', { target: v })} />
      )}
      {light.type === 'directional' && (
        <div style={styles.note}>方向光的位置只决定照射方向，光线平行射向目标点。</div>
      )}
    </Section>
  );
}

function LightData({ project, nodeId }: { project: Project; nodeId: string }) {
  const light = lightOf(project, nodeId);
  if (!light) return <Hint>光源已删除。</Hint>;
  const punctual = light.type === 'point' || light.type === 'spot';

  /** Edits one field of this light. */
  const set = (label: string, patch: Partial<SceneLight>) => patchLight(light.id, label, patch);

  return (
    <>
      <Section title="光源">
        <SelectRow label="光源类型" value={light.type}
          options={LIGHT_TYPES.map(t => ({ value: t, label: LIGHT_TYPE_LABELS[t] }))}
          onChange={v => set('修改光源类型', { type: v })} />
        <SliderRow label="强度" min={0} max={INTENSITY_RANGE[light.type].max} step={INTENSITY_RANGE[light.type].step}
          value={light.intensity} commitOnRelease
          onChange={v => set('修改光源强度', { intensity: v })} />
        <ColorRow label="颜色" value={light.color} onChange={v => set('修改光源颜色', { color: v })} />
        <ButtonRow>
          <SmallButton onClick={() => removeLight(light.id)}>删除光源</SmallButton>
        </ButtonRow>
      </Section>
      {light.type !== 'directional' && (
        <Section title="照射范围">
          {punctual && (
            <SliderRow label="照射距离" min={0} max={20} step={0.5} unit="m" value={light.distance} commitOnRelease
              onChange={v => set('修改光源距离', { distance: v })} />
          )}
          {light.type === 'spot' && (
            <>
              <SliderRow label="锥角" min={1} max={120} step={1} unit="°" value={light.coneAngleDeg} commitOnRelease
                onChange={v => set('修改聚光灯锥角', { coneAngleDeg: v })} />
              <SliderRow label="边缘柔化" min={0} max={1} step={0.05} value={light.penumbra} commitOnRelease
                onChange={v => set('修改聚光灯边缘', { penumbra: v })} />
            </>
          )}
          {light.type === 'area' && (
            <>
              <SliderRow label="宽度" min={0.05} max={10} step={0.05} unit="m" value={light.width} commitOnRelease
                onChange={v => set('修改面积光宽度', { width: v })} />
              <SliderRow label="高度" min={0.05} max={10} step={0.05} unit="m" value={light.height} commitOnRelease
                onChange={v => set('修改面积光高度', { height: v })} />
            </>
          )}
          <div style={styles.note}>
            {punctual ? '强度按平方反比衰减，距离 0 表示不限距离。' : '强度按平方反比衰减。'}
          </div>
        </Section>
      )}
    </>
  );
}

function SeamData({ project, nodeId }: { project: Project; nodeId: string }) {
  const seamId = seamObjectId(nodeId);
  const seam = project.pattern.seams[seamId];
  if (!seam) return <Hint>缝纫线已删除。</Hint>;
  const [nameA, nameB] = seamPanelNames(project, seam);

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
      <Section title="缝纫线">
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
        <div style={styles.note}>区间、对位点与缝型改动都只重排约束，顶点布局不变时不重建布料、不重置模拟；缩缝比例改写该缝的静止长度。对位点需甲乙两侧同时给定才会参与配对。</div>
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

function EnvironmentData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const lights = project.scene.lights;
  const envLabel = lights.iblName ?? lights.iblUrl ?? '内置环境图';
  const isCustomEnv = !!(lights.iblObjectKey ?? lights.iblUrl);

  const setIntensity = (value: number) => patchValue(
    '修改环境强度',
    p => p.scene.lights.iblIntensity,
    (ctx, v) => {
      ctx.project.scene = { ...ctx.project.scene, lights: { ...ctx.project.scene.lights, iblIntensity: v } };
    },
    value,
  );

  return (
    <Section title="环境光">
      <Row label="环境图">{envLabel}</Row>
      <SliderRow label="强度" min={0} max={2} step={0.05} value={lights.iblIntensity} commitOnRelease
        onChange={setIntensity} />
      <ButtonRow>
        <SmallButton disabled={!engineRef.current}
          onClick={() => engineRef.current && void importEnvironmentViaPicker()}>导入环境图</SmallButton>
        <SmallButton disabled={!engineRef.current || !isCustomEnv} onClick={commitEnvironmentReset}>内置环境图</SmallButton>
      </ButtonRow>
    </Section>
  );
}

function CameraData({ engineRef }: { engineRef: EngineRef }) {
  const [, bump] = useState(0);
  const engine = engineRef.current;
  const camera = engine?.getCameraState() ?? null;
  const projection = useUIStore(s => s.cameraProjection);
  const setCameraProjection = useUIStore(s => s.setCameraProjection);
  const refresh = () => bump(n => n + 1);

  if (!engine || !camera) return <Hint>3D 视图尚未就绪。</Hint>;
  const orthographic = projection === 'orthographic';

  return (
    <Section title="相机参数">
      <SelectRow label="相机类型" value={projection} options={CAMERA_PROJECTIONS}
        onChange={v => { setCameraProjection(v); refresh(); }} />
      <Vec3Field label="位置" value={camera.position} step={0.05} precision={2} unit="m"
        onCommit={v => { engine.setCameraState({ position: v }); refresh(); }} />
      <Vec3Field label="目标" value={camera.target} step={0.05} precision={2} unit="m"
        onCommit={v => { engine.setCameraState({ target: v }); refresh(); }} />
      {orthographic ? (
        <SliderRow label="视野高度" min={0.05} max={20} step={0.05} unit="m" value={camera.viewHeightMeters}
          onChange={v => { engine.setCameraState({ viewHeightMeters: v }); }} commitOnRelease={false} />
      ) : (
        <SliderRow label="视野角" min={20} max={90} step={1} unit="°" value={camera.fovDeg}
          onChange={v => { engine.setCameraState({ fovDeg: v }); }} commitOnRelease={false} />
      )}
      <div style={styles.note}>视角预设在 3D 窗格上方的「视角」下拉里；机位、目标、视野与相机类型随工程保存，打开工程时恢复。</div>
    </Section>
  );
}

/** Pattern object behind an `@kind:id` element row. */
function useElement(_project: Project, nodeId: string) {
  const m = /^@(point|edge|internal|dart|notch|annotation|measurement|print|topstitch|trim):(.+)$/.exec(nodeId);
  if (!m) return null;
  return { kind: m[1], id: m[2] };
}

function PointData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const point = el?.kind === 'point' ? project.pattern.points[el.id] : null;
  if (!point) return <Hint>点已删除。</Hint>;

  const setPoint = (label: string, patch: Partial<PatternPoint>) => patchValue(
    label,
    p => p.pattern.points[point.id],
    (ctx, value) => { ctx.project.pattern.points[point.id] = { ...value }; },
    { ...point, ...patch },
  );

  /** Rigid move of the point and everything hung on it. */
  const move = (delta: Vec2) => useProjectStore.getState()
    .executeCommand(new MovePointsCommand(new Map([[point.id, delta]])));

  return (
    <Section title="点">
      <Row label="坐标(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={point.pos.x} step={0.1} precision={2} title="X 坐标"
            onCommit={v => move({ x: v - point.pos.x, y: 0 })} />
          <NumberField value={point.pos.y} step={0.1} precision={2} title="Y 坐标"
            onCommit={v => move({ x: 0, y: v - point.pos.y })} />
        </span>
      </Row>
      <SelectRow label="点类型" value={point.kind ?? 'corner'}
        options={[{ value: 'corner', label: '角点' }, { value: 'smooth', label: '曲线点' }]}
        onChange={v => setPoint('修改点类型', { kind: v as 'corner' | 'smooth' })} />
      <Row label="手柄">{point.handleIn || point.handleOut ? '有' : '无'}</Row>
      <GradingRows project={project} point={point} />
    </Section>
  );
}

/** Per-size grading offsets of one point; blank when the project has no size chart. */
function GradingRows({ project, point }: { project: Project; point: PatternPoint }) {
  const sizes = orderedSizes(project).filter(s => !s.isBase);
  const selection = useUIStore(s => s.selection);
  const clipboard = useUIStore(s => s.gradingClipboard);
  const setClipboard = useUIStore(s => s.setGradingClipboard);
  if (sizes.length === 0) return null;

  const setGrade = (sizeId: string, axis: 'x' | 'y', value: number) => {
    const current = point.grading?.[sizeId] ?? { x: 0, y: 0 };
    useProjectStore.getState().executeCommand(
      new SetPointGradingCommand(point.id, sizeId, { ...current, [axis]: value }),
    );
  };

  /** Writes the copied delta onto every selected point, as one undo step. */
  const paste = (sizeId: string) => {
    if (!clipboard) return;
    const map = gradingPasteMap(project.pattern, sizeId, clipboard, idsOfKind(selection, 'point'), point.id);
    useProjectStore.getState().executeCommand(new SetPointsGradingCommand(map));
  };

  return (
    <>
      {sizes.map(size => {
        const delta = point.grading?.[size.id] ?? { x: 0, y: 0 };
        return (
          <Row key={size.id} label={`放码 ${size.label}:cm`}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <NumberField value={delta.x} step={0.05} precision={2} title={`${size.label} X 放缩量`}
                onCommit={v => setGrade(size.id, 'x', v)} />
              <NumberField value={delta.y} step={0.05} precision={2} title={`${size.label} Y 放缩量`}
                onCommit={v => setGrade(size.id, 'y', v)} />
              <SmallButton onClick={() => setClipboard({ ...delta })} title="把这一码的放缩量放进剪贴板">复制</SmallButton>
              <SmallButton disabled={!clipboard} onClick={() => paste(size.id)}
                title="把剪贴板的放缩量写给所有选中点">粘贴</SmallButton>
            </span>
          </Row>
        );
      })}
      <div style={styles.note}>复制取的是这一行当前的 X/Y 放缩量；粘贴一次写给全部选中点，撤销一步全退。</div>
    </>
  );
}

const EDGE_TYPE_LABELS: Record<EdgeType, string> = { line: '直线', bezier: '曲线', arc: '圆弧' };
const EDGE_SEMANTIC_OPTIONS = [
  { value: 'free', label: '自由边' }, { value: 'hem', label: '脚口' }, { value: 'neckline', label: '领口' },
  { value: 'armhole', label: '袖窿' }, { value: 'sideSeam', label: '侧缝' }, { value: 'shoulder', label: '肩线' },
  { value: 'sleeveCap', label: '袖山' }, { value: 'waist', label: '腰节' }, { value: 'dart', label: '省道' },
  { value: 'internal', label: '内部' },
];

function EdgeData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const edge = el?.kind === 'edge' ? project.pattern.edges[el.id] : null;
  if (!edge) return <Hint>边已删除。</Hint>;
  const pattern = project.pattern;
  const length = edgeLength(pattern, edge.id);

  const setEdge = (label: string, patch: Partial<PatternEdge>) => patchValue(
    label,
    p => p.pattern.edges[edge.id],
    (ctx, value) => { ctx.project.pattern.edges[edge.id] = { ...value }; },
    { ...edge, ...patch },
  );

  /** Outline edges sharing a vertex with this one, as angle references. */
  const neighbours = outlineNeighbours(pattern, edge);

  const execute = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };

  return (
    <Section title="边">
      <Row label="边类型">{EDGE_TYPE_LABELS[edge.type]}</Row>
      <Row label="长度(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={length} step={0.1} precision={2} min={0.01} title="目标边长；只移动终点"
            onCommit={v => execute(new SetEdgeLengthCommand(edge.id, v))} />
        </span>
      </Row>
      {edge.type === 'arc' && edge.arc && (
        <>
          <Row label="半径(cm)">
            <NumberField value={edge.arc.radius} step={0.1} precision={2} min={0.01} title="圆弧半径；两端点保持不动"
              onCommit={v => execute(new SetArcParamsCommand(edge.id, { radiusCm: v }))} />
          </Row>
          <Row label="圆心角(°)">
            <NumberField value={Math.abs(arcSpan(edge.arc)) * 180 / Math.PI} step={0.5} precision={1} min={1} max={359} title="圆心角；两端点保持不动"
              onCommit={v => execute(new SetArcParamsCommand(edge.id, { sweepDeg: v }))} />
          </Row>
        </>
      )}
      {neighbours.length > 0 && (
        <Row label="与邻边夹角(°)">
          <AngleRow pattern={pattern} edge={edge} neighbours={neighbours} onCommit={execute} />
        </Row>
      )}
      <SelectRow label="语义" value={edge.semantic ?? 'free'}
        options={EDGE_SEMANTIC_OPTIONS as { value: EdgeSemantic; label: string }[]}
        onChange={v => setEdge('修改边语义', { semantic: v })} />
      <SliderRow label="缝份（此边）" min={0} max={2} step={0.05} unit="cm"
        value={edge.seamAllowanceCm ?? 0}
        commitOnRelease
        onChange={v => setEdge('修改边缝份', { seamAllowanceCm: v })} />
      <SelectRow label="角型" value={edge.cornerStyle ?? 'miter'}
        options={[{ value: 'miter', label: '尖角' }, { value: 'round', label: '圆弧' }, { value: 'bevel', label: '斜角' }]}
        onChange={v => setEdge('修改角型', { cornerStyle: v as 'miter' | 'round' | 'bevel' })} />
    </Section>
  );
}

/** Outline edges of the same panel that meet this edge at one of its vertices. */
function outlineNeighbours(pattern: Pattern, edge: PatternEdge): PatternEdge[] {
  const panel = Object.values(pattern.panels).find(p => p.outlineEdgeIds.includes(edge.id));
  if (!panel) return [];
  return panel.outlineEdgeIds
    .map(id => pattern.edges[id])
    .filter((e): e is PatternEdge => !!e && e.id !== edge.id
      && (e.startPointId === edge.startPointId || e.startPointId === edge.endPointId
        || e.endPointId === edge.startPointId || e.endPointId === edge.endPointId));
}

/** Reference-edge picker plus the target angle, dispatched as SetEdgeAngleCommand. */
function AngleRow({ pattern, edge, neighbours, onCommit }: {
  pattern: Pattern;
  edge: PatternEdge;
  neighbours: PatternEdge[];
  onCommit: (cmd: Command) => void;
}) {
  const [referenceId, setReferenceId] = useState(neighbours[0]!.id);
  const reference = neighbours.find(e => e.id === referenceId) ?? neighbours[0]!;
  const sharedId = reference.startPointId === edge.startPointId || reference.endPointId === edge.startPointId
    ? edge.startPointId
    : edge.endPointId;
  const at = pattern.points[sharedId]!.pos;
  const from = (e: PatternEdge): string => (e.startPointId === sharedId ? e.endPointId : e.startPointId);
  const a = pattern.points[from(edge)]!.pos;
  const b = pattern.points[from(reference)]!.pos;
  const current = Math.abs(((Math.atan2(a.y - at.y, a.x - at.x) - Math.atan2(b.y - at.y, b.x - at.x)) * 180 / Math.PI + 540) % 360 - 180);

  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <PopupSelect
        value={referenceId}
        options={neighbours.map(e => ({ value: e.id, label: edgeLabel(pattern, e.id) }))}
        onChange={setReferenceId}
        title="作为角度参照的邻边"
      />
      <NumberField value={current} step={0.5} precision={1} min={1} max={179} title="输入目标夹角"
        onCommit={v => onCommit(new SetEdgeAngleCommand(edge.id, referenceId, v))} />
    </span>
  );
}

function InternalLineData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const line = el?.kind === 'internal' ? project.pattern.internalLines[el.id] : null;
  if (!line) return <Hint>内部线已删除。</Hint>;

  const setLine = (label: string, patch: Partial<InternalLine>) => patchValue(
    label,
    p => p.pattern.internalLines[line.id],
    (ctx, value) => { ctx.project.pattern.internalLines[line.id] = { ...value }; },
    { ...line, ...patch },
  );

  return (
    <Section title="内部线">
      <SelectRow label="用途" value={line.kind}
        options={[{ value: 'split', label: '分割线' }, { value: 'fold', label: '折痕' }, { value: 'decor', label: '装饰线' }]}
        onChange={v => setLine('修改内部线用途', { kind: v as 'split' | 'fold' | 'decor' })} />
      <Row label="点数">{line.points.length}</Row>
    </Section>
  );
}

function DartData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const dart = el?.kind === 'dart' ? project.pattern.darts[el.id] : null;
  if (!dart) return <Hint>省道已删除。</Hint>;

  const setDart = (label: string, patch: Partial<Dart>) => patchValue(
    label,
    p => p.pattern.darts[dart.id],
    (ctx, value) => { ctx.project.pattern.darts[dart.id] = { ...value }; },
    { ...dart, ...patch },
  );

  return (
    <Section title="省道">
      <SliderRow label="省量" min={0.5} max={6} step={0.1} unit="cm" value={dart.intakeCm} commitOnRelease
        onChange={v => setDart('修改省量', { intakeCm: v })} />
      <CheckRow label="收省（模拟时缝合省边）" checked={!!dart.closing}
        onChange={v => setDart(v ? '闭合省道' : '打开省道', { closing: v })} />
      <Row label="省尖(cm)">{`${project.pattern.points[dart.tipId]?.pos.x.toFixed(1)}, ${project.pattern.points[dart.tipId]?.pos.y.toFixed(1)}`}</Row>
      <ButtonRow>
        <SmallButton
          title="先选中一条轮廓边，再把省道转移到该边"
          onClick={() => {
            const target = idsOfKind(useUIStore.getState().selection, 'edge')[0];
            if (!target || !project.pattern.edges[target]) {
              reportActionError(new Error('请先选中一条轮廓边'));
              return;
            }
            useProjectStore.getState().executeCommand(new TransferDartCommand(dart.id, target, 0.5));
          }}
        >转移到选中边</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Edge-relative production mark: position, width and glyph style. */
function NotchData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const notch = el?.kind === 'notch' ? project.pattern.notches?.[el.id] : null;
  if (!notch) return <Hint>刀口已删除。</Hint>;
  const edge = project.pattern.edges[notch.edgeId];

  const setNotch = (label: string, patch: Partial<Notch>) => patchValue(
    label,
    p => p.pattern.notches?.[notch.id],
    (ctx, value) => {
      const map = ctx.project.pattern.notches;
      if (map && value) map[notch.id] = value;
    },
    { ...notch, ...patch },
  );

  return (
    <Section title="刀口">
      <Row label="所在边">{edge ? `${EDGE_TYPE_LABELS[edge.type]} ${notch.edgeId}` : '边已删除'}</Row>
      <SliderRow label="位置" min={0} max={1} step={0.01} value={notch.t} commitOnRelease
        onChange={v => setNotch('移动刀口', { t: v })} />
      <SliderRow label="宽度" min={1} max={10} step={0.5} unit="mm" value={notch.widthMm ?? 3} commitOnRelease
        onChange={v => setNotch('修改刀口宽度', { widthMm: v })} />
      <SelectRow label="样式" value={notch.style ?? 'v'}
        options={[{ value: 'v', label: 'V 形' }, { value: 't', label: 'T 形' }, { value: 'drill', label: '钻孔' }]}
        onChange={v => setNotch('修改刀口样式', { style: v as Notch['style'] })} />
      <ButtonRow>
        <SmallButton onClick={() => useProjectStore.getState().executeCommand(new DeleteNotchCommand(notch.id))}>删除刀口</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Free text note carried on a panel. */
function AnnotationData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const note = el?.kind === 'annotation' ? project.pattern.annotations?.[el.id] : null;
  if (!note) return <Hint>注释已删除。</Hint>;

  const setNote = (label: string, patch: Partial<Annotation>) => patchValue(
    label,
    p => p.pattern.annotations?.[note.id],
    (ctx, value) => {
      const map = ctx.project.pattern.annotations;
      if (map && value) map[note.id] = value;
    },
    { ...note, ...patch },
  );

  return (
    <Section title="注释">
      <TextRow label="文字" value={note.text} onChange={v => setNote('修改注释文字', { text: v })} />
      <SliderRow label="角度" min={-180} max={180} step={1} unit="°" value={note.angleDeg ?? 0} commitOnRelease
        onChange={v => setNote('修改注释角度', { angleDeg: v })} />
      <SliderRow label="字号" min={2} max={12} step={0.5} unit="mm" value={note.sizeMm ?? 4} commitOnRelease
        onChange={v => setNote('修改注释字号', { sizeMm: v })} />
      <Row label="坐标(cm)">{`${note.pos.x.toFixed(2)}, ${note.pos.y.toFixed(2)}`}</Row>
      <ButtonRow>
        <SmallButton onClick={() => useProjectStore.getState().executeCommand(new DeleteAnnotationCommand(note.id))}>删除注释</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Dimension line: the value is measured from the geometry, never stored. */
function MeasurementData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const measurement = el?.kind === 'measurement' ? project.pattern.measurements?.[el.id] : null;
  if (!measurement) return <Hint>尺寸标注已删除。</Hint>;
  const suffix = measurement.kind === 'angle' ? '°' : ' cm';
  const digits = measurement.kind === 'angle' ? 1 : 2;
  const current = measurementValue(project.pattern, measurement);

  const setKind = (kind: Measurement['kind']) => patchValue(
    '修改标注类型',
    p => p.pattern.measurements?.[measurement.id],
    (ctx, val) => {
      const map = ctx.project.pattern.measurements;
      if (map && val) map[measurement.id] = val;
    },
    { ...measurement, kind },
  );

  /** Same reading resolved onto each chart size, for the multi-size table. */
  const perSize = orderedSizes(project).map(size => {
    const resolved = resolveSize(project.pattern, project.activeSizeId, size.id);
    const value = measurementValue(resolved, measurement);
    return { label: size.label, text: value === null ? '—' : `${value.toFixed(digits)}${suffix}` };
  });

  return (
    <Section title="尺寸标注">
      <SelectRow label="尺寸线类型" value={measurement.kind}
        options={[{ value: 'distance', label: '两点距离' }, { value: 'edgeLength', label: '边长' }, { value: 'angle', label: '角度' }]}
        onChange={v => setKind(v as Measurement['kind'])} />
      <Row label="数值">{current === null ? '参照已删除' : `${current.toFixed(digits)}${suffix}`}</Row>
      {perSize.length > 1 && perSize.map(s => <Row key={s.label} label={`各码 ${s.label}`}>{s.text}</Row>)}
      <ButtonRow>
        <SmallButton onClick={() => useProjectStore.getState().executeCommand(new DeleteMeasurementCommand(measurement.id))}>删除标注</SmallButton>
      </ButtonRow>
    </Section>
  );
}

/** Artwork print placed on a panel; the placement drives both the 2D rectangle and the 3D composite. */
function PrintData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const print = el?.kind === 'print' ? project.pattern.prints?.[el.id] : null;
  if (!print) return <Hint>印花已删除。</Hint>;
  const panelName = project.pattern.panels[print.panelId]?.name ?? '—';

  const run = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };
  const set = (patch: Partial<Omit<Print, 'id' | 'panelId'>>) => run(new UpdatePrintCommand(print.id, patch));

  return (
    <Section title="印花">
      <Row label="版片">{panelName}</Row>
      <Row label="图片">{print.imageName ?? '已载入'}</Row>
      <Row label="宽 × 高(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={print.widthCm} step={0.5} precision={2} min={0.1} max={1000} title="印花宽度"
            onCommit={v => set({ widthCm: v })} />
          <NumberField value={print.heightCm} step={0.5} precision={2} min={0.1} max={1000} title="印花高度"
            onCommit={v => set({ heightCm: v })} />
        </span>
      </Row>
      <SliderRow label="角度" min={-180} max={180} step={1} unit="°" value={print.angleDeg} commitOnRelease
        onChange={v => set({ angleDeg: v })} />
      <SliderRow label="不透明度" min={0} max={1} step={0.01} value={print.opacity} commitOnRelease
        onChange={v => set({ opacity: v })} />
      <Row label="平铺(次)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={print.repeat.x} step={1} precision={0} min={1} max={50} title="横向平铺次数"
            onCommit={v => set({ repeat: { ...print.repeat, x: v } })} />
          <NumberField value={print.repeat.y} step={1} precision={0} min={1} max={50} title="纵向平铺次数"
            onCommit={v => set({ repeat: { ...print.repeat, y: v } })} />
        </span>
      </Row>
      <Row label="位置(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={print.center.x} step={0.5} precision={2} title="相对版片外接框中心的横向偏移"
            onCommit={v => set({ center: { ...print.center, x: v } })} />
          <NumberField value={print.center.y} step={0.5} precision={2} title="相对版片外接框中心的纵向偏移"
            onCommit={v => set({ center: { ...print.center, y: v } })} />
        </span>
      </Row>
      <ButtonRow>
        <SmallButton onClick={() => run(new DeleteElementsCommand([elementNodeId('print', print.id)]))}>删除印花</SmallButton>
      </ButtonRow>
      <div style={styles.note}>位置相对版片外接框中心；角度逆时针为正。2D 虚线框标出印花范围，3D 按版片 UV 把图案裁进面料底色。</div>
    </Section>
  );
}

/** Decorative stitch line offset inward from one panel edge. */
function TopstitchData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const stitch = el?.kind === 'topstitch' ? project.pattern.topstitches?.[el.id] : null;
  if (!stitch) return <Hint>明线已删除。</Hint>;
  const panelName = project.pattern.panels[stitch.panelId]?.name ?? '—';
  const edge = project.pattern.edges[stitch.edgeId];

  const run = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };
  const set = (patch: Partial<Omit<Topstitch, 'id' | 'panelId' | 'edgeId'>>) =>
    run(new UpdateTopstitchCommand(stitch.id, patch));

  return (
    <Section title="明线">
      <Row label="版片">{panelName}</Row>
      <Row label="所在边">{edge ? edgeLabel(project.pattern, stitch.edgeId) : '边已删除'}</Row>
      <SliderRow label="起点" min={0} max={1} step={0.01} value={stitch.t0} commitOnRelease
        onChange={v => set({ t0: Math.min(v, stitch.t1 - 0.01) })} />
      <SliderRow label="终点" min={0} max={1} step={0.01} value={stitch.t1} commitOnRelease
        onChange={v => set({ t1: Math.max(v, stitch.t0 + 0.01) })} />
      <SliderRow label="偏移" min={0} max={20} step={0.5} unit="mm" value={stitch.offsetMm} commitOnRelease
        onChange={v => set({ offsetMm: v })} />
      <Row label="行数">
        <NumberField value={stitch.rows} step={1} precision={0} min={1} max={5} title="平行行数，逐行向版片内侧递增"
          onCommit={v => set({ rows: Math.round(v) })} />
      </Row>
      <SliderRow label="行距" min={0.5} max={20} step={0.5} unit="mm" value={stitch.spacingMm} commitOnRelease
        onChange={v => set({ spacingMm: v })} />
      <ColorRow label="线色" value={stitch.color} onChange={v => set({ color: v })} />
      <SliderRow label="针距" min={0.5} max={20} step={0.5} unit="mm" value={stitch.stitchMm} commitOnRelease
        onChange={v => set({ stitchMm: v })} />
      <SliderRow label="空距" min={0.5} max={20} step={0.5} unit="mm" value={stitch.gapMm} commitOnRelease
        onChange={v => set({ gapMm: v })} />
      <ButtonRow>
        <SmallButton onClick={() => run(new DeleteElementsCommand([elementNodeId('topstitch', stitch.id)]))}>删除明线</SmallButton>
      </ButtonRow>
      <div style={styles.note}>明线沿边向版片内侧偏移，2D 按针距与空距画虚线；同一条边可叠多行，线长按区间长度与行数计入物料清单。</div>
    </Section>
  );
}

/** Button, eyelet, rivet or snap mark recorded for the bill of materials. */
function TrimData({ project, nodeId }: { project: Project; nodeId: string }) {
  const el = useElement(project, nodeId);
  const trim = el?.kind === 'trim' ? project.pattern.trims?.[el.id] : null;
  if (!trim) return <Hint>辅料已删除。</Hint>;
  const panelName = project.pattern.panels[trim.panelId]?.name ?? '—';

  const run = (cmd: Command) => {
    try {
      useProjectStore.getState().executeCommand(cmd);
    } catch (err) {
      reportActionError(err);
    }
  };
  const set = (patch: Partial<Omit<Trim, 'id' | 'panelId'>>) => run(new UpdateTrimCommand(trim.id, patch));

  return (
    <Section title="辅料">
      <Row label="版片">{panelName}</Row>
      <SelectRow label="类型" value={trim.kind}
        options={TRIM_KINDS.map(kind => ({ value: kind, label: TRIM_KIND_LABELS[kind] }))}
        onChange={v => set({ kind: v as TrimKind })} />
      <Row label="直径(mm)">
        <NumberField value={trim.sizeMm} step={0.5} precision={1} min={0.5} max={200} title="辅料直径"
          onCommit={v => set({ sizeMm: v })} />
      </Row>
      <ColorRow label="颜色" value={trim.color} onChange={v => set({ color: v })} />
      <Row label="数量">
        <NumberField value={trim.qty} step={1} precision={0} min={1} max={9999} title="这个标记代表的件数"
          onCommit={v => set({ qty: Math.round(v) })} />
      </Row>
      <Row label="单价(元)">
        <NumberField value={trim.unitPrice ?? 0} step={0.1} precision={2} min={0} title="填 0 表示不计价"
          onCommit={v => set({ unitPrice: v > 0 ? v : undefined })} />
      </Row>
      <Row label="位置(cm)">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField value={trim.pos.x} step={0.5} precision={2} title="X 坐标"
            onCommit={v => set({ pos: { ...trim.pos, x: v } })} />
          <NumberField value={trim.pos.y} step={0.5} precision={2} title="Y 坐标"
            onCommit={v => set({ pos: { ...trim.pos, y: v } })} />
        </span>
      </Row>
      <ButtonRow>
        <SmallButton onClick={() => run(new DeleteElementsCommand([elementNodeId('trim', trim.id)]))}>删除辅料</SmallButton>
      </ButtonRow>
      <div style={styles.note}>辅料只在 2D 与物料清单中出现，不生成 3D 实体；数量按这个标记的件数计入，填了单价才计算金额。</div>
    </Section>
  );
}

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
