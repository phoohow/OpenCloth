import { memo, type CSSProperties } from 'react';

/** Every UI glyph; each one is the file `assets/icons/<name>.svg`. */
export const ICON_NAMES = [
  // 2D pattern tools
  'select', 'add-point', 'line', 'curve', 'internal-line', 'dart', 'seam', 'pan',
  'rect', 'circle', 'ellipse', 'print', 'topstitch', 'trim',
  // 3D pin tools
  'pin', 'unpin',
  // Properties tabs
  'cube', 'swatch', 'waves', 'move', 'sparkles', 'image', 'briefcase', 'scene',
  // Outliner nodes
  'folder', 'panel', 'avatar', 'reference', 'environment', 'camera',
  'light-directional', 'light-point', 'light-spot', 'light-area',
  // Mobile shell
  'atom', 'aperture',
  // Shared controls
  'chevron-down', 'chevron-right', 'eye', 'eye-off', 'plus', 'minus', 'check',
  'collapse-all', 'expand-all', 'status-dot',
  // Transport
  'play', 'pause', 'reset', 'step',
  // Garment templates
  't-shirt', 'shirt', 'dress', 'skirt', 'sleeve',
] as const;

/** Name of one UI glyph, drawn from `assets/icons/<name>.svg`. */
export type IconName = (typeof ICON_NAMES)[number];

// Drawings are read out of assets/icons at build time and shipped inside the bundle, so a
// glyph never depends on the fonts or emoji set of the device showing it.
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  ).map(([path, source]) => [path.replace(/^.*\//, '').replace(/\.svg$/, ''), source]),
);

/** Raw SVG markup of one glyph, for hosts that need the drawing itself. */
export function iconSource(name: IconName): string {
  return SOURCES[name] ?? '';
}

/** One UI glyph in a square box; it inherits the surrounding text color. */
export const Icon = memo(function Icon({ name, size = 14, style }: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex', flex: '0 0 auto', width: size, height: size,
        verticalAlign: 'middle', ...style,
      }}
      dangerouslySetInnerHTML={{ __html: iconSource(name) }}
    />
  );
});
