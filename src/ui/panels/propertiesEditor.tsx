import type { EngineRef } from '@/ui/sceneCommands';
import type { ReactNode } from 'react';

import { parseElementNodeId } from '@/model';
import { useProjectStore, useUIStore, type PropTab } from '@/store';
import { Icon } from '@/ui/icons';
import { PROP_TAB_OPTIONS } from '@/ui/optionTables';
import { tabsForKind } from '@/ui/panels/properties/constants';
import { selectedBody } from '@/ui/panels/properties/objectTab';
import { PatternTab, ProjectTab, RenderTab } from '@/ui/panels/properties/sceneRenderTabs';
import { styles } from '@/ui/panels/properties/styles';
import { buildSceneIndex, elementLabel, type SceneNode } from '@/ui/sceneTree';

const ALL_PROP_TABS: PropTab[] = PROP_TAB_OPTIONS.map(option => option.key);

export interface PropsTarget {
  nodeId: string | null;
  objectName: string;
  tab: PropTab;
  allowedTabs: PropTab[];
  body: ReactNode;
  bodyKey: string;
}

export function usePropsTarget(engineRef: EngineRef, visibleTabs: readonly PropTab[] = ALL_PROP_TABS): PropsTarget {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selection);
  const propTab = useUIStore(s => s.propTab);
  const refObjectsVersion = useUIStore(s => s.refObjectsVersion);

  const nodeId = selection.length === 1 ? selection[0] : null;
  const element = nodeId ? parseElementNodeId(nodeId) : null;
  const node: SceneNode | null = element
    ? {
        id: nodeId!, kind: element.kind, label: elementLabel(project, element.kind, element.id),
        icon: 'panel', hideable: false, visible: true, children: [],
      }
    : nodeId ? buildSceneIndex(project).byId.get(nodeId) ?? null : null;
  const kind = node?.kind ?? null;
  const allowedTabs = tabsForKind(kind);
  const fallbackTab = kind === null ? 'project' : allowedTabs[0];
  const visibleFallback = visibleTabs.includes(fallbackTab)
    ? fallbackTab
    : visibleTabs.find(candidate => allowedTabs.includes(candidate)) ?? fallbackTab;
  const tab = visibleTabs.includes(propTab) && allowedTabs.includes(propTab) ? propTab : visibleFallback;

  const body = node && nodeId
    ? selectedBody(tab, project, nodeId, node, engineRef)
    : tab === 'render' ? <RenderTab project={project} />
      : tab === 'pattern' ? <PatternTab project={project} engineRef={engineRef} />
        : <ProjectTab project={project} />;

  return {
    nodeId,
    objectName: node ? node.label : '未选中对象',
    tab,
    allowedTabs,
    body,
    bodyKey: `${nodeId ?? 'none'}-${tab}-${refObjectsVersion}`,
  };
}

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
