import { useEffect, useSyncExternalStore } from 'react';
import {
  getTemplates, hydrateTemplates, removeUserTemplate, subscribeTemplates,
  useProjectStore, useUIStore,
} from '@/store';
import { AppendTemplateCommand, ApplyTemplateCommand } from '@/pattern/template';
import type { GarmentTemplate } from '@/pattern/template';
import { useAssetPreview } from '@/ui/assets/assetPreviews';
import { Icon } from '@/ui/icons';
import {
  importTemplatesViaPicker, saveCurrentPatternAsTemplate,
} from '@/ui/patternTemplateIo';
import { Section, notify, styles } from '@/ui/panels/assetTabs/shared';

/** Templates read from the default folder and templates imported by the user. */
export function PatternAssets() {
  const templates = useSyncExternalStore(subscribeTemplates, getTemplates);
  useEffect(() => { void hydrateTemplates(); }, []);

  const bundled = templates.filter(template => template.source !== 'user');
  const saved = templates.filter(template => template.source === 'user');

  const remove = (template: GarmentTemplate) => {
    if (!template.assetId) return;
    void removeUserTemplate(template.assetId)
      .then(() => notify(`已移除「${template.name}」`))
      .catch(() => notify('移除失败：本机存储不可用'));
  };

  return (
    <>
      <Section title={`版型库（${bundled.length}）`}>
        {bundled.map(template => <TemplateRow key={template.key} template={template} />)}
      </Section>
      <Section
        title={`我的版型（${saved.length}）`}
        action={
          <button
            style={styles.iconBtn}
            title="导入 .ocpat 版型文件"
            onClick={() => void importTemplatesViaPicker()}
          >导入版型</button>
        }
      >
        {saved.length === 0
          ? <div style={styles.note}>还没有导入的版型；默认文件夹里的版型显示在上方</div>
          : saved.map(template => (
            <TemplateRow key={template.key} template={template} onDelete={() => remove(template)} />
          ))}
      </Section>
      <button
        style={{ ...styles.iconBtn, height: 24, alignSelf: 'stretch', justifyContent: 'center' }}
        title="把当前工程的版片导出成 .ocpat 模板文件"
        onClick={saveCurrentPatternAsTemplate}
      >另存当前版型</button>
    </>
  );
}

function TemplateRow({ template, onDelete }: { template: GarmentTemplate; onDelete?: () => void }) {
  const executeCommand = useProjectStore(s => s.executeCommand);
  // The icon is a still of the garment itself, simulated and drawn by the render layer.
  const preview = useAssetPreview('pattern', template.key, template.revision);

  return (
    <div
      style={styles.row}
      title={template.summary}
    >
      <span style={styles.glyph}>
        {preview
          ? <img src={preview} alt="" draggable={false} style={styles.thumbnail} />
          : <Icon name="panel" size={16} style={{ color: '#6c7484' }} />}
      </span>
      <span style={styles.text}>
        <span style={styles.name}>{template.name}</span>
      </span>
      <button
        style={styles.glyphBtn}
        title={`替换：清空当前版型，按「${template.name}」重新生成`}
        aria-label={`替换为${template.name}`}
        onClick={() => {
          executeCommand(new ApplyTemplateCommand(template));
          // A new sheet is a different size, so frame all of it in the 2D pane.
          useUIStore.getState().requestFit();
        }}
      ><Icon name="refresh" size={11} /></button>
      <button
        style={styles.glyphBtn}
        title={`添加：保留已有版片，把「${template.name}」的片排在右侧`}
        aria-label={`添加${template.name}`}
        onClick={() => {
          executeCommand(new AppendTemplateCommand(template));
          useUIStore.getState().requestFit();
        }}
      ><Icon name="plus" size={11} /></button>
      {onDelete && (
        <button
          style={styles.deleteBtn}
          title="移除导入的版型"
          aria-label={`移除${template.name}`}
          onClick={onDelete}
        ><Icon name="close" size={9} /></button>
      )}
    </div>
  );
}
