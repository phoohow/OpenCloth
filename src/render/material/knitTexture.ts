import type { KnitSpec } from '../../core/model/knit';

/** Clamps a count into a visible range. */
function clampCount(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

/**
 * Seamless grayscale knit tile drawn from a knit spec, suitable as an albedo map:
 * white gaps and light-grey loops multiply with the fabric's base colour.
 */
export function knitTextureDataUrl(spec: KnitSpec, size = 192): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, size, size);
  const cols = clampCount(spec.needleGauge / 2, 4, 16);
  const rows = clampCount(spec.rowGauge / 2, 4, 16);
  const cellW = size / cols;
  const cellH = size / rows;
  ctx.lineWidth = Math.max(1, cellW * 0.16);
  ctx.lineCap = 'round';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW;
      const y = row * cellH;
      if (spec.stitch === 'rib2' && col % 4 >= 2) {
        ctx.strokeStyle = '#bdbdbd';
        ctx.beginPath();
        ctx.moveTo(x + cellW * 0.2, y + cellH * 0.5);
        ctx.lineTo(x + cellW * 0.8, y + cellH * 0.5);
        ctx.stroke();
        continue;
      }
      if (spec.stitch === 'cable' && row % 8 === 4 && col % 6 >= 2 && col % 6 < 4) {
        ctx.strokeStyle = '#9f9f9f';
        ctx.beginPath();
        ctx.moveTo(x + cellW * 0.2, y + cellH * 0.15);
        ctx.lineTo(x + cellW * 0.8, y + cellH * 0.85);
        ctx.moveTo(x + cellW * 0.2, y + cellH * 0.85);
        ctx.lineTo(x + cellW * 0.8, y + cellH * 0.15);
        ctx.stroke();
        continue;
      }
      // Jersey loop: two legs meeting at the bottom of the cell.
      ctx.strokeStyle = '#cfcfcf';
      ctx.beginPath();
      ctx.moveTo(x + cellW * 0.2, y + cellH * 0.15);
      ctx.lineTo(x + cellW * 0.5, y + cellH * 0.78);
      ctx.lineTo(x + cellW * 0.8, y + cellH * 0.15);
      ctx.stroke();
      ctx.strokeStyle = '#e0e0e0';
      ctx.beginPath();
      ctx.moveTo(x + cellW * 0.5, y + cellH * 0.78);
      ctx.lineTo(x + cellW * 0.5, y + cellH * 1.0);
      ctx.stroke();
    }
  }
  return canvas.toDataURL('image/png');
}
