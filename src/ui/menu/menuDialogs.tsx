import { useEffect, useState } from 'react';
import { useMenuStore } from '@/ui/menu/menuStore';
import { shortcutsByScope, type ShortcutScope } from '@/ui/menu/shortcuts';
import { detectWebGPU } from '@/render/common';
import { ReviewDialog } from '@/ui/menu/reviewDialog';
import { IntegrationDialog } from '@/ui/menu/integrationDialog';
import { ProductionDialog } from '@/ui/menu/productionDialog';
import type { ProductionKind } from '@/ui/menu/production';
import type { MenuActions } from '@/ui/menu/actions';
import { reportActionError } from '@/ui/widgets/toast';
import type {
  Screenshot2DContent, Screenshot3DContent, ScreenshotRequest, ScreenshotViewport,
} from '@/ui/debug/screenshot';

const SCOPE_ORDER: ShortcutScope[] = ['全局', '3D 视口', '2D 制版', '菜单栏'];

/** Panes the debug screenshot can be taken from. */
const SCREENSHOT_VIEWPORTS: ReadonlyArray<{ value: ScreenshotViewport; label: string }> = [
  { value: '3d', label: '3D 视口' },
  { value: '2d', label: '2D 制版' },
];

/** What each pane can keep in the picture. */
const SCREENSHOT_3D: ReadonlyArray<{ value: Screenshot3DContent; label: string }> = [
  { value: 'full', label: '完整场景' },
  { value: 'garment', label: '仅服装' },
  { value: 'body', label: '仅人体' },
];
const SCREENSHOT_2D: ReadonlyArray<{ value: Screenshot2DContent; label: string }> = [
  { value: 'full', label: '完整场景' },
  { value: 'pattern', label: '仅版片' },
  { value: 'body', label: '仅人体' },
];

/** Modal host for Help ▸ Shortcuts, About OpenCloth, the debug screenshot and the collaboration dialogs. */
export function MenuDialogs({ actions }: { actions: MenuActions }) {
  const dialog = useMenuStore(s => s.dialog);
  const dialogParam = useMenuStore(s => s.dialogParam);
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
      <div
        style={{
          ...styles.panel,
          ...(dialog === 'review' ? styles.panelWide : null),
          ...(dialog === 'integration' ? styles.panelPreview : null),
          ...(dialog === 'production' ? styles.panelPreview : null),
        }}
        onClick={e => e.stopPropagation()}
      >
        {dialog === 'shortcuts' ? <ShortcutsDialog />
          : dialog === 'about' ? <AboutDialog />
          : dialog === 'screenshot' ? <ScreenshotDialog actions={actions} />
          : dialog === 'review' ? <ReviewDialog initialProjectId={dialogParam} />
          : dialog === 'integration' ? <IntegrationDialog />
          : <ProductionDialog initialKind={dialogParam as ProductionKind | null} />}
        {dialog !== 'production' && dialog !== 'integration' && dialog !== 'screenshot' && (
          <div style={styles.footer}>
            <button style={styles.closeBtn} onClick={closeDialog}>关闭</button>
          </div>
        )}
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
      </div>
    </>
  );
}

