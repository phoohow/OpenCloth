import { useState } from 'react';
import { useUIStore } from '@/store';
import type { LightType, Project, SceneLight } from '@/model/types';
import { LIGHT_TYPES, LIGHT_TYPE_LABELS, normalizeLights } from '@/model';
import {
  commitEnvironmentReset, commitReferenceOpacity, patchLight, patchValue, removeLight, removeReference,
  type EngineRef,
} from '@/ui/sceneCommands';
import { importEnvironmentViaPicker } from '@/ui/modelImport';
import {
  ButtonRow, ColorRow, Hint, Row, Section, SelectRow, SliderRow, SmallButton,
} from '@/ui/widgets/propertyRows';
import { Vec3Field } from '@/ui/widgets/numberField';
import { CAMERA_PROJECTIONS } from '@/ui/optionTables';
import { styles } from '@/ui/panels/properties/styles';
import { lightObjectId, referenceObjectId } from '@/model';

export function ReferenceData({ project, nodeId, engineRef }: {
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

export function LightData({ project, nodeId }: { project: Project; nodeId: string }) {
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

export function EnvironmentData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
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

export function CameraData({ engineRef }: { engineRef: EngineRef }) {
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
