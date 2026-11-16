import type { Pattern } from '@/model/types';

/** A ready-made garment pattern read from a file, which the user can apply and then edit. */
export interface GarmentTemplate {
  key: string;
  name: string;
  /** Panel composition shown under the template name. */
  summary: string;
  /** Fingerprint of the pattern content, so a rewritten file is drawn again instead of cached. */
  revision: string;
  /** Measurements the geometry was drafted from; informational only. */
  params?: Record<string, number>;
  /** Bundled files and imported files are grouped separately in the template tab. */
  source: 'file' | 'user';
  /** Id of the stored user asset, used to remove the template from the library. */
  assetId?: string;
  /** Builds a fresh pattern instance bound to the project's fabric. */
  generate(fabricId: string): Pattern;
}
