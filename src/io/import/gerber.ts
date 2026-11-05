import type { Pattern, Vec2 } from '../../core/model/types';
import { patternFromGroups } from './patternFromGroups';

/** Options for the Gerber reader. */
export interface GerberOptions {
  /** Group name used for the imported pieces. */
  name?: string;
}

/** Centimetres per Gerber file unit. */
const UNIT_TO_CM: Record<string, number> = { MM: 0.1, CM: 1, IN: 2.54 };

/** Samples an arc between two points into at least eight segments. */
function appendArc(
  chain: Vec2[], from: Vec2, to: Vec2, center: Vec2, clockwise: boolean,
): void {
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  let sweep = endAngle - startAngle;
  if (clockwise) {
    while (sweep >= 0) sweep -= Math.PI * 2;
  } else {
    while (sweep <= 0) sweep += Math.PI * 2;
  }
  const segments = Math.max(8, Math.min(256, Math.ceil((Math.abs(sweep) * radius) / 0.05)));
  for (let i = 1; i <= segments; i++) {
    const angle = startAngle + (sweep * i) / segments;
    chain.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
}

/**
 * Parses a Gerber RS-274X file into a pattern. Linear and circular draws are read as
 * centerlines; flashes, apertures and device attributes are ignored, and G36 regions close.
 */
export function parseGerberPattern(text: string, options: GerberOptions = {}): Pattern {
  const format = text.match(/%FS[^%]*?X(\d)(\d)Y(\d)(\d)[^%]*%/i);
  const decimals = format ? Number(format[2]) : 4;
  const unitMatch = text.match(/%MO(MM|IN|CM)\*%/i);
  const unit = unitMatch ? unitMatch[1]!.toUpperCase() : 'MM';
  const scale = (UNIT_TO_CM[unit] ?? 0.1) / 10 ** decimals;

  const body = text.replace(/G04[^%]*/gi, '').replace(/%[^%]*%/g, '');
  const tokens = body.split('*').map(token => token.replace(/\s+/g, '')).filter(Boolean);

  const chains: Vec2[][] = [];
  let chain: Vec2[] = [];
  let current: Vec2 = { x: 0, y: 0 };
  let drawing = false;
  let arcMode: 'off' | 'cw' | 'ccw' = 'off';

  /** Ends the open chain without closing it. */
  const flush = (): void => {
    if (chain.length >= 2) chains.push(chain);
    chain = [];
    drawing = false;
  };

  for (const token of tokens) {
    if (/^G0?4/.test(token)) continue;
    const gMatch = token.match(/G0*(\d+)/i);
    if (gMatch) {
      const code = Number(gMatch[1]);
      if (code === 1) arcMode = 'off';
      else if (code === 2) arcMode = 'cw';
      else if (code === 3) arcMode = 'ccw';
      else if (code === 36) {
        flush();
      } else if (code === 37) {
        if (chain.length >= 3) {
          chain.push({ ...chain[0]! });
          chains.push(chain);
        }
        chain = [];
        drawing = false;
      }
    }

    const xMatch = token.match(/X([-+]?\d+)/i);
    const yMatch = token.match(/Y([-+]?\d+)/i);
    const iMatch = token.match(/I([-+]?\d+)/i);
    const jMatch = token.match(/J([-+]?\d+)/i);
    const dMatch = token.match(/D0*(\d+)/i);
    if (!xMatch && !yMatch && !dMatch) continue;

    const hasPoint = !!xMatch || !!yMatch;
    const next: Vec2 = {
      x: xMatch ? Number(xMatch[1]) * scale : current.x,
      y: yMatch ? Number(yMatch[1]) * scale : current.y,
    };
    const operation = dMatch ? Number(dMatch[1]) : hasPoint ? 1 : 0;
    if (operation >= 10) continue;

    if (operation === 2) {
      flush();
      current = next;
      continue;
    }
    if (operation === 3) {
      current = next;
      continue;
    }
    if (!hasPoint) continue;

    if (!drawing) {
      chain.push({ ...current });
      drawing = true;
    }
    if (arcMode !== 'off' && (iMatch || jMatch)) {
      const center = {
        x: current.x + (iMatch ? Number(iMatch[1]) * scale : 0),
        y: current.y + (jMatch ? Number(jMatch[1]) * scale : 0),
      };
      appendArc(chain, current, next, center, arcMode === 'cw');
    } else {
      chain.push(next);
    }
    current = next;
  }
  flush();

  if (chains.length === 0) throw new Error('Gerber 里没有可识别的绘图路径');
  return patternFromGroups([{ name: options.name ?? '', chains }]);
}
