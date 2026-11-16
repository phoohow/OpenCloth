import type { GarmentLayer, Project } from '@/model/types';
import { GARMENT_LAYERS } from '@/model';
import { GARMENT_LAYER_LABELS } from '@/ui/optionTables';
import { layerThicknessCm } from '@/model';
import { patchValue } from '@/ui/sceneCommands';
import { Row, Section, SliderRow } from '@/ui/widgets/propertyRows';

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
    <Section title="多层">
      {GARMENT_LAYERS.map(layer => (
        <SliderRow key={layer} label={`${GARMENT_LAYER_LABELS[layer]}厚度`} min={0} max={2} step={0.05} unit="cm"
          value={thickness[layer]} commitOnRelease
          onChange={v => setThickness(layer, `修改${GARMENT_LAYER_LABELS[layer]}厚度`, v)} />
      ))}
      <Row label="各层片数">
        {counts.lining} / {counts.padding} / {counts.shell}
      </Row>
    </Section>
  );
}
