import { useState } from 'react';
import { useProjectStore } from '@/store';
import type { Fabric, FabricMapSlot, FabricPresetKey, Project, SkinAppearance } from '@/model/types';
import { DEFAULT_SKIN_APPEARANCE, FABRIC_PRESET_KEYS, FABRIC_PRESET_LABELS } from '@/model';
import { SKIN_TONES } from '@/ui/optionTables';
import { fabricList, panelsUsingFabric, uniqueFabricName } from '@/model';
import { AddFabricCommand, AssignFabricCommand, DetachFabricCommand } from '@/commands';
import type { Command } from '@/commands';
import { readImageAsPngDataUrl } from '@/io/serialization';
import { downloadTextFile } from '@/io/serialization';
import { patchValue, type EngineRef } from '@/ui/sceneCommands';
import { Vec2Field } from '@/ui/widgets/numberField';
import { Icon } from '@/ui/icons';
import {
  ColorRow, FileRow, FlexSelect, Hint, IconButton, InlineText, PopupSelect, Row, Section,
  SelectRow, SliderRow, SlotRow, SmallButton, ValueButton,
} from '@/ui/widgets/propertyRows';
import { samplePanelOutline } from '@/pattern/panel';
import { computeBBox } from '@/common/geom';
import {
  KNIT_STITCHES, KNIT_STITCH_LABELS, knitChartCsv, knitNeedleCount, knitOf, knitRowCount,
  type KnitStitch,
} from '@/model';
import { knitTextureDataUrl } from '@/render/material';

// ===== Material tab ("材质") =====

/** Texture slots of the appearance block. */
const MAP_SLOT_LABELS: Record<FabricMapSlot, string> = {
  albedo: '基础色贴图',
  normal: '法线贴图',
  roughness: '粗糙度贴图',
  metallic: '金属度贴图',
};

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
  if (!panel) return <Hint>版片已删除。</Hint>;

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
  const knit = knitOf(fabric);
  const knitBox = panel ? computeBBox(samplePanelOutline(project.pattern, panel)) : null;
  const knitNeedles = knitBox ? knitNeedleCount(knitBox.max.x - knitBox.min.x, knit) : 0;
  const knitRows = knitBox ? knitRowCount(knitBox.max.y - knitBox.min.y, knit) : 0;

  /** Writes one knit-spec patch onto the material record. */
  const setKnit = (patch: Partial<typeof knit>) => setFabric('修改针织组织', {
    ...fabric!, knit: { ...knit, ...patch },
  });

  /** Renders the stitch tile into the albedo slot and resets UV tiling to one tile per panel. */
  const makeKnitTexture = () => {
    const url = knitTextureDataUrl(knit);
    if (!url) return;
    appearance({
      maps: { ...maps, albedo: url, fileNames: { ...maps.fileNames, albedo: '针织组织.png' } },
      uvTiling: { x: 1, y: 1 },
    });
  };

  const exportKnitChart = () => {
    downloadTextFile(
      `${fabric!.name}-组织图.csv`,
      '\ufeff' + knitChartCsv(knit, knitNeedles, knitRows),
      'text/csv;charset=utf-8',
    );
  };

  /** One texture slot row; it sits directly under the parameter it modulates. */
  const mapRow = (slot: FabricMapSlot) => (
    <FileRow
      label={MAP_SLOT_LABELS[slot]}
      name={maps.fileNames?.[slot] ?? ''}
      accept="image/*"
      pickTitle="选择图片"
      clearTitle="清除"
      clearDisabled={!maps[slot]}
      onPick={file => void pickMap(slot, file)}
      onClear={() => clearMap(slot)}
    />
  );

  return (
    <>
      <Section title="材质槽">
        <SlotRow label="名称">
          {fabric
            ? <InlineText value={fabric.name} title="改名对所有使用此材质的版片生效" onChange={rename} />
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
        <Row label="使用片数">
          <ValueButton
            disabled={users <= 1}
            title={users > 1 ? `被 ${users} 个版片使用，点击复制为独立材质` : undefined}
            onClick={() => run(new DetachFabricCommand([panelId], project, panelId))}
          >{users}</ValueButton>
        </Row>
        <SlotRow label="面料类型">
          <FlexSelect<FabricPresetKey>
            value={newPreset}
            options={FABRIC_PRESET_KEYS.map(k => ({ value: k, label: FABRIC_PRESET_LABELS[k] }))}
            onChange={setNewPreset}
            title="新建材质使用的面料类型"
          />
          <IconButton
            title="按所选面料新建独立材质并赋给当前版片"
            onClick={() => run(new AddFabricCommand([panelId], project, newPreset))}
          ><Icon name="plus" size={12} /></IconButton>
        </SlotRow>
      </Section>
      {fabric ? (
        <>
          <Section title="外观">
            <ColorRow label="基础色" value={fabric.appearance.baseColor} onChange={v => appearance({ baseColor: v })} />
            {mapRow('albedo')}
            <SliderRow label="粗糙度" min={0} max={1} step={0.01} value={fabric.appearance.roughness}
              onChange={v => appearance({ roughness: v })} />
            {mapRow('roughness')}
            <SliderRow label="金属度" min={0} max={1} step={0.01} value={fabric.appearance.metallic}
              onChange={v => appearance({ metallic: v })} />
            {mapRow('metallic')}
            <SliderRow label="法线强度" min={0} max={2} step={0.05} value={fabric.appearance.normalScale}
              onChange={v => appearance({ normalScale: v })} />
            {mapRow('normal')}
            <SliderRow label="光泽强度" min={0} max={1} step={0.01} value={fabric.appearance.sheenIntensity}
              onChange={v => appearance({ sheenIntensity: v })} />
            <ColorRow label="光泽色" value={fabric.appearance.sheenColor} onChange={v => appearance({ sheenColor: v })} />
            <SliderRow label="光泽粗糙度" min={0} max={1} step={0.01} value={fabric.appearance.sheenRoughness}
              onChange={v => appearance({ sheenRoughness: v })} />
            <SliderRow label="透光" min={0} max={1} step={0.01} value={fabric.appearance.transmission}
              onChange={v => appearance({ transmission: v })} />
            <SliderRow label="厚度" min={0} max={5} step={0.01} unit="mm" value={fabric.appearance.thickness}
              onChange={v => appearance({ thickness: v })} />
            <SliderRow label="清漆" min={0} max={1} step={0.01} value={fabric.appearance.clearcoat}
              onChange={v => appearance({ clearcoat: v })} />
            <SliderRow label="清漆粗糙度" min={0} max={1} step={0.01} value={fabric.appearance.clearcoatRoughness}
              onChange={v => appearance({ clearcoatRoughness: v })} />
            <SliderRow label="各向异性" min={0} max={1} step={0.01} value={fabric.appearance.anisotropy}
              onChange={v => appearance({ anisotropy: v })} />
            <SliderRow label="虹彩" min={0} max={1} step={0.01} value={fabric.appearance.iridescence}
              onChange={v => appearance({ iridescence: v })} />
            <Vec2Field label="平铺" value={fabric.appearance.uvTiling} step={0.1} precision={2} min={0.01}
              title="UV 平铺次数，最小 0.01" onCommit={v => appearance({ uvTiling: v })} />
            <Vec2Field label="偏移" value={fabric.appearance.uvOffset} step={0.1} precision={2}
              title="UV 偏移" onCommit={v => appearance({ uvOffset: v })} />
          </Section>
          <Section title="针织组织">
            <SelectRow label="组织" value={knit.stitch}
              options={KNIT_STITCHES.map(stitch => ({ value: stitch, label: KNIT_STITCH_LABELS[stitch] }))}
              onChange={v => setKnit({ stitch: v as KnitStitch })} />
            <SliderRow label="横向密度" unit="针/10cm" min={2} max={30} step={1}
              value={knit.needleGauge} commitOnRelease onChange={v => setKnit({ needleGauge: v })} />
            <SliderRow label="纵向密度" unit="行/10cm" min={2} max={40} step={1}
              value={knit.rowGauge} commitOnRelease onChange={v => setKnit({ rowGauge: v })} />
            <Row label="本片针数">{`${knitNeedles} 针 × ${knitRows} 行`}</Row>
            <Row label="">
              <SmallButton onClick={makeKnitTexture} title="按组织与密度生成灰度针织贴图并写入基础色贴图槽">生成针织贴图</SmallButton>
              <SmallButton onClick={exportKnitChart} title="按本片尺寸与密度导出组织图 CSV">导出组织图 CSV</SmallButton>
            </Row>
            <Hint>针织贴图是灰度组织，乘以基础色显示；组织图按当前片净轮廓的宽高与密度换算针数与行数。</Hint>
          </Section>
        </>
      ) : (
        <Hint>这个版片还没有材质，点右侧下拉换用一个，或用「＋」建一个。</Hint>
      )}
    </>
  );
}