function AboutDialog() {
  const [gpu, setGpu] = useState<string>('检测中');

  useEffect(() => {
    let cancelled = false;
    void detectWebGPU().then(ok => { if (!cancelled) setGpu(ok ? 'WebGPU 可用' : 'WebGPU 不可用'); });
    return () => { cancelled = true; };
  }, []);

  const rows: Array<[string, string]> = [
    ['渲染后端', gpu],
    ['布料求解', 'WebGPU 位置基底动力学'],
    ['技术栈', 'React · Zustand · three.js (WebGPURenderer)'],
  ];

  return (
    <>
      <div style={styles.title}>关于 OpenCloth</div>
      <div style={styles.body}>
        <div style={styles.summary}>浏览器内的服装制版与实时布料模拟。</div>
        {rows.map(([label, value]) => (
          <div key={label} style={styles.row}>
            <span style={styles.rowLabel}>{label}</span>
            <span style={styles.rowValue}>{value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Debug screenshot: pick the pane and the subject, then export one PNG. */
function ScreenshotDialog({ actions }: { actions: MenuActions }) {
  const closeDialog = useMenuStore(s => s.closeDialog);
  const [request, setRequest] = useState<ScreenshotRequest>({ viewport: '3d', content: 'full' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const file = await actions.debugScreenshot(request);
      setMessage(file ? `已导出 ${file}` : '导出失败：请先在界面中显示该视口');
    } catch (err) {
      reportActionError(err, '截图导出失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={styles.title}>导出调试截图</div>
      <div style={styles.body}>
        <ChoiceRow label="视口" options={SCREENSHOT_VIEWPORTS} value={request.viewport}
          onChange={viewport => setRequest({ viewport, content: 'full' })} />
        {request.viewport === '3d'
          ? <ChoiceRow label="内容" options={SCREENSHOT_3D} value={request.content}
            onChange={content => setRequest({ viewport: '3d', content })} />
          : <ChoiceRow label="内容" options={SCREENSHOT_2D} value={request.content}
            onChange={content => setRequest({ viewport: '2d', content })} />}
        <div style={styles.note}>只影响导出的图片；工程、模拟和显示设置都保持原样。</div>
        {message && <div style={styles.message}>{message}</div>}
      </div>
      <div style={styles.footer}>
        <button style={styles.exportBtn} disabled={busy} onClick={() => void run()}>
          {busy ? '导出中…' : '导出 PNG'}
        </button>
        <button style={styles.closeBtn} onClick={closeDialog}>关闭</button>
      </div>
    </>
  );
}

/** One labelled row of mutually exclusive choices. */
function ChoiceRow<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <div style={styles.choices}>
        {options.map(option => (
          <button key={option.value} type="button" onClick={() => onChange(option.value)}
            style={{ ...styles.choice, ...(option.value === value ? styles.choiceActive : null) }}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(10,10,12,0.62)', zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  panel: {
    width: 520, maxWidth: '92vw', maxHeight: 'min(84vh, 84dvh)', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    background: '#232328', border: '1px solid #3a3a42', borderRadius: 6,
    boxShadow: '0 12px 36px rgba(0,0,0,0.55)', padding: '14px 16px 12px',
  },
  panelWide: {
    width: 900, height: 'min(84vh, 84dvh)', maxWidth: '96vw', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  panelPreview: {
    width: 1040, height: 'min(88vh, 88dvh)', maxWidth: '96vw', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  title: { fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1, paddingBottom: 8, borderBottom: '1px solid #333' },
  body: { paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 },
  summary: { fontSize: 'var(--oc-fs-micro)', color: '#bbb', lineHeight: 1.6 },
  group: { display: 'flex', flexDirection: 'column', gap: 2 },
  groupTitle: { fontSize: 'var(--oc-fs-micro)', color: '#7d7d88', letterSpacing: 1, margin: '4px 0 2px' },
  row: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--oc-fs-micro)', color: '#ccc', padding: '4px 2px' },
  rowLabel: { flex: 1 },
  rowValue: { color: '#ddd', fontSize: 'var(--oc-fs-micro)' },
  kbd: {
    background: '#1b1b1f', border: '1px solid #3a3a42', borderBottomWidth: 2, borderRadius: 3,
    padding: '1px 6px', fontSize: 'var(--oc-fs-micro)', color: '#cfe4ff', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { color: '#7d7d88', fontSize: 'var(--oc-fs-micro)' },
  choices: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  choice: {
    padding: '4px 12px', background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#aaa', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  choiceActive: { background: '#2a3a4a', border: '1px solid #4da6ff', color: '#fff' },
  note: { color: '#777', fontSize: 'var(--oc-fs-note)', lineHeight: 1.5 },
  message: { color: '#9fd4a8', fontSize: 'var(--oc-fs-micro)' },
  exportBtn: {
    padding: '5px 14px', background: '#2a6a3a', border: '1px solid #3f9e55', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  closeBtn: {
    padding: '5px 14px', background: '#2a4a6a', border: '1px solid #3d6f9e', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
};
