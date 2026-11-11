import { useState } from 'react';
import { useProjectStore } from '@/store';
import { AppendTemplateCommand, ApplyTemplateCommand, GARMENT_TEMPLATES } from '@/pattern/template';
import type { GarmentTemplate, ParamField } from '@/pattern/template';
import { Icon } from '@/ui/icons';
import { Section, styles } from '@/ui/panels/assetTabs/shared';

/** Built-in garment templates: a glyph, then the measurements and the two build actions. */
export function PatternAssets() {
  return (
    <Section title="内置版型">
      {GARMENT_TEMPLATES.map(template => (
        <TemplateRow key={template.key} template={template} />
      ))}
    </Section>
  );
}

/** Keeps a typed measurement inside its template range. */
function clampField(value: number, field: ParamField, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, field.min), field.max);
}

function TemplateRow({ template }: { template: GarmentTemplate }) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<Record<string, number>>({ ...template.defaults });
  const executeCommand = useProjectStore(s => s.executeCommand);
  const toggle = () => setOpen(value => !value);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        style={{ ...styles.row, ...styles.rowPickable }}
        title={`${template.summary} · 展开调整尺寸`}
        onClick={toggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <span style={styles.glyph}>
          <Icon name={template.icon} size={22} style={{ color: '#c3c9d4' }} />
        </span>
        <span style={styles.text}>
          <span style={styles.name}>{template.name}</span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={10} style={{ color: '#666' }} />
      </div>

      {open && (
        <div style={styles.body}>
          {template.fields.map(field => (
            <label key={field.key} style={styles.fieldRow}>
              <span style={styles.fieldLabel}>{field.label}</span>
              <input
                type="number"
                style={styles.field}
                min={field.min}
                max={field.max}
                step={field.step}
                value={params[field.key] ?? template.defaults[field.key]}
                onChange={e => setParams(current => ({
                  ...current,
                  [field.key]: clampField(Number(e.target.value), field, template.defaults[field.key]),
                }))}
              />
              <span style={styles.fieldLabel}>{field.unit}</span>
            </label>
          ))}
          <div style={styles.fieldRow}>
            <button
              style={styles.iconBtn}
              title="清空当前版型，再按模板重新生成"
              onClick={() => executeCommand(new ApplyTemplateCommand(template, params))}
            >替换</button>
            <button
              style={styles.iconBtn}
              title="保留已有版片，把模板的片排在右侧"
              onClick={() => executeCommand(new AppendTemplateCommand(template, params))}
            >追加</button>
          </div>
        </div>
      )}
    </>
  );
}
