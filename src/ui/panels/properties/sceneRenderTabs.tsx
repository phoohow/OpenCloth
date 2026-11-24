import type { Project } from '@/model/types';

import { fitReportCsv } from '@/analysis';
import { DEFAULT_PRESSURE_KPA_PER_MM } from '@/analysis';
import { pressureReportCsv } from '@/analysis';
import { strainReportCsv } from '@/analysis';
import { AutoAssignCollisionLayersCommand } from '@/commands';
import { downloadTextFile } from '@/io/serialization';
import {
  DEFAULT_CLOTH_THICKNESS_CM, DEFAULT_COMPRESSION_LIMIT, DEFAULT_LAYER_SPACING_CM,
  DEFAULT_MESH_RESOLUTION_CM, DEFAULT_MESH_SAMPLING, DEFAULT_STRETCH_LIMIT, MESH_RESOLUTION_MAX_CM,
  MESH_RESOLUTION_MIN_CM, normalizeRayTracing,
} from '@/model';
import { displayModeOf, usePerfStore, useProjectStore, useSimStore, useUIStore } from '@/store';
import {
  WIRE_AUX_OPTIONS, PROXY_AUX_OPTIONS, GIRTH_LINES_AUX_OPTIONS, SKELETON_AUX_OPTIONS, DENOISE_MODELS, DISPLAY_MODES, MESH_SAMPLINGS, TONE_MAPPING,
  rayTracingUnavailableReason,
} from '@/ui/optionTables';
import { LayerSection } from '@/ui/panels/properties/layerSection';
import { SizeChart } from '@/ui/panels/properties/objectDataSections';
import { PomSection } from '@/ui/panels/properties/pomSection';
import { styles } from '@/ui/panels/properties/styles';
import { patchValue, setRayTracingConfig, setSimulationConfig, setToneMapping, type EngineRef } from '@/ui/sceneCommands';
import { ButtonRow, CheckRow, Row, Section, SelectRow, SliderRow, SmallButton, TextRow } from '@/ui/widgets/propertyRows';
import { reportActionError } from '@/ui/widgets/toast';

