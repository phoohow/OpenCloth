import { useState, useMemo, type MutableRefObject } from 'react';
import { useProjectStore, useSimStore, useUIStore, type ToolType } from '../store/stores';
import type { GarmentEngine, CameraPreset } from '../core/engine/garmentEngine';
import type { CameraProjection, RenderMode } from '../core/model/types';
import { CAMERA_PRESETS, CAMERA_PROJECTIONS, RENDER_MODES } from './optionTables';
import { comboOf } from './menu/shortcuts';
import { Icon, type IconName } from './icons';

/** One pattern or pin tool: toolbar glyph, tooltip and the tool it selects. */
const TOOLS_2D: Array<{ key: ToolType; label: string; icon: IconName }> = [
  { key: 'select', label: '选择 (点击/Ctrl加选)', icon: 'select' },
  { key: 'point', label: '线上加点', icon: 'add-point' },
  { key: 'line', label: '直线', icon: 'line' },
  { key: 'curve', label: '曲线', icon: 'curve' },
  { key: 'internalLine', label: '内部线', icon: 'internal-line' },
  { key: 'dart', label: '省道', icon: 'dart' },
  { key: 'seam', label: '缝合', icon: 'seam' },
  { key: 'pan', label: '平移画布', icon: 'pan' },
];

const TOOLS_3D: Array<{ key: ToolType; label: string; icon: IconName }> = [
  { key: 'pin', label: '打PIN 固定布料点', icon: 'pin' },
  { key: 'unpin', label: '拔PIN 释放布料点', icon: 'unpin' },
];

/** View preset entries shown in the 3D toolbar, each labelled with its keypad combo. */
const VIEW_ITEMS = CAMERA_PRESETS.map(p => ({
  key: p.value,
  label: `${p.label} (${comboOf(p.menuId)})`,
}));

const PROJECTION_ITEMS = CAMERA_PROJECTIONS.map(p => ({ key: p.value, label: p.label }));

const RENDER_ITEMS = RENDER_MODES.map(m => ({ key: m.value, label: m.label }));

/** Tool row that sits above the 2D pattern pane. */
export function Toolbar2D() {
  const activeTool = useUIStore(s => s.activeTool);
  const setTool = useUIStore(s => s.setTool);
  const requestFit = useUIStore(s => s.requestFit);

  return (
    <div style={styles.bar}>
      {TOOLS_2D.map(t => (
        <ToolButton key={t.key} tool={t} active={activeTool === t.key} onPick={setTool} />
      ))}
      <div style={styles.spacer} />
      <button style={styles.textBtn} title="适配版型范围 (F)" onClick={requestFit}>适应视图</button>
    </div>
  );
}

/** Tool row that sits above the 3D try-on pane. */
export function Toolbar3D({ engineRef }: { engineRef: MutableRefObject<GarmentEngine | null> }) {
  const activeTool = useUIStore(s => s.activeTool);
  const setTool = useUIStore(s => s.setTool);
  const renderMode = useUIStore(s => s.renderMode);
  const setRenderMode = useUIStore(s => s.setRenderMode);
  const projection = useUIStore(s => s.cameraProjection);
  const setCameraProjection = useUIStore(s => s.setCameraProjection);
  const pinsVersion = useSimStore(s => s.pinsVersion);
  const bumpPins = useSimStore(s => s.bumpPins);
  const [clearing, setClearing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  // The pinned set lives on the solver, so the counts refresh when the version token moves.
  const pinCounts = useMemo(() => {
    const engine = engineRef.current;
    return {
      marked: engine?.getPinMarkers().length ?? 0,
      pinned: engine?.getPinnedParticles().length ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsVersion]);

  const clearPins = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setClearing(true);
    try {
      await engine.clearPins();
      bumpPins();
    } finally {
      setClearing(false);
    }
  };

  const rebuildCloth = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setRebuilding(true);
    try {
      await engine.initSimulator(useProjectStore.getState().project);
      engine.resetSimulation();
      useSimStore.getState().reset();
      bumpPins();
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div style={styles.bar}>
      {TOOLS_3D.map(t => (
        <ToolButton key={t.key} tool={t} active={activeTool === t.key} onPick={setTool} />
      ))}
      <button style={styles.textBtn} title="释放全部 PIN" disabled={clearing} onClick={() => void clearPins()}>{clearing ? '清除中…' : '清除PIN'}</button>
      <button style={styles.textBtn} title="按当前工程重建布料网格" disabled={rebuilding} onClick={() => void rebuildCloth()}>{rebuilding ? '重建中…' : '重建网格'}</button>
      <span style={styles.pinCount} title="手动打点数 · 固定点总数（含版片顶部假缝带）">
        <Icon name="pin" size={11} /> {pinCounts.marked} · 固定 {pinCounts.pinned}
      </span>
      <div style={styles.spacer} />
      <Dropdown
        label="视角"
        items={VIEW_ITEMS}
        onPick={key => engineRef.current?.setCameraPreset(key as CameraPreset)}
      />
      <Dropdown
        label="投影"
        items={PROJECTION_ITEMS}
        value={projection}
        onPick={key => setCameraProjection(key as CameraProjection)}
      />
      <Dropdown
        label="显示"
        items={RENDER_ITEMS}
        value={renderMode}
        onPick={key => setRenderMode(key as RenderMode)}
      />
    </div>
  );
}

function ToolButton({ tool, active, onPick }: {
  tool: { key: ToolType; label: string; icon: IconName };
  active: boolean;
  onPick: (t: ToolType) => void;
}) {
  return (
    <button
      style={{ ...styles.toolBtn, ...(active ? styles.toolBtnActive : null) }}
      title={tool.label}
      onClick={() => onPick(tool.key)}
    >
      <Icon name={tool.icon} size={15} />
    </button>
  );
}

function Dropdown({ label, items, value, onPick }: {
  label: string;
  items: Array<{ key: string; label: string }>;
  value?: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button style={styles.textBtn} onClick={() => setOpen(o => !o)}>{label}<Icon name="chevron-down" size={11} style={{ marginLeft: 4 }} /></button>
      {open && (
        <>
          <div style={styles.backdrop} onClick={() => setOpen(false)} />
          <div style={styles.menu}>
            {items.map(item => (
              <div
                key={item.key}
                style={{ ...styles.menuItem, ...(item.key === value ? styles.menuItemActive : null) }}
                onClick={() => { onPick(item.key); setOpen(false); }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 30, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', background: '#202024', borderBottom: '1px solid #333', overflow: 'hidden' },
  spacer: { flex: 1 },
  toolBtn: { width: 26, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid transparent', borderRadius: 3, color: '#bbb', cursor: 'pointer' },
  toolBtnActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
  textBtn: { flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 6px', background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 11 },
  pinCount: { flex: '0 1 auto', minWidth: 0, padding: '3px 2px', color: '#9ab', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 900 },
  menu: { position: 'absolute', top: '100%', right: 0, marginTop: 2, minWidth: 128, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4, zIndex: 901, boxShadow: '0 4px 12px rgba(0,0,0,0.5)' },
  menuItem: { padding: '7px 12px', fontSize: 12, color: '#ccc', cursor: 'pointer' },
  menuItemActive: { color: '#4da6ff', background: '#2a3a4a' },
};
