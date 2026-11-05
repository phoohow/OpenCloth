import type { EdgeSemantic, Panel, Pattern } from '../../core/model/types';
import { PatternBuilder } from './templateKit';
import { layoutRows } from './patternLayout';
import { cm, defineTemplate } from './garmentTemplate';

/** Finished size, base depth and handle dimensions of a tote bag. */
export interface ToteParams {
  widthCm: number;
  heightCm: number;
  /** Bottom gusset depth; 0 collapses the bottom panel. */
  depthCm: number;
  handleLengthCm: number;
  handleWidthCm: number;
}

export const DEFAULT_TOTE_PARAMS: ToteParams = {
  widthCm: 38,
  heightCm: 42,
  depthCm: 10,
  handleLengthCm: 60,
  handleWidthCm: 4,
};

interface BoxEdges {
  panel: Panel;
  bottom: string;
  right: string;
  top: string;
  left: string;
}

/** One rectangular piece with its four outline edges named in traversal order. */
function addBox(
  builder: PatternBuilder,
  name: string,
  width: number,
  height: number,
  sideSemantic: EdgeSemantic,
  seamAllowanceCm: number,
): BoxEdges {
  const bottomLeft = builder.point(0, 0);
  const bottomRight = builder.point(width, 0);
  const topRight = builder.point(width, height);
  const topLeft = builder.point(0, height);
  const bottom = builder.line(bottomLeft, bottomRight, 'free');
  const right = builder.line(bottomRight, topRight, sideSemantic);
  const top = builder.line(topRight, topLeft, 'free');
  const left = builder.line(topLeft, bottomLeft, sideSemantic);
  const panel = builder.panel({ name, edges: [bottom, right, top, left], seamAllowanceCm });
  return { panel, bottom, right, top, left };
}

/** Adds the four pieces of a flat tote; the depth panel sits between the two body panels. */
export function generateTote(params: ToteParams = DEFAULT_TOTE_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const depth = Math.max(0.5, params.depthCm);
  const front = addBox(builder, '前片', params.widthCm, params.heightCm, 'sideSeam', 1);
  const back = addBox(builder, '后片', params.widthCm, params.heightCm, 'sideSeam', 1);
  const bottom = addBox(builder, '底片', params.widthCm, depth, 'sideSeam', 1);
  const handleA = addBox(builder, '提手 1', params.handleWidthCm, params.handleLengthCm, 'free', 0.6);
  const handleB = addBox(builder, '提手 2', params.handleWidthCm, params.handleLengthCm, 'free', 0.6);

  // The bottom panel joins both body panels along the base; sides close front to back.
  builder.seam(front.bottom, bottom.top, { flipB: true });
  builder.seam(back.bottom, bottom.bottom, { flipB: true });
  builder.seam(front.right, back.right, { flipB: true });
  builder.seam(front.left, back.left, { flipB: true });

  layoutRows(builder.pattern, [
    [front.panel, back.panel],
    [bottom.panel],
    [handleA.panel, handleB.panel],
  ]);
  return builder.pattern;
}

export const toteTemplate = defineTemplate({
  key: 'tote',
  name: '托特包',
  icon: 'bag',
  summary: '前后袋身 + 底板 + 两条提手',
  fields: [
    cm('widthCm', '袋宽', 20, 60),
    cm('heightCm', '袋高', 20, 60),
    cm('depthCm', '底宽', 0.5, 25),
    cm('handleLengthCm', '提手长', 20, 120),
    cm('handleWidthCm', '提手宽', 2, 10),
  ],
  defaults: DEFAULT_TOTE_PARAMS,
}, generateTote);
