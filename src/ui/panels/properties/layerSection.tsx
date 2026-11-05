import type { GarmentLayer, Project } from '../../../core/model/types';
import { GARMENT_LAYERS, GARMENT_LAYER_LABELS } from '../../../core/model/defaults';
import { layerThicknessCm } from '../../../core/model/layers';
import { patchValue } from '../../sceneCommands';
import { Row, Section, SliderRow } from '../../widgets/propertyRows';
import { styles } from './styles';

/** Construction-layer clearances and how many panels each layer holds. */
export function LayerSection({ project }: { project: Project }) {
  const thickness = layerThicknessCm(project);
  const counts = Object.values(project.pattern.panels).reduce<Record<GarmentLayer, number>>((acc, panel) => {
    if (panel.layer) acc[panel.layer] += 1;
    return acc;
  }, { lining: 0, padding: 0, shell: 0 });

  /** Writes one layer clearance, keeping the other two. */
  const setThickness = (layer: GarmentLayer, label: string, cm: number) => patchValue(
    label,
    p => p.layerThicknessCm,
    (ctx, value) => { ctx.project.layerThicknessCm = { ...value }; },
    { ...thickness, [layer]: cm },
  );

  return (
    <Section title="多层结构">
      {GARMENT_LAYERS.map(layer => (
        <SliderRow key={layer} label={`${GARMENT_LAYER_LABELS[layer]}厚度`} min={0} max={2} step={0.05} unit="cm"
          value={thickness[layer]} commitOnRelease
          onChange={v => setThickness(layer, `修改${GARMENT_LAYER_LABELS[layer]}厚度`, v)} />
      ))}
      <Row label="版片 里布 / 填充 / 外壳">
        {counts.lining} / {counts.padding} / {counts.shell}
      </Row>
      <div style={styles.note}>
        结构层在版片的模拟标签里设置。层厚度是布料与身体、地面及相邻层的碰撞间隙；里布、填充、外壳的默认碰撞层依次为 0 / 1 / 2，层间距再按层差推开。未指定结构层的片沿用全局「布料厚度」。
      </div>
    </Section>
  );
}
