export const SHORTCUTS: ShortcutDef[] = [
  { id: 'newProject', label: '新建', combo: 'Ctrl+N', scope: '全局' },
  { id: 'openProject', label: '打开', combo: 'Ctrl+O', scope: '全局' },
  { id: 'saveProject', label: '保存', combo: 'Ctrl+S', scope: '全局' },
  { id: 'saveProjectAs', label: '另存为', combo: 'Ctrl+Shift+S', scope: '全局' },

  { id: 'undo', label: '撤销', combo: 'Ctrl+Z', scope: '全局' },
  { id: 'redo', label: '重做', combo: 'Ctrl+Shift+Z', aliases: ['Ctrl+Y'], scope: '全局' },
  { id: 'copyPanels', label: '复制版片', combo: 'Ctrl+C', scope: '全局' },
  { id: 'pastePanels', label: '粘贴版片', combo: 'Ctrl+V', scope: '全局' },
  { id: 'deleteSelection', label: '删除选中', combo: 'Delete', aliases: ['Backspace'], scope: '全局' },
  { id: 'selectAll', label: '全选版片', combo: 'Ctrl+A', scope: '全局' },
  { id: 'clearSelection', label: '取消选择', combo: 'Esc', scope: '全局' },

  { id: 'layout3d2d', label: '3D 在左', combo: '3', scope: '全局' },
  { id: 'layout2d3d', label: '2D 在左', combo: '4', scope: '全局' },
  { id: 'layout2d', label: '仅 2D', combo: '2', scope: '全局' },
  { id: 'layout3d', label: '仅 3D', combo: '1', scope: '全局' },
  { id: 'fitView', label: '适应视图', combo: 'F', scope: '2D 制版' },
  { id: 'toggleFocus', label: '切换焦点', combo: 'Tab', scope: '全局' },

  { id: 'dress', label: '自动着装', combo: 'Ctrl+D', scope: '全局' },

  { id: 'gizmoTranslate', label: '平移手柄', combo: 'W', scope: '3D 视口' },
  { id: 'gizmoRotate', label: '旋转手柄', combo: 'E', scope: '3D 视口' },
  { id: 'playPause', label: '播放/暂停（当前通道）', combo: 'Space', scope: '3D 视口' },
  { id: 'stepFrame', label: '单步（当前通道）', combo: '.', scope: '3D 视口' },
  { id: 'resetSim', label: '重置（当前通道）', combo: 'R', scope: '3D 视口' },
  { id: 'cameraFront', label: '正视', combo: 'Num2', scope: '3D 视口' },
  { id: 'cameraBack', label: '后视', combo: 'Num8', scope: '3D 视口' },
  { id: 'cameraLeft', label: '左视', combo: 'Num4', scope: '3D 视口' },
  { id: 'cameraRight', label: '右视', combo: 'Num6', scope: '3D 视口' },
  { id: 'cameraBottom', label: '仰视', combo: 'Num0', scope: '3D 视口' },
  { id: 'cameraTop', label: '俯视', combo: 'Num5', scope: '3D 视口' },
  { id: 'cameraFrontLeft', label: '前左', combo: 'Num1', scope: '3D 视口' },
  { id: 'cameraFrontRight', label: '前右', combo: 'Num3', scope: '3D 视口' },
  { id: 'cameraBackLeft', label: '后左', combo: 'Num7', scope: '3D 视口' },
  { id: 'cameraBackRight', label: '后右', combo: 'Num9', scope: '3D 视口' },

  { id: 'shortcuts', label: '快捷键', combo: 'F1', scope: '全局' },
  { id: 'debug3d', label: '3D 截帧', combo: 'F9', scope: '全局' },
  { id: 'perfPanel', label: '性能面板', combo: 'F10', scope: '全局' },
  { id: 'menuFile', label: '文件菜单', combo: 'Alt+F', scope: '菜单栏' },
  { id: 'menuEdit', label: '编辑菜单', combo: 'Alt+E', scope: '菜单栏' },
  { id: 'menuPattern', label: '版型菜单', combo: 'Alt+P', scope: '菜单栏' },
  { id: 'menuTryOn', label: '试衣菜单', combo: 'Alt+T', scope: '菜单栏' },
  { id: 'menuView', label: '视图菜单', combo: 'Alt+V', scope: '菜单栏' },
  { id: 'menuWindow', label: '窗口菜单', combo: 'Alt+W', scope: '菜单栏' },
  { id: 'menuCollab', label: '协作菜单', combo: 'Alt+C', scope: '菜单栏' },
  { id: 'menuProduction', label: '生产菜单', combo: 'Alt+M', scope: '菜单栏' },
  { id: 'menuHelp', label: '帮助菜单', combo: 'Alt+H', scope: '菜单栏' },
];

const MODIFIER_KEYS = ['Control', 'Meta', 'Alt', 'Shift'];

const NUMPAD_DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

export type ShortcutScope = '全局' | '3D 视口' | '2D 制版' | '菜单栏';

export interface ShortcutDef {
  id: string;
  label: string;
  combo: string;
  scope: ShortcutScope;
  aliases?: string[];
}

export function comboOf(id: string): string | undefined {
  return SHORTCUTS.find(s => s.id === id)?.combo;
}

export function shortcutsByScope(scope: ShortcutScope): ShortcutDef[] {
  return SHORTCUTS.filter(s => s.scope === scope);
}

export function comboOfEvent(ev: KeyboardEvent | {
  ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; key: string; code?: string;
}): string | null {
  if (MODIFIER_KEYS.includes(ev.key)) return null;
  const parts: string[] = [];
  if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  parts.push(normalizeKey(ev.key, ev.code));
  return parts.join('+');
}

function normalizeKey(key: string, code?: string): string {
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Esc';
  if (code?.startsWith('Numpad') && NUMPAD_DIGITS.has(key)) return `Num${key}`;
  if (key.length === 1) return key.toLowerCase();
  return key.length <= 2 ? key.toUpperCase() : key;
}

export function matchShortcut(ev: KeyboardEvent): string | null {
  const combo = comboOfEvent(ev);
  if (!combo) return null;
  const needle = combo.toLowerCase();
  const hit = SHORTCUTS.find(s => s.combo.toLowerCase() === needle || s.aliases?.some(a => a.toLowerCase() === needle));
  return hit?.id ?? null;
}
