import { useEffect, useState } from 'react';
import { BUNDLED_ENVIRONMENT_URL } from '@/runtime';
import { useProjectStore } from '@/store';
import { getModelBlob } from '@/io/storage';
import { commitEnvironmentReset } from '@/ui/sceneCommands';
import { importEnvironmentViaPicker } from '@/ui/modelImport';
import { useAssetPreview } from '@/ui/assets/assetPreviews';
import { AssetRow, Section, notify, styles } from '@/ui/panels/assetTabs/shared';

/** Environment images that light and back the viewport. Light switches stay in the properties panel. */
export function EnvironmentAssets() {
  const lights = useProjectStore(s => s.project.scene.lights);
  const custom = !!(lights.iblObjectKey ?? lights.iblUrl);
  const builtIn = useAssetPreview('environment', BUNDLED_ENVIRONMENT_URL);
  const customImage = useEnvironmentImage();
  const customPreview = useAssetPreview('environment', customImage);

  const useBuiltIn = () => {
    commitEnvironmentReset();
    notify('已恢复内置环境');
  };

  return (
    <>
      <Section title="环境图">
        <AssetRow
          name="影棚环境"
          meta="内置 HDR"
          icon="environment"
          {...(builtIn ? { image: builtIn } : {})}
          active={!custom}
          title={custom ? '使用内置环境贴图' : '正在使用'}
          {...(custom ? { onClick: useBuiltIn } : {})}
        />
        {custom && (
          <AssetRow
            name={lights.iblName ?? '外链环境图'}
            meta="导入的环境贴图"
            icon="environment"
            {...(customPreview ? { image: customPreview } : {})}
            active
            title="当前使用的环境贴图"
          />
        )}
      </Section>
      <button
        style={{ ...styles.iconBtn, height: 24, alignSelf: 'stretch', justifyContent: 'center' }}
        onClick={() => void importEnvironmentViaPicker()}
      >导入环境贴图</button>
    </>
  );
}

/** Image the project's environment points at: an external url, or the stored import. */
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
