import type { AvatarParams } from '@/model';
import type { AssetItem } from '@/ui/assets/assetItem';

import { AVATAR_PRESETS, matchAvatarPreset, type AvatarPreset } from '@/model/defaults';
import { useProjectStore } from '@/store';
import { useAssetPreview } from '@/ui/assets/assetPreviews';
import { importAvatarViaPicker } from '@/ui/modelImport';
import { AssetRow, HeaderButton, Section, styles } from '@/ui/panels/assetTabs/shared';
import { patchValue } from '@/ui/sceneCommands';
import { notify } from '@/ui/widgets/toast';

export function ModelAssets() {
  const avatar = useProjectStore(s => s.project.avatar);
  const imported = avatar.source === 'glb';
  const current = matchAvatarPreset(avatar.params);
  const importedPreview = useAssetPreview('model', imported ? avatar.glbUrl ?? null : null);
  const importModel = () => void importAvatarViaPicker();

  const switchToPreset = (preset: AvatarPreset) => {
    patchValue(
      '切换模特',
      p => p.avatar,
      (ctx, value) => { ctx.project.avatar = { ...value }; },
      {
        ...avatar,
        source: 'makehuman',
        glbObjectKey: undefined,
        glbUrl: undefined,
        modelName: undefined,
        params: { ...preset.params, pose: avatar.params.pose },
      },
    );
    notify(`已切换到${preset.label}`);
  };

  const importedItem: AssetItem = {
    id: 'imported',
    name: avatar.modelName ?? '导入模型',
    meta: '导入模型',
    thumb: importedPreview ? { kind: 'image', src: importedPreview } : { kind: 'icon', name: 'avatar' },
    status: 'active',
    statusLabel: '正在使用',
    title: '正在使用',
  };

  return (
    <>
      <Section title="内置" count={AVATAR_PRESETS.length}>
        {AVATAR_PRESETS.map(preset => {
          const active = !imported && current?.id === preset.id;
          return (
            <PresetRow
              key={preset.id}
              preset={preset}
              active={active}
              onUse={active ? undefined : () => switchToPreset(preset)}
            />
          );
        })}
        {!imported && !current ? <div style={styles.note}>自定义体型</div> : null}
      </Section>
      <Section
        title="我的"
        count={imported ? 1 : 0}
        action={<HeaderButton label="导入" title="导入 .glb 模特" onClick={importModel} />}
        empty={{ text: '还没有导入的模特' }}
      >
        {imported ? <AssetRow item={importedItem} /> : null}
      </Section>
    </>
  );
}

function PresetRow({ preset, active, onUse }: {
  preset: AvatarPreset;
  active: boolean;
  onUse?: () => void;
}) {
  const preview = useAssetPreview('body', JSON.stringify(preset.params));
  const item: AssetItem = {
    id: preset.id,
    name: preset.label,
    meta: measurements(preset.params),
    thumb: preview ? { kind: 'image', src: preview } : { kind: 'icon', name: 'avatar' },
    ...(active ? { status: 'active' as const } : {}),
    title: onUse ? `切换到${preset.label}` : '正在使用',
    ...(onUse
      ? { actions: [{ id: 'use', label: `切换到${preset.label}`, kind: 'primary' as const, run: onUse }] }
      : {}),
  };
  return <AssetRow item={item} />;
}

function measurements(params: AvatarParams): string {
  return `${params.heightCm} cm · 胸 ${params.chestCm} · 腰 ${params.waistCm} · 臀 ${params.hipCm}`;
}
