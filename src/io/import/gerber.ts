import type { Pattern, Vec2 } from '@/model/types';

import { CM_PER_UNIT } from '@/base/units';
import { patternFromGroups } from '@/io/import/patternFromGroups';

export interface GerberOptions {
  name?: string;
}

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

function gerberUnitToCm(unit: string): number {
  if (unit === 'IN') return CM_PER_UNIT.inch;
  if (unit === 'CM') return CM_PER_UNIT.cm;
  return CM_PER_UNIT.mm;
}

export function parseGerberPattern(text: string, options: GerberOptions = {}): Pattern {
  const format = text.match(/%FS[^%]*?X(\d)(\d)Y(\d)(\d)[^%]*%/i);
  const decimals = format ? Number(format[2]) : 4;
  const unitMatch = text.match(/%MO(MM|IN|CM)\*%/i);
  const unit = unitMatch ? unitMatch[1]!.toUpperCase() : 'MM';
  const scale = gerberUnitToCm(unit) / 10 ** decimals;

  const body = text.replace(/G04[^%]*/gi, '').replace(/%[^%]*%/g, '');
  const tokens = body.split('*').map(token => token.replace(/\s+/g, '')).filter(Boolean);

  const chains: Vec2[][] = [];
  let chain: Vec2[] = [];
  let current: Vec2 = { x: 0, y: 0 };
  let drawing = false;
  let arcMode: 'off' | 'cw' | 'ccw' = 'off';

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
