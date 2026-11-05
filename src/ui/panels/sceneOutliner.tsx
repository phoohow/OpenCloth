import { useRef, useState } from 'react';
import { useProjectStore, useUIStore } from '../../store/stores';
import type { LightType } from '../../core/model/types';
import {
  DEFAULT_PRINT_SIDE_CM, LIGHT_TYPES, LIGHT_TYPE_LABELS, MAX_PRINT_BYTES,
} from '../../core/model/defaults';
import { AddPrintCommand } from '../../core/command/patternCommands';
import { readImageAsPngDataUrl } from '../../io/imageData';
import {
  GARMENT_COLLECTION_ID, LIGHT_COLLECTION_ID, PRINT_COLLECTION_ID, REFERENCE_COLLECTION_ID,
  SEAM_COLLECTION_ID, TOPSTITCH_COLLECTION_ID, TRIM_COLLECTION_ID,
  buildSceneTree, isCollectionVisible, lightObjectId, referenceObjectId, seamObjectId,
  type SceneNode,
} from '../sceneTree';
import {
  addLight, setAvatarVisible, setEnvironmentEnabled, setLightsEnabled, setPanelsVisible,
  setProductionVisible, setReferencesVisible, setSeamsStitchVisible, type EngineRef,
} from '../sceneCommands';
import { idsOfKind, parseElementNodeId } from '../elementSelection';
import { Icon } from '../icons';
import { reportActionError } from '../widgets/toast';

/** Collections that group one kind of production object. */
const PRODUCTION_COLLECTION_KINDS: Record<string, 'print' | 'topstitch' | 'trim'> = {
  [PRINT_COLLECTION_ID]: 'print',
  [TOPSTITCH_COLLECTION_ID]: 'topstitch',
  [TRIM_COLLECTION_ID]: 'trim',
};

