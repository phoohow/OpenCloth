import type { GarmentTemplate } from '@/pattern';
import type { AssetItem } from '@/ui/assets/assetItem';

import { AppendTemplateCommand, ApplyTemplateCommand } from '@/commands';
import {
  getTemplates, hydrateTemplates, removeUserTemplate, subscribeTemplates, useProjectStore,
  useUIStore,
} from '@/store';
import { useAssetPreview } from '@/ui/assets/assetPreviews';
import { ASSET_MESSAGES } from '@/ui/assets/messages';
import { AssetRow, HeaderButton, Section } from '@/ui/panels/assetTabs/shared';
import { importTemplatesViaPicker, saveCurrentPatternAsTemplate } from '@/ui/patternTemplateIo';
import { askConfirm } from '@/ui/widgets/askDialog';
import { notify } from '@/ui/widgets/toast';
import { useEffect, useSyncExternalStore } from 'react';

export function PatternAssets() {
  const templates = useSyncExternalStore(subscribeTemplates, getTemplates);
  useEffect(() => { void hydrateTemplates(); }, []);

  const bundled = templates.filter(template => template.source !== 'user');
  const saved = templates.filter(template => template.source === 'user');
  const activeKey = useProjectStore(s => s.project.pattern.templateKey);
  const importTemplates = () => void importTemplatesViaPicker();

  const remove = async (template: GarmentTemplate) => {
    if (!template.assetId) return;
    const ok = await askConfirm({
      title: `移除「${template.name}」？`,
      detail: '移除只影响素材库，已经应用到工程里的版片不受影响。',
      confirmLabel: '移除',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeUserTemplate(template.assetId);
      notify(`已移除「${template.name}」`);
    } catch {
      notify(ASSET_MESSAGES.removeFailed(template.name));
    }
  };

  return (
    <>
      <Section title="内置" count={bundled.length}>
        {bundled.map(template => (
          <TemplateRow key={template.key} template={template} active={template.key === activeKey} />
        ))}
      </Section>
      <Section
        title="我的"
        count={saved.length}
        action={(
          <>
            <HeaderButton label="导入" title="导入 .ocpat 文件" onClick={importTemplates} />
            <HeaderButton label="另存" title="把当前版型保存为模板" onClick={() => void saveCurrentPatternAsTemplate()} />
          </>
        )}
        empty={{ text: '还没有导入的版型' }}
      >
        {saved.map(template => (
          <TemplateRow
            key={template.key}
            template={template}
            active={template.key === activeKey}
            onDelete={() => void remove(template)}
          />
        ))}
      </Section>
    </>
  );
}

function TemplateRow({ template, active, onDelete }: {
  template: GarmentTemplate;
  active: boolean;
  onDelete?: () => void;
}) {
  const executeCommand = useProjectStore(s => s.executeCommand);
  const preview = useAssetPreview('pattern', template.key, template.revision);
  const refit = () => useUIStore.getState().requestFit();

  const item: AssetItem = {
    id: template.key,
    name: template.name,
    title: active ? '当前版型' : template.summary,
    thumb: preview ? { kind: 'image', src: preview } : { kind: 'icon', name: 'panel' },
    ...(active ? { status: 'active' as const, statusLabel: '当前版型' } : {}),
    actions: [
      ...(active ? [] : [{
        id: 'apply',
        label: `替换为「${template.name}」`,
        kind: 'primary' as const,
        button: false,
        run: () => { executeCommand(new ApplyTemplateCommand(template)); refit(); },
      }]),
      {
        id: 'append',
        label: `追加「${template.name}」`,
        icon: 'plus' as const,
        kind: 'secondary',
        run: () => { executeCommand(new AppendTemplateCommand(template)); refit(); },
      },
      ...(onDelete ? [{ id: 'remove', label: `移除「${template.name}」`, kind: 'danger' as const, run: onDelete }] : []),
    ],
  };

  return <AssetRow item={item} />;
}
