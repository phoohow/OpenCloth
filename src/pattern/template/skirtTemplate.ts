import type { Pattern } from '@/model/types';
import { addFlaredPanel, addSplitBand, type FlaredEdges } from '@/pattern/template/panelShapes';
import { PatternBuilder } from '@/pattern/template/templateKit';
import { backArc, bandArc, frontArc } from '@/pattern/template/drapeArcs';
import { layoutRows } from '@/pattern/template/patternLayout';
import { cm, count, defineTemplate } from '@/pattern/template/garmentTemplate';

/** Waist, hip, hem, length and panel count of a gore skirt. */
export interface SkirtParams {
  waistCm: number;
  /** Hip girth the skirt has to clear at the hip line. */
  hipCm: number;
  /** Skirt length measured from the waist. */
  lengthCm: number;
  hemCm: number;
  /** Panels around the body. */
  panelCount: number;
}

export const DEFAULT_SKIRT_PARAMS: SkirtParams = {
  waistCm: 70,
  hipCm: 98,
  lengthCm: 55,
  hemCm: 132,
  panelCount: 6,
};

/** Extra hip room the skirt is drafted with, so the gores clear the body's widest point. */
const HIP_EASE_CM = 4;

/** Height of the waistband that grips the body and carries the gores. */
const BAND_HEIGHT_CM = 4;

/**
 * Builds an A-line skirt: matching gores around the waist that close into a ring and flare
 * to the hem circumference. `panelCount` is rounded to an even number so halves stay symmetric.
 */
export function generateSkirt(params: SkirtParams = DEFAULT_SKIRT_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const perHalf = Math.max(1, Math.round(Math.max(2, params.panelCount) / 2));
  const panelCount = perHalf * 2;
  const panelWidthCm = Math.max(params.hemCm, params.waistCm) / panelCount;
  const waistWidthCm = params.waistCm / panelCount;
  // Each gore is widened at the hip line to the share of the hip girth it covers.
  const hipWidthCm = (params.hipCm + HIP_EASE_CM) / panelCount;

  const front: FlaredEdges[] = [];
  const back: FlaredEdges[] = [];
  for (let i = 0; i < perHalf; i++) {
    front.push(addFlaredPanel(builder, {
      name: `前裙片${i + 1}`,
      waistWidthCm,
      hemWidthCm: panelWidthCm,
      lengthCm: params.lengthCm,
      hipWidthCm,
      drape: { region: 'torso', anchor: 'waist', ...bandArc(i, perHalf) },
    }));
    back.push(addFlaredPanel(builder, {
      name: `后裙片${i + 1}`,
      waistWidthCm,
      hemWidthCm: panelWidthCm,
      lengthCm: params.lengthCm,
      hipWidthCm,
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

  // The waistband sits on the waist and its split bottom edge picks up every gore.
  const bandDrape = { region: 'torso' as const, anchor: 'waist' as const, anchorOffsetCm: BAND_HEIGHT_CM };
  const frontBand = addSplitBand(builder, {
    name: '前腰头',
    lengthCm: params.waistCm / 2,
    heightCm: BAND_HEIGHT_CM,
    segments: perHalf,
    drape: { ...bandDrape, ...frontArc(180) },
  });
  const backBand = addSplitBand(builder, {
    name: '后腰头',
    lengthCm: params.waistCm / 2,
    heightCm: BAND_HEIGHT_CM,
    segments: perHalf,
    drape: { ...bandDrape, ...backArc(180) },
  });
  frontBand.bottoms.forEach((edge, i) => builder.seam(edge, front[i].waist, { flipB: true, strength: 1 }));
  backBand.bottoms.forEach((edge, i) => builder.seam(edge, back[i].waist, { flipB: true, strength: 1 }));
  builder.seam(frontBand.endRight, backBand.endRight, { strength: 1 });
  builder.seam(frontBand.endLeft, backBand.endLeft, { strength: 1 });

  layoutRows(builder.pattern, [
    front.map(g => g.panel),
    back.map(g => g.panel),
    [frontBand.panel, backBand.panel],
  ]);
  return builder.pattern;
}

export const skirtTemplate = defineTemplate({
  key: 'skirt',
  name: '裙子',
  icon: 'skirt',
  summary: '腰头 · 环形裙片 · A 字摆',
  fields: [
    cm('waistCm', '腰围', 56, 120),
    cm('hipCm', '臀围', 60, 150),
    cm('lengthCm', '裙长', 30, 120),
    cm('hemCm', '摆围', 60, 320),
    count('panelCount', '片数', 2, 12),
  ],
  defaults: DEFAULT_SKIRT_PARAMS,
}, generateSkirt);
