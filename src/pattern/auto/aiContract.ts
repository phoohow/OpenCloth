import type { Pattern } from '@/model/types';
import { normalizePattern } from '@/model';
import { validatePattern } from '@/model';

const EDGE_TYPES = new Set(['line', 'bezier', 'arc']);
const POINT_KINDS = new Set(['corner', 'smooth']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Strict field checks for AI-produced pattern JSON before it touches the model. */
function collectStructuralErrors(raw: Record<string, unknown>, errors: string[]): void {
  for (const key of ['points', 'edges', 'panels'] as const) {
    if (!isRecord(raw[key])) errors.push(`缺少「${key}」集合或其不是对象`);
  }
  for (const optionalKey of ['darts', 'internalLines', 'seams', 'notches', 'annotations', 'measurements'] as const) {
    if (raw[optionalKey] !== undefined && !isRecord(raw[optionalKey])) {
      errors.push(`「${optionalKey}」必须是对象`);
    }
  }
  if (!isRecord(raw.points) || !isRecord(raw.edges) || !isRecord(raw.panels)) return;

  for (const [id, value] of Object.entries(raw.points)) {
    const p = value as { pos?: { x?: unknown; y?: unknown }; kind?: unknown };
    if (typeof p?.pos?.x !== 'number' || typeof p?.pos?.y !== 'number' || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) {
      errors.push(`点 ${id} 缺少有限的 pos.x/pos.y`);
    }
    if (p.kind !== undefined && !POINT_KINDS.has(p.kind as string)) errors.push(`点 ${id} 的 kind「${String(p.kind)}」无效`);
  }
  for (const [id, value] of Object.entries(raw.edges)) {
    const e = value as { type?: unknown; startPointId?: unknown; endPointId?: unknown };
    if (!EDGE_TYPES.has(e?.type as string)) errors.push(`边 ${id} 的 type「${String(e?.type)}」无效`);
    if (typeof e?.startPointId !== 'string' || typeof e?.endPointId !== 'string') errors.push(`边 ${id} 缺少端点引用`);
  }
  for (const [id, value] of Object.entries(raw.panels)) {
    const panel = value as { outlineEdgeIds?: unknown; name?: unknown };
    if (!Array.isArray(panel?.outlineEdgeIds) || panel.outlineEdgeIds.some(x => typeof x !== 'string')) {
      errors.push(`版片 ${id} 的 outlineEdgeIds 必须是字符串数组`);
    }
    if (typeof panel?.name !== 'string') errors.push(`版片 ${id} 缺少 name`);
  }
}

/**
 * Strict import boundary for AI-generated patterns (FR-13.3): parses JSON text, checks
 * required fields, fills absent collections through `normalizePattern`, then validates
 * topology. Any failure throws an aggregated Chinese error.
 */
export function patternFromJson(json: string): Pattern {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`AI 版型 JSON 解析失败：${(error as Error).message}`);
  }
  if (!isRecord(raw)) throw new Error('AI 版型 JSON 必须是对象');

  const source = isRecord(raw.pattern) ? raw.pattern : raw;
  const errors: string[] = [];
  collectStructuralErrors(source, errors);
  if (errors.length > 0) {
    throw new Error(`AI 版型数据不合法：${errors.join('；')}`);
  }

  const pattern = normalizePattern(structuredClone(source as unknown as Pattern));

  const issues = validatePattern(pattern, { allowOpen: false });
  if (issues.length > 0) {
    const panels = new Set<string>();
    for (const issue of issues) {
      const owner = Object.values(pattern.panels).find(
        p => p.id === issue.targetId || p.outlineEdgeIds.includes(issue.targetId),
      );
      panels.add(owner?.name ?? issue.targetId);
    }
    throw new Error(`AI 版型拓扑校验失败（${[...panels].join('、')}）：${issues.map(i => i.message).join('；')}`);
  }
  return pattern;
}
