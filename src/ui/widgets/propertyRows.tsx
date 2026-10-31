import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';

/** Collapsible titled group of property rows, like a Blender panel. */
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

/** Label with its control on the right. */
export function Row({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>{children}</span>
    </div>
  );
}

/** Slider with a numeric readout; `commitOnRelease` keeps the drag local for edits that rebuild. */
export function SliderRow({ label, min, max, step, value, onChange, commitOnRelease, suffix }: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  commitOnRelease?: boolean;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const decimals = step < 0.01 ? 3 : (step < 1 ? 2 : 0);
  const commit = () => {
    if (draft !== null) { onChange(draft); setDraft(null); }
  };
  return (
    <div style={styles.sliderRow}>
      <div style={styles.sliderHead}>
        <span>{label}</span>
        <span>{shown.toFixed(decimals)}{suffix ? ` ${suffix}` : ''}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={shown} style={{ width: '100%' }}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (commitOnRelease) setDraft(v); else onChange(v);
        }}
        onPointerUp={commitOnRelease ? commit : undefined}
        onKeyUp={commitOnRelease ? commit : undefined}
      />
    </div>
  );
}

/** Editable text row; commits the draft on blur or Enter, and ignores a blank value. */
export function TextRow({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <InlineText value={value} onChange={onChange} />
    </div>
  );
}

/** Text field that fills the space it is given; commits on blur or Enter and ignores blank drafts. */
export function InlineText({ value, onChange, disabled, placeholder, title }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
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
      title={title} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setDraft(null); }}
    />
  );
}

/** One compact line: a label, a primary field and its icon-width controls. */
export function SlotRow({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div style={styles.slotRow}>
      {label && <span style={styles.label}>{label}</span>}
      {children}
    </div>
  );
}

/** File slot row: the chosen file's name, a picker and a clear button. */
export function FileRow({ label, name, accept, pickLabel, clearLabel, clearDisabled, onPick, onClear }: {
  label: string;
  /** Shown file name, or the unset placeholder. */
  name: string;
  accept: string;
  pickLabel: string;
  clearLabel: string;
  clearDisabled?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={styles.fileRow}>
      <span style={styles.label}>{label}</span>
      <span style={styles.fileName} title={name}>{name}</span>
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
      <button style={styles.fileBtn} onClick={() => inputRef.current?.click()}>{pickLabel}</button>
      <button style={styles.fileBtn} onClick={onClear} disabled={clearDisabled}>{clearLabel}</button>
    </div>
  );
}

/** A value that is also the button, drawn as plain text like the readouts above the sliders. */
export function ValueButton({ children, onClick, disabled, title }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <span
      style={disabled ? styles.valueText : styles.valueButton}
      onClick={disabled ? undefined : onClick}
      title={title}
    >{children}</span>
  );
}

/** Square icon button, for the controls packed beside a field. */
export function IconButton({ children, onClick, disabled, title, width = 24 }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; width?: number;
}) {
  return (
    <button
      style={{ ...styles.iconBtn, width }} onClick={onClick} disabled={disabled} title={title}
    >{children}</button>
  );
}

/** Square button that opens a list instead of showing a value. */
export function PopupSelect<T extends string>({ value, options, onChange, title }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <span style={styles.popupWrap} title={title}>
      <select
        style={styles.popup} value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={styles.popupOption}>{o.label}</option>
        ))}
      </select>
      <span style={styles.popupGlyph}><Icon name="chevron-down" size={11} /></span>
    </span>
  );
}

