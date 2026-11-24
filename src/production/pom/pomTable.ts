import type { Pattern, PomPoint, Project, SizeDef, Vec2 } from '@/model/types';

import { add2, distance2, sub2, unit2 } from '@/base/math';
import { edgeLength } from '@/pattern/geom';
import { orderedSizes, resolveSize } from '@/pattern/grading';
import { evaluatePomFormula } from '@/production/pom/formula';

export interface PomValueRow {
  pom: PomPoint;
  baseValue: number | null;
  values: Record<string, number>;
}

export interface PomTable {
  sizes: SizeDef[];
  baseSizeId: string | null;
  rows: PomValueRow[];
  issues: string[];
}

export interface PomBase {
  pattern: Pattern;
  baseSizeId: string | null;
  sizes: SizeDef[];
}

export interface PomReportRow {
  pomId: string;
  name: string;
  part: string;
  sizeLabel: string;
  valueCm: number | null;
  diffCm: number | null;
  formula: string | null;
}

export type PomGrading = Map<string, Map<string, Vec2>>;

export interface PomCsvUpdate {
  pomId: string;
  sizeId: string;
  value: number;
}

export function pomBase(project: Project): PomBase {
  const sizes = orderedSizes(project);
  const baseSize = sizes.find(size => size.isBase) ?? sizes[0] ?? null;
  const pattern = baseSize
    ? resolveSize(project.pattern, project.activeSizeId, baseSize.id)
    : structuredClone(project.pattern);
  return { pattern, baseSizeId: baseSize?.id ?? null, sizes };
}

function basePomValue(pom: PomPoint, pattern: Pattern, project: Project): number | null {
  if (pom.kind === 'body') {
    const key = pom.refs.bodyKey;
    if (key === 'height') return project.avatar.params.heightCm;
    if (key === 'chest') return project.avatar.params.chestCm;
    if (key === 'waist') return project.avatar.params.waistCm;
    if (key === 'hip') return project.avatar.params.hipCm;
    return null;
  }

  if (pom.kind === 'edge') {
    const edgeId = pom.refs.edgeId;
    if (!edgeId || !pattern.edges[edgeId]) return null;
    return edgeLength(pattern, edgeId);
  }

  const a = pom.refs.pointAId ? pattern.points[pom.refs.pointAId]?.pos : null;
  const b = pom.refs.pointBId ? pattern.points[pom.refs.pointBId]?.pos : null;
  if (!a || !b) return null;
  return distance2(a, b);
}

