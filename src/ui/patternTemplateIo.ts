import { canChooseSaveFile, chooseSaveFile, type SaveFileType } from '@/base/platform';
import { stripExtension } from '@/base/string';
import { PATTERN_FILE_EXTENSION, encodePatternFile } from '@/io/codec';
import { importPatternFiles, useProjectStore } from '@/store';
import { openFilePicker } from '@/ui/modelImport';
import { askText } from '@/ui/widgets/askDialog';
import { notify } from '@/ui/widgets/toast';

const patternTypes: SaveFileType[] = [
  { description: 'OpenCloth 版型', accept: { 'application/json': [PATTERN_FILE_EXTENSION] } },
];

export async function importTemplatesViaPicker(): Promise<void> {
  const files = await openFilePicker(PATTERN_FILE_EXTENSION, true);
  if (!files || files.length === 0) return;

  const result = await importPatternFiles(files);
  const parts: string[] = [];
  if (result.added.length > 0) parts.push(`已导入 ${result.added.length} 个版型：${result.added.join('、')}`);
  if (result.errors.length > 0) parts.push(`${result.errors.length} 个失败：${result.errors[0]}`);
  if (result.warnings.length > 0) parts.push(result.warnings[0]!);
  notify(parts.join('；') || '没有导入任何版型');
}

export async function saveCurrentPatternAsTemplate(): Promise<void> {
  const project = useProjectStore.getState().project;
  if (Object.keys(project.pattern.panels).length === 0) {
    notify('当前工程没有版片，无法另存为版型');
    return;
  }

  const suggested = `${safeFileName(project.meta.name)} 版型`;
  try {
    const typed = canChooseSaveFile() ? suggested : await askText({ title: '版型名称', initial: suggested });
    if (!typed) return;
    const target = await chooseSaveFile(`${safeFileName(typed)}${PATTERN_FILE_EXTENSION}`, patternTypes);
    if (!target) return;

    const name = stripExtension(target.name) || typed;
    const text = encodePatternFile(project.pattern, { name });
    await target.write(new Blob([text], { type: 'application/json' }));
    notify(`已另存版型「${name}」，可放入默认文件夹或用「导入版型」添加`);
  } catch (error) {
    notify(`导出失败：${(error as Error).message}`);
  }
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'pattern';
}
