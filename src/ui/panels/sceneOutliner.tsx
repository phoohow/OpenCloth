import { useState } from 'react';
import { useProjectStore, useUIStore } from '../../store/stores';
import type { LightType } from '../../core/model/types';
import { LIGHT_TYPES, LIGHT_TYPE_LABELS } from '../../core/model/defaults';
import {
  GARMENT_COLLECTION_ID, LIGHT_COLLECTION_ID, REFERENCE_COLLECTION_ID, SEAM_COLLECTION_ID,
  buildSceneTree, isCollectionVisible, lightObjectId, referenceObjectId, seamObjectId,
  type SceneNode,
} from '../sceneTree';
import {
  addLight, setAvatarVisible, setEnvironmentEnabled, setLightsEnabled, setPanelsVisible,
  setReferencesVisible, setSeamsStitchVisible, type EngineRef,
} from '../sceneCommands';
import { Icon } from '../icons';

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

  const tree = buildSceneTree(project);
  const activeId = selection.length === 1 ? selection[0] : null;

  const toggleNode = (node: SceneNode) => {
    if (node.kind === 'panel') { setPanelsVisible([node.id], !node.visible); return; }
    if (node.kind === 'reference') { setReferencesVisible([referenceObjectId(node.id)], !node.visible, engineRef); return; }
    if (node.kind === 'avatar') { setAvatarVisible(!node.visible, engineRef); return; }
    if (node.kind === 'light') { setLightsEnabled([lightObjectId(node.id)], !node.visible); return; }
    if (node.kind === 'environment') { setEnvironmentEnabled(!node.visible); return; }
    if (node.kind === 'seam') { setSeamsStitchVisible([seamObjectId(node.id)], !node.visible); return; }
    if (node.kind === 'collection') {
      const next = !isCollectionVisible(node);
      if (node.id === GARMENT_COLLECTION_ID) {
        setPanelsVisible(node.children.map(c => c.id), next);
      } else if (node.id === REFERENCE_COLLECTION_ID) {
        setReferencesVisible(node.children.map(c => referenceObjectId(c.id)), next, engineRef);
      } else if (node.id === SEAM_COLLECTION_ID) {
        setSeamsStitchVisible(node.children.map(c => seamObjectId(c.id)), next);
      }
    }
  };

  const onRowClick = (node: SceneNode) => {
    if (node.children.length > 0 && node.kind !== 'scene') { toggleOutliner(node.id); return; }
    select([node.id]);
  };

  const toggleCollapseAll = () => {
    if (collapsed.length > 0) { setCollapsedOutliner([]); return; }
    setCollapsedOutliner(collectExpandableIds(tree));
  };

  const renderNode = (node: SceneNode, depth: number): React.ReactNode[] => {
    const isExpanded = node.children.length === 0 || !collapsed.includes(node.id);
    const rows: React.ReactNode[] = [
      <div
        key={node.id}
        style={{ ...styles.row, marginLeft: depth * 12, ...(activeId === node.id ? styles.rowActive : null) }}
        onClick={() => onRowClick(node)}
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
        {node.children.length > 0 && <span style={styles.count}>{node.children.length}</span>}
      </div>,
    ];
    if (isExpanded) node.children.forEach(child => rows.push(...renderNode(child, depth + 1)));
    return rows;
  };

  return (
    <div style={styles.outliner}>
      <div style={styles.header}>
        <span style={styles.title}>场景</span>
        <button style={styles.miniBtn} title={collapsed.length > 0 ? '展开全部' : '折叠全部'} onClick={toggleCollapseAll}>
          <Icon name={collapsed.length > 0 ? 'expand-all' : 'collapse-all'} size={12} />
        </button>
      </div>
      <div style={styles.body} key={`tree${refVersion}`}>{renderNode(tree, 0)}</div>
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
  title: { fontSize: 11, color: '#4da6ff', letterSpacing: 1 },
  miniBtn: { marginLeft: 'auto', width: 22, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid #3a3a42', borderRadius: 3, color: '#999', cursor: 'pointer' },
  body: { flex: 1, overflowY: 'auto', padding: '2px 2px 6px' },
  row: { display: 'flex', alignItems: 'center', gap: 3, height: 22, paddingRight: 4, borderRadius: 3, cursor: 'pointer', fontSize: 11, color: '#ccc' },
  rowActive: { background: '#2a4a6a', color: '#fff', boxShadow: 'inset 0 0 0 1px #4da6ff' },
  chevron: { width: 12, height: 22, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' },
  eye: { width: 18, height: 22, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: 0 },
  label: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  note: { flex: '0 0 auto', fontSize: 10, color: '#7a8496', padding: '0 2px' },
  addRow: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2 },
  addSelect: {
    height: 16, maxWidth: 62, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#aaa', fontSize: 10, padding: '0 2px',
  },
  addBtn: {
    width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#bbb', cursor: 'pointer', padding: 0,
  },
  count: { fontSize: 10, color: '#777' },
};
