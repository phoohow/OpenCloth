import type { Command } from '@/commands';
import type { Fabric, FabricMapSlot, FabricPresetKey, Project, SkinAppearance } from '@/model/types';

import { computeBBox } from '@/base/geom';
import { AddFabricCommand, AssignFabricCommand, RemoveFabricCommand } from '@/commands';
import { readImageAsPngDataUrl } from '@/io/serialization';
import { DEFAULT_SKIN_APPEARANCE, FABRIC_PRESET_KEYS, FABRIC_PRESET_LABELS } from '@/model';
import { fabricList, panelsUsingFabric, uniqueFabricName } from '@/model';
import {
  DEFAULT_KNIT_SPEC, KNIT_MACHINE_GAUGES, KNIT_NEEDLE_GAUGE_MAX, KNIT_NEEDLE_GAUGE_MIN,
  KNIT_ROW_GAUGE_MAX, KNIT_ROW_GAUGE_MIN, KNIT_STITCHES, KNIT_STITCH_LABELS, knitGaugeOf,
  knitNeedleCount, knitOf, knitRowCount, type KnitStitch,
} from '@/model';
import { samplePanelOutline, UV_TILE_CM } from '@/pattern/panel';
import { KNIT_TILE_CM, knitTextureDataUrl } from '@/runtime';
import { useProjectStore } from '@/store';
import { Icon } from '@/ui/icons';
import { SKIN_TONES } from '@/ui/optionTables';
import { patchValue, setAvatarDisplay, type EngineRef } from '@/ui/sceneCommands';
import { Vec2Field } from '@/ui/widgets/numberField';
import {
  ButtonRow, ColorRow, Field, FileRow, Hint, IconButton, InlineText, Row, Section,
  SelectRow, SliderRow, SmallButton,
} from '@/ui/widgets/propertyRows';
import { useState } from 'react';

const countStyle: React.CSSProperties = {
  flex: '0 0 auto', minWidth: 10, color: '#999', fontSize: 'var(--oc-fs-micro)', textAlign: 'right',
};

const CUSTOM_MACHINE_GAUGE = 'custom';

const NOT_KNIT_TIP = '当前材质不是针织，点下方「设为针织」后即可调整';

const MAP_SLOT_LABELS: Record<FabricMapSlot, string> = {
  albedo: '基础色图',
  normal: '法线图',
  roughness: '粗糙度图',
  metallic: '金属度图',
};

const CUSTOM_TONE = 'custom';

export function panelFabric(project: Project, panelId: string): Fabric | undefined {
  const panel = project.pattern.panels[panelId];
  return panel ? project.fabrics[panel.fabricId] : undefined;
}

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