export function PatternTab({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  return (
    <>
      <SizeChart project={project} engineRef={engineRef} />
      <PomSection project={project} />
    </>
  );
}

export function ProjectTab({ project }: { project: Project }) {
  const sim = project.scene.simulation;
  const panels = Object.values(project.pattern.panels);
  const refs = project.scene.referenceObjects ?? [];

  const autoAssignLayers = () => {
    try {
      useProjectStore.getState().executeCommand(new AutoAssignCollisionLayersCommand());
      useUIStore.getState().showToast('已按缝合关系识别碰撞层');
    } catch (err) {
      reportActionError(err, '自动识别碰撞层失败');
    }
  };

  return (
    <>
      <Section title="工程">
        <TextRow label="名称" value={project.meta.name}
          onChange={v => patchValue('重命名工程',
            p => p.meta.name,
            (ctx, name) => { ctx.project.meta = { ...ctx.project.meta, name }; }, v)} />
        <Row label="版片">{panels.length}</Row>
        <Row label="缝合">{Object.keys(project.pattern.seams).length}</Row>
        <Row label="面料">{Object.keys(project.fabrics).length}</Row>
        <Row label="参考物">{refs.length}</Row>
      </Section>
      <Section title="网格">
        <SelectRow label="采样" tip="面片内部的采样点分布方式" value={sim.meshSampling ?? DEFAULT_MESH_SAMPLING}
          options={MESH_SAMPLINGS}
          onChange={v => setSimulationConfig('修改网格生成方式', { meshSampling: v })} />
        <SliderRow label="网格边长" tip="全局网格密度，所有版片统一使用，越小越贴合(cm)" min={MESH_RESOLUTION_MIN_CM} max={MESH_RESOLUTION_MAX_CM} step={0.1}
          value={sim.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM} commitOnRelease
          onChange={v => setSimulationConfig('修改网格边长', { meshResolutionCm: v })} />
      </Section>
      <Section title="模拟">
        <SliderRow label="重力" tip="m/s²" min={-20} max={0} step={0.1} value={sim.gravity.y}
          onChange={v => setSimulationConfig('修改重力', { gravity: { ...sim.gravity, y: v } })} />
        <SliderRow label="风速" tip="风向在场景设置里，0 为无风" min={0} max={20} step={0.5} value={sim.wind.speed}
          onChange={v => setSimulationConfig('修改风速', { wind: { ...sim.wind, speed: v } })} />
        <SliderRow label="迭代" tip="约束求解次数，越多越稳定也越慢" min={1} max={15} step={1} value={sim.constraintIterations}
          onChange={v => setSimulationConfig('修改迭代次数', { constraintIterations: Math.round(v) })} />
        <CheckRow label="自碰撞" tip="布面与自身发生碰撞" checked={sim.selfCollision !== false}
          onChange={v => setSimulationConfig('修改布料自碰撞', { selfCollision: v })} />
        <CheckRow label="缝合断裂" tip="受力过大时缝合处会断开" checked={sim.seamTearing === true}
          onChange={v => setSimulationConfig(v ? '开启缝合断裂' : '关闭缝合断裂', { seamTearing: v })} />
        <SliderRow label="默认厚度" tip="未设置结构层的版片使用此厚度(cm)；层厚度优先" min={0} max={1} step={0.05}
          value={sim.clothThicknessCm ?? DEFAULT_CLOTH_THICKNESS_CM}
          onChange={v => setSimulationConfig('修改默认厚度', { clothThicknessCm: v })} />
        <SliderRow label="层间距" tip="相邻碰撞层之间的间隙(cm)" min={0} max={2} step={0.1}
          value={sim.layerSpacingCm ?? DEFAULT_LAYER_SPACING_CM}
          onChange={v => setSimulationConfig('修改层间距', { layerSpacingCm: v })} />
        <ButtonRow>
          <SmallButton onClick={autoAssignLayers} title="按缝合关系推断每片碰撞层">自动分层</SmallButton>
        </ButtonRow>
      </Section>
      <LayerSection project={project} />
    </>
  );
}

export function RenderTab({ project }: { project: Project }) {
  const displayMode = useUIStore(displayModeOf);
  const backend = useUIStore(s => s.backend);
  const aux = useUIStore(s => s.aux);
  const setAux = useUIStore(s => s.setAux);
  const setDisplayMode = useUIStore(s => s.setDisplayMode);
  const fitCheck = useUIStore(s => s.fitCheck);
  const fitTightCm = useUIStore(s => s.fitTightCm);
  const fitLooseCm = useUIStore(s => s.fitLooseCm);
  const setFitThresholds = useUIStore(s => s.setFitThresholds);
  const fitStats = useSimStore(s => s.fitStats);
  const strainCheck = useUIStore(s => s.strainCheck);
  const strainMin = useUIStore(s => s.strainMin);
  const strainMax = useUIStore(s => s.strainMax);
  const setStrainRange = useUIStore(s => s.setStrainRange);
  const strainByFabric = useUIStore(s => s.strainByFabric);
  const setStrainByFabric = useUIStore(s => s.setStrainByFabric);
  const strainStats = useSimStore(s => s.strainStats);
  const pressureCheck = useUIStore(s => s.pressureCheck);
  const pressureMaxKpa = useUIStore(s => s.pressureMaxKpa);
  const setPressureMaxKpa = useUIStore(s => s.setPressureMaxKpa);
  const pressureStats = useSimStore(s => s.pressureStats);
  const fabricLimits = Object.values(project.fabrics).map(fabric => ({
    name: fabric.name,
    stretchLimit: fabric.physics.stretchLimit ?? DEFAULT_STRETCH_LIMIT,
    compressionLimit: fabric.physics.compressionLimit ?? DEFAULT_COMPRESSION_LIMIT,
  }));
  const rayUnavailable = rayTracingUnavailableReason(usePerfStore(s => s.rayUnsupported3D));
  const ray = normalizeRayTracing(project.scene.render.rayTracing);

  return (
    <>
      <Section title="显示">
        <SelectRow label="显示模式" value={displayMode}
          options={DISPLAY_MODES.map(m => m.value === 'raytraced' && rayUnavailable
            ? { value: m.value, label: `${m.label}（不支持）`, disabled: true }
            : { value: m.value, label: m.label })}
          onChange={v => setDisplayMode(v)} />
        <SelectRow label="线框" value={aux.wire}
          options={WIRE_AUX_OPTIONS}
          onChange={v => setAux({ ...aux, wire: v })} />
        <SelectRow label="简模" value={aux.proxy}
          options={PROXY_AUX_OPTIONS}
          onChange={v => setAux({ ...aux, proxy: v })} />
        <SelectRow label="围度线" value={aux.girthLines}
          options={GIRTH_LINES_AUX_OPTIONS}
          onChange={v => setAux({ ...aux, girthLines: v })} />
        <SelectRow label="骨架" value={aux.skeleton}
          options={SKELETON_AUX_OPTIONS}
          onChange={v => setAux({ ...aux, skeleton: v })} />
        {rayUnavailable && <div style={styles.note}>本机不支持光追：{rayUnavailable}</div>}
      </Section>
      {fitCheck && (
        <Section title="合身热图">
          <SliderRow label="贴近阈值" tip="小于此距离算贴近(cm)" min={0} max={3} step={0.1} value={fitTightCm}
            onChange={v => setFitThresholds(v, fitLooseCm)} />
          <SliderRow label="宽松阈值" tip="大于此距离算宽松(cm)" min={0.5} max={8} step={0.1} value={fitLooseCm}
            onChange={v => setFitThresholds(fitTightCm, v)} />
          {fitStats && (
            <>
              <Row label="顶点">{fitStats.vertices}</Row>
              <Row label="分布" tip="穿透 / 贴近 / 合适 / 宽松 各段的顶点数">
                {fitStats.penetration} / {fitStats.tight} / {fitStats.ideal} / {fitStats.loose}
              </Row>
              <Row label="统计" tip="最小 / 平均 / 最大 距离">
                {fitStats.minCm.toFixed(2)} / {fitStats.meanCm.toFixed(2)} / {fitStats.maxCm.toFixed(2)} cm
              </Row>
              <button
                style={styles.action}
                onClick={() => downloadTextFile(
                  `${project.meta.name}-合身报告.csv`,
                  '\ufeff' + fitReportCsv(project.meta.name, fitStats, { tightCm: fitTightCm, looseCm: fitLooseCm }),
                  'text/csv;charset=utf-8',
                )}
              >导出 CSV</button>
            </>
          )}
        </Section>
      )}
      {strainCheck && (
        <Section title="应变热图">
          <CheckRow label="按面料" tip="用各面料的拉伸、压缩上限作为色标" checked={strainByFabric} onChange={setStrainByFabric} />
          {!strainByFabric && (
            <>
              <SliderRow label="色标下限" tip="色标对应的最小应变值" min={-1} max={0} step={0.05} value={strainMin}
                onChange={v => setStrainRange(v, strainMax)} />
              <SliderRow label="色标上限" tip="色标对应的最大应变值" min={0} max={1} step={0.05} value={strainMax}
                onChange={v => setStrainRange(strainMin, v)} />
            </>
          )}
          {strainStats && (
            <>
              <Row label="应变统计" tip="最小 / 最大 / 平均绝对应变">
                {strainStats.min.toFixed(4)} / {strainStats.max.toFixed(4)} / {strainStats.meanAbs.toFixed(4)}
              </Row>
              {strainByFabric && (
                <Row label="超限" tip="超出面料上限的 拉伸 / 压缩 顶点数">
                  {strainStats.overStretch} / {strainStats.overCompression}
                  {strainStats.vertices > 0
                    ? `（${((strainStats.overStretch + strainStats.overCompression) / strainStats.vertices * 100).toFixed(1)}%）`
                    : ''}
                </Row>
              )}
              <button
                style={styles.action}
                onClick={() => downloadTextFile(
                  `${project.meta.name}-应变报告.csv`,
                  '\ufeff' + strainReportCsv(
                    project.meta.name, strainStats, { min: strainMin, max: strainMax },
                    { mode: strainByFabric ? 'fabric' : 'manual', fabrics: fabricLimits },
                  ),
                  'text/csv;charset=utf-8',
                )}
              >导出 CSV</button>
            </>
          )}
        </Section>
      )}
      {pressureCheck && (
        <Section title="压力热图">
          <SliderRow label="色标上限" tip="色标对应的最大压力（kPa）" min={0.5} max={20} step={0.5}
            value={pressureMaxKpa} onChange={setPressureMaxKpa} />
          {pressureStats && (
            <>
              <Row label="顶点数" tip="总顶点数 / 与身体接触的顶点数">
                {pressureStats.vertices} / {pressureStats.contactVertices}
              </Row>
              <Row label="统计" tip="最小 / 平均 / 最大 压力">
                {pressureStats.minKpa.toFixed(2)} / {pressureStats.meanKpa.toFixed(2)} / {pressureStats.maxKpa.toFixed(2)} kPa
              </Row>
              <button
                style={styles.action}
                onClick={() => downloadTextFile(
                  `${project.meta.name}-压力报告.csv`,
                  '\ufeff' + pressureReportCsv(project.meta.name, pressureStats, {
                    maxKpa: pressureMaxKpa,
                    kpaPerMm: DEFAULT_PRESSURE_KPA_PER_MM,
                    panelNames: Object.fromEntries(
                      Object.values(project.pattern.panels).map(panel => [panel.id, panel.name]),
                    ),
                  }),
                  'text/csv;charset=utf-8',
                )}
              >导出 CSV</button>
            </>
          )}
        </Section>
      )}
      {backend === 'pathtrace' && (
        <>
          <Section title="光线追踪">
            <SliderRow label="弹射次数" tip="一条光线最多反弹的次数" min={1} max={16} step={1} value={ray.maxBounces}
              onChange={v => setRayTracingConfig('修改光追弹射次数', { maxBounces: v })} />
            <SliderRow label="路径预算" tip="每帧光线的数量（k 为千条）" min={50} max={1000} step={10}
              value={ray.frameBudget / 1000}
              onChange={v => setRayTracingConfig('修改光追每帧预算', { frameBudget: Math.round(v * 1000) })} />
            <SliderRow label="采样数" tip="每像素累积的最大采样数" min={8} max={1024} step={1} value={ray.maxSamples}
              onChange={v => setRayTracingConfig('修改光追最大采样数', { maxSamples: v })} />
            <SliderRow label="渲染比例" tip="按视口分辨率的比例渲染" min={0.5} max={1} step={0.05} value={ray.renderScale}
              onChange={v => setRayTracingConfig('修改光追渲染比例', { renderScale: v })} />
          </Section>
          <Section title="降噪">
            <CheckRow label="降噪" tip="用 OIDN 降噪模型" checked={ray.denoise}
              onChange={v => setRayTracingConfig(v ? '开启光追降噪' : '关闭光追降噪', { denoise: v })} />
            {ray.denoise && (
              <SelectRow label="降噪模型" tip="OIDN 使用的降噪模型" value={ray.denoiseModel}
                options={DENOISE_MODELS.map(m => ({ value: m.value, label: m.label }))}
                onChange={v => setRayTracingConfig('修改降噪模型', { denoiseModel: v })} />
            )}
          </Section>
          <Section title="画质">
            <SliderRow label="光泽滤波" tip="压低光泽反射的噪点" min={0} max={1} step={0.05} value={ray.filterGlossyFactor}
              onChange={v => setRayTracingConfig('修改光追光泽滤波', { filterGlossyFactor: v })} />
            <SliderRow label="直射钳制" tip="直接光亮度上限，越低噪点越少" min={0} max={10} step={0.5} value={ray.clampDirect}
              onChange={v => setRayTracingConfig('修改直接光钳制', { clampDirect: v })} />
            <SliderRow label="间接钳制" tip="间接光亮度上限，越低噪点越少" min={0} max={20} step={0.5} value={ray.clampIndirect}
              onChange={v => setRayTracingConfig('修改间接光钳制', { clampIndirect: v })} />
            <div style={styles.note}>钳制越低噪点越少，但高光会变暗</div>
          </Section>
        </>
      )}
      <Section title="色调映射">
        <SelectRow label="映射" value={project.scene.render.toneMapping}
          options={TONE_MAPPING.map(m => ({ value: m.value, label: m.label }))}
          onChange={v => setToneMapping(v)} />
      </Section>
    </>
  );
}
