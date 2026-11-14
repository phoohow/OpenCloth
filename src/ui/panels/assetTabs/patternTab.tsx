import { useState } from 'react';
import { useProjectStore, useUIStore } from '@/store';
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
        {/* The two build actions sit on the row itself, so they act without opening the sizes. */}
        <button
          style={styles.glyphBtn}
          title={`替换：清空当前版型，按「${template.name}」重新生成`}
          aria-label={`替换为${template.name}`}
          onClick={e => {
            e.stopPropagation();
            executeCommand(new ApplyTemplateCommand(template, params));
            // A new sheet is a different size, so frame all of it in the 2D pane.
            useUIStore.getState().requestFit();
          }}
        ><Icon name="refresh" size={11} /></button>
        <button
          style={styles.glyphBtn}
          title={`添加：保留已有版片，把「${template.name}」的片排在右侧`}
          aria-label={`添加${template.name}`}
          onClick={e => {
            e.stopPropagation();
            executeCommand(new AppendTemplateCommand(template, params));
            useUIStore.getState().requestFit();
          }}
        ><Icon name="plus" size={11} /></button>
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
        </div>
      )}
    </>
  );
}
