import { useState } from 'react';
import { useProjectStore, useUIStore } from '../../store/stores';
import { GARMENT_TEMPLATES } from '../../pattern/template';
import { AppendTemplateCommand, ApplyTemplateCommand } from '../../pattern/template/templateCommands';
import type { GarmentTemplate, ParamField } from '../../pattern/template/templateKit';
import { Icon } from '../icons';

/** Template library; pattern tools live above the 2D pane and scene objects on the right. */
export function LeftPanel() {
  const width = useUIStore(s => s.leftPanelWidth);
  return (
    <div style={{ ...styles.panel, width }}>
      <div style={styles.header}>模板</div>
      <div style={styles.content}>
        {GARMENT_TEMPLATES.map(template => (
          <TemplateCard key={template.key} template={template} />
        ))}
      </div>
    </div>
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
          <span style={{ display: 'block', fontSize: 13, color: '#eee' }}>{template.name}</span>
          <span style={{ display: 'block', fontSize: 10, color: '#777' }}>{template.summary}</span>
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
            <button style={styles.actionBtn} onClick={() => executeCommand(new ApplyTemplateCommand(template, params))}>
              应用
            </button>
            <button style={styles.actionBtn} onClick={() => executeCommand(new AppendTemplateCommand(template, params))}>
              追加
            </button>
          </div>
          <div style={styles.fieldHint}>应用会替换当前版型，追加保留已有版型片。</div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { flex: '0 0 auto', background: '#202024', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  header: { height: 30, flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, color: '#4da6ff', borderBottom: '1px solid #333', letterSpacing: 1 },
  content: { flex: 1, overflowY: 'auto', padding: 8 },
  templateCard: { margin: '4px 0', background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4, overflow: 'hidden' },
  templateHead: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px', background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer', textAlign: 'left' },
  templateBody: { padding: '4px 8px 8px', borderTop: '1px solid #3a3a42' },
  fieldGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, margin: '6px 0' },
  field: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#999' },
  fieldLabel: { flexShrink: 0 },
  fieldInput: { width: '100%', minWidth: 0, background: '#1c1c20', border: '1px solid #3a3a42', borderRadius: 3, color: '#ddd', fontSize: 11, padding: '2px 3px' },
  fieldUnit: { flexShrink: 0, color: '#666' },
  fieldActions: { display: 'flex', gap: 4, marginTop: 4 },
  actionBtn: { flex: 1, padding: '6px 0', background: '#2a4a6a', border: '1px solid #3d6f9e', borderRadius: 3, color: '#fff', cursor: 'pointer', fontSize: 12 },
  fieldHint: { fontSize: 10, color: '#666', marginTop: 4, lineHeight: 1.4 },
};
