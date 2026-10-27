import { useEffect, useMemo, useRef, useState } from 'react';
import { Menubar } from './menubar';
import { LeftPanel } from './panels/leftPanel';
import { RightPanel } from './panels/rightPanel';
import { Timeline } from './panels/timeline';
import { Viewport3D } from './viewport3D';
import { Viewport2D } from './viewport2D';
import { PaneDivider } from './paneDivider';
import { Toolbar2D, Toolbar3D } from './paneToolbars';
import { createMenuActions, refreshRecentList, shortcutActions, writeAutosave } from './menu/actions';
import { menuOwnsKeyboard } from './menu/menuStore';
import { SHORTCUTS, matchShortcut } from './menu/shortcuts';
import {
  useUIStore, is3DFocus, isSplitLayout, leftPaneOf, isRightPanelShown,
  FPS_SAMPLE_MS, usePerfStore, type PaneId,
} from '../store/stores';
import { readAutosave } from '../io/projectArchive';
import type { GarmentEngine } from '../core/engine/garmentEngine';
import type { RendererContext } from '../render/renderer/rendererContext';
import {
  isPaneShown, paneFlex, leftPanelWidthFromPointer, rightPanelWidthFromPointer, splitRatioFromPointer,
} from './viewportLayout';

/** Application shell: menu bar, panels, the two viewports, global shortcuts and autosave. */
export function App() {
  const layout = useUIStore(s => s.layout);
  const focus = useUIStore(s => s.focus);
  const splitRatio = useUIStore(s => s.splitRatio);
  const showTemplatePanel = useUIStore(s => s.showTemplatePanel);
  const showScenePanel = useUIStore(s => s.showScenePanel);
  const showPropertiesPanel = useUIStore(s => s.showPropertiesPanel);
  const showTimeline = useUIStore(s => s.showTimeline);
  const autoSaveSeconds = useUIStore(s => s.autoSaveSeconds);
  const setLastAutosaveAt = useUIStore(s => s.setLastAutosaveAt);
  const setFocus = useUIStore(s => s.setFocus);
  const setSplitRatio = useUIStore(s => s.setSplitRatio);
  const setLeftPanelWidth = useUIStore(s => s.setLeftPanelWidth);
  const setRightPanelWidth = useUIStore(s => s.setRightPanelWidth);
  const engineRef = useRef<GarmentEngine | null>(null);
  const ctxRef = useRef<RendererContext | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewportAreaRef = useRef<HTMLDivElement>(null);
  const pane2DRef = useRef<HTMLDivElement>(null);
  const pane3DRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const actions = useMemo(() => createMenuActions({ engineRef, ctxRef, projectInputRef }), []);
  const runShortcut = useMemo(() => shortcutActions(actions), [actions]);

  const handleEngineReady = (engine: GarmentEngine, ctx: RendererContext) => {
    engineRef.current = engine;
    ctxRef.current = ctx;
    setReady(true);
  };

  // Split position follows the cursor, in units of the flexed area beside the divider.
  const applyDividerDrag = (clientX: number) => {
    const box = viewportAreaRef.current?.getBoundingClientRect();
    if (!box) return;
    setSplitRatio(splitRatioFromPointer(clientX, box.left, box.width));
  };

  // Side panels are dragged in pixels, bounded by the width of the whole body row.
  const applyLeftPanelDrag = (clientX: number) => {
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box) return;
    setLeftPanelWidth(leftPanelWidthFromPointer(clientX, box.left, box.width));
  };

  const applyRightPanelDrag = (clientX: number) => {
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box) return;
    setRightPanelWidth(rightPanelWidthFromPointer(clientX, box.right, box.width));
  };

  // Global keyboard shortcuts, dispatched through the shared shortcut table.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (menuOwnsKeyboard()) return;

      const id = matchShortcut(e);
      if (!id) return;
      const def = SHORTCUTS.find(s => s.id === id);
      if (!def || def.scope === '菜单栏') return;
      const ui = useUIStore.getState();
      if (def.scope === '3D 视口' && !is3DFocus(ui.layout, ui.focus)) return;
      if (def.scope === '2D 制版' && ui.layout === '3d') return;
      const run = runShortcut[id];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runShortcut]);

  // Clicking a pane gives it keyboard focus. Capture phase runs before the
  // viewport listeners, which may stop propagation.
  useEffect(() => {
    const on2D = () => setFocus('2d');
    const on3D = () => setFocus('3d');
    pane2DRef.current?.addEventListener('pointerdown', on2D, true);
    pane3DRef.current?.addEventListener('pointerdown', on3D, true);
    return () => {
      pane2DRef.current?.removeEventListener('pointerdown', on2D, true);
      pane3DRef.current?.removeEventListener('pointerdown', on3D, true);
    };
  }, [setFocus]);

  // Local archive is read once so 文件 ▸ 最近 and the autosave stamp start populated.
  useEffect(() => {
    refreshRecentList();
    void readAutosave().then(record => {
      if (record) setLastAutosaveAt(record.savedAt);
    });
  }, [setLastAutosaveAt]);

  useEffect(() => {
    if (autoSaveSeconds <= 0) return undefined;
    const timer = window.setInterval(() => void writeAutosave(), autoSaveSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoSaveSeconds]);

  // Pane frame rates are published on a timer so idle panes fall back to 0.
  useEffect(() => {
    const timer = window.setInterval(
      () => usePerfStore.getState().sampleFps(performance.now()),
      FPS_SAMPLE_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  const paneStyle = (pane: PaneId): React.CSSProperties => ({
    ...styles.pane,
    flex: paneFlex(layout, pane, splitRatio),
    display: isPaneShown(layout, pane) ? 'flex' : 'none',
    boxShadow: isSplitLayout(layout) && focus === pane ? 'inset 0 0 0 1px #4da6ff' : 'none',
  });

  const showRightPanel = isRightPanelShown({ showScenePanel, showPropertiesPanel });

  return (
    <div style={styles.root}>
      <Menubar actions={actions} />
      <div style={styles.body} ref={bodyRef}>
        {showTemplatePanel && <LeftPanel />}
        {showTemplatePanel && <PaneDivider axis="x" onDrag={applyLeftPanelDrag} />}
        {/* Reversing the row swaps the panes without remounting either viewport. */}
        <div
          style={{ ...styles.viewportContainer, flexDirection: leftPaneOf(layout) === '2d' ? 'row-reverse' : 'row' }}
          ref={viewportAreaRef}
        >
          <div style={paneStyle('3d')} ref={pane3DRef}>
            <Toolbar3D engineRef={engineRef} />
            <div style={styles.paneBody}>
              <Viewport3D onEngineReady={handleEngineReady} />
              {!ready && (
                <div style={styles.loading}>
                  <div style={styles.spinner} />
                  <div>正在初始化 WebGPU 渲染器…</div>
                </div>
              )}
            </div>
          </div>
          {isSplitLayout(layout) && <PaneDivider axis="x" onDrag={applyDividerDrag} />}
          <div style={paneStyle('2d')} ref={pane2DRef}>
            <Toolbar2D />
            <div style={styles.paneBody}><Viewport2D /></div>
          </div>
        </div>
        {showRightPanel && <PaneDivider axis="x" onDrag={applyRightPanelDrag} />}
        {showRightPanel && <RightPanel engineRef={engineRef} />}
      </div>
      {showTimeline && <Timeline />}
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,.ocproj.json"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) actions.openProjectFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1e' },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  viewportContainer: { flex: 1, position: 'relative', overflow: 'hidden', background: '#252528', display: 'flex' },
  pane: { flexDirection: 'column', position: 'relative', overflow: 'hidden', minWidth: 0, height: '100%' },
  paneBody: { flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' },
  loading: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#888', fontSize: 14, background: 'rgba(26,26,30,0.85)' },
  spinner: { width: 32, height: 32, border: '3px solid #333', borderTopColor: '#4da6ff', borderRadius: '50%', animation: 'spin 1s linear infinite' },
};
