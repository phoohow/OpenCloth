import type { Fabric, Project } from '@/model/types';
import {
  DEFAULT_COMPRESSION_LIMIT, DEFAULT_CONTACT_FRICTION, DEFAULT_STRETCH_LIMIT,
} from '@/model';
import { patchValue, setSimulationConfig } from '@/ui/sceneCommands';
import { SliderRow, CheckRow, Section } from '@/ui/widgets/propertyRows';
import { writeFabric } from '@/ui/panels/properties/materialTab';
import { styles } from '@/ui/panels/properties/styles';

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
      <SliderRow label="接触摩擦" min={0} max={1} step={0.01}
        value={fabric.physics.contactFriction ?? DEFAULT_CONTACT_FRICTION} commitOnRelease
        onChange={v => setPhysics('修改接触摩擦', { contactFriction: v })} />
      <SliderRow label="拉伸上限(%)" min={1} max={100} step={1}
        value={(fabric.physics.stretchLimit ?? DEFAULT_STRETCH_LIMIT) * 100} commitOnRelease
        onChange={v => setPhysics('修改拉伸上限', { stretchLimit: v / 100 })} />
      <SliderRow label="压缩上限(%)" min={1} max={100} step={1}
        value={(fabric.physics.compressionLimit ?? DEFAULT_COMPRESSION_LIMIT) * 100} commitOnRelease
        onChange={v => setPhysics('修改压缩上限', { compressionLimit: v / 100 })} />
      <div style={styles.note}>刚度、克重与阻尼按材质所属的版片生效；接触摩擦取第一份面料的取值。拉伸与压缩上限只用于应变热图的按面料判定，不改变求解刚度。</div>
    </Section>
  );
}

/** Cloth-avatar collision switch and the soft-body toggle. */
export function AvatarPhysics({ project }: { project: Project }) {
  const sim = project.scene.simulation;
  return (
    <Section title="碰撞">
      <CheckRow label="布料与模特碰撞" checked={sim.avatarCollision}
        onChange={v => setSimulationConfig('修改模特碰撞', { avatarCollision: v })} />
      <CheckRow label="软体胸腹" checked={project.avatar.softBody === true}
        onChange={v => patchValue(
          v ? '开启软体模特' : '关闭软体模特',
          p => p.avatar.softBody === true,
          (ctx, value) => { ctx.project.avatar = { ...ctx.project.avatar, softBody: value }; },
          v,
        )} />
      <div style={styles.note}>碰撞体随模特尺寸自动重建。软体胸腹开启后，布料压到的胸部与腹部会向体内让开，布料与合身热图都读取形变后的碰撞体。</div>
    </Section>
  );
}
