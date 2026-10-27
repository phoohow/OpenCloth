import { useState } from 'react';
import { useProjectStore } from '../../../store/stores';
import type { Fabric, FabricPresetKey, Project } from '../../../core/model/types';
import { FABRIC_PRESET_KEYS, FABRIC_PRESET_LABELS } from '../../../core/model/defaults';
import { fabricList, panelsUsingFabric, uniqueFabricName } from '../../../core/model/fabric';
import { AddFabricCommand, AssignFabricCommand, DetachFabricCommand } from '../../../core/command/fabricCommands';
import type { Command } from '../../../core/command/command';
import { patchValue, type EngineRef } from '../../sceneCommands';
import { Icon } from '../../icons';
import {
  ColorRow, FlexSelect, Hint, IconButton, InlineText, PopupSelect, Row, Section,
  SliderRow, SlotRow, ValueButton,
} from '../../widgets/propertyRows';

// ===== Material tab ("材质") =====

/** Fabric assigned to a panel row. */
export function panelFabric(project: Project, panelId: string): Fabric | undefined {
  const panel = project.pattern.panels[panelId];
  return panel ? project.fabrics[panel.fabricId] : undefined;
}

/** Replaces a fabric record; the renderer rebuilds materials and the solver reads physics each step. */
export function writeFabric(label: string, before: Fabric, after: Fabric): void {
  patchValue(
    label,
    p => p.fabrics[before.id],
    (ctx, value) => {
      ctx.project.fabrics = { ...ctx.project.fabrics, [value.id]: value };
    },
    after,
  );
}

/** One material slot of the selected panel: the name field renames the shared record, the list
 *  button swaps in another record, − unlinks it, and the user-count row copies it for this panel alone. */
export function MaterialTab({ project, panelId, engineRef }: {
  project: Project; panelId: string; engineRef: EngineRef;
}) {
  const panel = project.pattern.panels[panelId];
  const fabric = panel ? project.fabrics[panel.fabricId] : undefined;
  /** Fabric type the + button creates from. */
  const [newPreset, setNewPreset] = useState<FabricPresetKey>('cotton');
  if (!panel) return <Hint>版型片已删除。</Hint>;

  /** Runs a material command and re-binds the cloth without restarting the simulation. */
  const run = (cmd: Command) => {
    useProjectStore.getState().executeCommand(cmd);
    engineRef.current?.applyFabrics(useProjectStore.getState().project);
  };

  const users = fabric ? panelsUsingFabric(project, fabric.id).length : 0;
  const options = fabricList(project).map(f => ({ value: f.id, label: f.name }));
  if (!options.some(o => o.value === panel.fabricId)) {
    options.unshift({ value: panel.fabricId, label: '未指定' });
  }

  const setFabric = (label: string, next: Fabric) => writeFabric(label, fabric!, next);
  const appearance = (patch: Partial<Fabric['appearance']>) => setFabric('修改材质外观', {
    ...fabric!, appearance: { ...fabric!.appearance, ...patch },
  });
  /** Renaming edits the record every panel sharing it wears, so names stay unique. */
  const rename = (name: string) => setFabric('重命名材质', { ...fabric!, name: uniqueFabricName(project, name) });

  return (
    <>
      <Section title="材质槽">
        <SlotRow label="名称">
          {fabric
            ? <InlineText value={fabric.name} title="改名对所有使用此材质的版型片生效" onChange={rename} />
            : <InlineText value="" disabled placeholder="未指定" onChange={() => {}} />}
          <PopupSelect
            title="换用其他材质"
            value={panel.fabricId}
            options={options}
            onChange={fabricId => run(new AssignFabricCommand([panelId], fabricId))}
          />
          <IconButton
            disabled={!fabric}
            title="解除材质指定"
            onClick={() => run(new AssignFabricCommand([panelId], ''))}
          ><Icon name="minus" size={12} /></IconButton>
        </SlotRow>
        <Row label="引用次数">
          <ValueButton
            disabled={users <= 1}
            title={users > 1 ? `被 ${users} 个版型片引用，点击复制为独立材质` : undefined}
            onClick={() => run(new DetachFabricCommand([panelId], project, panelId))}
          >{users}</ValueButton>
        </Row>
        <SlotRow label="材质模型">
          <FlexSelect<FabricPresetKey>
            value={newPreset}
            options={FABRIC_PRESET_KEYS.map(k => ({ value: k, label: FABRIC_PRESET_LABELS[k] }))}
            onChange={setNewPreset}
            title="新增材质使用的面料类型"
          />
          <IconButton
            title="按所选面料新建独立材质并赋给当前版型片"
            onClick={() => run(new AddFabricCommand([panelId], project, newPreset))}
          ><Icon name="plus" size={12} /></IconButton>
        </SlotRow>
      </Section>
      {fabric ? (
        <Section title="外观">
          <ColorRow label="基础色" value={fabric.appearance.baseColor} onChange={v => appearance({ baseColor: v })} />
          <SliderRow label="粗糙度" min={0} max={1} step={0.01} value={fabric.appearance.roughness}
            onChange={v => appearance({ roughness: v })} />
          <SliderRow label="金属度" min={0} max={1} step={0.01} value={fabric.appearance.metallic}
            onChange={v => appearance({ metallic: v })} />
          <SliderRow label="光泽强度" min={0} max={1} step={0.01} value={fabric.appearance.sheenIntensity}
            onChange={v => appearance({ sheenIntensity: v })} />
          <ColorRow label="光泽色" value={fabric.appearance.sheenColor} onChange={v => appearance({ sheenColor: v })} />
          <SliderRow label="法线强度" min={0} max={2} step={0.05} value={fabric.appearance.normalScale}
            onChange={v => appearance({ normalScale: v })} />
        </Section>
      ) : (
        <Hint>这个版型片还没有材质，点右侧下拉换用一个，或用「＋」建一个。</Hint>
      )}
    </>
  );
}
