import { useState } from 'react';
import { useUIStore } from '../../../store/stores';
import type { Avatar, LightType, Panel, Project, SceneLight, Seam, SeamType } from '../../../core/model/types';
import {
  BUNDLED_AVATARS, LIGHT_TYPES, LIGHT_TYPE_LABELS, SEAM_TYPES, SEAM_TYPE_LABELS, normalizeLights,
} from '../../../core/model/defaults';
import type { SceneNodeKind } from '../../sceneTree';
import {
  lightObjectId, panelSizeCm, referenceObjectId, seamObjectId, seamPanelNames,
} from '../../sceneTree';
import {
  commitEnvironmentReset, commitReferenceOpacity, patchLight, patchValue, removeLight, removeReference,
  setAvatarDisplay, setEnvironmentEnabled, setSeamsStitchVisible, type EngineRef,
} from '../../sceneCommands';
import { importAvatarViaPicker, importEnvironmentViaPicker } from '../../modelImport';
import { ButtonRow, CheckRow, ColorRow, Hint, Row, Section, SelectRow, SliderRow, SmallButton, TextRow } from '../../widgets/propertyRows';
import { Vec3Field } from '../../widgets/numberField';
import { CAMERA_PROJECTIONS } from '../../optionTables';
import { CUSTOM_MODEL, PROCEDURAL_MODEL, toDeg, toRad } from './constants';
import { styles } from './styles';

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
    default: return <Hint>这个对象类型没有额外的属性。</Hint>;
  }
}

