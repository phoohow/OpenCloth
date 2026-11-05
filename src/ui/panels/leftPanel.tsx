import { useState } from 'react';
import { useProjectStore, useUIStore } from '../../store/stores';
import { GARMENT_TEMPLATES } from '../../pattern/template';
import { AppendTemplateCommand, ApplyTemplateCommand } from '../../pattern/template/templateCommands';
import type { GarmentTemplate, ParamField } from '../../pattern/template/templateKit';
import { Icon } from '../icons';

/** Template library; pattern tools live above the 2D pane and scene objects on the right. */
export function LeftPanel() {
  const width = useUIStore(s => s.leftPanelWidth);
  const toggle = useUIStore(s => s.toggleTemplatePanel);
  return (
    <div style={{ ...styles.panel, width }}>
      <div style={styles.header}>
        <span style={{ flex: 1 }}>模板库</span>
        <button style={styles.collapseBtn} onClick={toggle} title="收起模板库">
          <Icon name="chevron-right" size={11} style={{ color: '#888', transform: 'rotate(180deg)' }} />
        </button>
      </div>
      <div style={styles.content}>
        {GARMENT_TEMPLATES.map(template => (
          <TemplateCard key={template.key} template={template} />
        ))}
      </div>
    </div>
  );
}

/** Collapsed template library: a rail that expands the panel when clicked. */
export function TemplateRail() {
  const toggle = useUIStore(s => s.toggleTemplatePanel);
  return (
    <button style={styles.rail} onClick={toggle} title="展开模板库">
      <Icon name="chevron-right" size={11} style={{ color: '#4da6ff' }} />
      <span style={styles.railLabel}>模板库</span>
    </button>
  );
}

/** Keeps a typed measurement inside its template range. */
function clampField(value: number, field: ParamField, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, field.min), field.max);
}

function TemplateCard({ template }: { template: GarmentTemplate }) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<Record<string, number>>({ ...template.defaults });
  const executeCommand = useProjectStore(s => s.executeCommand);

  return (
    <div style={styles.templateCard}>
      <button style={styles.templateHead} onClick={() => setOpen(o => !o)}>
        <Icon name={template.icon} size={18} style={{ color: '#9ab' }} />
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 'var(--oc-fs-label)', color: '#eee' }}>{template.name}</span>
          <span style={{ display: 'block', fontSize: 'var(--oc-fs-note)', color: '#777' }}>{template.summary}</span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} style={{ color: '#666' }} />
      </button>

      {open && (
        <div style={styles.templateBody}>
          <div style={styles.fieldGrid}>
            {template.fields.map(field => (
              <label key={field.key} style={styles.field}>
                <span style={styles.fieldLabel}>{field.label}</span>
                <input
                  type="number"
                  style={styles.fieldInput}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={params[field.key] ?? template.defaults[field.key]}
                  onChange={e => setParams(p => ({
                    ...p,
                    [field.key]: clampField(Number(e.target.value), field, template.defaults[field.key]),
                  }))}
                />
                <span style={styles.fieldUnit}>{field.unit}</span>
              </label>
            ))}
          </div>
          <div style={styles.fieldActions}>
            <button
              style={styles.actionBtn}
              title="会清空当前版型，再按模板重新生成"
              onClick={() => executeCommand(new ApplyTemplateCommand(template, params))}
            >
              替换版型
            </button>
            <button
              style={styles.actionBtn}
              title="保留已有版片，把模板的片排在右侧"
              onClick={() => executeCommand(new AppendTemplateCommand(template, params))}
            >
              追加版型
            </button>
          </div>
          <div style={styles.fieldHint}>「替换版型」会清空当前版型；「追加版型」保留已有版片。</div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { flex: '0 0 auto', background: '#202024', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  header: { height: 30, flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 'var(--oc-fs-body)', color: '#4da6ff', borderBottom: '1px solid #333', letterSpacing: 1 },
  collapseBtn: { width: 20, height: 20, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  rail: { flex: '0 0 auto', width: 24, height: '100%', background: '#202024', border: 'none', borderRight: '1px solid #333', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 8, paddingLeft: 0, paddingRight: 0 },
  railLabel: { writingMode: 'vertical-rl', fontSize: 'var(--oc-fs-body)', color: '#9ab', letterSpacing: 3 },
  content: { flex: 1, overflowY: 'auto', padding: 8 },
  templateCard: { margin: '4px 0', background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4, overflow: 'hidden' },
  templateHead: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px', background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer', textAlign: 'left' },
  templateBody: { padding: '4px 8px 8px', borderTop: '1px solid #3a3a42' },
  fieldGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, margin: '6px 0' },
  field: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--oc-fs-note)', color: '#999' },
  fieldLabel: { flexShrink: 0 },
  fieldInput: { width: '100%', minWidth: 0, background: '#1c1c20', border: '1px solid #3a3a42', borderRadius: 3, color: '#ddd', fontSize: 'var(--oc-fs-micro)', padding: '2px 3px' },
  fieldUnit: { flexShrink: 0, color: '#666' },
  fieldActions: { display: 'flex', gap: 4, marginTop: 4 },
  actionBtn: { flex: 1, padding: '6px 0', background: '#2a4a6a', border: '1px solid #3d6f9e', borderRadius: 3, color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-body)' },
  fieldHint: { fontSize: 'var(--oc-fs-note)', color: '#666', marginTop: 4, lineHeight: 1.4 },
};
