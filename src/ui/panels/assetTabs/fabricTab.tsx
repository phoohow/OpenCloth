import { useCallback, useEffect, useMemo, useState } from 'react';
import { builtInFabricAssets, fabricAssetFrom, fabricAssetSummary, idsOfKind, type FabricAsset } from '@/model';
import { useProjectStore, useUIStore } from '@/store';
import { deleteFabricAsset, listFabricAssets, saveFabricAsset } from '@/io/storage';
import { AssetRow, Section, notify, styles } from '@/ui/panels/assetTabs/shared';

/** Built-in and saved materials; a row is dragged onto a panel to apply it. */
export function FabricAssets() {
  const project = useProjectStore(s => s.project);
  const builtIn = useMemo(() => builtInFabricAssets(), []);
  const [saved, setSaved] = useState<FabricAsset[]>([]);

  const refresh = useCallback(async () => {
    try {
      setSaved(await listFabricAssets());
    } catch {
      notify('存储不可用，收藏仅在本次会话有效');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Saves the selected panel's material, or the project's first one, as a reusable asset. */
  const collectCurrent = () => {
    const panelId = idsOfKind(useUIStore.getState().selection, 'panel')
      .find(id => !!project.pattern.panels[id]);
    const fabricId = panelId ? project.pattern.panels[panelId]?.fabricId : Object.keys(project.fabrics)[0];
    const fabric = fabricId ? project.fabrics[fabricId] : undefined;
    if (!fabric) {
      notify('当前工程没有可收藏的面料');
      return;
    }
    void saveFabricAsset(fabricAssetFrom(fabric)).then(() => {
      void refresh();
      notify(`已收藏「${fabric.name}」`);
    }).catch(() => notify('收藏失败：本机存储不可用'));
  };

  const remove = (id: string) => {
    void deleteFabricAsset(id).then(() => {
      void refresh();
      notify('已删除收藏的面料');
    }).catch(() => notify('删除失败：本机存储不可用'));
  };

  const card = (asset: FabricAsset, onDelete?: () => void) => (
    <AssetRow
      key={asset.id}
      name={asset.name}
      swatch={asset.fabric.appearance.baseColor}
      meta={`${asset.fabric.physics.massPerArea} g/m²`}
      title={`拖到版片应用 · ${fabricAssetSummary(asset)}`}
      dragPayload={{ kind: 'fabric', asset }}
      {...(onDelete ? { onDelete } : {})}
    />
  );

  return (
    <>
      <Section title="内置面料">
        {builtIn.map(asset => card(asset))}
      </Section>
      <Section
        title={`我的面料（${saved.length}）`}
        action={<button style={styles.iconBtn} title="收藏当前面料" onClick={collectCurrent}>收藏</button>}
      >
        {saved.length === 0
          ? <div style={styles.note}>还没有收藏</div>
          : saved.map(asset => card(asset, () => remove(asset.id)))}
      </Section>
    </>
  );
}
