import { BUNDLED_AVATARS, type AvatarParams, type BundledAvatar } from '@/model';
import { useProjectStore } from '@/store';
import { patchValue } from '@/ui/sceneCommands';
import { useAssetPreview } from '@/ui/assets/assetPreviews';
import { AssetRow, Section, notify } from '@/ui/panels/assetTabs/shared';

/** Bundled body meshes plus the procedural body; a row switches the model in place. */
export function ModelAssets() {
  const avatar = useProjectStore(s => s.project.avatar);
  const current = avatar.source === 'procedural' ? 'procedural' : avatar.glbUrl ?? '';

  const swap = (url: string | 'procedural', label: string) => {
    if (url === current) return;
    const next = url === 'procedural'
      ? { ...avatar, source: 'procedural' as const }
      : {
        ...avatar,
        source: 'glb' as const,
        glbUrl: url,
        modelName: undefined,
        params: { ...BUNDLED_AVATARS.find(model => model.url === url)!.params },
      };
    patchValue('切换模特', p => p.avatar, (ctx, value) => { ctx.project.avatar = { ...value }; }, next);
    notify(`已切换到「${label}」，布料将重建`);
  };

  return (
    <>
      <Section title="内置模特">
        {BUNDLED_AVATARS.map(model => (
          <ModelRow
            key={model.url}
            model={model}
            active={current === model.url}
            onPick={() => swap(model.url, model.label)}
          />
        ))}
      </Section>
      <Section title="程序模特">
        <AssetRow
          name="程序模特"
          meta="程序生成的胶囊身体"
          icon="avatar"
          active={current === 'procedural'}
          title="切换到程序模特"
          onClick={() => swap('procedural', '程序模特')}
        />
      </Section>
    </>
  );
}

/** One bundled mesh row, showing the portrait the render backend drew for it. */
function ModelRow({ model, active, onPick }: {
  model: BundledAvatar;
  active: boolean;
  onPick: () => void;
}) {
  const preview = useAssetPreview('model', model.url);
  return (
    <AssetRow
      name={model.label}
      meta={measurements(model.params)}
      icon="avatar"
      {...(preview ? { image: preview } : {})}
      active={active}
      title="切换到这个模特"
      onClick={onPick}
    />
  );
}

/** Body measurements shown under a model name. */
function measurements(params: AvatarParams): string {
  return `${params.heightCm} cm · 胸 ${params.chestCm} · 腰 ${params.waistCm}`;
}
