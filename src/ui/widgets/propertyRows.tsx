import { clamp as clampValue } from '@/base/math';
import { Icon } from '@/ui/icons';
import { useRef, useState, type ReactNode } from 'react';

const styles: Record<string, React.CSSProperties> = {
  dimmed: { opacity: 0.45 },
  noPointer: { cursor: 'default' },
  section: { border: '1px solid #333', borderRadius: 4, marginBottom: 6, background: '#232327' },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: 5, padding: '4px 7px', minHeight: 'var(--oc-h-section-header)',
    cursor: 'pointer', background: '#2a2a30', borderRadius: '4px 4px 0 0',
    fontSize: 'var(--oc-fs-micro)', color: '#bbb',
    letterSpacing: 0.5, userSelect: 'none',
  },
  chevron: { flex: '0 0 auto', color: '#888' },
  sectionTitle: { fontWeight: 600 },
  sectionBody: { padding: '4px 7px 7px' },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    minHeight: 'var(--oc-h-row)', fontSize: 'var(--oc-fs-micro)', color: '#ccc',
  },
  label: {
    color: '#999', flex: '0 1 auto', minWidth: 'var(--oc-w-field-label)', textAlign: 'right',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  value: {
    flex: '0 1 auto', minWidth: 'var(--oc-w-field)', color: '#ddd', textAlign: 'right',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  field: {
    display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle',
    flex: '0 0 auto', width: 'var(--oc-w-field)', minWidth: 0,
  },
  sliderRow: { padding: '6px 0 9px', fontSize: 'var(--oc-fs-micro)', color: '#aaa' },
  sliderHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  rangeWrap: { width: 'var(--oc-w-field)', marginLeft: 'auto' },
  range: { display: 'block', width: '100%' },
  sliderField: { position: 'relative', flex: '0 0 auto', width: 'var(--oc-w-field)', height: 'var(--oc-h-control)' },
  sliderNum: {
    width: '100%', height: '100%', background: '#1d1d22',
    border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', padding: '0 5px',
    fontSize: 'var(--oc-fs-micro)', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  },
  select: {
    flex: '1 1 auto', width: 0, minWidth: 0, background: '#1d1d22', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#ddd', padding: '0 4px', height: 'var(--oc-h-control)',
    fontSize: 'var(--oc-fs-micro)',
  },
  text: {
    flex: '1 1 auto', minWidth: 0, width: 0, background: '#1d1d22', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#eee', padding: '0 5px', height: 'var(--oc-h-control)',
    fontSize: 'var(--oc-fs-micro)', textAlign: 'right',
  },
  fileName: {
    flex: '1 1 auto', minWidth: 0, width: 0, background: '#1d1d22', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#ddd', padding: '0 5px', height: 'var(--oc-h-control)',
    fontSize: 'var(--oc-fs-micro)', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right',
  },
  fileInput: { display: 'none' },
  iconBtn: {
    flex: '0 0 auto', width: 'var(--oc-w-icon)', height: 'var(--oc-w-icon)', padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#2a2a30',
    border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 'var(--oc-fs-note)',
  },
  popupWrap: { position: 'relative', flex: '0 0 auto', width: 'var(--oc-w-icon)', height: 'var(--oc-w-icon)' },
  popup: {
    position: 'absolute', inset: 0, width: '100%', height: '100%', appearance: 'none', WebkitAppearance: 'none',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: 'transparent',
    cursor: 'pointer', fontSize: 1, padding: 0,
  },
  popupGlyph: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#bbb', fontSize: 'var(--oc-fs-note)', pointerEvents: 'none',
  },
  popupOption: { color: '#ddd', background: '#2a2a30', fontSize: 'var(--oc-fs-micro)' },
  color: { width: 46, height: 'var(--oc-h-control)', border: '1px solid #3a3a42', borderRadius: 3, background: 'transparent', cursor: 'pointer', padding: 0 },
  btnRow: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 5 },
  smallBtn: {
    flex: '0 0 calc((100% - 12px) / 4)', verticalAlign: 'middle', minHeight: 'var(--oc-h-row)', padding: '4px 4px',
    background: '#2a2a30', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    border: '1px solid #3a3a42',
    borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 'var(--oc-fs-note)',
  },
  smallBtnInline: {
    flex: '0 0 auto', verticalAlign: 'middle', height: 'var(--oc-h-control)', padding: '0 7px',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc',
    cursor: 'pointer', fontSize: 'var(--oc-fs-micro)', whiteSpace: 'nowrap',
  },
  hint: { color: '#777', fontSize: 'var(--oc-fs-micro)', padding: '14px 6px', textAlign: 'center', lineHeight: 1.6 },
};

export function Section({ title, children, defaultOpen = true }: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader} onClick={() => setOpen(o => !o)} title={open ? '折叠' : '展开'}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} style={styles.chevron} />
        <span style={styles.sectionTitle}>{title}</span>
      </div>
      {open && <div style={styles.sectionBody}>{children}</div>}
    </div>
  );
}

export function Row({ label, tip, disabled, children }: {
  label: string; tip?: string; disabled?: boolean; children?: ReactNode;
}) {
  const row = disabled ? { ...styles.row, ...styles.dimmed } : styles.row;
  return (
    <div style={row} title={tip}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>{children}</span>
    </div>
  );
}

export function Field({ children }: { children: ReactNode }) {
  return <span style={styles.field}>{children}</span>;
}

