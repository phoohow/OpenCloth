import type { Pattern } from '@/model/types';
import type { GarmentTemplate } from '@/pattern/template/garmentTemplate';
import {
  instantiatePattern, parsePatternFile, patternFileToTemplate, type PatternFile,
} from '@/pattern/template/patternFile';
import tshirtText from '/assets/patterns/tshirt.ocpat?raw';
import shirtText from '/assets/patterns/shirt.ocpat?raw';
import hoodieText from '/assets/patterns/hoodie.ocpat?raw';
import skirtText from '/assets/patterns/skirt.ocpat?raw';
import dressText from '/assets/patterns/dress.ocpat?raw';

/** Keys of the templates shipped in `assets/patterns/`, in the order the catalogue shows them. */
export const PRESET_KEYS = ['tshirt', 'shirt', 'hoodie', 'skirt', 'dress'] as const;

/** Parsed documents of the shipped files, validated once at module load. */
const FILES: Record<string, PatternFile> = Object.fromEntries(
  Object.entries({
    tshirt: tshirtText, shirt: shirtText, hoodie: hoodieText, skirt: skirtText, dress: dressText,
  }).map(([key, text]) => [key, parsePatternFile(text).file]),
);

/** Built-in patterns offered by the template tab, all read from files. */
export const GARMENT_TEMPLATES: GarmentTemplate[] = PRESET_KEYS.map(key =>
  patternFileToTemplate(FILES[key]!, 'file'),
);

/** Drafting measurements recorded in each file. */
export const PRESET_PARAMS: Record<string, Record<string, number>> = Object.fromEntries(
  Object.entries(FILES).map(([key, file]) => [key, file.params ?? {}]),
);

/** Builds a fresh pattern instance from one bundled file. */
export function presetPattern(key: string, fabricId = 'fabric_default'): Pattern {
  const file = FILES[key];
  if (!file) throw new Error(`未知的版型文件：${key}`);
  return instantiatePattern(file.pattern, fabricId);
}
