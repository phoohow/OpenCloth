import { useRef } from 'react';
import { isRightPanelShown, useUIStore } from '../../store/stores';
import { PaneDivider } from '../paneDivider';
import { sceneRatioFromPointer } from '../viewportLayout';
import { SceneOutliner } from './sceneOutliner';
import { PropertiesEditor } from './propertiesEditor';
import type { EngineRef } from '../sceneCommands';

/** Right column: the scene outliner above the properties editor, split by a draggable divider. */
export function RightPanel({ engineRef }: { engineRef: EngineRef }) {
  const sceneRatio = useUIStore(s => s.sceneRatio);
  const width = useUIStore(s => s.rightPanelWidth);
  const showScenePanel = useUIStore(s => s.showScenePanel);
  const showPropertiesPanel = useUIStore(s => s.showPropertiesPanel);
  const setSceneRatio = useUIStore(s => s.setSceneRatio);
  const panelRef = useRef<HTMLDivElement>(null);

  const applySceneDrag = (clientY: number) => {
    const box = panelRef.current?.getBoundingClientRect();
    if (!box) return;
    setSceneRatio(sceneRatioFromPointer(clientY, box.top, box.height));
  };

  if (!isRightPanelShown({ showScenePanel, showPropertiesPanel })) return null;
  const bothVisible = showScenePanel && showPropertiesPanel;

  return (
    <div style={{ ...styles.panel, width }} ref={panelRef}>
      {showScenePanel && (
        <div style={{ ...styles.section, flex: bothVisible ? `${sceneRatio} 1 0%` : '1 1 0%' }}>
          <SceneOutliner engineRef={engineRef} />
        </div>
      )}
      {bothVisible && <PaneDivider axis="y" onDrag={applySceneDrag} />}
      {showPropertiesPanel && (
        <div style={{ ...styles.section, flex: bothVisible ? `${1 - sceneRatio} 1 0%` : '1 1 0%' }}>
          <PropertiesEditor engineRef={engineRef} />
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { flex: '0 0 auto', background: '#202024', borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  section: { display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
};
