import { dialogButton, dialogTitle } from '@/ui/widgets/dialogStyles';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

let pending: Request | null = null;

const queue: Request[] = [];

const listeners = new Set<() => void>();

let lastId = 0;

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.68)', zIndex: 2200,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  panel: {
    width: 380, maxWidth: '90vw', background: '#232328', border: '1px solid #3a3a42',
    borderRadius: 6, boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
    padding: '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  detail: { fontSize: 'var(--oc-fs-micro)', color: '#aaa', lineHeight: 1.6 },
  input: {
    background: '#1b1b1f', border: '1px solid #4a4a54', borderRadius: 3,
    color: '#e6e6ea', fontSize: 'var(--oc-fs-body)', padding: '5px 8px', outline: 'none',
  },
  hint: { fontSize: 'var(--oc-fs-micro)', color: '#7d7d88' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
};

export interface TextAsk {
  title: string;
  initial?: string;
  hint?: string;
  confirmLabel?: string;
}

export interface ConfirmAsk {
  title: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}

type Request = {
  id: number;
} & (
  | ({ kind: 'text'; resolve: (value: string | null) => void } & TextAsk)
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmAsk)
);

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function pendingRequest(): Request | null {
  return pending;
}

function enqueue(request: Request): void {
  if (pending) {
    queue.push(request);
    return;
  }

  pending = request;
  emit();
}

function settle(request: Request, answer: string | boolean | null): void {
  if (pending === request) {
    pending = queue.shift() ?? null;
  } else {
    const index = queue.indexOf(request);
    if (index >= 0) queue.splice(index, 1);
  }

  emit();
  if (request.kind === 'text') request.resolve(typeof answer === 'string' ? answer : null);
  else request.resolve(answer === true);
}

export function askText(options: TextAsk): Promise<string | null> {
  return new Promise(resolve => {
    enqueue({ kind: 'text', id: ++lastId, ...options, resolve });
  });
}

export function askConfirm(options: ConfirmAsk): Promise<boolean> {
  return new Promise(resolve => {
    enqueue({ kind: 'confirm', id: ++lastId, ...options, resolve });
  });
}

export function isAsking(): boolean {
  return pending !== null;
}

export function AskDialogHost() {
  const request = useSyncExternalStore(subscribe, pendingRequest);
  if (!request) return null;
  return <AskDialog key={request.id} request={request} />;
}

function AskDialog({ request }: { request: Request }) {
  const [value, setValue] = useState(request.kind === 'text' ? request.initial ?? '' : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const canSubmit = request.kind === 'confirm' || value.trim().length > 0;

  const submit = useCallback((): void => {
    if (request.kind === 'confirm') {
      settle(request, true);
      return;
    }

    const text = value.trim();
    if (text) settle(request, text);
  }, [request, value]);

  const cancel = useCallback(
    (): void => settle(request, request.kind === 'text' ? null : false),
    [request],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      if (e.key === 'Escape') cancel();
      else submit();
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancel, submit]);

  const danger = request.kind === 'confirm' && request.danger === true;

  return (
    <div style={styles.backdrop} onPointerDown={cancel}>
      <div style={styles.panel} onPointerDown={e => e.stopPropagation()}>
        <div style={dialogTitle}>{request.title}</div>
        {request.kind === 'text' ? (
          <>
            <input
              ref={inputRef}
              style={styles.input}
              value={value}
              onChange={e => setValue(e.target.value)}
            />
            {request.hint && <div style={styles.hint}>{request.hint}</div>}
          </>
        ) : (
          request.detail && <div style={styles.detail}>{request.detail}</div>
        )}
        <div style={styles.footer}>
          <button style={dialogButton('secondary', 12)} onClick={cancel}>取消</button>
          <button
            style={{
              ...dialogButton(danger ? 'danger' : 'primary', 16),
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            disabled={!canSubmit}
            onClick={submit}
          >
            {request.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}
