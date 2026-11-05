import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Menubar } from '@/ui/menubar';
import { LeftPanel, TemplateRail } from '@/ui/panels/leftPanel';
import { RightPanel } from '@/ui/panels/rightPanel';
import { Timeline } from '@/ui/panels/timeline';
import { Viewport3D } from '@/ui/viewport3D';
import { Viewport2D } from '@/ui/viewport2D';
import { MobileShell } from '@/ui/mobile/mobileShell';
import { isMobileUi } from '@/ui/mobile/mobileUi';
import { PaneDivider } from '@/ui/paneDivider';
import { Toolbar2D, Toolbar3D } from '@/ui/paneToolbars';
import { ToastHost } from '@/ui/widgets/toast';
import { createMenuActions, shortcutActions } from '@/ui/menu/actions';
import type { MenuActions } from '@/ui/menu/actions';
import { useUIStore, isSplitLayout, leftPaneOf, isRightPanelShown, type PaneId } from '@/store';
import type { GarmentEngine } from '@/runtime';
import type { RendererContext } from '@/render/renderer';
import {
  isPaneShown, paneFlex, leftPanelWidthFromPointer, rightPanelWidthFromPointer, splitRatioFromPointer,
} from '@/ui/viewportLayout';
import {
  useAutosaveTimer, useFpsSampling, useGlobalShortcuts, useLocalArchiveStartup, useReviewHashRoute,
} from '@/ui/appHooks';

/** Engine handle and menu actions every shell drives. */
interface ShellProps {
  actions: MenuActions;
  engineRef: MutableRefObject<GarmentEngine | null>;
  onEngineReady: (engine: GarmentEngine, ctx: RendererContext) => void;
  /** Whether the 3D viewport has finished creating its renderer. */
  ready: boolean;
}

/** Picks the desktop or the phone shell and owns what the two share. */
export function App() {
  const autoSaveSeconds = useUIStore(s => s.autoSaveSeconds);
  const engineRef = useRef<GarmentEngine | null>(null);
  const ctxRef = useRef<RendererContext | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);

  const actions = useMemo(() => createMenuActions({ engineRef, ctxRef, projectInputRef }), []);
  const runShortcut = useMemo(() => shortcutActions(actions), [actions]);

  const handleEngineReady = (engine: GarmentEngine, ctx: RendererContext) => {
    engineRef.current = engine;
    ctxRef.current = ctx;
    setReady(true);
  };

  const shellProps: ShellProps = { actions, engineRef, onEngineReady: handleEngineReady, ready };

  useGlobalShortcuts(runShortcut);
  useReviewHashRoute();
  useLocalArchiveStartup();
  useAutosaveTimer(autoSaveSeconds);
  useFpsSampling();

  return (
    <>
      {isMobileUi() ? <MobileShell {...shellProps} /> : <DesktopShell {...shellProps} />}
      <ToastHost />
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
    </>
  );
}

/** Desktop layout: menu bar, side panels, the two viewports and the timeline. */
function DesktopShell({ actions, engineRef, onEngineReady, ready }: ShellProps) {
  const layout = useUIStore(s => s.layout);
  const focus = useUIStore(s => s.focus);
  const splitRatio = useUIStore(s => s.splitRatio);
  const showTemplatePanel = useUIStore(s => s.showTemplatePanel);
  const showScenePanel = useUIStore(s => s.showScenePanel);
  const showPropertiesPanel = useUIStore(s => s.showPropertiesPanel);
  const showTimeline = useUIStore(s => s.showTimeline);
  const setFocus = useUIStore(s => s.setFocus);
  const setSplitRatio = useUIStore(s => s.setSplitRatio);
  const setLeftPanelWidth = useUIStore(s => s.setLeftPanelWidth);
  const setRightPanelWidth = useUIStore(s => s.setRightPanelWidth);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewportAreaRef = useRef<HTMLDivElement>(null);
  const pane2DRef = useRef<HTMLDivElement>(null);
  const pane3DRef = useRef<HTMLDivElement>(null);

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

  // Clicking a pane gives it keyboard focus. Capture phase runs before the
  // viewport listeners, which may stop propagation.
  useEffect(() => {
    const on2D = () => setFocus('2d');
    const on3D = () => setFocus('3d');
    const pane2D = pane2DRef.current;
    const pane3D = pane3DRef.current;
    pane2D?.addEventListener('pointerdown', on2D, true);
    pane3D?.addEventListener('pointerdown', on3D, true);
    return () => {
      pane2D?.removeEventListener('pointerdown', on2D, true);
      pane3D?.removeEventListener('pointerdown', on3D, true);
    };
  }, [setFocus]);

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
        {showTemplatePanel ? <LeftPanel /> : <TemplateRail />}
        {showTemplatePanel && <PaneDivider axis="x" onDrag={applyLeftPanelDrag} />}
        {/* Reversing the row swaps the panes without remounting either viewport. */}
        <div
          style={{ ...styles.viewportContainer, flexDirection: leftPaneOf(layout) === '2d' ? 'row-reverse' : 'row' }}
          ref={viewportAreaRef}
        >
          <div style={paneStyle('3d')} ref={pane3DRef}>
            <Toolbar3D engineRef={engineRef} />
            <div style={styles.paneBody}>
              <Viewport3D onEngineReady={onEngineReady} />
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
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1e' },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  viewportContainer: { flex: 1, position: 'relative', overflow: 'hidden', background: '#252528', display: 'flex' },
  pane: { flexDirection: 'column', position: 'relative', overflow: 'hidden', minWidth: 0, height: '100%' },
  paneBody: { flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' },
  loading: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#888', fontSize: 'var(--oc-fs-heading)', background: 'rgba(26,26,30,0.85)' },
  spinner: { width: 32, height: 32, border: '3px solid #333', borderTopColor: '#4da6ff', borderRadius: '50%', animation: 'spin 1s linear infinite' },
};
