/** Single source of truth for keyboard shortcuts: menu labels, the overview dialog and the global handler. */

/** Where a shortcut is active, listed in 快捷键总览. */
export type ShortcutScope = '全局' | '3D 视口' | '2D 制版' | '菜单栏';

/** One keyboard shortcut as data: overview rows and the global handler both read this. */
export interface ShortcutDef {
  /** Action id the global handler matches. */
  id: string;
  /** Action name shown in 快捷键总览. */
  label: string;
  /** Displayed combo and the one the handler matches; `Num2` is keypad digit 2. */
  combo: string;
  scope: ShortcutScope;
  /** Extra combos that trigger the same action but stay out of the overview. */
  aliases?: string[];
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'newProject', label: '新建工程', combo: 'Ctrl+N', scope: '全局' },
  { id: 'openProject', label: '打开工程', combo: 'Ctrl+O', scope: '全局' },
  { id: 'saveProject', label: '保存工程', combo: 'Ctrl+S', scope: '全局' },
  { id: 'saveProjectAs', label: '另存为', combo: 'Ctrl+Shift+S', scope: '全局' },

  { id: 'undo', label: '撤销', combo: 'Ctrl+Z', scope: '全局' },
  { id: 'redo', label: '重做', combo: 'Ctrl+Shift+Z', aliases: ['Ctrl+Y'], scope: '全局' },
  { id: 'copyPanels', label: '复制选中版片', combo: 'Ctrl+C', scope: '全局' },
  { id: 'pastePanels', label: '粘贴版片', combo: 'Ctrl+V', scope: '全局' },
  { id: 'deleteSelection', label: '删除选中', combo: 'Delete', aliases: ['Backspace'], scope: '全局' },
  { id: 'selectAll', label: '全选版片', combo: 'Ctrl+A', scope: '全局' },
  { id: 'clearSelection', label: '取消选择', combo: 'Esc', scope: '全局' },

  { id: 'layout3d2d', label: '3D 左 + 2D 右 分屏', combo: '3', scope: '全局' },
  { id: 'layout2d3d', label: '2D 左 + 3D 右 分屏', combo: '4', scope: '全局' },
  { id: 'layout2d', label: '仅 2D 制版', combo: '2', scope: '全局' },
  { id: 'layout3d', label: '仅 3D 视口', combo: '1', scope: '全局' },
  { id: 'fitView', label: '适应视图', combo: 'F', scope: '全局' },
  { id: 'toggleFocus', label: '在 3D 与 2D 之间切换焦点', combo: 'Tab', scope: '全局' },

  { id: 'drape', label: '自动着装', combo: 'Ctrl+D', scope: '全局' },

  { id: 'playPause', label: '播放 / 暂停', combo: 'Space', scope: '3D 视口' },
  { id: 'stepFrame', label: '单步', combo: '.', scope: '3D 视口' },
  { id: 'resetSim', label: '重置模拟', combo: 'R', scope: '3D 视口' },
  { id: 'cameraFront', label: '正视视角', combo: 'Num2', scope: '3D 视口' },
  { id: 'cameraBack', label: '后视视角', combo: 'Num8', scope: '3D 视口' },
  { id: 'cameraLeft', label: '左视视角', combo: 'Num4', scope: '3D 视口' },
  { id: 'cameraRight', label: '右视视角', combo: 'Num6', scope: '3D 视口' },
  { id: 'cameraBottom', label: '仰视视角', combo: 'Num0', scope: '3D 视口' },
  { id: 'cameraTop', label: '俯视视角', combo: 'Num5', scope: '3D 视口' },
  { id: 'cameraFrontLeft', label: '正左 45° 视角', combo: 'Num1', scope: '3D 视口' },
  { id: 'cameraFrontRight', label: '正右 45° 视角', combo: 'Num3', scope: '3D 视口' },
  { id: 'cameraBackLeft', label: '后左 45° 视角', combo: 'Num7', scope: '3D 视口' },
  { id: 'cameraBackRight', label: '后右 45° 视角', combo: 'Num9', scope: '3D 视口' },

  { id: 'shortcuts', label: '快捷键总览', combo: 'F1', scope: '全局' },
  { id: 'menuFile', label: '打开文件菜单', combo: 'Alt+F', scope: '菜单栏' },
  { id: 'menuEdit', label: '打开编辑菜单', combo: 'Alt+E', scope: '菜单栏' },
  { id: 'menuView', label: '打开视图菜单', combo: 'Alt+V', scope: '菜单栏' },
  { id: 'menuWindow', label: '打开窗口菜单', combo: 'Alt+W', scope: '菜单栏' },
  { id: 'menuHelp', label: '打开帮助菜单', combo: 'Alt+H', scope: '菜单栏' },
];

/** Combo shown next to a menu item. */
export function comboOf(id: string): string | undefined {
  return SHORTCUTS.find(s => s.id === id)?.combo;
}

/** Overview rows, grouped by the surface that receives the key. */
export function shortcutsByScope(scope: ShortcutScope): ShortcutDef[] {
  return SHORTCUTS.filter(s => s.scope === scope);
}

const MODIFIER_KEYS = ['Control', 'Meta', 'Alt', 'Shift'];
const NUMPAD_DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** Combo text for a key event, or null for a bare modifier press. */
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
  // Numpad digits report the same `key` as the top row; only `code` tells them apart.
  if (code?.startsWith('Numpad') && NUMPAD_DIGITS.has(key)) return `Num${key}`;
  if (key.length === 1) return key.toLowerCase();
  return key.length <= 2 ? key.toUpperCase() : key;
}

/** Shortcut id triggered by the event, or null when nothing is bound. */
export function matchShortcut(ev: KeyboardEvent): string | null {
  const combo = comboOfEvent(ev);
  if (!combo) return null;
  const needle = combo.toLowerCase();
  const hit = SHORTCUTS.find(s => s.combo.toLowerCase() === needle || s.aliases?.some(a => a.toLowerCase() === needle));
  return hit?.id ?? null;
}
