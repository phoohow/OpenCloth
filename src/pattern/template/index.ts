import type { GarmentTemplate } from '@/pattern/template/garmentTemplate';
import { tShirtTemplate } from '@/pattern/template/tShirtTemplate';
import { shirtTemplate } from '@/pattern/template/shirtTemplate';
import { skirtTemplate } from '@/pattern/template/skirtTemplate';
import { dressTemplate } from '@/pattern/template/dressTemplate';
import { sleeveTemplate } from '@/pattern/template/sleeveTemplate';
import { toteTemplate } from '@/pattern/template/bagTemplate';
import { shoeTemplate } from '@/pattern/template/shoeTemplate';

/** Built-in patterns offered by the template tab. */
export const GARMENT_TEMPLATES: GarmentTemplate[] = [
  tShirtTemplate,
  shirtTemplate,
  skirtTemplate,
  dressTemplate,
  sleeveTemplate,
  toteTemplate,
  shoeTemplate,
];

export { generateTShirt, DEFAULT_TSHIRT_PARAMS, tShirtTemplate } from '@/pattern/template/tShirtTemplate';
export { generateShirt, DEFAULT_SHIRT_PARAMS, shirtTemplate } from '@/pattern/template/shirtTemplate';
export { generateSkirt, DEFAULT_SKIRT_PARAMS, skirtTemplate } from '@/pattern/template/skirtTemplate';
export { generateDress, DEFAULT_DRESS_PARAMS, dressTemplate } from '@/pattern/template/dressTemplate';
export { generateSleeves, DEFAULT_SLEEVE_PARAMS, sleeveTemplate } from '@/pattern/template/sleeveTemplate';
export { generateTote, DEFAULT_TOTE_PARAMS, toteTemplate } from '@/pattern/template/bagTemplate';
export { generateShoes, DEFAULT_SHOE_PARAMS, shoeTemplate } from '@/pattern/template/shoeTemplate';
export { createStarterProject, createBlankProject } from '@/pattern/template/starterProject';
export { PatternBuilder } from '@/pattern/template/templateKit';
export { layoutRows, appendPattern, offsetPanel } from '@/pattern/template/patternLayout';
export { type GarmentTemplate, type ParamField } from '@/pattern/template/garmentTemplate';
export { AppendTemplateCommand, ApplyTemplateCommand } from '@/pattern/template/templateCommands';
