import { useUIStore } from '../../../store/stores';
import type { Project } from '../../../core/model/types';
import { DEFAULT_MESH_RESOLUTION_CM, normalizeRayTracing } from '../../../core/model/defaults';
import { setRayTracingConfig, setSimulationConfig, setToneMapping } from '../../sceneCommands';
import { DENOISE_MODELS, RENDER_MODES, TONE_MAPPING } from '../../optionTables';
import { CheckRow, Row, Section, SelectRow, SliderRow } from '../../widgets/propertyRows';
import { styles } from './styles';

// ===== Scene and render tabs ("场景" / "渲染") =====

/** Project summary plus the global simulation block. */
export function SceneTab({ project }: { project: Project }) {
  const sim = project.scene.simulation;
  const panels = Object.values(project.pattern.panels);
  const refs = project.scene.referenceObjects ?? [];

  return (
    <>
      <Section title="工程">
        <Row label="名称">{project.meta.name}</Row>
        <Row label="版型片">{panels.length}</Row>
        <Row label="缝合">{Object.keys(project.pattern.seams).length}</Row>
        <Row label="面料">{Object.keys(project.fabrics).length}</Row>
        <Row label="参考物">{refs.length}</Row>
      </Section>
      <Section title="全局模拟">
        <SliderRow label="重力" min={-20} max={0} step={0.1} suffix="m/s²" value={sim.gravity.y}
          onChange={v => setSimulationConfig('修改重力', { gravity: { ...sim.gravity, y: v } })} />
        <SliderRow label="风速" min={0} max={20} step={0.5} value={sim.wind.speed}
          onChange={v => setSimulationConfig('修改风速', { wind: { ...sim.wind, speed: v } })} />
        <SliderRow label="迭代次数" min={1} max={15} step={1} value={sim.constraintIterations}
          onChange={v => setSimulationConfig('修改迭代次数', { constraintIterations: Math.round(v) })} />
        <SliderRow label="全局网格边长" min={0.8} max={3} step={0.1} suffix="cm"
          value={sim.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM} commitOnRelease
          onChange={v => setSimulationConfig('修改全局网格边长', { meshResolutionCm: v })} />
        <div style={styles.note}>全局网格边长在松手后重建全部布料。</div>
      </Section>
    </>
  );
}

/** Viewport display mode, tone mapping and ray tracing settings. */
export function RenderTab({ project }: { project: Project }) {
  const renderMode = useUIStore(s => s.renderMode);
  const setRenderMode = useUIStore(s => s.setRenderMode);
  const ray = normalizeRayTracing(project.scene.render.rayTracing);

  return (
    <>
      <Section title="显示">
        <SelectRow label="显示模式" value={renderMode}
          options={RENDER_MODES.map(m => ({ value: m.value, label: m.label }))}
          onChange={v => setRenderMode(v)} />
      </Section>
      {renderMode === 'raytraced' && (
        <>
          <Section title="光线追踪">
            <SliderRow label="最大弹射次数" min={1} max={16} step={1} value={ray.maxBounces}
              onChange={v => setRayTracingConfig('修改光追弹射次数', { maxBounces: v })} />
            <SliderRow label="每帧路径预算" min={50} max={1000} step={10} suffix="k"
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