function PanelData({ project, panelId }: { project: Project; panelId: string }) {
  const panel = project.pattern.panels[panelId];
  if (!panel) return <Hint>版型片已删除。</Hint>;
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

  return (
    <>
      <Section title="版型">
        <Row label="轮廓">{size ? `${size.width.toFixed(1)} × ${size.height.toFixed(1)} cm` : '—'}</Row>
        <Row label="轮廓边">{panel.outlineEdgeIds.length}</Row>
        <Row label="省道">{panel.dartIds.length}</Row>
        <Row label="内部线">{panel.internalLineIds.length}</Row>
      </Section>
      <Section title="模拟">
        <SliderRow label="缝份量" min={0} max={2} step={0.05} suffix="cm" value={panel.seamAllowanceCm} commitOnRelease
          onChange={v => setPanel('修改缝份量', { seamAllowanceCm: v })} />
        <SliderRow label="网格边长" min={0.5} max={4} step={0.1} suffix="cm" value={panel.meshResolutionCm} commitOnRelease
          onChange={v => setPanel('修改网格边长', { meshResolutionCm: v })} />
      </Section>
      <Section title="着装">
        <Row label="方式">{panel.drape ? `环绕 ${drapeRegionLabel(panel.drape.region)}` : '自动推断'}</Row>
        {panel.placement && <Row label="手动放置">平面摆放</Row>}
      </Section>
    </>
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

  const bundled = BUNDLED_AVATARS.find(b => b.url === avatar.glbUrl);
  const modelValue = avatar.source === 'procedural'
    ? PROCEDURAL_MODEL
    : bundled ? bundled.url : CUSTOM_MODEL;
  const modelOptions = [
    ...(avatar.source === 'glb' && !bundled ? [{ value: CUSTOM_MODEL, label: `自定义：${avatar.modelName ?? '模型'}` }] : []),
    ...BUNDLED_AVATARS.map(b => ({ value: b.url, label: b.label })),
    { value: PROCEDURAL_MODEL, label: '程序人台' },
  ];

  /** Selecting a bundled model also adopts the measurements that fit its mesh. */
  const chooseModel = (value: string) => {
    if (value === PROCEDURAL_MODEL) setAvatar('恢复程序人台', { source: 'procedural' });
    else if (value !== CUSTOM_MODEL) {
      const model = BUNDLED_AVATARS.find(b => b.url === value);
      if (model) setAvatar('切换模特', {
        source: 'glb', glbUrl: value, modelName: undefined, params: { ...model.params },
      });
    }
  };

  return (
    <>
      <Section title="人体">
        <SelectRow label="显示效果" value={avatar.display === 'translucent' ? 'translucent' : 'solid'}
          options={[{ value: 'solid', label: '实体' }, { value: 'translucent', label: '半透明' }]}
          onChange={v => setAvatarDisplay(v === 'translucent' ? 'translucent' : 'visible', engineRef)} />
        <SliderRow label="身高" min={140} max={200} step={1} suffix="cm" value={avatar.params.heightCm} commitOnRelease
          onChange={v => setAvatar('修改身高', { params: { ...avatar.params, heightCm: v } })} />
        <SliderRow label="胸围" min={60} max={140} step={1} suffix="cm" value={avatar.params.chestCm} commitOnRelease
          onChange={v => setAvatar('修改胸围', { params: { ...avatar.params, chestCm: v } })} />
        <SliderRow label="腰围" min={50} max={130} step={1} suffix="cm" value={avatar.params.waistCm} commitOnRelease
          onChange={v => setAvatar('修改腰围', { params: { ...avatar.params, waistCm: v } })} />
        <SliderRow label="臀围" min={60} max={150} step={1} suffix="cm" value={avatar.params.hipCm} commitOnRelease
          onChange={v => setAvatar('修改臀围', { params: { ...avatar.params, hipCm: v } })} />
        <SliderRow label="手臂外展" min={0} max={45} step={1} suffix="°" value={toDeg(avatar.params.poseArmAngleRad ?? 0.12)} commitOnRelease
          onChange={v => setAvatar('修改手臂外展', { params: { ...avatar.params, poseArmAngleRad: toRad(v) } })} />
        <div style={styles.note}>尺寸改动会重建人体、布料与模拟状态。</div>
      </Section>
      <Section title="模特">
        <SelectRow label="模特" value={modelValue} options={modelOptions} onChange={chooseModel} />
        <ButtonRow>
          <SmallButton disabled={!engineRef.current} onClick={() => engineRef.current && void importAvatarViaPicker()}>导入模特</SmallButton>
        </ButtonRow>
      </Section>
    </>
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

function LightData({ project, nodeId }: { project: Project; nodeId: string }) {
  const light = normalizeLights(project.scene.lights).find(l => l.id === lightObjectId(nodeId));
  if (!light) return <Hint>光源已删除。</Hint>;
  const aims = light.type !== 'point';
  const punctual = light.type === 'point' || light.type === 'spot';

  /** Edits one field of this light. */
  const set = (label: string, patch: Partial<SceneLight>) => patchLight(light.id, label, patch);

  return (
    <>
      <Section title="光源">
        <TextRow label="名称" value={light.name} onChange={v => set('重命名光源', { name: v })} />
        <SelectRow label="类型" value={light.type}
          options={LIGHT_TYPES.map(t => ({ value: t, label: LIGHT_TYPE_LABELS[t] }))}
          onChange={v => set('修改光源类型', { type: v })} />
        <CheckRow label="启用" checked={light.enabled} onChange={v => set(v ? '开启光源' : '关闭光源', { enabled: v })} />
        <SliderRow label="强度" min={0} max={INTENSITY_RANGE[light.type].max} step={INTENSITY_RANGE[light.type].step}
          value={light.intensity} commitOnRelease
          onChange={v => set('修改光源强度', { intensity: v })} />
        <ColorRow label="颜色" value={light.color} onChange={v => set('修改光源颜色', { color: v })} />
        <ButtonRow>
          <SmallButton onClick={() => removeLight(light.id)}>删除光源</SmallButton>
        </ButtonRow>
      </Section>
      <Section title="位置">
        <Vec3Field label={light.type === 'directional' ? '方向' : '位置'} value={light.position}
          step={0.05} precision={2} suffix="m"
          onCommit={v => set('修改光源位置', { position: v })} />
        {aims && (
          <Vec3Field label="目标" value={light.target} step={0.05} precision={2} suffix="m"
            onCommit={v => set('修改光源目标', { target: v })} />
        )}
        {punctual && (
          <SliderRow label="照射距离" min={0} max={20} step={0.5} suffix="m" value={light.distance} commitOnRelease
            onChange={v => set('修改光源距离', { distance: v })} />
        )}
        {light.type === 'spot' && (
          <>
            <SliderRow label="锥角" min={1} max={120} step={1} suffix="°" value={light.coneAngleDeg} commitOnRelease
              onChange={v => set('修改聚光灯锥角', { coneAngleDeg: v })} />
            <SliderRow label="边缘柔化" min={0} max={1} step={0.05} value={light.penumbra} commitOnRelease
              onChange={v => set('修改聚光灯边缘', { penumbra: v })} />
          </>
        )}
        {light.type === 'area' && (
          <>
            <SliderRow label="宽度" min={0.05} max={10} step={0.05} suffix="m" value={light.width} commitOnRelease
              onChange={v => set('修改面积光宽度', { width: v })} />
            <SliderRow label="高度" min={0.05} max={10} step={0.05} suffix="m" value={light.height} commitOnRelease
              onChange={v => set('修改面积光高度', { height: v })} />
          </>
        )}
        <div style={styles.note}>
          {light.type === 'directional'
            ? '方向光的位置只决定照射方向，光线平行射向目标点。'
            : '强度按平方反比衰减，距离 0 表示不限距离。'}
        </div>
      </Section>
    </>
  );
}

function SeamData({ project, nodeId }: { project: Project; nodeId: string }) {
  const seamId = seamObjectId(nodeId);
  const seam = project.pattern.seams[seamId];
  if (!seam) return <Hint>缝线已删除。</Hint>;
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
        <CheckRow label="显示缝线" checked={seam.stitchVisible}
          onChange={v => setSeamsStitchVisible([seamId], v)} />
      </Section>
      <Section title="缝合">
        <SelectRow label="缝型" value={seam.type}
          options={SEAM_TYPES.map(t => ({ value: t, label: SEAM_TYPE_LABELS[t] }))}
          onChange={v => setSeam('修改缝型', { type: v as SeamType })} />
        <SliderRow label="缝合强度" min={0.05} max={1} step={0.05} value={seam.strength} commitOnRelease
          onChange={v => setSeam('修改缝合强度', { strength: v })} />
        <CheckRow label="乙边反向" checked={seam.flipB}
          onChange={v => setSeam(v ? '反转乙边配对' : '恢复乙边配对', { flipB: v })} />
        <ColorRow label="线色" value={seam.threadColor} onChange={v => setSeam('修改线色', { threadColor: v })} />
        <div style={styles.note}>缝型与配对改动在松手后重建布料并重置模拟；显示缝线只影响视口里的线。</div>
      </Section>
    </>
  );
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
      <CheckRow label="启用" checked={lights.iblEnabled} onChange={setEnvironmentEnabled} />
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
      <SelectRow label="类型" value={projection} options={CAMERA_PROJECTIONS}
        onChange={v => { setCameraProjection(v); refresh(); }} />
      <Vec3Field label="位置" value={camera.position} step={0.05} precision={2} suffix="m"
        onCommit={v => { engine.setCameraState({ position: v }); refresh(); }} />
      <Vec3Field label="目标" value={camera.target} step={0.05} precision={2} suffix="m"
        onCommit={v => { engine.setCameraState({ target: v }); refresh(); }} />
      {orthographic ? (
        <SliderRow label="视野高度" min={0.05} max={20} step={0.05} suffix="m" value={camera.viewHeightMeters}
          onChange={v => { engine.setCameraState({ viewHeightMeters: v }); }} commitOnRelease={false} />
      ) : (
        <SliderRow label="视野角" min={20} max={90} step={1} suffix="°" value={camera.fovDeg}
          onChange={v => { engine.setCameraState({ fovDeg: v }); }} commitOnRelease={false} />
      )}
      <div style={styles.note}>视角预设在 3D 窗格上方的「视角」下拉里；机位与视野属于视口状态，不写入工程文件。</div>
    </Section>
  );
}
