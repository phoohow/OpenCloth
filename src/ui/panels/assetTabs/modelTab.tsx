import type { AvatarParams } from '@/model';
import { useProjectStore } from '@/store';
import { patchValue } from '@/ui/sceneCommands';
import { AssetRow, Section, notify } from '@/ui/panels/assetTabs/shared';

/** Body sources: the parametric mannequin, and the model file when the project imported one. */
export function ModelAssets() {
  const avatar = useProjectStore(s => s.project.avatar);
  const imported = avatar.source === 'glb';

  const useMannequin = () => {
    if (!imported) return;
    patchValue(
      '恢复基础模特',
      p => p.avatar,
      (ctx, value) => { ctx.project.avatar = { ...value }; },
      { ...avatar, source: 'makehuman', glbObjectKey: undefined, glbUrl: undefined, modelName: undefined },
    );
    notify('已切换到基础模特，布料将重建');
  };

  return (
    <Section title="模特">
      <AssetRow
        name="基础模特"
        meta={measurements(avatar.params)}
        icon="avatar"
        active={!imported}
        title="切换到按体型生成的基础模特"
        onClick={useMannequin}
      />
      {imported ? (
        <AssetRow
          name={avatar.modelName ?? '自定义模型'}
          meta="导入的模型文件"
          icon="avatar"
          active
          title="当前使用导入的模型"
          onClick={() => undefined}
        />
      ) : null}
    </Section>
  );
}

/** Body measurements shown under the model name. */
function measurements(params: AvatarParams): string {
  const gender = Math.round((params.gender ?? 0) * 100);
  return `${params.heightCm} cm · 胸 ${params.chestCm} · 腰 ${params.waistCm} · 臀 ${params.hipCm} · 性别 ${gender}%`;
}
