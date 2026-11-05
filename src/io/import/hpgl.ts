import type { Pattern, Vec2 } from '../../core/model/types';
import { patternFromGroups } from './patternFromGroups';

/** Options for the HPGL / PLT reader. */
export interface HpglOptions {
  /** Plotter units per centimetre; the HPGL default is 400 (0.025 mm per unit). */
  unitsPerCm?: number;
  /** Group name used for the imported pieces. */
  name?: string;
}

/**
 * Parses an HPGL / HP-GL2 plotter file (`.plt`) into a pattern. Only pen moves and draws
 * are read; pen selection, line types and other device commands are ignored.
 */
export function parseHpglPattern(text: string, options: HpglOptions = {}): Pattern {
  const unitsPerCm = options.unitsPerCm && options.unitsPerCm > 0 ? options.unitsPerCm : 400;
  const chains: Vec2[][] = [];
  let current: Vec2[] = [];
  let last: Vec2 = { x: 0, y: 0 };
  let absolute = true;
  let penDown = false;

  /** Closes the current chain and appends it in centimetres. */
  const flush = (): void => {
    if (current.length >= 2) chains.push(current.map(p => ({ x: p.x / unitsPerCm, y: p.y / unitsPerCm })));
    current = [];
    penDown = false;
  };

  for (const raw of text.split(';')) {
    const token = raw.trim();
    if (token.length < 2) continue;
    const op = token.slice(0, 2).toUpperCase();
    const values = (token.slice(2).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

    if (op === 'PA') {
      absolute = true;
      continue;
    }
    if (op === 'PR') {
      absolute = false;
      continue;
    }
    if (op !== 'PU' && op !== 'PD') continue;

    if (op === 'PU') flush();
    else {
      penDown = true;
      if (current.length === 0) current.push({ ...last });
    }
    for (let i = 0; i + 1 < values.length; i += 2) {
      const point = absolute
        ? { x: values[i]!, y: values[i + 1]! }
        : { x: last.x + values[i]!, y: last.y + values[i + 1]! };
      last = point;
      if (penDown) current.push(point);
    }
  }
  flush();

  if (chains.length === 0) throw new Error('PLT 里没有可识别的绘图路径');
  return patternFromGroups([{ name: options.name ?? '', chains }]);
}
