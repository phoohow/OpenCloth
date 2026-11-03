/**
 * Pointer cursors for the 3D viewport. CSS has no clamp or pin glyph, so each one is an inline SVG
 * painted twice (black outline under a coloured stroke) to stay visible on light and dark cloth
 * alike.
 */

interface CursorDot {
  x: number;
  y: number;
  r: number;
  color: string;
}

interface CursorSpec {
  /** Stroke paths of the glyph, in a 32×32 box. */
  paths: string[];
  /** Filled dots of the glyph, drawn after the strokes. */
  dots?: CursorDot[];
  /** Stroke colour painted over the black outline. */
  color?: string;
  /** Outer stroke width; the coloured stroke is always a little over half of it. */
  stroke?: number;
  /** Glyph transform, for tilting or shrinking a shape drawn in its own local frame. */
  transform?: string;
  /** Glyph point that lands on the pointer, in px. */
  hotspot: [number, number];
}

const SIZE = 32;
const OUTLINE_WIDTH = 4.4;

function svgCursor(spec: CursorSpec): string {
  const width = spec.stroke ?? OUTLINE_WIDTH;
  const paint = (stroke: string, strokeWidth: number) => spec.paths
    .map(d => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"`
      + ' stroke-linecap="round" stroke-linejoin="round"/>')
    .join('');
  // Each dot keeps a black rim under its own colour so it survives a similar-coloured fabric.
  const dots = (spec.dots ?? [])
    .map(dot => `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r + 1.1}" fill="#000"/>`
      + `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" fill="${dot.color}"/>`)
    .join('');
  const art = paint('#000', width) + paint(spec.color ?? '#fff', width * 0.52) + dots;
  const glyph = spec.transform ? `<g transform="${spec.transform}">${art}</g>` : art;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"`
    + ` viewBox="0 0 ${SIZE} ${SIZE}">${glyph}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${spec.hotspot[0]} ${spec.hotspot[1]}, auto`;
}

/** One decimal is plenty for a 32 px cursor and keeps the data URL short. */
const round = (value: number): string => String(Math.round(value * 10) / 10);

interface Point {
  x: number;
  y: number;
}

/**
 * Clamp glyph built as two rigid levers: each is one straight segment from grip to jaw tip and
 * pivots about its own point on the coil, so open jaws come with grips drawn together.
 *
 *   grip   (±9, -19)      pivot (±1.2, -10)      jaw (±0.6, -1)
 */
const GRIP: Point = { x: 9, y: -19 };
const PIVOT: Point = { x: 1.2, y: -10 };
const JAW: Point = { x: 0.6, y: -1 };
const OPEN_DEG = 22;
/** Coil drawn between the levers; it is the spring they ride on, not a joint in either lever. */
const COIL_R = 3.2;

/** Rotates a point around a pivot; SVG angles run clockwise. */
function rotate(point: Point, pivot: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

/**
 * Two straight levers plus the coil. `open` swings each lever about its own pivot, which is the
 * only degree of freedom a real clamp has: nothing bends, one end goes out as the other comes in.
 */
const clampPaths = (open: boolean): string[] => {
  const lever = (side: 1 | -1) => {
    const pivot = { x: side * PIVOT.x, y: PIVOT.y };
    // Mirrored halves turn opposite ways; the sign is what keeps the glyph symmetric.
    const angle = open ? -side * OPEN_DEG : 0;
    const grip = rotate({ x: side * GRIP.x, y: GRIP.y }, pivot, angle);
    const tip = rotate({ x: side * JAW.x, y: JAW.y }, pivot, angle);
    return `M ${round(grip.x)} ${round(grip.y)} L ${round(tip.x)} ${round(tip.y)}`;
  };
  return [
    lever(-1),
    lever(1),
    `M ${-COIL_R} ${PIVOT.y} A ${COIL_R} ${COIL_R} 0 1 1 ${COIL_R} ${PIVOT.y}`
      + ` A ${COIL_R} ${COIL_R} 0 1 1 ${-COIL_R} ${PIVOT.y}`,
  ];
};

const clampGlyph = (open: boolean): string => svgCursor({
  hotspot: [19, 26],
  transform: 'translate(19,26) rotate(-25) scale(0.72)',
  // Thicker than the other glyphs because the transform shrinks it by 0.72.
  stroke: 6,
  paths: clampPaths(open),
});

/** Open clamp: the pointer is over cloth and a press would grab it. */
export const OPEN_CLAMP_CURSOR = clampGlyph(true);

/** Closed clamp: the cloth is being held and dragged. */
export const CLAMP_CURSOR = clampGlyph(false);

/** Ring with a red core: fix the point under the pointer. */
export const PIN_CURSOR = svgCursor({
  hotspot: [16, 16],
  paths: [
    'M 9.5 16 A 6.5 6.5 0 1 1 22.5 16 A 6.5 6.5 0 1 1 9.5 16',
  ],
  dots: [{ x: 16, y: 16, r: 2, color: '#ff3b3b' }],
});

/** Red cross: pull the fixed point under the pointer. */
export const UNPIN_CURSOR = svgCursor({
  hotspot: [16, 16],
  color: '#ff5a5a',
  paths: ['M 9 9 L 23 23', 'M 23 9 L 9 23'],
});
