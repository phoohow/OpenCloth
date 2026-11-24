import type { Pattern } from '@/model/types';

import {
  buildMarkerLayout, placedOutline, type MarkerLayoutOptions,
} from '@/production/marker';

const HPGL_UNITS_PER_CM = 400;

const GERBER_SCALE = 1_000_000;

function gerberCoord(valueCm: number): number {
  return Math.round(valueCm * 10 * GERBER_SCALE);
}

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
