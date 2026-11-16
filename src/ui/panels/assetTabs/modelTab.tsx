import type { AvatarParams } from '@/model';
import { AVATAR_PRESETS, matchAvatarPreset, type AvatarPreset } from '@/model/defaults';
import { useProjectStore } from '@/store';
import { patchValue } from '@/ui/sceneCommands';
import { useAssetPreview } from '@/ui/assets/assetPreviews';
import { AssetRow, Section, notify, styles } from '@/ui/panels/assetTabs/shared';

/** Body presets the model library offers, drawn as portraits by the render layer. */
export function ModelAssets() {
  const avatar = useProjectStore(s => s.project.avatar);
  const imported = avatar.source === 'glb';
  const current = matchAvatarPreset(avatar.params);
  const importedPreview = useAssetPreview('model', imported ? avatar.glbUrl ?? null : null);

  /** Replaces the body with a preset figure, keeping the current arm pose. */
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

  return (
    <Section title="模特">
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
      {imported ? (
        <AssetRow
          name={avatar.modelName ?? '导入模型'}
          meta="导入模型"
          icon="avatar"
          {...(importedPreview ? { image: importedPreview } : {})}
          active
          title="正在使用"
        />
      ) : null}
      {!imported && !current ? <div style={styles.note}>自定义体型</div> : null}
    </Section>
  );
}

/** One preset row, with the portrait the preview pipeline draws for its measurements. */
function PresetRow({ preset, active, onUse }: {
  preset: AvatarPreset;
  active: boolean;
  onUse?: () => void;
}) {
  const preview = useAssetPreview('body', JSON.stringify(preset.params));
  return (
    <AssetRow
      name={preset.label}
      meta={measurements(preset.params)}
      icon="avatar"
      {...(preview ? { image: preview } : {})}
      active={active}
      title={onUse ? `切换到${preset.label}` : '正在使用'}
      {...(onUse ? { onClick: onUse } : {})}
    />
  );
}

/** Body measurements shown under the model name. */
function measurements(params: AvatarParams): string {
  return `${params.heightCm} cm · 胸 ${params.chestCm} · 腰 ${params.waistCm} · 臀 ${params.hipCm}`;
}