export function SliderRow({ label, tip, min, max, step, value, onChange, commitOnRelease, onCommit, disabled }: {
  label: string;
  tip?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  commitOnRelease?: boolean;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const shown = draft ?? value;
  const decimals = step < 0.01 ? 3 : (step < 1 ? 2 : 0);
  const clamp = (v: number) => clampValue(v, min, max);
  const snap = (v: number) => clamp(Number((Math.round(v / step) * step).toFixed(Math.max(decimals, 0))));

  const commitDraft = () => {
    if (draft !== null) { onChange(draft); setDraft(null); }
  };

  const commitText = () => {
    if (text === null) return;
    const parsed = Number.parseFloat(text);
    setText(null);
    if (!Number.isFinite(parsed)) return;
    const next = snap(parsed);
    if (next !== value) onChange(next);
    onCommit?.();
  };

  const settle = commitOnRelease || onCommit
    ? () => { if (commitOnRelease) commitDraft(); onCommit?.(); }
    : undefined;

  return (
    <div style={disabled ? { ...styles.sliderRow, ...styles.dimmed } : styles.sliderRow} title={tip}>
      <div style={styles.sliderHead}>
        <span style={styles.label}>{label}</span>
        <span style={styles.sliderField}>
          <input
            type="text" inputMode="decimal" spellCheck={false} style={styles.sliderNum} disabled={disabled}
            value={text ?? shown.toFixed(decimals)} onChange={e => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setText(null);
            }}
          />
        </span>
      </div>
      <div style={styles.rangeWrap}>
        <input
          type="range" min={min} max={max} step={step} value={shown} style={styles.range} disabled={disabled}
          onChange={e => {
            const v = Number.parseFloat(e.target.value);
            if (commitOnRelease) setDraft(v); else onChange(v);
          }}
          onPointerUp={settle}
          onKeyUp={settle}
        />
      </div>
    </div>
  );
}

export function TextRow({ label, value, tip, onChange }: {
  label: string; value: string; tip?: string; onChange: (v: string) => void;
}) {
  return (
    <div style={styles.row} title={tip}>
      <span style={styles.label}>{label}</span>
      <Field><InlineText value={value} onChange={onChange} /></Field>
    </div>
  );
}

export function InlineText({ value, onChange, disabled, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next && next !== value) onChange(next);
  };
  return (
    <input
      style={styles.text} value={shown} spellCheck={false} disabled={disabled} placeholder={placeholder}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setDraft(null); }}
    />
  );
}

export function FileRow({ label, tip, name, accept, pickTitle, clearTitle, clearDisabled, onPick, onClear }: {
  label: string;
  tip?: string;
  name: string;
  accept: string;
  pickTitle: string;
  clearTitle: string;
  clearDisabled?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={styles.row} title={tip}>
      <span style={styles.label}>{label}</span>
      <Field>
        <input style={styles.fileName} value={name} title={name} readOnly />
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={styles.fileInput}
          onChange={e => {
            const file = e.target.files?.[0];
            e.currentTarget.value = '';
            if (file) onPick(file);
          }}
        />
        <IconButton title={pickTitle} onClick={() => inputRef.current?.click()}><Icon name="plus" size={10} /></IconButton>
        <IconButton title={clearTitle} onClick={onClear} disabled={clearDisabled}><Icon name="minus" size={10} /></IconButton>
      </Field>
    </div>
  );
}

export function IconButton({ children, onClick, disabled, title }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button
      style={disabled ? { ...styles.iconBtn, ...styles.dimmed } : styles.iconBtn}
      onClick={onClick} disabled={disabled} title={title}
    >{children}</button>
  );
}

export function PopupSelect<T extends string>({ value, options, onChange }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <span style={styles.popupWrap}>
      <select
        style={styles.popup} value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={styles.popupOption}>{o.label}</option>
        ))}
      </select>
      <span style={styles.popupGlyph}><Icon name="chevron-down" size={9} /></span>
    </span>
  );
}

export function SelectRow<T extends string>({ label, tip, value, options, onChange, trailing, disabled }: {
  label: string;
  tip?: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  const row = disabled ? { ...styles.row, ...styles.dimmed } : styles.row;
  return (
    <div style={row} title={tip}>
      <span style={styles.label}>{label}</span>
      <Field>
        <select style={styles.select} value={value} disabled={disabled}
          onChange={e => onChange(e.target.value as T)}>
          {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        {trailing}
      </Field>
    </div>
  );
}

export function ColorRow({ label, value, tip, onChange }: {
  label: string; value: string; tip?: string; onChange: (v: string) => void;
}) {
  return (
    <div style={styles.row} title={tip}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>
        <input
          type="color" style={styles.color} value={value}
          onChange={e => onChange(e.target.value)}
          onPointerUp={() => onChange(value)}
        />
      </span>
    </div>
  );
}

export function CheckRow({ label, checked, tip, onChange, disabled }: {
  label: string; checked: boolean; tip?: string; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div style={disabled ? { ...styles.row, ...styles.dimmed } : styles.row} title={tip}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      </span>
    </div>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div style={styles.btnRow}>{children}</div>;
}

export function SmallButton({ children, onClick, disabled, title, compact }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; compact?: boolean;
}) {
  return (
    <button style={{
      ...(compact ? styles.smallBtnInline : styles.smallBtn),
      ...(disabled ? { ...styles.dimmed, ...styles.noPointer } : null),
    }}
      onClick={onClick} disabled={disabled} title={title}>{children}</button>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div style={styles.hint}>{children}</div>;
}
