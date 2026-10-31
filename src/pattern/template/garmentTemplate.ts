import type { Pattern } from '../../core/model/types';

/** Glyph key of a template card; the UI resolves it to an icon. */
export type TemplateIcon = 't-shirt' | 'shirt' | 'dress' | 'skirt' | 'sleeve';

/** One numeric garment measurement shown in the template picker. */
export interface ParamField {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

/** A ready-made garment pattern the user can apply and then edit. */
export interface GarmentTemplate {
  key: string;
  name: string;
  icon: TemplateIcon;
  /** Panel composition shown under the template name. */
  summary: string;
  fields: ParamField[];
  /** Default measurements, keyed by field key. */
  defaults: Record<string, number>;
  generate(params: Record<string, number>, fabricId: string): Pattern;
}

/** Turns a typed generator and its default measurements into a UI-listed template. */
export function defineTemplate<P extends object>(
  meta: { key: string; name: string; icon: TemplateIcon; summary: string; fields: ParamField[]; defaults: P },
  generate: (params: P, fabricId: string) => Pattern,
): GarmentTemplate {
  return {
    ...meta,
    defaults: { ...meta.defaults } as Record<string, number>,
    generate: (params, fabricId) => generate(params as never, fabricId),
  };
}

/** Declares a template's measurement fields in one expression. */
export function cm(key: string, label: string, min: number, max: number, step = 1): ParamField {
  return { key, label, unit: 'cm', min, max, step };
}

/** Declares a whole-count template field. */
export function count(key: string, label: string, min: number, max: number, step = 1): ParamField {
  return { key, label, unit: '片', min, max, step };
}
