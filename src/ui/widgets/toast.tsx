import { useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';

/** Milliseconds a toast stays visible before it retires on its own. */
const TOAST_MS = 3200;

/** Shows the current transient message above the viewport area and retires it after a pause. */
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

/** Logs a failed action and shows its message to the user; `fallback` covers non-Error rejections. */
export function reportActionError(err: unknown, fallback = '操作未生效'): void {
  console.warn(err);
  const message = err instanceof Error && err.message ? err.message : fallback;
  useUIStore.getState().showToast(message);
}

const styles: Record<string, React.CSSProperties> = {
  toast: {
    position: 'fixed', bottom: 56, left: '50%', transform: 'translateX(-50%)',
    maxWidth: 'min(70vw, 460px)', padding: '8px 14px', borderRadius: 4,
    background: 'rgba(30, 30, 36, 0.94)', border: '1px solid #4a4a54',
    color: '#e6e6ea', fontSize: 12, lineHeight: 1.5, textAlign: 'center',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)', pointerEvents: 'none', zIndex: 850,
  },
};
