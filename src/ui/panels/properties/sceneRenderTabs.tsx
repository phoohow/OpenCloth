import { displayModeOf, usePerfStore, useProjectStore, useSimStore, useUIStore } from '@/store';
import type { Project } from '@/model/types';
import {
  DEFAULT_CLOTH_THICKNESS_CM, DEFAULT_COMPRESSION_LIMIT, DEFAULT_LAYER_SPACING_CM,
  DEFAULT_MESH_RESOLUTION_CM, DEFAULT_MESH_SAMPLING, DEFAULT_STRETCH_LIMIT, normalizeRayTracing,
} from '@/model';
import { AutoAssignCollisionLayersCommand } from '@/commands';
import { patchValue, setGlobalMeshResolution, setRayTracingConfig, setSimulationConfig, setToneMapping, type EngineRef } from '@/ui/sceneCommands';
import { SizeChart } from '@/ui/panels/properties/objectDataSections';
import { DynamicFitSection } from '@/ui/panels/properties/dynamicFitSection';
import { LayerSection } from '@/ui/panels/properties/layerSection';
import { PomSection } from '@/ui/panels/properties/pomSection';
import {
  DENOISE_MODELS, DISPLAY_MODES, MESH_SAMPLINGS, TONE_MAPPING, WIRE_MODES,
  rayTracingUnavailableReason,
} from '@/ui/optionTables';
import { ButtonRow, CheckRow, Row, Section, SelectRow, SliderRow, SmallButton, TextRow } from '@/ui/widgets/propertyRows';
import { downloadTextFile } from '@/io/serialization';
import { fitReportCsv } from '@/analysis';
import { DEFAULT_PRESSURE_KPA_PER_MM } from '@/analysis';
import { pressureReportCsv } from '@/analysis';
import { strainReportCsv } from '@/analysis';
import { reportActionError } from '@/ui/widgets/toast';
import { styles } from '@/ui/panels/properties/styles';

// ===== Pattern, project and render tabs ("版型" / "工程" / "渲染") =====

