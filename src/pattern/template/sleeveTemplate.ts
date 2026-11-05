import type { Pattern } from '@/model/types';
import { addSleeve } from '@/pattern/template/panelShapes';
import { PatternBuilder } from '@/pattern/template/templateKit';
import { layoutRows } from '@/pattern/template/patternLayout';
import { cm, defineTemplate } from '@/pattern/template/garmentTemplate';

/** Measurements of a one-piece sleeve, in centimeters. */
export interface SleeveParams {
  /** Sleeve length from the cap base to the cuff. */
  lengthCm: number;
  capHeightCm: number;
  /** Bicep circumference. */
  armCm: number;
  cuffCm: number;
}

export const DEFAULT_SLEEVE_PARAMS: SleeveParams = {
  lengthCm: 55,
  capHeightCm: 16,
  armCm: 32,
  cuffCm: 24,
};

/** Builds a matching pair of one-piece sleeves, ready to append to a bodice pattern. */
export function generateSleeves(params: SleeveParams = DEFAULT_SLEEVE_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const widthCm = params.armCm / 2 + 2;
  const cuffWidthCm = Math.max(params.cuffCm / 2, 6);

  const sleeveL = addSleeve(builder, {
    name: '左袖',
    widthCm,
    lengthCm: params.lengthCm,
    capHeightCm: params.capHeightCm,
    cuffCm: cuffWidthCm,
    side: 'left',
  });

  const sleeveR = addSleeve(builder, {
    name: '右袖',
    widthCm,
    lengthCm: params.lengthCm,
    capHeightCm: params.capHeightCm,
    cuffCm: cuffWidthCm,
    side: 'right',
  });

  builder.seam(sleeveL.seamRight, sleeveL.seamLeft, { flipB: true });
  builder.seam(sleeveR.seamRight, sleeveR.seamLeft, { flipB: true });

  layoutRows(builder.pattern, [[sleeveL.panel, sleeveR.panel]]);
  return builder.pattern;
}

export const sleeveTemplate = defineTemplate({
  key: 'sleeve',
  name: '袖子',
  icon: 'sleeve',
  summary: '左右一片袖 · 可追加',
  fields: [
    cm('lengthCm', '袖长', 15, 65),
    cm('capHeightCm', '袖山高', 6, 22),
    cm('armCm', '上臂围', 22, 48),
    cm('cuffCm', '袖口围', 16, 36),
  ],
  defaults: DEFAULT_SLEEVE_PARAMS,
}, generateSleeves);