/** Hierarchical scene list: collections, objects, viewport visibility and selection. */
export function SceneOutliner({ engineRef }: { engineRef: EngineRef }) {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const select = useUIStore(s => s.select);
  const collapsed = useUIStore(s => s.collapsedOutliner);
  const toggleOutliner = useUIStore(s => s.toggleOutliner);
  const setCollapsedOutliner = useUIStore(s => s.setCollapsedOutliner);
  const refVersion = useUIStore(s => s.refObjectsVersion);
  const [newLightType, setNewLightType] = useState<LightType>('directional');
  const [printPanelId, setPrintPanelId] = useState<string | null>(null);
  const printInputRef = useRef<HTMLInputElement>(null);

  const tree = buildSceneTree(project);
  const activeId = selection.length === 1 ? selection[0] : null;
  const selectedPanelId = idsOfKind(selection, 'panel').find(id => !!project.pattern.panels[id]) ?? null;

  /** Places a print at the centre of the selected panel, using the chosen artwork. */
  const onPrintFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const panelId = printPanelId;
    setPrintPanelId(null);
    if (!file || !panelId) return;
    if (file.size > MAX_PRINT_BYTES) {
      useUIStore.getState().showToast('图片超过 8 MB，请压缩后再插入');
      return;
    }
    try {
      const imageUrl = await readImageAsPngDataUrl(file);
      useProjectStore.getState().executeCommand(new AddPrintCommand(panelId, imageUrl, {
        imageName: file.name,
        widthCm: DEFAULT_PRINT_SIDE_CM,
        heightCm: DEFAULT_PRINT_SIDE_CM,
      }));
    } catch (err) {
      reportActionError(err);
    }
  };

  const toggleNode = (node: SceneNode) => {
    if (node.kind === 'panel') { setPanelsVisible([node.id], !node.visible); return; }
    if (node.kind === 'reference') { setReferencesVisible([referenceObjectId(node.id)], !node.visible, engineRef); return; }
    if (node.kind === 'avatar') { setAvatarVisible(!node.visible, engineRef); return; }
    if (node.kind === 'light') { setLightsEnabled([lightObjectId(node.id)], !node.visible); return; }
    if (node.kind === 'environment') { setEnvironmentEnabled(!node.visible); return; }
    if (node.kind === 'seam') { setSeamsStitchVisible([seamObjectId(node.id)], !node.visible); return; }
    if (node.kind === 'print' || node.kind === 'topstitch' || node.kind === 'trim') {
      const element = parseElementNodeId(node.id);
      if (element) setProductionVisible(node.kind, [element.id], !node.visible);
      return;
    }
    if (node.kind === 'collection') {
      const next = !isCollectionVisible(node);
      if (node.id === GARMENT_COLLECTION_ID) {
        setPanelsVisible(node.children.map(c => c.id), next);
      } else if (node.id === REFERENCE_COLLECTION_ID) {
        setReferencesVisible(node.children.map(c => referenceObjectId(c.id)), next, engineRef);
      } else if (node.id === SEAM_COLLECTION_ID) {
        setSeamsStitchVisible(node.children.map(c => seamObjectId(c.id)), next);
      } else {
        const kind = PRODUCTION_COLLECTION_KINDS[node.id];
        if (kind) {
          const ids = node.children.flatMap(c => parseElementNodeId(c.id)?.id ?? []);
          setProductionVisible(kind, ids, next);
        }
      }
    }
  };

  /** Picks the object a row stands for; collections only expand or collapse. */
  const onRowClick = (node: SceneNode) => {
    if (node.kind === 'collection') { toggleOutliner(node.id); return; }
    select([node.id]);
  };

  const toggleCollapseAll = () => {
    if (collapsed.length > 0) { setCollapsedOutliner([]); return; }
    setCollapsedOutliner(tree.children.flatMap(collectExpandableIds));
  };

  const renderNode = (node: SceneNode, depth: number): React.ReactNode[] => {
    const isExpanded = node.children.length === 0 || !collapsed.includes(node.id);
    const rows: React.ReactNode[] = [
      <div
        key={node.id}
        style={{ ...styles.row, marginLeft: depth * 12, ...(activeId === node.id ? styles.rowActive : null) }}
        onClick={() => onRowClick(node)}
        onDoubleClick={() => { if (node.children.length > 0) toggleOutliner(node.id); }}
        title={node.children.length > 0 ? `${node.label} (${node.children.length})` : node.label}
      >
        <span style={styles.chevron} onClick={e => { if (node.children.length > 0) { e.stopPropagation(); toggleOutliner(node.id); } }}>
          {node.children.length > 0 && <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={11} />}
        </span>
        {node.hideable && (
          <button
            style={styles.eye}
            title={node.visible ? '在视口中隐藏' : '在视口中显示'}
            onClick={e => { e.stopPropagation(); toggleNode(node); }}
          >
            <Icon name={node.visible ? 'eye' : 'eye-off'} size={13} />
          </button>
        )}
        <Icon name={node.icon} size={13} />
        <span style={{ ...styles.label, opacity: node.hideable && !node.visible ? 0.45 : 1 }}>{node.label}</span>
        {node.note && <span style={styles.note}>{node.note}</span>}
        {node.id === LIGHT_COLLECTION_ID && (
          <span style={styles.addRow} title="添加光源">
            <select
              style={styles.addSelect} value={newLightType}
              onClick={e => e.stopPropagation()}
              onChange={e => setNewLightType(e.target.value as LightType)}
            >
              {LIGHT_TYPES.map(t => <option key={t} value={t}>{LIGHT_TYPE_LABELS[t]}</option>)}
            </select>
            <button
              style={styles.addBtn} title={`添加${LIGHT_TYPE_LABELS[newLightType]}`}
              onClick={e => { e.stopPropagation(); addLight(newLightType); }}
            ><Icon name="plus" size={10} /></button>
          </span>
        )}
        {node.id === PRINT_COLLECTION_ID && (
          <span style={styles.addRow}>
            <button
              style={{ ...styles.addBtn, ...(selectedPanelId ? null : styles.addBtnDisabled) }}
              disabled={!selectedPanelId}
              title={selectedPanelId
                ? `在「${project.pattern.panels[selectedPanelId]?.name}」中心添加印花`
                : '先在场景树选中一个版片'}
              onClick={e => {
                e.stopPropagation();
                if (!selectedPanelId) return;
                setPrintPanelId(selectedPanelId);
                printInputRef.current?.click();
              }}
            ><Icon name="plus" size={10} /></button>
          </span>
        )}
        {node.children.length > 0 && <span style={styles.count}>{node.children.length}</span>}
      </div>,
    ];
    if (isExpanded) node.children.forEach(child => rows.push(...renderNode(child, depth + 1)));
    return rows;
  };

  return (
    <div style={styles.outliner}>
      <div style={styles.header}>
        <span style={styles.title}>场景树</span>
        <button style={styles.miniBtn} title={collapsed.length > 0 ? '展开全部' : '折叠全部'} onClick={toggleCollapseAll}>
          <Icon name={collapsed.length > 0 ? 'expand-all' : 'collapse-all'} size={12} />
        </button>
      </div>
      <div style={styles.body} key={`tree${refVersion}`}>{tree.children.flatMap(child => renderNode(child, 0))}</div>
      <input ref={printInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPrintFile} />
    </div>
  );
}

/** Ids of every row that has children. */
function collectExpandableIds(node: SceneNode): string[] {
  if (node.children.length === 0) return [];
  return [node.id, ...node.children.flatMap(collectExpandableIds)];
}

const styles: Record<string, React.CSSProperties> = {
  outliner: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' },
  header: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 6px 0 8px', borderBottom: '1px solid #333' },
  title: { fontSize: 'var(--oc-fs-micro)', color: '#4da6ff', letterSpacing: 1 },
  miniBtn: { marginLeft: 'auto', width: 22, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid #3a3a42', borderRadius: 3, color: '#999', cursor: 'pointer' },
  body: { flex: 1, overflowY: 'auto', padding: '2px 2px 6px' },
  row: { display: 'flex', alignItems: 'center', gap: 3, height: 22, paddingRight: 4, borderRadius: 3, cursor: 'pointer', fontSize: 'var(--oc-fs-micro)', color: '#ccc' },
  rowActive: { background: '#2a4a6a', color: '#fff', boxShadow: 'inset 0 0 0 1px #4da6ff' },
  chevron: { width: 12, height: 22, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' },
  eye: { width: 18, height: 22, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: 0 },
  label: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  note: { flex: '0 0 auto', fontSize: 'var(--oc-fs-note)', color: '#7a8496', padding: '0 2px' },
  addRow: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2 },
  addSelect: {
    height: 16, maxWidth: 62, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#aaa', fontSize: 'var(--oc-fs-note)', padding: '0 2px',
  },
  addBtn: {
    width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#bbb', cursor: 'pointer', padding: 0,
  },
  addBtnDisabled: { color: '#555', cursor: 'default' },
  count: { fontSize: 'var(--oc-fs-note)', color: '#777' },
};