/** Size chart, points of measure and the grading rules that read them. */
export function PatternTab({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  return (
    <>
      <SizeChart project={project} engineRef={engineRef} />
      <PomSection project={project} />
    </>
  );
}

/** Project summary, mesh generation, global simulation, construction layers and body animation. */
export function ProjectTab({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
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
      <Section title="网格生成">
        <SelectRow label="生成方式" value={sim.meshSampling ?? DEFAULT_MESH_SAMPLING}
          options={MESH_SAMPLINGS}
          onChange={v => setSimulationConfig('修改网格生成方式', { meshSampling: v })} />
        <SliderRow label="网格边长" min={0.5} max={10} step={0.5} unit="cm"
          value={sim.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM} commitOnRelease
          onChange={v => setGlobalMeshResolution(v)} />
        <div style={styles.note}>生成方式决定版片内部撒点的分布：六边形晶格是规则的三角结构，蓝噪声（泊松盘）没有固定方向，三角形更接近正三角。两种方式都在松手后把全部版片的网格边长设为该值并重建布料；之后可在单片的「布料网格」区块单独调整。</div>
      </Section>
      <Section title="全局模拟">
        <SliderRow label="重力" min={-20} max={0} step={0.1} unit="m/s²" value={sim.gravity.y}
          onChange={v => setSimulationConfig('修改重力', { gravity: { ...sim.gravity, y: v } })} />
        <SliderRow label="风速" min={0} max={20} step={0.5} value={sim.wind.speed}
          onChange={v => setSimulationConfig('修改风速', { wind: { ...sim.wind, speed: v } })} />
        <SliderRow label="迭代次数" min={1} max={15} step={1} value={sim.constraintIterations}
          onChange={v => setSimulationConfig('修改迭代次数', { constraintIterations: Math.round(v) })} />
        <CheckRow label="布料自碰撞" checked={sim.selfCollision !== false}
          onChange={v => setSimulationConfig('修改布料自碰撞', { selfCollision: v })} />
        <CheckRow label="缝合断裂" checked={sim.seamTearing === true}
          onChange={v => setSimulationConfig(v ? '开启缝合断裂' : '关闭缝合断裂', { seamTearing: v })} />
        <SliderRow label="布料厚度" min={0} max={1} step={0.05} unit="cm"
          value={sim.clothThicknessCm ?? DEFAULT_CLOTH_THICKNESS_CM}
          onChange={v => setSimulationConfig('修改布料厚度', { clothThicknessCm: v })} />
        <SliderRow label="层间距" min={0} max={2} step={0.1} unit="cm"
          value={sim.layerSpacingCm ?? DEFAULT_LAYER_SPACING_CM}
          onChange={v => setSimulationConfig('修改层间距', { layerSpacingCm: v })} />
        <ButtonRow>
          <SmallButton onClick={autoAssignLayers} title="按缝合连通性与平均松量推断每片的碰撞层">自动识别碰撞层</SmallButton>
        </ButtonRow>
        <div style={styles.note}>布料厚度同时抬高模特与地面的碰撞距离；层间距按相邻版片的「碰撞层」差值加大分离距离，0 为最内层。缝合断裂开启后，拉伸超过缝合强度阈值的缝合对会解除约束。</div>
      </Section>
      <LayerSection project={project} />
      <DynamicFitSection project={project} engineRef={engineRef} />
    </>
  );
}

/** Viewport display mode, fit and strain heatmaps, tone mapping and ray tracing settings. */
export function RenderTab({ project }: { project: Project }) {
  const displayMode = useUIStore(displayModeOf);
  const backend = useUIStore(s => s.backend);
  const wire = useUIStore(s => s.wire);
  const setWire = useUIStore(s => s.setWire);
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
        <SelectRow label="线框" value={wire}
          options={WIRE_MODES.map(m => ({ value: m.value, label: m.label }))}
          onChange={v => setWire(v)} />
        {rayUnavailable && <div style={styles.note}>本机 WebGPU 跑不了光线追踪：{rayUnavailable}。</div>}
      </Section>
      {fitCheck && (
        <Section title="合身热图">
          <SliderRow label="贴近阈值" min={0} max={3} step={0.1} unit="cm" value={fitTightCm}
            onChange={v => setFitThresholds(v, fitLooseCm)} />
          <SliderRow label="宽松阈值" min={0.5} max={8} step={0.1} unit="cm" value={fitLooseCm}
            onChange={v => setFitThresholds(fitTightCm, v)} />
          {fitStats && (
            <>
              <Row label="顶点">{fitStats.vertices}</Row>
              <Row label="穿透 / 贴近 / 合适 / 宽松">
                {fitStats.penetration} / {fitStats.tight} / {fitStats.ideal} / {fitStats.loose}
              </Row>
              <Row label="最小 / 平均 / 最大">
                {fitStats.minCm.toFixed(2)} / {fitStats.meanCm.toFixed(2)} / {fitStats.maxCm.toFixed(2)} cm
              </Row>
              <button
                style={styles.action}
                onClick={() => downloadTextFile(
                  `${project.meta.name}-合身报告.csv`,
                  '\ufeff' + fitReportCsv(project.meta.name, fitStats, { tightCm: fitTightCm, looseCm: fitLooseCm }),
                  'text/csv;charset=utf-8',
                )}
              >导出合身报告 CSV</button>
            </>
          )}
          <div style={styles.note}>合身热图按布料顶点到模特碰撞体的间隙着色：红色穿透、橙色贴近、绿色合适、蓝色宽松；切回其他显示模式即恢复面料材质。</div>
        </Section>
      )}
      {strainCheck && (
        <Section title="应变热图">
          <CheckRow label="按面料上限" checked={strainByFabric} onChange={setStrainByFabric} />
          {!strainByFabric && (
            <>
              <SliderRow label="色标下限" min={-1} max={0} step={0.05} value={strainMin}
                onChange={v => setStrainRange(v, strainMax)} />
              <SliderRow label="色标上限" min={0} max={1} step={0.05} value={strainMax}
                onChange={v => setStrainRange(strainMin, v)} />
            </>
          )}
          {strainStats && (
            <>
              <Row label="最小 / 最大 / 平均应变">
                {strainStats.min.toFixed(4)} / {strainStats.max.toFixed(4)} / {strainStats.meanAbs.toFixed(4)}
              </Row>
              {strainByFabric && (
                <Row label="超限 拉伸 / 压缩">
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
              >导出应变报告 CSV</button>
            </>
          )}
          <div style={styles.note}>应变热图按每个顶点相邻边的长度变化着色：蓝色受压缩、白色无变形、红色被拉伸。通用模式用上下限作色标；按面料模式取每片面料自身的拉伸与压缩上限，并统计超限顶点。</div>
        </Section>
      )}
      {pressureCheck && (
        <Section title="压力热图">
          <SliderRow label="色标上限" min={0.5} max={20} step={0.5} unit="kPa"
            value={pressureMaxKpa} onChange={setPressureMaxKpa} />
          {pressureStats && (
            <>
              <Row label="顶点 / 接触">{pressureStats.vertices} / {pressureStats.contactVertices}</Row>
              <Row label="最小 / 平均 / 最大">
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
              >导出压力报告 CSV</button>
            </>
          )}
          <div style={styles.note}>压力热图把碰撞阶段施加的法向接触修正量按每毫米 1 kPa 折算成估算压力，不是接触力求解结果；蓝色为轻接触，红色为高压。只有贴住模特或地面的顶点参与统计。</div>
        </Section>
      )}
      {backend === 'pathtrace' && (
        <>
          <Section title="光线追踪">
            <SliderRow label="最大弹射次数" min={1} max={16} step={1} value={ray.maxBounces}
              onChange={v => setRayTracingConfig('修改光追弹射次数', { maxBounces: v })} />
            <SliderRow label="每帧路径预算" min={50} max={1000} step={10} unit="k"
              value={ray.frameBudget / 1000}
              onChange={v => setRayTracingConfig('修改光追每帧预算', { frameBudget: Math.round(v * 1000) })} />
            <SliderRow label="最大采样数" min={8} max={1024} step={1} value={ray.maxSamples}
              onChange={v => setRayTracingConfig('修改光追最大采样数', { maxSamples: v })} />
            <SliderRow label="渲染比例" min={0.5} max={1} step={0.05} value={ray.renderScale}
              onChange={v => setRayTracingConfig('修改光追渲染比例', { renderScale: v })} />
            <div style={styles.note}>移动相机或播放模拟时显示光栅画面，停下后立即重新开始累积，前 32 个样本从光栅过渡到光追；累积分辨率取窗格的 CSS 尺寸，调「渲染比例」可换取收敛速度。</div>
          </Section>
          <Section title="降噪">
            <CheckRow label="OIDN 降噪" checked={ray.denoise}
              onChange={v => setRayTracingConfig(v ? '开启光追降噪' : '关闭光追降噪', { denoise: v })} />
            {ray.denoise && (
              <SelectRow label="降噪模型" value={ray.denoiseModel}
                options={DENOISE_MODELS.map(m => ({ value: m.value, label: m.label }))}
                onChange={v => setRayTracingConfig('修改降噪模型', { denoiseModel: v })} />
            )}
            <div style={styles.note}>降噪权重随安装包提供，无需联网；达到最大采样数后自动降噪并停止累积。</div>
          </Section>
          <Section title="画质调节">
            <SliderRow label="光泽滤波" min={0} max={1} step={0.05} value={ray.filterGlossyFactor}
              onChange={v => setRayTracingConfig('修改光追光泽滤波', { filterGlossyFactor: v })} />
            <SliderRow label="直接光钳制" min={0} max={10} step={0.5} value={ray.clampDirect}
              onChange={v => setRayTracingConfig('修改直接光钳制', { clampDirect: v })} />
            <SliderRow label="间接光钳制" min={0} max={20} step={0.5} value={ray.clampIndirect}
              onChange={v => setRayTracingConfig('修改间接光钳制', { clampIndirect: v })} />
            <div style={styles.note}>钳制值越低越能抑制火噪，但会压暗高光。</div>
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
