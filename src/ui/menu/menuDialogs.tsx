import { useEffect, useState } from 'react';
import { useMenuStore } from './menuStore';
import { SHORTCUTS, shortcutsByScope, type ShortcutScope } from './shortcuts';
import { detectWebGPU } from '../../render/renderer/rendererContext';
import { useProjectStore } from '../../store/stores';

const SCOPE_ORDER: ShortcutScope[] = ['全局', '3D 视口', '2D 制版', '菜单栏'];

/** Modal host for 帮助 ▸ 快捷键总览 and 关于 OpenCloth. */
export function MenuDialogs() {
  const dialog = useMenuStore(s => s.dialog);
  const closeDialog = useMenuStore(s => s.closeDialog);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dialog, closeDialog]);

  if (!dialog) return null;
  return (
    <div style={styles.backdrop} onClick={closeDialog}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        {dialog === 'shortcuts' ? <ShortcutsDialog /> : <AboutDialog />}
        <div style={styles.footer}>
          <button style={styles.closeBtn} onClick={closeDialog}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function ShortcutsDialog() {
  return (
    <>
      <div style={styles.title}>快捷键总览</div>
      <div style={styles.body}>
        {SCOPE_ORDER.map(scope => {
          const rows = shortcutsByScope(scope);
          if (rows.length === 0) return null;
          return (
            <section key={scope} style={styles.group}>
              <div style={styles.groupTitle}>{scope}</div>
              {rows.map(row => (
                <div key={row.id} style={styles.row}>
                  <span style={styles.rowLabel}>{row.label}</span>
                  <kbd style={styles.kbd}>{row.combo}</kbd>
                </div>
              ))}
            </section>
          );
        })}
        <div style={styles.note}>
          视口鼠标操作：2D 拖拽平移、滚轮缩放、点击选中、Ctrl 加选；3D 左键旋转、右键平移、滚轮推拉。
        </div>
      </div>
    </>
  );
}

function AboutDialog() {
  const appVersion = useProjectStore(s => s.project.meta.appVersion);
  const [gpu, setGpu] = useState<string>('检测中…');

  useEffect(() => {
    let cancelled = false;
    void detectWebGPU().then(ok => { if (!cancelled) setGpu(ok ? 'WebGPU 可用' : 'WebGPU 不可用'); });
    return () => { cancelled = true; };
  }, []);

  const rows: Array<[string, string]> = [
    ['版本', appVersion],
    ['渲染后端', gpu],
    ['布料求解', 'WebGPU 位置基底动力学'],
    ['技术栈', 'React · Zustand · three.js (WebGPURenderer)'],
    ['工程格式', '.ocproj.json（数据版本 1）'],
  ];

  return (
    <>
      <div style={styles.title}>关于 OpenCloth</div>
      <div style={styles.body}>
        <div style={styles.summary}>OpenCloth 是一款在浏览器里运行的服装制版与试衣软件：2D 制版、缝合、自动着装与实时布料模拟。</div>
        {rows.map(([label, value]) => (
          <div key={label} style={styles.row}>
            <span style={styles.rowLabel}>{label}</span>
            <span style={styles.rowValue}>{value}</span>
          </div>
        ))}
        <div style={styles.note}>
          共 {SHORTCUTS.length} 项快捷键，全部列在「快捷键总览」中。
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(10,10,12,0.62)', zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  panel: {
    width: 520, maxWidth: '92vw', maxHeight: '84vh', overflowY: 'auto',
    background: '#232328', border: '1px solid #3a3a42', borderRadius: 6,
    boxShadow: '0 12px 36px rgba(0,0,0,0.55)', padding: '14px 16px 12px',
  },
  title: { fontSize: 15, color: '#4da6ff', letterSpacing: 1, paddingBottom: 8, borderBottom: '1px solid #333' },
  body: { paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 },
  summary: { fontSize: 12, color: '#bbb', lineHeight: 1.6 },
  group: { display: 'flex', flexDirection: 'column', gap: 2 },
  groupTitle: { fontSize: 11, color: '#7d7d88', letterSpacing: 1, margin: '4px 0 2px' },
  row: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#ccc', padding: '3px 2px' },
  rowLabel: { flex: 1 },
  rowValue: { color: '#ddd', fontSize: 12 },
  kbd: {
    background: '#1b1b1f', border: '1px solid #3a3a42', borderBottomWidth: 2, borderRadius: 3,
    padding: '1px 6px', fontSize: 11, color: '#cfe4ff', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  note: { fontSize: 11, color: '#777', lineHeight: 1.6 },
  footer: { display: 'flex', justifyContent: 'flex-end', paddingTop: 12 },
  closeBtn: {
    padding: '5px 14px', background: '#2a4a6a', border: '1px solid #3d6f9e', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 12,
  },
};
