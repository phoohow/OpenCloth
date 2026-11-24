import type { Project, Trim, TrimKind } from '@/model/types';
import type { AssetItem } from '@/ui/assets/assetItem';

import { deleteTrimAsset, listTrimAssets } from '@/io/storage';
import { builtInTrimAssets, idsOfKind, TRIM_KIND_LABELS, type TrimAsset } from '@/model';
import { useProjectStore, useUIStore } from '@/store';
import { panelCentre, placeTrimOnPanel, selectedPanelIds, type TrimPlacementSpec } from '@/ui/assets/applyAsset';
import { ASSET_MESSAGES } from '@/ui/assets/messages';
import { useStoredAssets } from '@/ui/assets/useStoredAssets';
import { AssetRow, Section } from '@/ui/panels/assetTabs/shared';
import { askConfirm } from '@/ui/widgets/askDialog';
import { notify } from '@/ui/widgets/toast';
import { useMemo } from 'react';

const TRIM_IO = { list: listTrimAssets, remove: deleteTrimAsset };

interface OwnedTrim extends TrimPlacementSpec {
  key: string;
  name: string;
  places: number;
}

export function TrimAssets() {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const builtIn = useMemo(() => builtInTrimAssets(), []);
  const { items: stored, remove } = useStoredAssets(TRIM_IO);
  const panelIds = idsOfKind(selection, 'panel').filter(id => !!project.pattern.panels[id]);
  const owned = useMemo(() => collectOwnedTrims(project.pattern.trims), [project.pattern.trims]);
  const ownedKeys = new Set(owned.map(trim => trim.key));
  const library = stored.filter(asset => !ownedKeys.has(specKeyOf(asset)));

  const place = (spec: TrimPlacementSpec) => {
    const [panelId] = selectedPanelIds();
    if (!panelId) {
      notify(ASSET_MESSAGES.noPanel);
      return;
    }

    placeTrimOnPanel(panelId, panelCentre(panelId), spec);
  };

  const confirmRemove = async (asset: TrimAsset) => {
    const ok = await askConfirm({
      title: `移除「${asset.name}」？`,
      detail: '移除只影响素材库，已经放到版片上的辅料不受影响。',
      confirmLabel: '移除',
      danger: true,
    });
    if (ok) await remove(asset.id, asset.name);
  };

  const row = (spec: TrimPlacementSpec & { key: string; label: string }, asset: TrimAsset | null, onDelete?: () => void, places = 0) => {
    const applied = asset === null && panelIds.some(panelId => trimApplied(project, panelId, spec));
    const item: AssetItem = {
      id: spec.key,
      name: spec.label,
      meta: `${spec.sizeMm} mm${spec.qty > 1 ? ` · ×${spec.qty}` : ''}${places > 1 ? ` · ${places} 处` : ''}`,
      thumb: { kind: 'swatch', color: spec.color },
      title: '拖到版片上放置，或放到选中版片的中心',
      drag: asset ? { kind: 'trim', asset } : { kind: 'trim', asset: asAsset(spec) },
      ...(applied ? { status: 'applied' as const, statusLabel: '选中版片已有该辅料' } : {}),
      actions: [
        { id: 'apply', label: '放到选中版片中心', icon: 'check', kind: 'primary', run: () => place(spec) },
        ...(onDelete ? [{ id: 'remove', label: `移除「${spec.label}」`, kind: 'danger' as const, run: onDelete }] : []),
      ],
    };
    return <AssetRow key={item.id} item={item} />;
  };

  return (
    <>
      <Section title="内置" count={builtIn.length}>
        {builtIn.map(asset => row(
          { key: asset.id, label: TRIM_KIND_LABELS[asset.kind], ...asset },
          asset,
        ))}
      </Section>
      <Section title="我的" count={owned.length + library.length} empty={{ text: '还没有辅料' }}>
        {owned.map(trim => row({ ...trim, label: trim.name }, null, undefined, trim.places))}
        {library.map(asset => row(
          { key: asset.id, label: asset.name, ...asset },
          asset,
          () => void confirmRemove(asset),
        ))}
      </Section>
    </>
  );
}

function collectOwnedTrims(trims: Record<string, Trim>): OwnedTrim[] {
  const rows = new Map<string, OwnedTrim>();
  for (const trim of Object.values(trims ?? {})) {
    const name = trim.name ?? TRIM_KIND_LABELS[trim.kind];
    const key = specKey(trim.kind, trim.sizeMm, trim.color, trim.qty, name);
    const found = rows.get(key);
    if (found) {
      found.places += 1;
      continue;
    }

    rows.set(key, {
      key,
      name,
      kind: trim.kind,
      sizeMm: trim.sizeMm,
      color: trim.color,
      qty: trim.qty,
      ...(trim.unitPrice !== undefined ? { unitPrice: trim.unitPrice } : {}),
      places: 1,
    });
  }

  return [...rows.values()];
}

function specKey(kind: TrimKind, sizeMm: number, color: string, qty: number, name: string): string {
  return [kind, sizeMm, color, qty, name].join('|');
}

function specKeyOf(asset: TrimAsset): string {
  return specKey(asset.kind, asset.sizeMm, asset.color, asset.qty, asset.name);
}

function asAsset(spec: TrimPlacementSpec & { key: string; label: string }): TrimAsset {
  return {
    id: spec.key,
    name: spec.label,
    source: 'user',
    kind: spec.kind,
    sizeMm: spec.sizeMm,
    color: spec.color,
    qty: spec.qty,
    ...(spec.unitPrice !== undefined ? { unitPrice: spec.unitPrice } : {}),
  };
}

function trimApplied(project: Project, panelId: string, spec: TrimPlacementSpec): boolean {
  return Object.values(project.pattern.trims).some(trim => (
    trim.panelId === panelId
    && trim.kind === spec.kind
    && trim.sizeMm === spec.sizeMm
    && trim.color === spec.color
    && trim.qty === spec.qty
  ));
}
