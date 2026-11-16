import { useCallback, useEffect, useMemo, useState } from 'react';
import { builtInTrimAssets, TRIM_KIND_LABELS, TRIM_KINDS, trimAssetFrom, type TrimAsset } from '@/model';
import type { TrimKind } from '@/model/types';
import { deleteTrimAsset, listTrimAssets, saveTrimAsset } from '@/io/storage';
import { AssetRow, Section, notify, styles } from '@/ui/panels/assetTabs/shared';

/** Built-in and saved trims; a row is dragged onto a spot on a panel to place it there. */
export function TrimAssets() {
  const builtIn = useMemo(() => builtInTrimAssets(), []);
  const [saved, setSaved] = useState<TrimAsset[]>([]);
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TrimKind>('button');
  const [size, setSize] = useState('12');
  const [color, setColor] = useState('#b08d57');
  const [qty, setQty] = useState('1');

  const refresh = useCallback(async () => {
    try {
      setSaved(await listTrimAssets());
    } catch {
      notify('存储不可用，收藏仅在本次会话有效');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = () => {
    const sizeMm = Number(size);
    const count = Math.round(Number(qty));
    if (!(sizeMm > 0)) { notify('辅料直径需为正数'); return; }
    if (!(count >= 1 && count <= 9999)) { notify('数量需为 1–9999 的整数'); return; }
    void saveTrimAsset(trimAssetFrom({
      name: name.trim() || TRIM_KIND_LABELS[kind],
      kind,
      sizeMm,
      color,
      qty: count,
    })).then(() => {
      setName('');
      setComposing(false);
      void refresh();
      notify('已收藏当前辅料规格');
    }).catch(() => notify('收藏失败：本机存储不可用'));
  };

  const remove = (id: string) => {
    void deleteTrimAsset(id).then(() => {
      void refresh();
      notify('已删除收藏的辅料');
    }).catch(() => notify('删除失败：本机存储不可用'));
  };

  const card = (asset: TrimAsset, label: string, onDelete?: () => void) => (
    <AssetRow
      key={asset.id}
      name={label}
      swatch={asset.color}
      meta={`${asset.sizeMm} mm${asset.qty > 1 ? ` · ×${asset.qty}` : ''}`}
      title="拖到版片上放置"
      dragPayload={{ kind: 'trim', asset }}
      {...(onDelete ? { onDelete } : {})}
    />
  );

  return (
    <>
      <Section title="内置辅料">
        {builtIn.map(asset => card(asset, TRIM_KIND_LABELS[asset.kind]))}
      </Section>
      <Section
        title={`我的辅料（${saved.length}）`}
        action={(
          <button style={styles.iconBtn} title="收藏一组规格" onClick={() => setComposing(value => !value)}>
            {composing ? '取消' : '收藏规格'}
          </button>
        )}
      >
        {composing && (
          <div style={styles.body}>
            <input style={styles.field} placeholder="名称（默认取类型名）" value={name} onChange={e => setName(e.target.value)} />
            <div style={styles.fieldRow}>
              <select style={styles.field} value={kind} onChange={e => setKind(e.target.value as TrimKind)}>
                {TRIM_KINDS.map(option => <option key={option} value={option}>{TRIM_KIND_LABELS[option]}</option>)}
              </select>
            </div>
            <div style={styles.fieldRow}>
              <input style={styles.field} type="number" min="0.5" step="0.5" value={size}
                title="直径(mm)" placeholder="直径" onChange={e => setSize(e.target.value)} />
              <input style={styles.color} type="color" value={color} onChange={e => setColor(e.target.value)} />
              <input style={styles.field} type="number" min="1" step="1" value={qty}
                title="数量" placeholder="数量" onChange={e => setQty(e.target.value)} />
            </div>
            <button style={styles.iconBtn} onClick={save}>收藏</button>
          </div>
        )}
        {saved.length === 0
          ? <div style={styles.note}>还没有收藏</div>
          : saved.map(asset => card(asset, asset.name, () => remove(asset.id)))}
      </Section>
    </>
  );
}
