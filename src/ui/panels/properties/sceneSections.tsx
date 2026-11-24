import type {
  CameraAnimationConfig, CameraAnimationKind, EnvironmentSource, LightType, Project, SceneLight,
} from '@/model/types';

import {
  CAMERA_ANIMATION_KINDS, CAMERA_ANIMATION_LABELS, LIGHT_TYPES, LIGHT_TYPE_LABELS,
  MAX_CAMERA_ANIMATION_PERIOD_SEC, environmentSource, hasOwnEnvironment, normalizeCameraAnimation, normalizeLights,
} from '@/model';
import { parseSceneRef } from '@/model';
import { useUIStore } from '@/store';
import { Icon } from '@/ui/icons';
import { importEnvironmentViaPicker } from '@/ui/modelImport';
import { CAMERA_PROJECTIONS } from '@/ui/optionTables';
import { opacityOf, transparencyOf } from '@/ui/panels/properties/constants';
import {
  commitEnvironmentReset, commitEnvironmentSource, commitReferenceOpacity, patchLight, patchValue,
  type EngineRef,
} from '@/ui/sceneCommands';
import { Vec3Field } from '@/ui/widgets/numberField';
import {
  CheckRow, ColorRow, Hint, IconButton, Row, Section, SelectRow, SliderRow,
} from '@/ui/widgets/propertyRows';
import { useState } from 'react';

const INTENSITY_RANGE: Record<LightType, { max: number; step: number }> = {
  directional: { max: 10, step: 0.1 },
  point: { max: 300, step: 1 },
  spot: { max: 300, step: 1 },
  area: { max: 60, step: 0.5 },
};

const AMPLITUDE_RANGE: Record<CameraAnimationKind, {
  label: string; min: number; max: number; step: number; tip: string;
}> = {
  orbit: { label: '旋转角度', min: 5, max: 180, step: 5, tip: '°' },
  dolly: { label: '推拉距离', min: 0, max: 2, step: 0.05, tip: 'm' },
  pan: { label: '平移幅度', min: 0, max: 2, step: 0.05, tip: 'm' },
  crane: { label: '升降幅度', min: 0, max: 2, step: 0.05, tip: 'm' },
};

export function ReferenceData({ project, nodeId, engineRef }: {
  project: Project; nodeId: string; engineRef: EngineRef;
}) {
  const nodeRef = parseSceneRef(nodeId);
  if (nodeRef.kind !== 'reference') return <Hint>参考物已删除。</Hint>;
  const refId = nodeRef.id;
  const ref = (project.scene.referenceObjects ?? []).find(r => r.id === refId);
  if (!ref) return <Hint>参考物已删除。</Hint>;
  return (
    <Section title="参考物">
      <Row label="模型">{ref.objectKey ? '已存入' : '已失效'}</Row>
      <SliderRow label="透明度" tip="越大越透明，0 完全不透明" min={0} max={0.95} step={0.05}
        value={transparencyOf(ref.opacity)} commitOnRelease
        onChange={v => commitReferenceOpacity(refId, opacityOf(v), engineRef)} />
    </Section>
  );
}

function lightOf(project: Project, nodeId: string): SceneLight | null {
  const nodeRef = parseSceneRef(nodeId);
  if (nodeRef.kind !== 'light') return null;
  return normalizeLights(project.scene.lights).find(l => l.id === nodeRef.id) ?? null;
}

export function LightPlacementData({ project, nodeId }: { project: Project; nodeId: string }) {
  const light = lightOf(project, nodeId);
  if (!light) return <Hint>光源已删除。</Hint>;
  const aims = light.type !== 'point';

  return (
    <Section title="位置">
      <Vec3Field label={light.type === 'directional' ? '方向' : '位置'} tip="m" value={light.position}
        step={0.05} precision={2}
        onCommit={v => patchLight(light.id, '修改光源位置', { position: v })} />
      {aims && (
        <Vec3Field label="目标" tip="m" value={light.target} step={0.05} precision={2}
          onCommit={v => patchLight(light.id, '修改光源目标', { target: v })} />
      )}
    </Section>
  );
}

export function LightData({ project, nodeId }: { project: Project; nodeId: string }) {
  const light = lightOf(project, nodeId);
  if (!light) return <Hint>光源已删除。</Hint>;
  const punctual = light.type === 'point' || light.type === 'spot';

  const set = (label: string, patch: Partial<SceneLight>) => patchLight(light.id, label, patch);

  return (
    <>
      <Section title="光源">
        <SelectRow label="类型" value={light.type}
          options={LIGHT_TYPES.map(t => ({ value: t, label: LIGHT_TYPE_LABELS[t] }))}
          onChange={v => set('修改光源类型', { type: v })} />
        <SliderRow label="强度" min={0} max={INTENSITY_RANGE[light.type].max} step={INTENSITY_RANGE[light.type].step}
          value={light.intensity} commitOnRelease
          onChange={v => set('修改光源强度', { intensity: v })} />
        <ColorRow label="颜色" value={light.color} onChange={v => set('修改光源颜色', { color: v })} />
      </Section>
      {light.type !== 'directional' && (
        <Section title="范围">
          {punctual && (
            <SliderRow label="距离" tip="光照衰减到零的距离（m）" min={0} max={20} step={0.5} value={light.distance} commitOnRelease
              onChange={v => set('修改光源距离', { distance: v })} />
          )}
          {light.type === 'spot' && (
            <>
              <SliderRow label="锥角" tip="°" min={1} max={120} step={1} value={light.coneAngleDeg} commitOnRelease
                onChange={v => set('修改聚光灯锥角', { coneAngleDeg: v })} />
              <SliderRow label="柔边" tip="光斑边缘过渡的柔和程度" min={0} max={1} step={0.05} value={light.penumbra} commitOnRelease
                onChange={v => set('修改聚光灯边缘', { penumbra: v })} />
            </>
          )}
          {light.type === 'area' && (
            <>
              <SliderRow label="宽度" tip="m" min={0.05} max={10} step={0.05} value={light.width} commitOnRelease
                onChange={v => set('修改面积光宽度', { width: v })} />
              <SliderRow label="高度" tip="m" min={0.05} max={10} step={0.05} value={light.height} commitOnRelease
                onChange={v => set('修改面积光高度', { height: v })} />
            </>
          )}
        </Section>
      )}
    </>
  );
}

