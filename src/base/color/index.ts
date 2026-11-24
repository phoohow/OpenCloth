export type LinearRgb = readonly [number, number, number];

function srgbChannel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function hexToLinearRgb(hex: string): LinearRgb {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [srgbChannel((value >> 16) & 0xff), srgbChannel((value >> 8) & 0xff), srgbChannel(value & 0xff)];
}