/** Dropdown that stretches across the remaining width of a slot row. */
export function FlexSelect<T extends string>({ label, value, options, onChange, title }: {
  label?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div style={{ ...styles.slotRow, ...styles.slotFill }}>
      {label && <span style={styles.label}>{label}</span>}
      <select
        style={{ ...styles.select, ...styles.selectFill }} value={value} title={title}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Dropdown row over the listed choices. */
export function SelectRow<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <select style={styles.select} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Colour swatch row. */
export function ColorRow({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <input
        type="color" style={styles.color} value={value}
        onChange={e => onChange(e.target.value)}
        onPointerUp={() => onChange(value)}
      />
    </div>
  );
}

/** Checkbox row. */
export function CheckRow({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    </div>
  );
}

/** Row of buttons for the secondary actions of a section. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div style={styles.btnRow}>{children}</div>;
}

/** Small action button. */
export function SmallButton({ children, onClick, disabled, title }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button style={styles.smallBtn} onClick={onClick} disabled={disabled} title={title}>{children}</button>
  );
}

/** Centered note for a tab that has nothing to show. */
export function Hint({ children }: { children: ReactNode }) {
  return <div style={styles.hint}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
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
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 'var(--oc-h-row)', fontSize: 'var(--oc-fs-micro)', color: '#ccc' },
  label: { color: '#999', flex: '0 0 auto' },
  value: { color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sliderRow: { padding: '5px 0 7px' },
  sliderHead: { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--oc-fs-micro)', color: '#aaa', marginBottom: 4 },
  select: {
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ddd',
    padding: '2px 4px', minHeight: 'var(--oc-h-control)', fontSize: 'var(--oc-fs-micro)',
    maxWidth: 'var(--oc-w-select)',
  },
  text: {
    flex: '1 1 auto', minWidth: 0, background: '#1d1d22', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#eee', padding: '2px 5px', height: 'var(--oc-h-control)',
    fontSize: 'var(--oc-fs-micro)', textAlign: 'right',
  },
  slotRow: { display: 'flex', alignItems: 'center', gap: 4, minHeight: 'var(--oc-h-slot)', fontSize: 'var(--oc-fs-micro)', color: '#ccc' },
  slotFill: { flex: '1 1 auto', minWidth: 0 },
  fileRow: { display: 'flex', alignItems: 'center', gap: 4, minHeight: 'var(--oc-h-slot)', fontSize: 'var(--oc-fs-micro)', color: '#ccc' },
  fileName: {
    flex: '1 1 auto', minWidth: 0, color: '#ddd', textAlign: 'right',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  fileInput: { display: 'none' },
  fileBtn: {
    flex: '0 0 auto', height: 'var(--oc-h-row)', padding: '0 6px', background: '#2a2a30',
    border: '1px solid #3a3a42', borderRadius: 3, color: '#ccc', cursor: 'pointer',
    fontSize: 'var(--oc-fs-micro)', whiteSpace: 'nowrap',
  },
  iconBtn: {
    flex: '0 0 auto', height: 'var(--oc-h-row)', padding: '0 4px', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', background: '#2a2a30', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#ccc', cursor: 'pointer',
  },
  popupWrap: { position: 'relative', flex: '0 0 auto', width: 28, height: 'var(--oc-h-row)' },
  popup: {
    position: 'absolute', inset: 0, width: '100%', height: '100%', appearance: 'none', WebkitAppearance: 'none',
    background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: 'transparent',
    cursor: 'pointer', fontSize: 1, padding: 0,
  },
  popupGlyph: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#bbb', fontSize: 9, pointerEvents: 'none',
  },
  popupOption: { color: '#ddd', background: '#2a2a30', fontSize: 'var(--oc-fs-micro)' },
  valueText: { color: '#999', fontSize: 'var(--oc-fs-micro)' },
  valueButton: {
    color: '#ddd', fontSize: 'var(--oc-fs-micro)', cursor: 'pointer', padding: '3px 6px', borderRadius: 3,
  },
  selectFill: { flex: '1 1 auto', minWidth: 0, maxWidth: 'none' },
  color: { width: 46, height: 'var(--oc-h-control)', border: '1px solid #3a3a42', borderRadius: 3, background: 'transparent', cursor: 'pointer', padding: 0 },
  btnRow: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  smallBtn: {
    flex: '1 1 auto', minHeight: 'var(--oc-h-row)', padding: '4px 8px', background: '#2a2a30',
    border: '1px solid #3a3a42',
    borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  hint: { color: '#777', fontSize: 'var(--oc-fs-micro)', padding: '14px 6px', textAlign: 'center', lineHeight: 1.6 },
};
