import { degToRad, rotateAround2, type Vec2 } from '@/base/math';

const SIZE = 32;

const OUTLINE_WIDTH = 4.4;

const GRIP: Vec2 = { x: 9, y: -19 };

const PIVOT: Vec2 = { x: 1.2, y: -10 };

const JAW: Vec2 = { x: 0.6, y: -1 };

const OPEN_DEG = 22;

const COIL_R = 3.2;

export const PIN_CURSOR = svgCursor({
  hotspot: [16, 16],
  paths: [
    'M 9.5 16 A 6.5 6.5 0 1 1 22.5 16 A 6.5 6.5 0 1 1 9.5 16',
  ],
  dots: [{ x: 16, y: 16, r: 2, color: '#ff3b3b' }],
});

export const UNPIN_CURSOR = svgCursor({
  hotspot: [16, 16],
  color: '#ff5a5a',
  paths: ['M 9 9 L 23 23', 'M 23 9 L 9 23'],
});

interface CursorDot {
  x: number;
  y: number;
  r: number;
  color: string;
}

interface CursorSpec {
  paths: string[];
  dots?: CursorDot[];
  color?: string;
  stroke?: number;
  transform?: string;
  hotspot: [number, number];
}

const round = (value: number): string => String(Math.round(value * 10) / 10);

const clampPaths = (open: boolean): string[] => {
  const lever = (side: 1 | -1) => {
    const pivot = { x: side * PIVOT.x, y: PIVOT.y };
    const angle = open ? -side * OPEN_DEG : 0;
    const grip = rotateAround2({ x: side * GRIP.x, y: GRIP.y }, pivot, degToRad(angle));
    const tip = rotateAround2({ x: side * JAW.x, y: JAW.y }, pivot, degToRad(angle));
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
  stroke: 6,
  paths: clampPaths(open),
});

function svgCursor(spec: CursorSpec): string {
  const width = spec.stroke ?? OUTLINE_WIDTH;
  const paint = (stroke: string, strokeWidth: number) => spec.paths
    .map(d => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"`
      + ' stroke-linecap="round" stroke-linejoin="round"/>')
    .join('');
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

export const OPEN_CLAMP_CURSOR = clampGlyph(true);

export const CLAMP_CURSOR = clampGlyph(false);
