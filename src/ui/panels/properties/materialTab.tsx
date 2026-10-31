import { useState } from 'react';
import { useProjectStore } from '../../../store/stores';
import type { Fabric, FabricMapSlot, FabricPresetKey, Project } from '../../../core/model/types';
import { FABRIC_PRESET_KEYS, FABRIC_PRESET_LABELS } from '../../../core/model/defaults';
import { fabricList, panelsUsingFabric, uniqueFabricName } from '../../../core/model/fabric';
import { AddFabricCommand, AssignFabricCommand, DetachFabricCommand } from '../../../core/command/fabricCommands';
import type { Command } from '../../../core/command/command';
import { readImageAsPngDataUrl } from '../../../io/imageData';
import { patchValue, type EngineRef } from '../../sceneCommands';
import { Vec2Field } from '../../widgets/numberField';
import { Icon } from '../../icons';
import {
  ColorRow, FileRow, FlexSelect, Hint, IconButton, InlineText, PopupSelect, Row, Section,
  SliderRow, SlotRow, ValueButton,
} from '../../widgets/propertyRows';

// ===== Material tab ("材质") =====

/** Texture slots of the appearance block, in display order. */
const MAP_SLOTS: Array<{ slot: FabricMapSlot; label: string }> = [
  { slot: 'albedo', label: '基础色贴图' },
  { slot: 'normal', label: '法线贴图' },
  { slot: 'roughness', label: '粗糙度贴图' },
  { slot: 'metallic', label: '金属度贴图' },
];

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

  /** Reads a picked image, shrinks it, and writes it into one map slot. */
  const pickMap = async (slot: FabricMapSlot, file: File) => {
    const url = await readImageAsPngDataUrl(file);
    const latest = useProjectStore.getState().project.fabrics[fabric!.id];
    if (!latest) return;
    const prev = latest.appearance.maps ?? {};
    const maps = { ...prev, [slot]: url, fileNames: { ...prev.fileNames, [slot]: file.name } };
    writeFabric('修改材质贴图', latest, { ...latest, appearance: { ...latest.appearance, maps } });
  };

  /** Clears one map slot and the file name stored beside it. */
  const clearMap = (slot: FabricMapSlot) => {
    const prev = fabric!.appearance.maps ?? {};
    const fileNames = { ...prev.fileNames };
    delete fileNames[slot];
    appearance({ maps: { ...prev, [slot]: null, fileNames } });
  };
  const maps = fabric?.appearance.maps ?? {};

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
          {MAP_SLOTS.map(({ slot, label }) => (
            <FileRow
              key={slot}
              label={label}
              name={maps.fileNames?.[slot] || (maps[slot] ? '已设置' : '未设置')}
              accept="image/*"
              pickLabel="选择图片"
              clearLabel="清除"
              clearDisabled={!maps[slot]}
              onPick={file => void pickMap(slot, file)}
              onClear={() => clearMap(slot)}
            />
          ))}
          <Vec2Field label="平铺" value={fabric.appearance.uvTiling} step={0.1} precision={2} min={0.01}
            title="UV 平铺次数，最小 0.01" onCommit={v => appearance({ uvTiling: v })} />
          <Vec2Field label="偏移" value={fabric.appearance.uvOffset} step={0.1} precision={2}
            title="UV 偏移" onCommit={v => appearance({ uvOffset: v })} />
        </Section>
      ) : (
        <Hint>这个版型片还没有材质，点右侧下拉换用一个，或用「＋」建一个。</Hint>
      )}
    </>
  );
}
