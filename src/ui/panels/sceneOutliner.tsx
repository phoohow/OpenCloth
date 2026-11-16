import { useRef, useState } from 'react';
import { useProjectStore, useUIStore } from '@/store';
import type { LightType } from '@/model/types';
import {
  DEFAULT_PRINT_SIDE_CM, LIGHT_TYPES, LIGHT_TYPE_LABELS, MAX_PRINT_BYTES,
} from '@/model';
import { AddPrintCommand } from '@/commands';
import { readImageAsPngDataUrl } from '@/io/serialization';
import { LIGHT_COLLECTION_ID, PRINT_COLLECTION_ID } from '@/model';
import { buildSceneTree, type SceneNode } from '@/ui/sceneTree';
import { addLight, setNodeVisible, type EngineRef } from '@/ui/sceneCommands';
import { idsOfKind, isNodeVisibleWritable } from '@/model';
import { Icon } from '@/ui/icons';
import { reportActionError } from '@/ui/widgets/toast';

/** Hierarchical scene list: collections, objects, viewport visibility and selection. */
export function SceneOutliner({ engineRef }: { engineRef: EngineRef }) {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const select = useUIStore(s => s.select);
  const expanded = useUIStore(s => s.expandedOutliner);
  const toggleOutliner = useUIStore(s => s.toggleOutliner);
  const setExpandedOutliner = useUIStore(s => s.setExpandedOutliner);
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

  /** Flips one row's viewport visibility; collection rows fan out to their members. */
  const toggleNode = (node: SceneNode) => {
    setNodeVisible(node.id, !node.visible, engineRef);
  };

  /** Picks the object a row stands for; collections only expand or collapse. */
  const onRowClick = (node: SceneNode) => {
    if (node.kind === 'collection') { toggleOutliner(node.id); return; }
    select([node.id]);
  };

  const toggleCollapseAll = () => {
    if (expanded.length > 0) { setExpandedOutliner([]); return; }
    setExpandedOutliner(tree.children.flatMap(collectExpandableIds));
  };

  const renderNode = (node: SceneNode, depth: number): React.ReactNode[] => {
    const isExpanded = node.children.length === 0 || expanded.includes(node.id);
    const canToggle = node.hideable && isNodeVisibleWritable(project, node.id);
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
            style={{ ...styles.eye, ...(canToggle ? null : styles.eyeDisabled) }}
            disabled={!canToggle}
            title={canToggle ? (node.visible ? '隐藏' : '显示') : '不可隐藏'}
            onClick={e => { e.stopPropagation(); if (canToggle) toggleNode(node); }}
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
              title={selectedPanelId ? '在选中版片加印花' : '先选中版片'}
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
        <button style={styles.miniBtn} title={expanded.length > 0 ? '折叠全部' : '展开全部'} onClick={toggleCollapseAll}>
          <Icon name={expanded.length > 0 ? 'collapse-all' : 'expand-all'} size={12} />
        </button>
      </div>
      <div style={styles.body}>{tree.children.flatMap(child => renderNode(child, 0))}</div>
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
  eyeDisabled: { color: '#4a4a52', cursor: 'default' },
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
