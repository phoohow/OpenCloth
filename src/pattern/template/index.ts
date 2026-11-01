import type { GarmentTemplate } from './garmentTemplate';
import { tShirtTemplate } from './tShirtTemplate';
import { shirtTemplate } from './shirtTemplate';
import { skirtTemplate } from './skirtTemplate';
import { dressTemplate } from './dressTemplate';
import { sleeveTemplate } from './sleeveTemplate';

/** Built-in patterns offered by the template tab. */
export const GARMENT_TEMPLATES: GarmentTemplate[] = [
  tShirtTemplate,
  shirtTemplate,
  skirtTemplate,
  dressTemplate,
  sleeveTemplate,
];

export { generateTShirt, DEFAULT_TSHIRT_PARAMS, tShirtTemplate } from './tShirtTemplate';
export { generateShirt, DEFAULT_SHIRT_PARAMS, shirtTemplate } from './shirtTemplate';
export { generateSkirt, DEFAULT_SKIRT_PARAMS, skirtTemplate } from './skirtTemplate';
export { generateDress, DEFAULT_DRESS_PARAMS, dressTemplate } from './dressTemplate';
export { generateSleeves, DEFAULT_SLEEVE_PARAMS, sleeveTemplate } from './sleeveTemplate';
export { createStarterProject, createBlankProject } from './starterProject';
export { PatternBuilder } from './templateKit';
export { layoutRows, appendPattern, offsetPanel } from './patternLayout';
export { type GarmentTemplate, type ParamField } from './garmentTemplate';