export function MaterialTab({ project, panelId, engineRef }: {
  project: Project; panelId: string; engineRef: EngineRef;
}) {
  const panel = project.pattern.panels[panelId];
  const fabric = panel ? project.fabrics[panel.fabricId] : undefined;
  const [newPreset, setNewPreset] = useState<FabricPresetKey>('cotton');
  if (!panel) return <Hint>版片已删除。</Hint>;

  const run = (cmd: Command) => {
    useProjectStore.getState().executeCommand(cmd);
    engineRef.current?.applyFabrics(useProjectStore.getState().project);
  };

  const users = fabric ? panelsUsingFabric(project, fabric.id).length : 0;
  const options = [
    { value: '', label: '未指定' },
    ...fabricList(project).map(f => ({ value: f.id, label: f.name })),
  ];
  if (panel.fabricId && !options.some(o => o.value === panel.fabricId)) {
    options.splice(1, 0, { value: panel.fabricId, label: '未指定' });
  }

  const setFabric = (label: string, next: Fabric) => writeFabric(label, fabric!, next);
  const appearance = (patch: Partial<Fabric['appearance']>) => setFabric('修改材质外观', {
    ...fabric!, appearance: { ...fabric!.appearance, ...patch },
  });
  const rename = (name: string) => setFabric('重命名材质', { ...fabric!, name: uniqueFabricName(project, name) });

  const pickMap = async (slot: FabricMapSlot, file: File) => {
    const url = await readImageAsPngDataUrl(file);
    const latest = useProjectStore.getState().project.fabrics[fabric!.id];
    if (!latest) return;
    const prev = latest.appearance.maps ?? {};
    const maps = { ...prev, [slot]: url, fileNames: { ...prev.fileNames, [slot]: file.name } };
    writeFabric('修改材质贴图', latest, { ...latest, appearance: { ...latest.appearance, maps } });
  };

  const clearMap = (slot: FabricMapSlot) => {
    const prev = fabric!.appearance.maps ?? {};
    const fileNames = { ...prev.fileNames };
    delete fileNames[slot];
    appearance({ maps: { ...prev, [slot]: null, fileNames } });
  };
  const maps = fabric?.appearance.maps ?? {};
  const knit = knitOf(fabric);
  const knitEnabled = !!fabric && (fabric.presetKey === 'knit' || !!fabric.knit);
  const knitTip = (tip: string) => (knitEnabled ? tip : NOT_KNIT_TIP);
  const machineGauge = knitGaugeOf(knit);
  const gaugeValue = machineGauge === null ? CUSTOM_MACHINE_GAUGE : String(machineGauge);
  const knitBox = panel ? computeBBox(samplePanelOutline(project.pattern, panel)) : null;
  const knitNeedles = knitBox ? knitNeedleCount(knitBox.max.x - knitBox.min.x, knit) : 0;
  const knitRows = knitBox ? knitRowCount(knitBox.max.y - knitBox.min.y, knit) : 0;

  const setKnit = (patch: Partial<typeof knit>) => setFabric('修改针织组织', {
    ...fabric!, knit: { ...knit, ...patch },
  });

  const enableKnit = () => setFabric('启用针织参数', { ...fabric!, knit: structuredClone(DEFAULT_KNIT_SPEC) });

  const makeKnitTexture = () => {
    const url = knitTextureDataUrl(knit);
    if (!url) return;
    const scale = UV_TILE_CM / KNIT_TILE_CM;
    appearance({
      maps: { ...maps, albedo: url, fileNames: { ...maps.fileNames, albedo: '针织组织.png' } },
      uvTiling: { x: scale, y: scale },
    });
  };

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
      <Section title="材质">
        <Row label="名称" tip="改名对共用此材质的版片同时生效">
          <Field>
            {fabric
              ? <InlineText value={fabric.name} onChange={rename} />
              : <InlineText value="" disabled placeholder="未指定" onChange={() => {}} />}
          </Field>
        </Row>
        <SelectRow label="使用" tip="这个版片用哪块材质，右侧数字是共用片数" value={panel.fabricId} options={options}
          onChange={fabricId => run(new AssignFabricCommand([panelId], fabricId))}
          trailing={
            <>
              {fabric && <span style={countStyle} title={`被 ${users} 个版片使用`}>{users}</span>}
              <IconButton
                disabled={!fabric}
                title={fabric ? `删除材质「${fabric.name}」，${users} 个版片将变为未指定` : '当前没有材质'}
                onClick={() => fabric && run(new RemoveFabricCommand(fabric))}
              ><Icon name="minus" size={10} /></IconButton>
            </>
          } />
      </Section>
      <Section title="新增材质">
        <SelectRow<FabricPresetKey> label="类型" tip="按预设参数新建一块材质" value={newPreset}
          options={FABRIC_PRESET_KEYS.map(k => ({ value: k, label: FABRIC_PRESET_LABELS[k] }))}
          onChange={setNewPreset}
          trailing={
            <IconButton title="按这个类型新建材质，并指定给当前版片"
              onClick={() => run(new AddFabricCommand([panelId], project, newPreset))}><Icon name="plus" size={10} /></IconButton>
          } />
      </Section>
      {fabric ? (
        <>
          <Section title="外观">
            <ColorRow label="基础色" value={fabric.appearance.baseColor} onChange={v => appearance({ baseColor: v })} />
            {mapRow('albedo')}
            <SliderRow label="粗糙度" tip="表面越粗糙越不反光" min={0} max={1} step={0.01} value={fabric.appearance.roughness}
              onChange={v => appearance({ roughness: v })} />
            {mapRow('roughness')}
            <SliderRow label="金属度" tip="按金属的方式反射环境" min={0} max={1} step={0.01} value={fabric.appearance.metallic}
              onChange={v => appearance({ metallic: v })} />
            {mapRow('metallic')}
            <SliderRow label="法线强度" tip="法线贴图凹凸的强弱" min={0} max={2} step={0.05} value={fabric.appearance.normalScale}
              onChange={v => appearance({ normalScale: v })} />
            {mapRow('normal')}
            <SliderRow label="光泽强度" tip="布料表面的柔光强弱" min={0} max={1} step={0.01}
              value={fabric.appearance.sheenIntensity}
              onChange={v => appearance({ sheenIntensity: v })} />
            <ColorRow label="光泽色" value={fabric.appearance.sheenColor} onChange={v => appearance({ sheenColor: v })} />
            <SliderRow label="光泽粗糙" tip="柔光的扩散程度" min={0} max={1} step={0.01} value={fabric.appearance.sheenRoughness}
              onChange={v => appearance({ sheenRoughness: v })} />
            <SliderRow label="透光" tip="光线穿透布面的程度" min={0} max={1} step={0.01} value={fabric.appearance.transmission}
              onChange={v => appearance({ transmission: v })} />
            <SliderRow label="厚度" tip="mm" min={0} max={5} step={0.01} value={fabric.appearance.thickness}
              onChange={v => appearance({ thickness: v })} />
            <SliderRow label="清漆" tip="表面涂层的高光" min={0} max={1} step={0.01} value={fabric.appearance.clearcoat}
              onChange={v => appearance({ clearcoat: v })} />
            <SliderRow label="清漆粗糙" tip="涂层高光扩散的程度" min={0} max={1} step={0.01}
              value={fabric.appearance.clearcoatRoughness}
              onChange={v => appearance({ clearcoatRoughness: v })} />
            <SliderRow label="各向异性" tip="高光沿一个方向拉长" min={0} max={1} step={0.01} value={fabric.appearance.anisotropy}
              onChange={v => appearance({ anisotropy: v })} />
            <SliderRow label="虹彩" tip="随角度变色的薄膜效果" min={0} max={1} step={0.01} value={fabric.appearance.iridescence}
              onChange={v => appearance({ iridescence: v })} />
            <Vec2Field label="平铺" tip="贴图在 UV 上的重复次数，最小 0.01" value={fabric.appearance.uvTiling}
              step={0.1} precision={2} min={0.01} onCommit={v => appearance({ uvTiling: v })} />
            <Vec2Field label="偏移" tip="贴图在 UV 上的偏移" value={fabric.appearance.uvOffset}
              step={0.1} precision={2} onCommit={v => appearance({ uvOffset: v })} />
          </Section>
          <Section title="针织">
            <SelectRow label="组织结构" tip={knitTip('针织物组织，决定贴图图案与上机针数取整')}
              value={knit.stitch} disabled={!knitEnabled}
              options={KNIT_STITCHES.map(stitch => ({ value: stitch, label: KNIT_STITCH_LABELS[stitch] }))}
              onChange={v => setKnit({ stitch: v as KnitStitch })} />
            <SelectRow label="机号" tip={knitTip('横机机号，选中即带出起始密度，之后可再微调')} value={gaugeValue}
              disabled={!knitEnabled}
              options={[
                ...KNIT_MACHINE_GAUGES.map(g => ({ value: String(g.gauge), label: `${g.gauge}G` })),
                ...(machineGauge === null ? [{ value: CUSTOM_MACHINE_GAUGE, label: '自定义' }] : []),
              ]}
              onChange={key => {
                const picked = KNIT_MACHINE_GAUGES.find(g => String(g.gauge) === key);
                if (picked) setKnit({ needleGauge: picked.needleGauge, rowGauge: picked.rowGauge });
              }} />
            <SliderRow label="横向密度" tip={knitTip('针/10cm')} value={knit.needleGauge} commitOnRelease
              disabled={!knitEnabled}
              min={KNIT_NEEDLE_GAUGE_MIN} max={KNIT_NEEDLE_GAUGE_MAX} step={1}
              onChange={v => setKnit({ needleGauge: v })} />
            <SliderRow label="纵向密度" tip={knitTip('行/10cm')} value={knit.rowGauge} commitOnRelease
              disabled={!knitEnabled}
              min={KNIT_ROW_GAUGE_MIN} max={KNIT_ROW_GAUGE_MAX} step={1}
              onChange={v => setKnit({ rowGauge: v })} />
            <Row label="本片针数" tip={knitTip('按版片最宽处与横向密度取整')} disabled={!knitEnabled}>
              {`最宽 ${knitNeedles} 针 × 高 ${knitRows} 行`}
            </Row>
            <ButtonRow>
              <SmallButton disabled={!knitEnabled} onClick={makeKnitTexture}
                title={knitTip('按组织与密度生成 10cm 见方的贴图并写入基础色图')}>生成贴图</SmallButton>
              {!knitEnabled && (
                <SmallButton onClick={enableKnit}
                  title="给这块材质补上针织记录（12G 平针），保留其外观与物理参数">设为针织</SmallButton>
              )}
            </ButtonRow>
          </Section>
        </>
      ) : (
        <Hint>未指定材质</Hint>
      )}
    </>
  );
}

export function AvatarMaterialTab({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
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
      <SelectRow label="预设" value={preset?.color ?? CUSTOM_TONE}
        options={toneOptions.map(tone => ({ value: tone.color, label: tone.label }))}
        onChange={v => {
          if (v !== CUSTOM_TONE) write('套用肤色预设', { color: v });
        }} />
      <SliderRow label="粗糙度" min={0} max={1} step={0.01} value={skin.roughness} commitOnRelease
        onChange={v => write('修改皮肤粗糙度', { roughness: v })} />
      <SliderRow label="高光" min={0} max={1} step={0.01} value={skin.clearcoat} commitOnRelease
        onChange={v => write('修改皮肤高光', { clearcoat: v })} />
      <SelectRow label="透明度" tip="半透明时模特变淡，布料与身体的遮挡关系更清楚"
        value={avatar.display === 'translucent' ? 'translucent' : 'solid'}
        options={[{ value: 'solid', label: '不透明' }, { value: 'translucent', label: '半透明' }]}
        onChange={v => setAvatarDisplay(v === 'translucent' ? 'translucent' : 'visible', engineRef)} />
    </Section>
  );
}
