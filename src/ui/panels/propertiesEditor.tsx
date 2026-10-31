import { useProjectStore, useUIStore, type PropTab } from '../../store/stores';
import { buildSceneTree, elementLabel, findSceneNode, type SceneNode } from '../sceneTree';
import { parseElementNodeId } from '../elementSelection';
import { PROP_TAB_OPTIONS } from '../optionTables';
import type { EngineRef } from '../sceneCommands';
import { selectedBody } from './properties/objectTab';
import { RenderTab, SceneTab } from './properties/sceneRenderTabs';
import { tabsForKind } from './properties/constants';
import { styles } from './properties/styles';
import { Icon } from '../icons';
import type { ReactNode } from 'react';

/** Object, applicable tabs and tab content the properties surface edits right now. */
export interface PropsTarget {
  /** Id of the single selected object, or null when nothing usable is selected. */
  nodeId: string | null;
  /** Label of the edited object, or 未选中对象. */
  objectName: string;
  /** Tab actually shown, after the object's allowed set filters the requested one. */
  tab: PropTab;
  /** Tabs the selected object accepts, in rail order. */
  allowedTabs: PropTab[];
  /** Content of the shown tab. */
  body: ReactNode;
  /** Changes whenever the content must start from a fresh state. */
  bodyKey: string;
}

/** Resolves the selected scene object and its tab body for the desktop editor and the phone sheet. */
export function usePropsTarget(engineRef: EngineRef): PropsTarget {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const propTab = useUIStore(s => s.propTab);
  const refObjectsVersion = useUIStore(s => s.refObjectsVersion);

  const nodeId = selection.length === 1 ? selection[0] : null;
  const element = nodeId ? parseElementNodeId(nodeId) : null;
  // Element rows share their name with the outliner row; the tree only holds panel ids.
  const node: SceneNode | null = element
    ? {
        id: nodeId!, kind: element.kind, label: elementLabel(project, element.kind, element.id),
        icon: 'panel', hideable: false, visible: true, children: [],
      }
    : nodeId ? findSceneNode(buildSceneTree(project), nodeId) : null;
  const kind = node?.kind ?? null;
  const allowedTabs = tabsForKind(kind);
  const tab = allowedTabs.includes(propTab) ? propTab : allowedTabs[0];

  // A tab other than "场景" / "渲染" is selectable only with one resolved object.
  const body = node && nodeId
    ? selectedBody(tab, project, nodeId, node, engineRef)
    : tab === 'render' ? <RenderTab project={project} /> : <SceneTab project={project} />;

  return {
    nodeId,
    objectName: node ? node.label : '未选中对象',
    tab,
    allowedTabs,
    body,
    bodyKey: `${nodeId ?? 'none'}-${tab}-${refObjectsVersion}`,
  };
}

/** Properties editor for the selected scene object, with the Blender-style tab rail on the right. */
export function PropertiesEditor({ engineRef }: { engineRef: EngineRef }) {
  const setPropTab = useUIStore(s => s.setPropTab);
  const target = usePropsTarget(engineRef);

  return (
    <div style={styles.editor}>
      <div style={styles.rail}>
        {PROP_TAB_OPTIONS.map(t => {
          const enabled = target.allowedTabs.includes(t.key);
          const active = enabled && target.tab === t.key;
          return (
            <button
              key={t.key}
              style={{ ...styles.tab, ...(active ? styles.tabActive : null), ...(enabled ? null : styles.tabDisabled) }}
              title={t.label}
              aria-label={t.label}
              aria-pressed={active}
              disabled={!enabled}
              onClick={() => setPropTab(t.key)}
            >
              <Icon name={t.icon} size={15} />
            </button>
          );
        })}
      </div>
      <div style={styles.body} key={target.bodyKey}>
        <div style={styles.objectName}>{target.objectName}</div>
        {target.body}
      </div>
    </div>
  );
}
