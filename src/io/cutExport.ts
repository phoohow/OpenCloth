import type { Pattern } from '../core/model/types';
import {
  buildMarkerLayout, placedOutline, type MarkerLayoutOptions,
} from '../pattern/marker/markerLayout';

/** Plotter units per centimetre; the HPGL default unit is 0.025 mm. */
const HPGL_UNITS_PER_CM = 400;

/** Gerber coordinates use six decimal places on millimetres. */
const GERBER_SCALE = 1_000_000;

/** Gerber coordinate of one marker point, in 0.000001 mm units. */
function gerberCoord(valueCm: number): number {
  return Math.round(valueCm * 10 * GERBER_SCALE);
}

/**
 * Marker outlines as Gerber RS-274X: one aperture, millimetre units and a closed
 * draw for every placed piece. The file cuts the pieces only, without the fabric frame.
 */
export function markerGerber(pattern: Pattern, options: MarkerLayoutOptions = {}): string {
  const layout = buildMarkerLayout(pattern, options);
  const lines: string[] = [
    '%FSLAX46Y46*%',
    '%MOMM*%',
    '%ADD10C,0.050*%',
    'D10*',
    'G01*',
  ];
  for (const entry of layout.placements) {
    const outline = placedOutline(entry);
    if (outline.length < 3) continue;
    const first = outline[0]!;
    lines.push(`X${gerberCoord(first.x)}Y${gerberCoord(first.y)}D02*`);
    for (const point of outline.slice(1)) {
      lines.push(`X${gerberCoord(point.x)}Y${gerberCoord(point.y)}D01*`);
    }
    lines.push(`X${gerberCoord(first.x)}Y${gerberCoord(first.y)}D01*`);
  }
  lines.push('M02*');
  return lines.join('\n') + '\n';
}

/**
 * Marker outlines as HPGL / PLT: pen-up moves and pen-down strokes in plotter units.
 * The marker's rotation and flipped pieces are baked into the points.
 */
export function markerHpgl(pattern: Pattern, options: MarkerLayoutOptions = {}): string {
  const layout = buildMarkerLayout(pattern, options);
  const parts: string[] = ['IN', 'SP1'];
  const coord = (valueCm: number): number => Math.round(valueCm * HPGL_UNITS_PER_CM);
  for (const entry of layout.placements) {
    const outline = placedOutline(entry);
    if (outline.length < 3) continue;
    const first = outline[0]!;
    parts.push(`PU${coord(first.x)},${coord(first.y)}`);
    const points = [...outline.slice(1), first].map(point => `${coord(point.x)},${coord(point.y)}`);
    parts.push(`PD${points.join(',')}`);
  }
  parts.push('PU', 'SP0');
  return parts.join(';') + ';';
}
