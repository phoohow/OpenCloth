import { useEffect, useMemo, useRef, useState } from 'react';
import { useMenuStore } from '@/ui/menu/menuStore';
import { shortcutsByScope, type ShortcutScope } from '@/ui/menu/shortcuts';
import { detectWebGPU } from '@/render/common';
import { ReviewDialog } from '@/ui/menu/reviewDialog';
import { IntegrationDialog } from '@/ui/menu/integrationDialog';
import { ProductionDialog } from '@/ui/menu/productionDialog';
import type { ProductionKind } from '@/ui/menu/production';
import type { MenuActions } from '@/ui/menu/actions';
import { reportActionError } from '@/ui/widgets/toast';
import { DISPLAY_LAYER_OPTIONS } from '@/ui/optionTables';
import { useUIStore } from '@/store';
import type { DisplayOptions } from '@/ui/viewport2D/render';
import {
  CAPTURE_3D_SUBJECTS, exportFrame, type Capture3DSubject, type CaptureRequest, type CaptureViewport,
} from '@/ui/screenshot';

const SCOPE_ORDER: ShortcutScope[] = ['全局', '3D 视口', '2D 制版', '菜单栏'];

/** Title of the capture dialog for one pane. */
const CAPTURE_TITLES: Record<CaptureViewport, string> = {
  '3d': '3D 截帧预览',
  '2d': '2D 截帧预览',
};

/** What the 2D preview draws: the panels themselves plus the pane's display layers. */
type Keep2D = { panels: boolean; display: DisplayOptions };

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
          ...(dialog === 'screenshot' ? styles.panelPreview : null),
        }}
        onClick={e => e.stopPropagation()}
      >
        {dialog === 'shortcuts' ? <ShortcutsDialog />
          : dialog === 'about' ? <AboutDialog />
          : dialog === 'screenshot' ? (
            <CaptureDialog actions={actions} viewport={dialogParam === '2d' ? '2d' : '3d'} />
          )
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

/**
 * Debug capture: a rail of subjects on the left, the frame they produce on the right. The preview
 * is the shot itself, refreshed whenever a subject changes, so the export matches what is shown.
 */
function CaptureDialog({ actions, viewport }: { actions: MenuActions; viewport: CaptureViewport }) {
  const closeDialog = useMenuStore(s => s.closeDialog);
  const [keep3d, setKeep3d] = useState<ReadonlySet<Capture3DSubject>>(
    () => new Set(CAPTURE_3D_SUBJECTS.map(subject => subject.key)),
  );
  const [keep2d, setKeep2d] = useState<Keep2D>(() => ({
    panels: true,
    display: { ...useUIStore.getState().displayOptions },
  }));
  const [frame, setFrame] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Object URL of the shown frame, revoked as soon as another one replaces it. */
  const urlRef = useRef<string | null>(null);

  const request = useMemo<CaptureRequest>(() => (viewport === '3d'
    ? { viewport: '3d', subjects: CAPTURE_3D_SUBJECTS.map(s => s.key).filter(key => keep3d.has(key)) }
    : { viewport: '2d', options: keep2d }), [viewport, keep3d, keep2d]);

  // Drop the last URL when the dialog closes, so the blob is not kept alive.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void actions.debugFrame(request).then(blob => {
      if (cancelled) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = blob ? URL.createObjectURL(blob) : null;
      setBusy(false);
      setFrame(blob && urlRef.current ? { blob, url: urlRef.current } : null);
    }).catch(err => {
      if (cancelled) return;
      setBusy(false);
      setFrame(null);
      reportActionError(err, '截帧失败');
    });
    return () => { cancelled = true; };
  }, [actions, request]);

  return (
    <>
      <div style={styles.title}>{CAPTURE_TITLES[viewport]}</div>
      <div style={styles.captureBody}>
        <div style={styles.captureRail}>
          <div style={styles.railTitle}>显示对象</div>
          {viewport === '3d' ? CAPTURE_3D_SUBJECTS.map(subject => (
            <CheckRow
              key={subject.key}
              label={subject.label}
              checked={keep3d.has(subject.key)}
              onChange={() => setKeep3d(prev => toggleIn(prev, subject.key))}
            />
          )) : (
            <>
              <CheckRow
                label="版片"
                checked={keep2d.panels}
                onChange={() => setKeep2d(prev => ({ ...prev, panels: !prev.panels }))}
              />
              {DISPLAY_LAYER_OPTIONS.map(layer => (
                <CheckRow
                  key={layer.key}
                  label={layer.label}
                  checked={keep2d.display[layer.key]}
                  onChange={() => setKeep2d(prev => ({
                    ...prev,
                    display: { ...prev.display, [layer.key]: !prev.display[layer.key] },
                  }))}
                />
              ))}
            </>
          )}
        </div>
        <div style={styles.capturePreview}>
          {frame ? <img src={frame.url} alt="截帧预览" style={styles.previewImage} />
            : <div style={styles.previewNote}>{busy ? '正在截帧…' : '该视口当前无可读画面'}</div>}
          {busy && frame && <div style={styles.previewBusy}>正在截帧…</div>}
        </div>
      </div>
      <div style={styles.footer}>
        <button
          style={{ ...styles.exportBtn, ...(!frame || busy ? styles.exportBtnDisabled : null) }}
          disabled={!frame || busy}
          onClick={() => frame && exportFrame(frame.blob, request)}
        >导出 PNG</button>
        <button style={styles.closeBtn} onClick={closeDialog}>关闭</button>
      </div>
    </>
  );
}

/** One subject row: a checkbox and its name. */
function CheckRow({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label style={styles.checkRow}>
      <input type="checkbox" checked={checked} onChange={onChange} style={styles.checkBox} />
      <span>{label}</span>
    </label>
  );
}

/** Copy of a subject set with one entry flipped. */
function toggleIn<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
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
  captureBody: { flex: 1, minHeight: 0, display: 'flex', gap: 12, paddingTop: 10 },
  captureRail: {
    width: 178, flex: '0 0 auto', overflowY: 'auto', padding: '6px 8px',
    background: '#1d1d21', border: '1px solid #33333a', borderRadius: 4,
  },
  railTitle: {
    color: '#7d7d88', fontSize: 'var(--oc-fs-micro)', letterSpacing: 1,
    padding: '2px 2px 6px', borderBottom: '1px solid #33333a', marginBottom: 4,
  },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 7, padding: '5px 2px',
    fontSize: 'var(--oc-fs-micro)', color: '#ccc', cursor: 'pointer', userSelect: 'none',
  },
  checkBox: { width: 13, height: 13, accentColor: '#4da6ff', cursor: 'pointer', margin: 0 },
  capturePreview: {
    flex: 1, minWidth: 0, position: 'relative', display: 'flex',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    background: '#15171b', border: '1px solid #33333a', borderRadius: 4,
  },
  previewImage: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' },
  previewNote: { color: '#7d8b99', fontSize: 'var(--oc-fs-body)' },
  previewBusy: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(15,17,21,0.6)', color: '#cfe4ff', fontSize: 'var(--oc-fs-body)',
  },
  exportBtn: {
    padding: '5px 14px', background: '#2a6a3a', border: '1px solid #3f9e55', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  exportBtnDisabled: { opacity: 0.45, cursor: 'default' },
  closeBtn: {
    padding: '5px 14px', background: '#2a4a6a', border: '1px solid #3d6f9e', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
};
