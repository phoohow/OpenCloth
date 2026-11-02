import type { Pattern } from '../../core/model/types';
import { addFlaredPanel } from './panelShapes';
import { PatternBuilder } from './templateKit';
import { bandArc } from './drapeArcs';
import { layoutRows } from './patternLayout';
import { cm, count, defineTemplate } from './garmentTemplate';

/** Waist, hem, length and panel count of a gore skirt. */
export interface SkirtParams {
  waistCm: number;
  /** Skirt length measured from the waist. */
  lengthCm: number;
  hemCm: number;
  /** Panels around the body. */
  panelCount: number;
}

export const DEFAULT_SKIRT_PARAMS: SkirtParams = {
  waistCm: 72,
  lengthCm: 55,
  hemCm: 132,
  panelCount: 6,
};

/**
 * Builds an A-line skirt: matching gores around the waist that close into a ring and flare
 * to the hem circumference. `panelCount` is rounded to an even number so halves stay symmetric.
 */
export function generateSkirt(params: SkirtParams = DEFAULT_SKIRT_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const perHalf = Math.max(1, Math.round(Math.max(2, params.panelCount) / 2));
  const panelWidthCm = Math.max(params.hemCm, params.waistCm) / (perHalf * 2);
  const waistWidthCm = params.waistCm / (perHalf * 2);

  const front = [];
  const back = [];
  for (let i = 0; i < perHalf; i++) {
    front.push(addFlaredPanel(builder, {
      name: `前裙片${i + 1}`,
      waistWidthCm,
      hemWidthCm: panelWidthCm,
      lengthCm: params.lengthCm,
      drape: { region: 'torso', anchor: 'waist', ...bandArc(i, perHalf) },
    }));
    back.push(addFlaredPanel(builder, {
      name: `后裙片${i + 1}`,
      waistWidthCm,
      hemWidthCm: panelWidthCm,
      lengthCm: params.lengthCm,
      drape: { region: 'torso', anchor: 'waist', ...bandArc(i, perHalf, true) },
    }));
  }

  // Side seams join neighbouring gores at the angle they share.
  for (let i = 0; i < perHalf - 1; i++) {
    builder.seam(front[i].sideRight, front[i + 1].sideLeft, { flipB: true });
    builder.seam(back[i].sideRight, back[i + 1].sideLeft, { flipB: true });
  }
  builder.seam(front[perHalf - 1].sideRight, back[perHalf - 1].sideRight);
  builder.seam(front[0].sideLeft, back[0].sideLeft);

  layoutRows(builder.pattern, [front.map(g => g.panel), back.map(g => g.panel)]);
  return builder.pattern;
}

export const skirtTemplate = defineTemplate({
  key: 'skirt',
  name: '裙子',
  icon: 'skirt',
  summary: '腰头环形裙片 · A 字摆',
  fields: [
    cm('waistCm', '腰围', 56, 120),
    cm('lengthCm', '裙长', 30, 120),
    cm('hemCm', '摆围', 60, 320),
    count('panelCount', '片数', 2, 12),
  ],
  defaults: DEFAULT_SKIRT_PARAMS,
}, generateSkirt);
