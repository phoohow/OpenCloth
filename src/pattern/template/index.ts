import type { GarmentTemplate } from '@/pattern/template/garmentTemplate';
import { tShirtTemplate } from '@/pattern/template/tShirtTemplate';
import { shirtTemplate } from '@/pattern/template/shirtTemplate';
import { hoodieTemplate } from '@/pattern/template/hoodieTemplate';
import { skirtTemplate } from '@/pattern/template/skirtTemplate';
import { dressTemplate } from '@/pattern/template/dressTemplate';

/** Built-in patterns offered by the template tab. */
export const GARMENT_TEMPLATES: GarmentTemplate[] = [
  tShirtTemplate,
  shirtTemplate,
  hoodieTemplate,
  skirtTemplate,
  dressTemplate,
];

export { generateTShirt, DEFAULT_TSHIRT_PARAMS, tShirtTemplate } from '@/pattern/template/tShirtTemplate';
export { generateShirt, DEFAULT_SHIRT_PARAMS, shirtTemplate } from '@/pattern/template/shirtTemplate';
export { generateHoodie, DEFAULT_HOODIE_PARAMS, hoodieTemplate } from '@/pattern/template/hoodieTemplate';
export { generateSkirt, DEFAULT_SKIRT_PARAMS, skirtTemplate } from '@/pattern/template/skirtTemplate';
export { generateDress, DEFAULT_DRESS_PARAMS, dressTemplate } from '@/pattern/template/dressTemplate';
export { createStarterProject, createBlankProject } from '@/pattern/template/starterProject';
export { PatternBuilder } from '@/pattern/template/templateKit';
export { layoutRows, appendPattern, offsetPanel } from '@/pattern/template/patternLayout';
export { type GarmentTemplate, type ParamField } from '@/pattern/template/garmentTemplate';
export {
  AppendTemplateCommand, ApplyTemplateCommand, ArrangePanelsCommand,
} from '@/pattern/template/templateCommands';
