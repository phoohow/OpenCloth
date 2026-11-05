import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  dialogButton, dialogHint, dialogLabel, dialogMessage, dialogNote, dialogRoot,
  dialogSectionTitle, dialogTab, dialogTabActive, dialogTabs, dialogTitle,
} from './dialogStyles';
import type { TrimKind } from '../../core/model/types';
import {
  builtInFabricAssets, builtInTrimAssets, fabricAssetFrom, fabricAssetSummary, fabricFromAsset,
  trimAssetFrom, type FabricAsset, type TrimAsset,
} from '../../core/model/assetLibrary';
import { BUNDLED_AVATARS, TRIM_KIND_LABELS, TRIM_KINDS } from '../../core/model/defaults';
import { AddFabricCommand, AddFabricRecordCommand } from '../../core/command/fabricCommands';
import { AddTrimCommand } from '../../core/command/patternProductionCommands';
import { CompositeCommand } from '../../core/command/patternCommands';
import { samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { computeBBox } from '../../pattern/geom/vec2';
import { useProjectStore, useUIStore } from '../../store/stores';
import { idsOfKind } from '../elementSelection';
import { patchValue } from '../sceneCommands';
import {
  deleteFabricAsset, deleteTrimAsset, listFabricAssets, listTrimAssets, saveFabricAsset, saveTrimAsset,
} from '../../io/assetStore';

type AssetTab = 'fabrics' | 'trims' | 'models';

/** Built-in and saved materials, trims and body models, with apply actions for each. */
export function AssetLibraryDialog() {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const panelIds = useMemo(
    () => idsOfKind(selection, 'panel').filter(id => !!project.pattern.panels[id]),
    [selection, project],
  );
  const [tab, setTab] = useState<AssetTab>('fabrics');
  const [savedFabrics, setSavedFabrics] = useState<FabricAsset[]>([]);
  const [savedTrims, setSavedTrims] = useState<TrimAsset[]>([]);
  const [fabricPick, setFabricPick] = useState('');
  const [trimName, setTrimName] = useState('');
  const [trimKind, setTrimKind] = useState<TrimKind>('button');
  const [trimSize, setTrimSize] = useState('12');
  const [trimColor, setTrimColor] = useState('#b08d57');
  const [trimQty, setTrimQty] = useState('1');
  const [message, setMessage] = useState<string | null>(null);

  const builtInFabrics = useMemo(() => builtInFabricAssets(), []);
  const builtInTrims = useMemo(() => builtInTrimAssets(), []);
  const fabricList = Object.values(project.fabrics);
  const activeFabricId = fabricPick || (panelIds[0] ? project.pattern.panels[panelIds[0]]?.fabricId : fabricList[0]?.id) || '';

  const refreshAssets = useCallback(async () => {
    try {
      setSavedFabrics(await listFabricAssets());
      setSavedTrims(await listTrimAssets());
    } catch {
      setMessage('本机存储不可用，素材只在当前会话有效');
    }
  }, []);

  useEffect(() => { void refreshAssets(); }, [refreshAssets]);

  const requirePanels = (): string[] => {
    if (panelIds.length === 0) throw new Error('请先在 2D / 3D 中选择版片');
    return panelIds;
  };

  const applyFabric = (asset: FabricAsset) => {
    try {
      const ids = requirePanels();
      const state = useProjectStore.getState();
      if (asset.source === 'preset' && asset.presetKey) {
        state.executeCommand(new AddFabricCommand(ids, state.project, asset.presetKey));
      } else {
        state.executeCommand(new AddFabricRecordCommand(ids, fabricFromAsset(state.project, asset)));
      }
      setMessage(`已为 ${ids.length} 张版片应用「${asset.name}」`);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const saveFabric = () => {
    const fabric = project.fabrics[activeFabricId];
    if (!fabric) { setMessage('当前工程没有可收藏的面料'); return; }
    void saveFabricAsset(fabricAssetFrom(fabric)).then(() => {
      void refreshAssets();
      setMessage(`已收藏「${fabric.name}」`);
    }).catch(() => setMessage('收藏失败：本机存储不可用'));
  };

  const removeFabric = (id: string) => {
    void deleteFabricAsset(id).then(() => {
      void refreshAssets();
      setMessage('已删除收藏的面料');
    }).catch(() => setMessage('删除失败：本机存储不可用'));
  };

  /** Centre of one panel's cut outline, in pattern coordinates. */
  const panelCentre = (panelId: string): { x: number; y: number } => {
    const panel = project.pattern.panels[panelId];
    if (!panel) return { x: 0, y: 0 };
    const box = computeBBox(samplePanelOutline(project.pattern, panel));
    return { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
  };

  const addTrim = (asset: TrimAsset) => {
    try {
      const ids = requirePanels();
      const cmds = ids.map(id => new AddTrimCommand(id, asset.kind, panelCentre(id), {
        name: asset.name,
        sizeMm: asset.sizeMm,
        color: asset.color,
        qty: asset.qty,
        ...(asset.unitPrice !== undefined ? { unitPrice: asset.unitPrice } : {}),
      }));
      // One undo step per placement, so a multi-panel apply can be reverted at once.
      useProjectStore.getState().executeCommand(cmds.length === 1 ? cmds[0]! : new CompositeCommand('添加辅料', cmds));
      setMessage(`已在 ${ids.length} 张版片中心放置「${asset.name}」`);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const saveTrim = () => {
    const size = Number(trimSize);
    const qty = Math.round(Number(trimQty));
    if (!(size > 0)) { setMessage('辅料直径需为正数'); return; }
    if (!(qty >= 1 && qty <= 9999)) { setMessage('数量需为 1–9999 的整数'); return; }
    const asset = trimAssetFrom({
      name: trimName.trim() || TRIM_KIND_LABELS[trimKind],
      kind: trimKind,
      sizeMm: size,
      color: trimColor,
      qty,
    });
    void saveTrimAsset(asset).then(() => {
      setTrimName('');
      void refreshAssets();
      setMessage('已收藏当前辅料规格');
    }).catch(() => setMessage('收藏失败：本机存储不可用'));
  };

  const removeTrim = (id: string) => {
    void deleteTrimAsset(id).then(() => {
      void refreshAssets();
      setMessage('已删除收藏的辅料');
    }).catch(() => setMessage('删除失败：本机存储不可用'));
  };

  const switchModel = (url: string | 'procedural', label: string) => {
    const avatar = useProjectStore.getState().project.avatar;
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
    setMessage(`已切换到「${label}」，布料将重建`);
  };

  const currentModel = project.avatar.source === 'procedural'
    ? 'procedural'
    : project.avatar.glbUrl ?? 'procedural';

  return (
    <div style={styles.root}>
      <div style={styles.title}>素材库</div>
      <div style={styles.tabs}>
        {([
          ['fabrics', '面料'],
          ['trims', '辅料'],
          ['models', '模特'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            style={{ ...styles.tabBtn, ...(tab === key ? styles.tabBtnActive : null) }}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>
      {message && <div style={styles.message}>{message}</div>}

      <div style={styles.body}>
        {tab === 'fabrics' && (
          <>
            <div style={styles.toolbar}>
              <span style={styles.label}>当前面料</span>
              <select style={styles.select} value={activeFabricId} onChange={e => setFabricPick(e.target.value)}>
                {fabricList.map(fabric => (
                  <option key={fabric.id} value={fabric.id}>{fabric.name}</option>
                ))}
              </select>
              <button style={styles.secondaryBtn} onClick={saveFabric}>收藏当前面料</button>
              <span style={styles.note}>选中版片后应用；应用会新建一条材质记录，可从属性面板继续调。</span>
            </div>
            <div style={styles.sectionTitle}>内置面料</div>
            <div style={styles.grid}>
              {builtInFabrics.map(asset => (
                <FabricCard key={asset.id} asset={asset} onApply={applyFabric} />
              ))}
            </div>
            <div style={styles.sectionTitle}>我的面料（{savedFabrics.length}）</div>
            {savedFabrics.length === 0 && <div style={styles.hint}>还没有收藏；选一条工程面料点【收藏当前面料】。</div>}
            <div style={styles.grid}>
              {savedFabrics.map(asset => (
                <FabricCard key={asset.id} asset={asset} onApply={applyFabric} onDelete={() => removeFabric(asset.id)} />
              ))}
            </div>
          </>
        )}

        {tab === 'trims' && (
          <>
            <div style={styles.sectionTitle}>内置辅料</div>
            <div style={styles.grid}>
              {builtInTrims.map(asset => (
                <TrimCard key={asset.id} asset={asset} label={TRIM_KIND_LABELS[asset.kind]} onApply={addTrim} />
              ))}
            </div>
            <div style={styles.sectionTitle}>我的辅料（{savedTrims.length}）</div>
            {savedTrims.length === 0 && <div style={styles.hint}>还没有收藏；填写规格后点【收藏当前规格】。</div>}
            <div style={styles.grid}>
              {savedTrims.map(asset => (
                <TrimCard key={asset.id} asset={asset} label={asset.name} onApply={addTrim} onDelete={() => removeTrim(asset.id)} />
              ))}
            </div>
            <div style={styles.sectionTitle}>收藏当前规格</div>
            <div style={styles.toolbar}>
              <input style={styles.input} placeholder="名称" value={trimName} onChange={e => setTrimName(e.target.value)} />
              <select style={styles.select} value={trimKind} onChange={e => setTrimKind(e.target.value as TrimKind)}>
                {TRIM_KINDS.map(kind => <option key={kind} value={kind}>{TRIM_KIND_LABELS[kind]}</option>)}
              </select>
              <input style={styles.number} type="number" min="0.5" step="0.5" value={trimSize}
                onChange={e => setTrimSize(e.target.value)} title="直径(mm)" />
              <input style={styles.color} type="color" value={trimColor} onChange={e => setTrimColor(e.target.value)} />
              <input style={styles.number} type="number" min="1" step="1" value={trimQty}
                onChange={e => setTrimQty(e.target.value)} title="数量" />
              <button style={styles.secondaryBtn} onClick={saveTrim}>收藏当前规格</button>
            </div>
            <div style={styles.note}>内置辅料使用默认直径与颜色；添加后可在对象标签改位置、颜色与数量。</div>
          </>
        )}

        {tab === 'models' && (
          <>
            <div style={styles.sectionTitle}>内置模特</div>
            <div style={styles.grid}>
              {BUNDLED_AVATARS.map(model => (
                <div key={model.url} style={styles.card}>
                  <div style={styles.cardName}>{model.label}</div>
                  <div style={styles.cardMeta}>
                    身高 {model.params.heightCm} · 胸 {model.params.chestCm} · 腰 {model.params.waistCm} · 臀 {model.params.hipCm}
                  </div>
                  <button
                    style={currentModel === model.url ? styles.primaryBtn : styles.secondaryBtn}
                    disabled={currentModel === model.url}
                    onClick={() => switchModel(model.url, model.label)}
                  >{currentModel === model.url ? '当前模特' : '切换'}
                  </button>
                </div>
              ))}
              <div style={styles.card}>
                <div style={styles.cardName}>程序模特</div>
                <div style={styles.cardMeta}>程序生成的胶囊身体，逐关节姿态与体型参数可调。</div>
                <button
                  style={currentModel === 'procedural' ? styles.primaryBtn : styles.secondaryBtn}
                  disabled={currentModel === 'procedural'}
                  onClick={() => switchModel('procedural', '程序模特')}
                >{currentModel === 'procedural' ? '当前模特' : '切换'}
                </button>
              </div>
            </div>
            <div style={styles.note}>切换模特会重建碰撞体、布料与模拟状态；导入自定义模特仍走【文件 → 导入 → 模特模型…】。</div>
          </>
        )}
      </div>
    </div>
  );
}

/** One material card with a colour swatch, physics summary and apply/delete actions. */
function FabricCard({ asset, onApply, onDelete }: {
  asset: FabricAsset;
  onApply: (asset: FabricAsset) => void;
  onDelete?: () => void;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.cardName}>{asset.name}</div>
      <div style={styles.swatchRow}>
        <span style={{ ...styles.swatch, background: asset.fabric.appearance.baseColor }} />
        <span style={styles.cardMeta}>{fabricAssetSummary(asset)}</span>
      </div>
      <div style={styles.cardActions}>
        <button style={styles.secondaryBtn} onClick={() => onApply(asset)}>应用到选中版片</button>
        {onDelete && <button style={styles.dangerBtn} onClick={onDelete}>删除</button>}
      </div>
    </div>
  );
}

/** One trim card with its spec and apply/delete actions. */
function TrimCard({ asset, label, onApply, onDelete }: {
  asset: TrimAsset;
  label: string;
  onApply: (asset: TrimAsset) => void;
  onDelete?: () => void;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.cardName}>{label}</div>
      <div style={styles.swatchRow}>
        <span style={{ ...styles.swatch, background: asset.color }} />
        <span style={styles.cardMeta}>{asset.sizeMm} mm · ×{asset.qty}</span>
      </div>
      <div style={styles.cardActions}>
        <button style={styles.secondaryBtn} onClick={() => onApply(asset)}>放到选中版片</button>
        {onDelete && <button style={styles.dangerBtn} onClick={onDelete}>删除</button>}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: dialogRoot,
  title: dialogTitle,
  tabs: dialogTabs,
  tabBtn: dialogTab(12),
  tabBtnActive: dialogTabActive,
  message: dialogMessage,
  body: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  sectionTitle: dialogSectionTitle,
  toolbar: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  label: dialogLabel,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 },
  card: { background: '#26262b', border: '1px solid #333', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 },
  cardName: { color: '#ddd', fontSize: 'var(--oc-fs-micro)' },
  cardMeta: { color: '#888', fontSize: 'var(--oc-fs-note)', lineHeight: 1.5 },
  swatchRow: { display: 'flex', alignItems: 'center', gap: 6 },
  swatch: { width: 18, height: 18, borderRadius: 3, border: '1px solid #555', flex: '0 0 auto' },
  cardActions: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  select: { padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)' },
  input: { width: 110, padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)' },
  number: { width: 62, padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)' },
  color: { width: 32, height: 24, padding: 0, border: '1px solid #3a3a42', background: '#1b1b1f' },
  primaryBtn: dialogButton('primary'),
  secondaryBtn: dialogButton('secondary'),
  dangerBtn: dialogButton('danger'),
  hint: dialogHint(4),
  note: dialogNote(1.5),
};
