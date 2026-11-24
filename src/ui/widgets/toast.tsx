import { useUIStore } from '@/store';
import { useEffect } from 'react';

const TOAST_MS = 3200;

const styles: Record<string, React.CSSProperties> = {
  toast: {
    position: 'fixed', bottom: 56, left: '50%', transform: 'translateX(-50%)',
    maxWidth: 'min(70vw, 460px)', padding: '8px 14px', borderRadius: 4,
    background: 'rgba(30, 30, 36, 0.94)', border: '1px solid #4a4a54',
    color: '#e6e6ea', fontSize: 'var(--oc-fs-body)', lineHeight: 1.5, textAlign: 'center',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)', pointerEvents: 'none', zIndex: 850,
  },
};

export function ToastHost() {
  const toast = useUIStore(s => s.toast);
  const dismissToast = useUIStore(s => s.dismissToast);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(dismissToast, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;
  return <div style={styles.toast}>{toast.text}</div>;
}

export function notify(text: string): void {
  useUIStore.getState().showToast(text);
}

export function reportActionError(err: unknown, fallback = '操作未生效'): void {
  console.warn(err);
  const message = err instanceof Error && err.message ? err.message : fallback;
  notify(message);
}