// ===== Avatar material tab ("材质") =====

/** Dropdown value standing for a colour that matches no preset. */
const CUSTOM_TONE = 'custom';

/** Skin appearance of the selected body; edits repaint it without rebuilding the body. */
export function AvatarMaterialTab({ project }: { project: Project }) {
  const avatar = project.avatar;
  const skin = avatar.appearance ?? DEFAULT_SKIN_APPEARANCE;

  const write = (label: string, patch: Partial<SkinAppearance>) => patchValue(
    label,
    p => p.avatar,
    (ctx, value) => { ctx.project.avatar = { ...value }; },
    { ...avatar, appearance: { ...skin, ...patch } },
  );

  const preset = SKIN_TONES.find(tone => tone.color.toLowerCase() === skin.color.toLowerCase());
  const toneOptions = preset ? SKIN_TONES : [...SKIN_TONES, { key: CUSTOM_TONE, label: '自定义', color: CUSTOM_TONE }];

  return (
    <Section title="皮肤">
      <ColorRow label="肤色" value={skin.color} onChange={v => write('修改肤色', { color: v })} />
      <SelectRow label="肤色预设" value={preset?.color ?? CUSTOM_TONE}
        options={toneOptions.map(tone => ({ value: tone.color, label: tone.label }))}
        onChange={v => {
          if (v !== CUSTOM_TONE) write('套用肤色预设', { color: v });
        }} />
      <SliderRow label="粗糙度" min={0} max={1} step={0.01} value={skin.roughness} commitOnRelease
        onChange={v => write('修改皮肤粗糙度', { roughness: v })} />
      <SliderRow label="高光" min={0} max={1} step={0.01} value={skin.clearcoat} commitOnRelease
        onChange={v => write('修改皮肤高光', { clearcoat: v })} />
      <Hint>肤色只作用于无贴图的人体表面，眼睛与自带贴图的模型保持原样。</Hint>
    </Section>
  );
}
