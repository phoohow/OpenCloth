import { downloadTextFile } from '@/io/serialization';
import { previewText } from '@/ui/menu/previewText';
import { useEffect } from 'react';

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.68)', zIndex: 2100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  panel: {
    width: 860, maxWidth: '94vw', height: 'min(82vh, 82dvh)', background: '#232328',
    border: '1px solid #3a3a42', borderRadius: 6, boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
    padding: '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden',
  },
  header: { display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 8, borderBottom: '1px solid #333' },
  title: { fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1 },
  badge: {
    fontSize: 'var(--oc-fs-micro)', color: '#8fbfe0', background: '#1f2a33', border: '1px solid #33505e',
    borderRadius: 3, padding: '1px 6px', letterSpacing: 0.5,
  },
  filename: { flex: 1, textAlign: 'right', fontSize: 'var(--oc-fs-micro)', color: '#7d7d88', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  stats: { display: 'flex', flexWrap: 'wrap', gap: 14 },
  stat: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 'var(--oc-fs-micro)' },
  statLabel: { color: '#7d7d88' },
  statValue: { color: '#ddd' },
  code: {
    flex: 1, minHeight: 0, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'var(--oc-fs-note)', color: '#bcd',
    background: '#1b1b1f', border: '1px solid #333', borderRadius: 4, padding: '8px 10px', lineHeight: 1.6,
  },
  footer: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid #333' },
  note: { flex: 1, fontSize: 'var(--oc-fs-micro)', color: '#7d7d88' },
  exportBtn: {
    padding: '5px 16px', background: '#2a6a3a', border: '1px solid #3f9e55', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  secondaryBtn: {
    padding: '5px 12px', background: '#2a2a30', border: '1px solid #4a4a54', borderRadius: 3,
    color: '#ddd', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
};

export interface PreviewDownload {
  title: string;
  format: string;
  filename: string;
  mime: string;
  content: string;
  preview?: string;
  stats?: Array<[string, string]>;
  note?: string;
  onDownloaded?: () => void;
}

function payloadSize(content: string): string {
  const bytes = new TextEncoder().encode(content).length;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function ExportPreviewModal({ download, onClose }: {
  download: PreviewDownload | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!download) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [download, onClose]);

  if (!download) return null;
  const { text: preview, truncated } = previewText(download.preview ?? download.content);
  const stats = [...(download.stats ?? []), ['文件大小', payloadSize(download.content)]];

  const save = () => {
    downloadTextFile(download.filename, download.content, download.mime);
    download.onDownloaded?.();
    onClose();
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>{download.title}</span>
          <span style={styles.badge}>{download.format}</span>
          <span style={styles.filename}>{download.filename}</span>
        </div>
        <div style={styles.stats}>
          {stats.map(([label, value]) => (
            <div key={label} style={styles.stat}>
              <span style={styles.statLabel}>{label}</span>
              <span style={styles.statValue}>{value}</span>
            </div>
          ))}
        </div>
        <pre style={styles.code}>{preview}</pre>
        <div style={styles.footer}>
          <span style={styles.note}>
            {truncated ? '预览已截断' : download.note}
          </span>
          <button style={styles.secondaryBtn} onClick={onClose}>取消</button>
          <button style={styles.exportBtn} onClick={save}>导出</button>
        </div>
      </div>
    </div>
  );
}