export function EnvironmentData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const lights = project.scene.lights;
  const hasOwnImage = hasOwnEnvironment(lights);
  const source = environmentSource(lights);
  const ready = !!engineRef.current;
  const options: Array<{ value: EnvironmentSource; label: string }> = [
    { value: 'builtin', label: '内置影棚' },
  ];
  if (hasOwnImage) options.push({ value: 'custom', label: lights.iblName ?? lights.iblUrl ?? '外链环境图' });

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
      <SelectRow label="环境图" tip="点亮场景的环境贴图，可在内置与导入的贴图之间切换" value={source} options={options}
        onChange={v => commitEnvironmentSource(v)}
        trailing={(
          <>
            <IconButton title="导入环境图" disabled={!ready}
              onClick={() => void importEnvironmentViaPicker()}><Icon name="plus" size={10} /></IconButton>
            <IconButton title="移除导入的环境图，改用内置贴图" disabled={!ready || source !== 'custom'}
              onClick={() => commitEnvironmentReset()}><Icon name="minus" size={10} /></IconButton>
          </>
        )} />
      <SliderRow label="强度" tip="环境贴图的整体亮度" min={0} max={2} step={0.05} value={lights.iblIntensity} commitOnRelease
        onChange={setIntensity} />
    </Section>
  );
}

export function CameraData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const [, bump] = useState(0);
  const engine = engineRef.current;
  const camera = engine?.getCameraState() ?? null;
  const projection = useUIStore(s => s.cameraProjection);
  const setCameraProjection = useUIStore(s => s.setCameraProjection);
  const refresh = () => bump(n => n + 1);
  const animation = normalizeCameraAnimation(project.scene.cameraAnimation);
  const amplitude = AMPLITUDE_RANGE[animation.kind];

  if (!engine || !camera) return <Hint>3D 视图尚未就绪。</Hint>;
  const orthographic = projection === 'orthographic';

  const patchAnimation = (patch: Partial<CameraAnimationConfig>) => {
    const next = normalizeCameraAnimation({ ...animation, ...patch });
    patchValue('修改相机动画', p => p.scene.cameraAnimation, (ctx, value) => {
      ctx.project.scene = { ...ctx.project.scene, cameraAnimation: value };
    }, next);
  };

  return (
    <>
      <Section title="相机">
        <SelectRow label="类型" value={projection} options={CAMERA_PROJECTIONS}
          onChange={v => { setCameraProjection(v); refresh(); }} />
        <Vec3Field label="位置" tip="m" value={camera.position} step={0.05} precision={2}
          onCommit={v => { engine.setCameraState({ position: v }); refresh(); }} />
        <Vec3Field label="目标" tip="m" value={camera.target} step={0.05} precision={2}
          onCommit={v => { engine.setCameraState({ target: v }); refresh(); }} />
        {orthographic ? (
          <SliderRow label="视野高度" tip="正交相机可见的高度（m）" min={0.05} max={20} step={0.05} value={camera.viewHeightMeters}
            onChange={v => { engine.setCameraState({ viewHeightMeters: v }); }} commitOnRelease={false} />
        ) : (
          <SliderRow label="视野角" tip="°" min={20} max={90} step={1} value={camera.fovDeg}
            onChange={v => { engine.setCameraState({ fovDeg: v }); }} commitOnRelease={false} />
        )}
      </Section>
      <Section title="动画">
        <CheckRow label="播放" checked={animation.enabled} onChange={v => patchAnimation({ enabled: v })} />
        <SelectRow label="运镜" tip="相机循环运动的方式" value={animation.kind}
          options={CAMERA_ANIMATION_KINDS.map(kind => ({ value: kind, label: CAMERA_ANIMATION_LABELS[kind] }))}
          onChange={v => patchAnimation({ kind: v })} />
        <SliderRow label="周期" tip="s" min={2} max={MAX_CAMERA_ANIMATION_PERIOD_SEC} step={1}
          value={animation.periodSec} commitOnRelease onChange={v => patchAnimation({ periodSec: v })} />
        <SliderRow label={amplitude.label} tip={amplitude.tip} min={amplitude.min} max={amplitude.max} step={amplitude.step}
          value={Math.min(amplitude.max, animation.amplitude)} commitOnRelease
          onChange={v => patchAnimation({ amplitude: v })} />
      </Section>
    </>
  );
}
