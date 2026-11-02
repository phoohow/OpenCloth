import type { Fabric, Project } from '../../../core/model/types';
import { setSimulationConfig } from '../../sceneCommands';
import { SliderRow, CheckRow, Section } from '../../widgets/propertyRows';
import { writeFabric } from './materialTab';
import { styles } from './styles';

// ===== Physics tabs ("物理") =====

/** Fabric stiffness, mass and damping for the panel the object tab resolved to. */
export function FabricPhysics({ fabric }: { fabric: Fabric }) {
  const setPhysics = (label: string, patch: Partial<Fabric['physics']>) => writeFabric(
    label, fabric, { ...fabric, physics: { ...fabric.physics, ...patch } },
  );

  return (
    <Section title={`面料物理（${fabric.name}）`}>
      <SliderRow label="拉伸刚度" min={0} max={1} step={0.01} value={fabric.physics.stretchStiffness} commitOnRelease
        onChange={v => setPhysics('修改拉伸刚度', { stretchStiffness: v })} />
      <SliderRow label="弯曲刚度" min={0} max={1} step={0.01} value={fabric.physics.bendingStiffness} commitOnRelease
        onChange={v => setPhysics('修改弯曲刚度', { bendingStiffness: v })} />
      <SliderRow label="剪切刚度" min={0} max={1} step={0.01} value={fabric.physics.shearStiffness} commitOnRelease
        onChange={v => setPhysics('修改剪切刚度', { shearStiffness: v })} />
      <SliderRow label="折痕刚度" min={0} max={1} step={0.01} value={fabric.physics.creaseStiffness ?? 0.85} commitOnRelease
        onChange={v => setPhysics('修改折痕刚度', { creaseStiffness: v })} />
      <SliderRow label="克重" min={50} max={600} step={10} unit="g/m²" value={fabric.physics.massPerArea} commitOnRelease
        onChange={v => setPhysics('修改克重', { massPerArea: v })} />
      <SliderRow label="阻尼" min={0} max={0.1} step={0.001} value={fabric.physics.damping} commitOnRelease
        onChange={v => setPhysics('修改阻尼', { damping: v })} />
      <div style={styles.note}>刚度、克重与阻尼都按材质所属的版片生效，多片共用一份材质时一起变。折痕刚度只作用于片内用途为「折痕」的内部线。</div>
    </Section>
  );
}

/** Cloth-avatar collision switch. */
export function AvatarPhysics({ project }: { project: Project }) {
  const sim = project.scene.simulation;
  return (
    <Section title="碰撞">
      <CheckRow label="布料与模特碰撞" checked={sim.avatarCollision}
        onChange={v => setSimulationConfig('修改模特碰撞', { avatarCollision: v })} />
      <div style={styles.note}>碰撞体随模特尺寸自动重建。</div>
    </Section>
  );
}
