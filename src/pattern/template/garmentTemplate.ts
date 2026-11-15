import type { Pattern } from '@/model/types';

/** Glyph key of a template card; the UI resolves it to an icon. */
export type TemplateIcon = 't-shirt' | 'shirt' | 'hoodie' | 'dress' | 'skirt' | 'panel';

/** A ready-made garment pattern read from a file, which the user can apply and then edit. */
export interface GarmentTemplate {
  key: string;
  name: string;
  icon: TemplateIcon;
  /** Panel composition shown under the template name. */
  summary: string;
  /** Measurements the geometry was drafted from; informational only. */
  params?: Record<string, number>;
  /** Bundled files and imported files are grouped separately in the template tab. */
  source: 'file' | 'user';
  /** Id of the stored user asset, used to remove the template from the library. */
  assetId?: string;
  /** Builds a fresh pattern instance bound to the project's fabric. */
  generate(fabricId: string): Pattern;
}
