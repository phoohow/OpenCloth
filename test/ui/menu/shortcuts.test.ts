import { describe, expect, it } from 'vitest';
import { SHORTCUTS, comboOf, comboOfEvent, matchShortcut, shortcutsByScope } from '../../../src/ui/menu/shortcuts';

const ev = (over: Partial<KeyboardEvent> & { key: string }) => ({
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over,
} as KeyboardEvent);

describe('comboOfEvent', () => {
  it('normalises letters, digits and punctuation', () => {
    expect(comboOfEvent(ev({ key: 'z' }))).toBe('z');
    expect(comboOfEvent(ev({ key: 'Z', shiftKey: true }))).toBe('Shift+z');
    expect(comboOfEvent(ev({ key: '1' }))).toBe('1');
    expect(comboOfEvent(ev({ key: '.' }))).toBe('.');
  });

  it('names the space bar, function keys and navigation keys', () => {
    expect(comboOfEvent(ev({ key: ' ' }))).toBe('Space');
    expect(comboOfEvent(ev({ key: 'F1' }))).toBe('F1');
    expect(comboOfEvent(ev({ key: 'Delete' }))).toBe('Delete');
    expect(comboOfEvent(ev({ key: 'Escape' }))).toBe('Esc');
    expect(comboOfEvent(ev({ key: 'Tab' }))).toBe('Tab');
  });

  it('separates keypad digits from the top row', () => {
    expect(comboOfEvent(ev({ key: '2', code: 'Numpad2' }))).toBe('Num2');
    expect(comboOfEvent(ev({ key: '2', code: 'Digit2' }))).toBe('2');
    expect(comboOfEvent(ev({ key: '0', code: 'Numpad0' }))).toBe('Num0');
    expect(comboOfEvent(ev({ key: '5', code: 'Numpad5', shiftKey: true }))).toBe('Shift+Num5');
  });

  it('treats the meta key as Ctrl', () => {
    expect(comboOfEvent(ev({ key: 's', metaKey: true }))).toBe('Ctrl+s');
    expect(comboOfEvent(ev({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+z');
    expect(comboOfEvent(ev({ key: 'f', altKey: true }))).toBe('Alt+f');
  });

  it('ignores a bare modifier press', () => {
    expect(comboOfEvent(ev({ key: 'Shift' }))).toBeNull();
    expect(comboOfEvent(ev({ key: 'Control', ctrlKey: true }))).toBeNull();
  });
});

describe('matchShortcut', () => {
  it('finds a binding by its displayed combo', () => {
    expect(matchShortcut(ev({ key: 'S', ctrlKey: true }))).toBe('saveProject');
    expect(matchShortcut(ev({ key: '1' }))).toBe('layout3d');
    expect(matchShortcut(ev({ key: '4' }))).toBe('layout2d3d');
    expect(matchShortcut(ev({ key: 'F1' }))).toBe('shortcuts');
  });

  it('routes keypad digits to the view presets', () => {
    expect(matchShortcut(ev({ key: '2', code: 'Numpad2' }))).toBe('cameraFront');
    expect(matchShortcut(ev({ key: '8', code: 'Numpad8' }))).toBe('cameraBack');
    expect(matchShortcut(ev({ key: '4', code: 'Numpad4' }))).toBe('cameraLeft');
    expect(matchShortcut(ev({ key: '6', code: 'Numpad6' }))).toBe('cameraRight');
    expect(matchShortcut(ev({ key: '5', code: 'Numpad5' }))).toBe('cameraTop');
    expect(matchShortcut(ev({ key: '0', code: 'Numpad0' }))).toBe('cameraBottom');
    expect(matchShortcut(ev({ key: '1', code: 'Numpad1' }))).toBe('cameraFrontLeft');
    expect(matchShortcut(ev({ key: '9', code: 'Numpad9' }))).toBe('cameraBackRight');
    // The same digits on the top row keep changing the layout.
    expect(matchShortcut(ev({ key: '2', code: 'Digit2' }))).toBe('layout2d');
  });

  it('accepts a hidden alias', () => {
    expect(matchShortcut(ev({ key: 'y', ctrlKey: true }))).toBe('redo');
    expect(matchShortcut(ev({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('redo');
  });

  it('returns null for an unbound key', () => {
    expect(matchShortcut(ev({ key: 'q' }))).toBeNull();
    expect(matchShortcut(ev({ key: 'k', ctrlKey: true }))).toBeNull();
  });
});

describe('SHORTCUTS', () => {
  it('has unique ids and displayed combos', () => {
    expect(new Set(SHORTCUTS.map(s => s.id)).size).toBe(SHORTCUTS.length);
    const combos = SHORTCUTS.flatMap(s => [s.combo, ...(s.aliases ?? [])]);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('exposes the combo shown in a menu row', () => {
    expect(comboOf('undo')).toBe('Ctrl+Z');
    expect(comboOf('fitView')).toBe('F');
    expect(comboOf('nope')).toBeUndefined();
  });

  it('groups rows for the overview dialog', () => {
    expect(shortcutsByScope('3D 视口').map(s => s.id)).toContain('cameraTop');
    expect(shortcutsByScope('菜单栏')).toHaveLength(5);
    expect(shortcutsByScope('全局')).toHaveLength(SHORTCUTS.filter(s => s.scope === '全局').length);
  });

  it('keeps bare-key bindings unique across the panes', () => {
    const plain = SHORTCUTS.filter(s => !s.combo.includes('+') && s.combo.length === 1);
    const keys = plain.map(s => s.combo.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['1', '2', '3', '4', 'f', '.', 'r']));
  });
});
