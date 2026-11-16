import { useUIStore } from '@/store';
import { Icon } from '@/ui/icons';
import { ASSET_TAB_OPTIONS } from '@/ui/optionTables';
import { EnvironmentAssets } from '@/ui/panels/assetTabs/environmentTab';
import { FabricAssets } from '@/ui/panels/assetTabs/fabricTab';
import { ModelAssets } from '@/ui/panels/assetTabs/modelTab';
import { PatternAssets } from '@/ui/panels/assetTabs/patternTab';
import { TrimAssets } from '@/ui/panels/assetTabs/trimTab';

/** Built-in catalogue: patterns, models, fabrics, trims and environments. */
export function AssetPanel() {
  const width = useUIStore(s => s.leftPanelWidth);
  const toggle = useUIStore(s => s.toggleAssetPanel);
  const tab = useUIStore(s => s.assetTab);
  const setTab = useUIStore(s => s.setAssetTab);

  return (
    <div style={{ ...styles.panel, width }}>
      <div style={styles.header}>
        <span style={{ flex: 1 }}>素材库</span>
        <button style={styles.collapseBtn} onClick={toggle} title="收起" aria-label="收起素材库">
          <Icon name="chevron-right" size={11} style={{ color: '#888', transform: 'rotate(180deg)' }} />
        </button>
      </div>
      <div style={styles.tabs}>
        {ASSET_TAB_OPTIONS.map(item => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              style={{ ...styles.tab, ...(active ? styles.tabActive : null) }}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => setTab(item.key)}
            >
              <Icon name={item.icon} size={15} />
            </button>
          );
        })}
      </div>
      <div style={styles.content}>
        {tab === 'pattern' && <PatternAssets />}
        {tab === 'model' && <ModelAssets />}
        {tab === 'fabric' && <FabricAssets />}
        {tab === 'trim' && <TrimAssets />}
        {tab === 'environment' && <EnvironmentAssets />}
      </div>
    </div>
  );
}

/** Collapsed asset panel: a rail that expands the panel when clicked. */
export function AssetRail() {
  const toggle = useUIStore(s => s.toggleAssetPanel);
  return (
    <button style={styles.railEdge} onClick={toggle} title="展开">
      <Icon name="chevron-right" size={11} style={{ color: '#4da6ff' }} />
      <span style={styles.railLabel}>素材库</span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    flex: '0 0 auto', background: '#202024', borderRight: '1px solid #333',
    display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
  },
  header: {
    height: 30, flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '0 10px',
    fontSize: 'var(--oc-fs-body)', color: '#4da6ff', borderBottom: '1px solid #333', letterSpacing: 1,
  },
  collapseBtn: {
    width: 20, height: 20, background: 'transparent', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  tabs: { flex: '0 0 auto', display: 'flex', gap: 2, padding: '4px 6px', borderBottom: '1px solid #333' },
  tab: {
    flex: 1, minWidth: 0, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: '1px solid transparent', borderRadius: 3, color: '#ccc',
    cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  },
  tabActive: { background: '#2a4a6a', border: '1px solid #3d6f9e', color: '#fff' },
  content: {
    flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    padding: '6px 6px 10px',
  },
  railEdge: {
    flex: '0 0 auto', width: 24, height: '100%', background: '#202024', border: 'none',
    borderRight: '1px solid #333', cursor: 'pointer', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 8, paddingTop: 8, paddingLeft: 0, paddingRight: 0,
  },
  railLabel: { writingMode: 'vertical-rl', fontSize: 'var(--oc-fs-body)', color: '#9ab', letterSpacing: 3 },
};