export function uniquePomName(poms: readonly PomPoint[], desired: string): string {
  const base = desired.trim() || '测量点';
  const taken = new Set(poms.map(pom => pom.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) index++;
  return `${base} ${index}`;
}

function directValue(
  pom: PomPoint,
  size: SizeDef,
  baseSizeId: string | null,
  baseSeq: number,
  baseValue: number | null,
): number | null {
  const explicit = pom.values?.[size.id];
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit;
  if (size.id === baseSizeId) return baseValue;
  if (baseValue === null) return null;
  const step = pom.stepCm;
  const stepValue = typeof step === 'number' && Number.isFinite(step) ? step : 0;
  return baseValue + stepValue * (size.seq - baseSeq);
}

export function buildPomTable(project: Project, poms: readonly PomPoint[] = project.poms ?? []): PomTable {
  if (poms.length === 0) {
    const sizes = orderedSizes(project);
    return {
      sizes,
      baseSizeId: (sizes.find(size => size.isBase) ?? sizes[0])?.id ?? null,
      rows: [],
      issues: [],
    };
  }

  const base = pomBase(project);
  const baseSize = base.sizes.find(size => size.id === base.baseSizeId) ?? null;
  const baseSeq = baseSize?.seq ?? 0;
  const baseValues = new Map<string, number | null>();
  const issues = new Set<string>();
  for (const pom of poms) {
    if (pom.formula?.trim()) continue;
    const value = basePomValue(pom, base.pattern, project);
    baseValues.set(pom.id, value);
    if (value === null) issues.add(`测量点「${pom.name}」的参照无效或已删除`);
  }

  const byName = new Map<string, PomPoint>();
  for (const pom of poms) {
    if (!byName.has(pom.name)) byName.set(pom.name, pom);
  }

  const rows: PomValueRow[] = poms.map(pom => ({
    pom,
    baseValue: baseValues.get(pom.id) ?? null,
    values: {},
  }));

  for (const size of base.sizes) {
    const computed = new Map<string, number | null>();
    const stack: string[] = [];

    const valueOf = (pom: PomPoint): number | null => {
      const cached = computed.get(pom.id);
      if (cached !== undefined) return cached;
      try {
        if (pom.formula?.trim()) {
          if (stack.includes(pom.name)) {
            throw new Error(`公式循环引用：${[...stack, pom.name].join(' → ')}`);
          }

          stack.push(pom.name);
          let value: number;
          try {
            value = evaluatePomFormula(pom.formula, name => {
              const ref = byName.get(name);
              if (!ref) throw new Error(`未知测量点「${name}」`);
              const refValue = valueOf(ref);
              if (refValue === null) throw new Error(`测量点「${name}」没有有效值`);
              return refValue;
            });
          } finally {
            stack.pop();
          }

          computed.set(pom.id, value);
          if (value <= 0) issues.add(`测量点「${pom.name}」在尺码「${size.label}」不是正数`);
          return value;
        }

        const value = directValue(
          pom, size, base.baseSizeId, baseSeq, baseValues.get(pom.id) ?? null,
        );
        computed.set(pom.id, value);
        if (value === null) issues.add(`测量点「${pom.name}」在尺码「${size.label}」没有有效值`);
        else if (value <= 0) issues.add(`测量点「${pom.name}」在尺码「${size.label}」不是正数`);
        return value;
      } catch (err) {
        computed.set(pom.id, null);
        const message = err instanceof Error ? err.message : '无法计算';
        issues.add(`测量点「${pom.name}」（${size.label}）：${message}`);
        return null;
      }
    };

    for (const row of rows) {
      const value = valueOf(row.pom);
      if (value !== null) row.values[size.id] = value;
    }
  }

  const baseRows = rows.map(row => {
    if (row.pom.formula?.trim() && baseSize) {
      const value = row.values[baseSize.id];
      return { ...row, baseValue: typeof value === 'number' ? value : null };
    }

    return row;
  });

  return { sizes: base.sizes, baseSizeId: base.baseSizeId, rows: baseRows, issues: [...issues] };
}

export function pomReportRows(table: PomTable): PomReportRow[] {
  const out: PomReportRow[] = [];
  for (const row of table.rows) {
    for (const size of table.sizes) {
      const value = row.values[size.id] ?? null;
      out.push({
        pomId: row.pom.id,
        name: row.pom.name,
        part: row.pom.part,
        sizeLabel: size.label,
        valueCm: value,
        diffCm: value === null || row.baseValue === null ? null : value - row.baseValue,
        formula: row.pom.formula?.trim() || null,
      });
    }
  }

  return out;
}

export function computePomGradingDeltas(table: PomTable, basePattern: Pattern): PomGrading {
  const out: PomGrading = new Map();
  if (!table.baseSizeId) return out;
  for (const size of table.sizes) {
    if (size.id === table.baseSizeId) continue;
    const deltas = new Map<string, Vec2>();
    for (const row of table.rows) {
      const pom = row.pom;
      if (pom.kind === 'body') continue;
      const baseValue = row.values[table.baseSizeId] ?? row.baseValue;
      const target = row.values[size.id];
      if (typeof baseValue !== 'number' || typeof target !== 'number') continue;
      const lengthDelta = target - baseValue;
      if (!Number.isFinite(lengthDelta) || Math.abs(lengthDelta) < 1e-6) continue;

      const ends = pomEnds(pom, basePattern);
      if (!ends) continue;
      const a = basePattern.points[ends[0]!]?.pos;
      const b = basePattern.points[ends[1]!]?.pos;
      if (!a || !b) continue;
      const chord = distance2(a, b);
      const dir = unit2(sub2(b, a));
      if (!dir || chord < 1e-6) continue;
      const arc = pom.kind === 'edge' && pom.refs.edgeId
        ? edgeLength(basePattern, pom.refs.edgeId)
        : chord;
      const factor = arc > 1e-6 ? chord / arc : 1;
      const shift = lengthDelta / 2 * factor;
      addDelta(deltas, ends[0]!, { x: -dir.x * shift, y: -dir.y * shift });
      addDelta(deltas, ends[1]!, { x: dir.x * shift, y: dir.y * shift });
    }

    out.set(size.id, deltas);
  }

  return out;
}

function pomEnds(pom: PomPoint, pattern: Pattern): [string, string] | null {
  if (pom.kind === 'edge') {
    const edge = pom.refs.edgeId ? pattern.edges[pom.refs.edgeId] : null;
    return edge ? [edge.startPointId, edge.endPointId] : null;
  }

  const a = pom.refs.pointAId;
  const b = pom.refs.pointBId;
  return a && b && pattern.points[a] && pattern.points[b] ? [a, b] : null;
}

function addDelta(deltas: Map<string, Vec2>, pointId: string, delta: Vec2): void {
  const prev = deltas.get(pointId);
  deltas.set(pointId, prev ? add2(prev, delta) : delta);
}
