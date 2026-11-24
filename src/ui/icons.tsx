import { memo, type CSSProperties } from 'react';

export const ICON_NAMES = [
  'select', 'add-point', 'remove-point', 'line', 'curve', 'internal-line', 'dart', 'seam', 'pan',
  'rect', 'circle', 'ellipse', 'print', 'topstitch', 'trim', 'marquee',
  'pin', 'unpin', 'move', 'pen', 'ruler',
  'cube', 'swatch', 'waves', 'image', 'briefcase', 'scene',
  'folder', 'panel', 'avatar', 'reference', 'environment', 'camera', 'floor',
  'light-directional', 'light-point', 'light-spot', 'light-area',
  'aperture',
  'chevron-down', 'chevron-right', 'eye', 'eye-off', 'plus', 'minus', 'check', 'refresh',
  'collapse-all', 'expand-all', 'status-dot', 'menu', 'close',
  'play', 'pause', 'stop', 'reset', 'step',
  't-shirt',
  'grip',
] as const;

const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  ).map(([path, source]) => [path.replace(/^.*\//, '').replace(/\.svg$/, ''), source]),
);

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

export type IconName = (typeof ICON_NAMES)[number];

function iconSource(name: IconName): string {
  return SOURCES[name] ?? '';
}
