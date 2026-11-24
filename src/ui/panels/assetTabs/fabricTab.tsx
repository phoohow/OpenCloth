import type { Fabric } from '@/model/types';
import type { AssetItem } from '@/ui/assets/assetItem';

import { deleteFabricAsset, listFabricAssets } from '@/io/storage';
import { builtInFabricAssets, fabricAssetSummary, idsOfKind, type FabricAsset } from '@/model';
import { useProjectStore, useUIStore } from '@/store';
import { applyFabricToPanels, assignFabricToPanels, selectedPanelIds } from '@/ui/assets/applyAsset';
import { ASSET_MESSAGES } from '@/ui/assets/messages';
import { useStoredAssets } from '@/ui/assets/useStoredAssets';
import { AssetRow, Section } from '@/ui/panels/assetTabs/shared';
import { askConfirm } from '@/ui/widgets/askDialog';
import { notify } from '@/ui/widgets/toast';
import { useMemo } from 'react';

const FABRIC_IO = { list: listFabricAssets, remove: deleteFabricAsset };

export function FabricAssets() {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const builtIn = useMemo(() => builtInFabricAssets(), []);
  const { items: stored, remove } = useStoredAssets(FABRIC_IO);
  const panelIds = idsOfKind(selection, 'panel').filter(id => !!project.pattern.panels[id]);

  const owned = Object.values(project.fabrics);
  const ownedAssetIds = new Set(owned.map(fabric => fabric.assetId).filter((id): id is string => !!id));
  const library = stored.filter(asset => !ownedAssetIds.has(asset.id));

  const withTargets = (apply: (panelIds: string[]) => void) => {
    const targets = selectedPanelIds();
    if (targets.length === 0) {
      notify(ASSET_MESSAGES.noPanel);
      return;
    }

    apply(targets);
  };

  const confirmRemove = async (asset: FabricAsset) => {
    const ok = await askConfirm({
      title: `移除「${asset.name}」？`,
      detail: '移除只影响素材库，已经应用到版片的面料不受影响。',
      confirmLabel: '移除',
      danger: true,
    });
    if (ok) await remove(asset.id, asset.name);
  };

  const ownedRow = (fabric: Fabric) => {
    const applied = panelIds.some(panelId => project.pattern.panels[panelId]?.fabricId === fabric.id);
    const item: AssetItem = {
      id: `fabric:${fabric.id}`,
      name: fabric.name,
      meta: `${fabric.physics.massPerArea} g/m²`,
      thumb: { kind: 'swatch', color: fabric.appearance.baseColor },
      title: '应用到选中版片，或拖到版片上',
      drag: { kind: 'fabric-record', fabricId: fabric.id, name: fabric.name },
      ...(applied ? { status: 'applied' as const, statusLabel: '选中版片正在使用' } : {}),
      actions: [
        {
          id: 'apply',
          label: '应用到选中版片',
          icon: 'check',
          kind: 'primary',
          run: () => withTargets(ids => assignFabricToPanels(ids, fabric.id, fabric.name)),
        },
      ],
    };
    return <AssetRow key={item.id} item={item} />;
  };

  const assetRow = (asset: FabricAsset, onDelete?: () => void) => {
    const item: AssetItem = {
      id: `asset:${asset.id}`,
      name: asset.name,
      meta: `${asset.fabric.physics.massPerArea} g/m²`,
      thumb: { kind: 'swatch', color: asset.fabric.appearance.baseColor },
      title: `拖到版片应用 · ${fabricAssetSummary(asset)}`,
      drag: { kind: 'fabric', asset },
      actions: [
        {
          id: 'apply',
          label: '应用到选中版片',
          icon: 'check',
          kind: 'primary',
          run: () => withTargets(ids => applyFabricToPanels(ids, asset)),
        },
        ...(onDelete ? [{ id: 'remove', label: `移除「${asset.name}」`, kind: 'danger' as const, run: onDelete }] : []),
      ],
    };
    return <AssetRow key={item.id} item={item} />;
  };

  return (
    <>
      <Section title="内置" count={builtIn.length}>
        {builtIn.map(asset => assetRow(asset))}
      </Section>
      <Section title="我的" count={owned.length + library.length} empty={{ text: '还没有面料' }}>
        {owned.map(fabric => ownedRow(fabric))}
        {library.map(asset => assetRow(asset, () => void confirmRemove(asset)))}
      </Section>
    </>
  );
}
