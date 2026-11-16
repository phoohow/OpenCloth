import { PATTERN_FILE_EXTENSION, encodePatternFile } from '@/pattern/template';
import { downloadTextFile } from '@/io/serialization';
import { importPatternFiles, useProjectStore } from '@/store';
import { openFilePicker } from '@/ui/modelImport';
import { notify } from '@/ui/panels/assetTabs/shared';

/** Opens a picker and adds every valid `.ocpat` to the template library. */
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

/** Exports the open pattern as a template file that can be dropped into the default folder. */
export function saveCurrentPatternAsTemplate(): void {
  const project = useProjectStore.getState().project;
  if (Object.keys(project.pattern.panels).length === 0) {
    notify('当前工程没有版片，无法另存为版型');
    return;
  }
  const name = window.prompt('版型名称', `${project.meta.name} 版型`);
  if (!name || !name.trim()) return;

  try {
    const text = encodePatternFile(project.pattern, { name: name.trim() });
    downloadTextFile(`${safeFileName(name.trim())}${PATTERN_FILE_EXTENSION}`, text);
    notify(`已导出「${name.trim()}」，可放入默认文件夹或用「导入版型」添加`);
  } catch (error) {
    notify(`导出版型失败：${(error as Error).message}`);
  }
}

/** Keeps a downloaded template name inside the characters a file path accepts. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'pattern';
}
