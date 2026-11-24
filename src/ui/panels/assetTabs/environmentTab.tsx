import type { AssetItem } from '@/ui/assets/assetItem';

import { getModelBlob } from '@/io/storage';
import { environmentSource, hasOwnEnvironment } from '@/model';
import { BUNDLED_ENVIRONMENT_URL } from '@/runtime';
import { useProjectStore } from '@/store';
import { useAssetPreview } from '@/ui/assets/assetPreviews';
import { importEnvironmentViaPicker } from '@/ui/modelImport';
import { AssetRow, HeaderButton, Section } from '@/ui/panels/assetTabs/shared';
import { commitEnvironmentSource } from '@/ui/sceneCommands';
import { notify } from '@/ui/widgets/toast';
import { useEffect, useState } from 'react';

export function EnvironmentAssets() {
  const lights = useProjectStore(s => s.project.scene.lights);
  const ownImage = hasOwnEnvironment(lights);
  const ownInUse = environmentSource(lights) === 'custom';
  const builtIn = useAssetPreview('environment', BUNDLED_ENVIRONMENT_URL);
  const customImage = useEnvironmentImage();
  const customPreview = useAssetPreview('environment', customImage);
  const importEnvironment = () => void importEnvironmentViaPicker();

  const useBuiltIn = () => {
    commitEnvironmentSource('builtin');
    notify('已切换内置环境');
  };

  const useOwn = () => {
    commitEnvironmentSource('custom');
    notify('已切换导入的环境');
  };

  const builtInItem: AssetItem = {
    id: 'builtin',
    name: '影棚环境',
    meta: '内置 HDR',
    thumb: builtIn ? { kind: 'image', src: builtIn } : { kind: 'icon', name: 'environment' },
    ...(ownInUse ? {} : { status: 'active' as const }),
    title: ownInUse ? '使用内置环境贴图' : '正在使用',
    ...(ownInUse
      ? { actions: [{ id: 'use', label: '使用内置环境贴图', kind: 'primary' as const, run: useBuiltIn }] }
      : {}),
  };

  const ownItem: AssetItem = {
    id: 'custom',
    name: lights.iblName ?? '外链环境',
    meta: '导入贴图',
    thumb: customPreview ? { kind: 'image', src: customPreview } : { kind: 'icon', name: 'environment' },
    ...(ownInUse ? { status: 'active' as const } : {}),
    title: ownInUse ? '正在使用' : '使用导入的环境贴图',
    ...(ownInUse
      ? {}
      : { actions: [{ id: 'use', label: '使用导入的环境贴图', kind: 'primary' as const, run: useOwn }] }),
  };

  return (
    <>
      <Section title="内置" count={1}>
        <AssetRow item={builtInItem} />
      </Section>
      <Section
        title="我的"
        count={ownImage ? 1 : 0}
        action={<HeaderButton label="导入" title="导入环境贴图" onClick={importEnvironment} />}
        empty={{ text: '还没有导入的环境图' }}
      >
        {ownImage ? <AssetRow item={ownItem} /> : null}
      </Section>
    </>
  );
}

function useEnvironmentImage(): string | null {
  const external = useProjectStore(s => s.project.scene.lights.iblUrl);
  const storedKey = useProjectStore(s => s.project.scene.lights.iblObjectKey);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    setObjectUrl(null);
    if (!storedKey) return undefined;
    let created: string | null = null;
    let cancelled = false;
    void getModelBlob(storedKey).then(blob => {
      if (!blob || cancelled) return;
      created = URL.createObjectURL(blob instanceof File ? blob : new File([blob], 'environment'));
      setObjectUrl(created);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [storedKey]);

  return external ?? objectUrl;
}
