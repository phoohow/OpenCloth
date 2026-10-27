import { useProjectStore, useUIStore } from '../../store/stores';
import { buildSceneTree, findSceneNode } from '../sceneTree';
import { PROP_TAB_OPTIONS } from '../optionTables';
import type { EngineRef } from '../sceneCommands';
import { selectedBody } from './properties/objectTab';
import { RenderTab, SceneTab } from './properties/sceneRenderTabs';
import { tabsForKind } from './properties/constants';
import { styles } from './properties/styles';
import { Icon } from '../icons';

/** Properties editor for the selected scene object, with the Blender-style tab rail on the right. */
export function PropertiesEditor({ engineRef }: { engineRef: EngineRef }) {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const propTab = useUIStore(s => s.propTab);
  const setPropTab = useUIStore(s => s.setPropTab);
  const refObjectsVersion = useUIStore(s => s.refObjectsVersion);

  const nodeId = selection.length === 1 ? selection[0] : null;
  const node = nodeId ? findSceneNode(buildSceneTree(project), nodeId) : null;
  const kind = node?.kind ?? null;
  const allowed = tabsForKind(kind);
  const tab = allowed.includes(propTab) ? propTab : allowed[0];

  // A tab other than "场景" / "渲染" is selectable only with one resolved object.
  const body = node && nodeId
    ? selectedBody(tab, project, nodeId, node, engineRef)
    : tab === 'render' ? <RenderTab project={project} /> : <SceneTab project={project} />;

  return (
    <div style={styles.editor}>
      <div style={styles.rail}>
        {PROP_TAB_OPTIONS.map(t => {
          const enabled = allowed.includes(t.key);
          const active = enabled && tab === t.key;
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
      <div style={styles.body} key={`${nodeId ?? 'none'}-${tab}-${refObjectsVersion}`}>
        <div style={styles.objectName}>{node ? node.label : '未选中对象'}</div>
        {body}
      </div>
    </div>
  );
}
