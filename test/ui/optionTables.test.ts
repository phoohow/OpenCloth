import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS } from '../../src/ui/optionTables';
import { SHORTCUTS } from '../../src/ui/menu/shortcuts';

describe('CAMERA_PRESETS', () => {
  it('orders the six axis views before the four corners', () => {
    expect(CAMERA_PRESETS.map(p => p.value)).toEqual([
      'front', 'back', 'left', 'right', 'bottom', 'top',
      'frontLeft', 'frontRight', 'backLeft', 'backRight',
    ]);
  });

  it('labels each preset with the name the menus and toolbar show', () => {
    expect(CAMERA_PRESETS.map(p => p.label))
      .toEqual(['正视', '后视', '左视', '右视', '仰视', '俯视', '正左', '正右', '后左', '后右']);
  });

  it('binds every preset row to a keypad shortcut', () => {
    for (const preset of CAMERA_PRESETS) {
      expect(SHORTCUTS.find(s => s.id === preset.menuId)?.combo, preset.menuId).toMatch(/^Num\d$/);
    }
  });
});
