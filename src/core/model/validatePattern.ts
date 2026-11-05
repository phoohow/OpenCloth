import type { Pattern, Seam } from './types';
import { PatternTopology, type EdgeLocation } from './patternTopology';
/** Invariant violations that block a command from committing. */
export type TopologyErrorCode =
  | 'dangling_edge'
  | 'dangling_point'
  | 'duplicate_edge_ref'
  | 'outline_too_short'
  | 'chain_break'
  | 'not_closed'
  | 'orphan_edge'
  | 'orphan_point'
  | 'seam_missing_edge'
  | 'seam_unowned_edge'
  | 'seam_bad_interval'
  | 'seam_overlap'
  | 'dart_missing_ref'
  | 'dart_cross_panel';

/** Suspicious but possibly intentional seam geometry; reported by `pattern/seam/seamWarnings`, never blocks a commit. */
export type SeamWarningCode = 'seam_length_mismatch' | 'seam_duplicate_pair';

/** Every code the pattern checks can report. */
export type PatternIssueCode = TopologyErrorCode | SeamWarningCode;

/** `error` blocks a commit, `warning` only shows up in the check menu. */
export type IssueSeverity = 'error' | 'warning';

/** One violated invariant with the ids that caused it. */
export interface PatternIssue {
  code: PatternIssueCode;
  /** Stable id of the offending object; panel id for outline problems. */
  targetId: string;
  /** Human-readable Chinese message for the editing UI. */
  message: string;
  /** Absent means `error`; only the seam hints are reported as `warning`. */
  severity?: IssueSeverity;
}

/**
 * Join range of one seam side along its edge, as arc-length fractions.
 */
export function seamInterval(seam: Seam, side: 'a' | 'b'): readonly [number, number] {
  const end = seam[side];
  return [end?.t0 ?? 0, end?.t1 ?? 1];
}

/** Options for `validatePattern`. */
export interface ValidateOptions {
  /** Drafting mode: edges and points outside any closed outline stay legal until commit. */
  allowOpen?: boolean;
}

/**
 * Checks the topological invariants every committed pattern edit must satisfy. Every issue it
 * returns is an error; the seam hints live in `pattern/seam/seamWarnings`.
 */
export function validatePattern(pattern: Pattern, options: ValidateOptions = {}): PatternIssue[] {
  const issues: PatternIssue[] = [];
  const topology = new PatternTopology(pattern);

  checkOutlines(pattern, topology, issues);
  checkOwnership(pattern, topology, issues, options.allowOpen ?? false);
  checkSeams(pattern, topology, issues);
  checkDarts(pattern, topology, issues);

  return issues;
}

/** Walks every panel outline for closure, minimum size, duplicates and endpoint continuity. */
function checkOutlines(pattern: Pattern, topology: PatternTopology, issues: PatternIssue[]): void {
  for (const panel of Object.values(pattern.panels)) {
    const chain = topology.outlineOf(panel.id);
    if (chain.length < 3) {
      issues.push({ code: 'outline_too_short', targetId: panel.id, message: `版片「${panel.name}」的轮廓只有 ${chain.length} 条边，至少需要 3 条` });
    }
    const seen = new Set<string>();
    for (const location of chain) {
      if (seen.has(location.edgeId)) {
        issues.push({ code: 'duplicate_edge_ref', targetId: panel.id, message: `版片「${panel.name}」的轮廓重复引用边 ${location.edgeId}` });
      }
      seen.add(location.edgeId);
    }
    checkChain(pattern, panel.id, chain, issues);
  }
}

/** Reports dangling references and outline breaks for one panel chain. */
function checkChain(
  pattern: Pattern,
  panelId: string,
  chain: readonly EdgeLocation[],
  issues: PatternIssue[],
): void {
  if (chain.length === 0) return;

  for (const location of chain) {
    const edge = pattern.edges[location.edgeId];
    if (!edge) {
      issues.push({ code: 'dangling_edge', targetId: panelId, message: `版片 ${panelId} 的轮廓引用了不存在的边 ${location.edgeId}` });
      continue;
    }
    if (!pattern.points[edge.startPointId]) {
      issues.push({ code: 'dangling_point', targetId: edge.id, message: `边 ${edge.id} 的起点 ${edge.startPointId} 不存在` });
    }
    if (!pattern.points[edge.endPointId]) {
      issues.push({ code: 'dangling_point', targetId: edge.id, message: `边 ${edge.id} 的终点 ${edge.endPointId} 不存在` });
    }
  }

  for (let i = 0; i < chain.length; i++) {
    const current = pattern.edges[chain[i]!.edgeId];
    const next = pattern.edges[chain[(i + 1) % chain.length]!.edgeId];
    if (!current || !next) continue;
    if (i + 1 < chain.length && current.endPointId !== next.startPointId) {
      issues.push({ code: 'chain_break', targetId: panelId, message: `版片 ${panelId} 的边 ${current.id} 终点与下一条边 ${next.id} 起点不接续` });
    }
    if (i + 1 === chain.length && current.endPointId !== next.startPointId) {
      issues.push({ code: 'not_closed', targetId: panelId, message: `版片 ${panelId} 的轮廓未闭合` });
    }
  }
}

/** Every edge and point must be owned, directly or through a panel outline. */
function checkOwnership(
  pattern: Pattern,
  topology: PatternTopology,
  issues: PatternIssue[],
  allowOpen: boolean,
): void {
  const ownedEdges = new Set<string>();
  for (const seam of Object.values(pattern.seams)) {
    ownedEdges.add(seam.a?.edgeId ?? '');
    ownedEdges.add(seam.b?.edgeId ?? '');
  }
  for (const dart of Object.values(pattern.darts)) {
    ownedEdges.add(dart.edge1Id);
    ownedEdges.add(dart.edge2Id);
  }

  for (const edge of Object.values(pattern.edges)) {
    const onOutline = topology.isOnLoop(edge.id);
    if (!onOutline && !ownedEdges.has(edge.id) && !allowOpen) {
      issues.push({ code: 'orphan_edge', targetId: edge.id, message: `边 ${edge.id} 不属于任何轮廓、缝合或省道` });
    }
  }

  for (const point of Object.values(pattern.points)) {
    const refs = topology.edgesOf(point.id);
    const used = refs.some(ref =>
      topology.isOnLoop(ref.edgeId)
      || ownedEdges.has(ref.edgeId)
      || (allowOpen && !!pattern.edges[ref.edgeId]),
    );
    if (refs.length === 0 || !used) {
      issues.push({ code: 'orphan_point', targetId: point.id, message: `点 ${point.id} 未被任何所属实体引用` });
    }
  }
}

/** Seam edges must exist and be outlined; per-edge intervals must be legal and disjoint. */
function checkSeams(pattern: Pattern, topology: PatternTopology, issues: PatternIssue[]): void {
  const intervalsPerEdge = new Map<string, { seamId: string; t0: number; t1: number }[]>();

  for (const seam of Object.values(pattern.seams)) {
    for (const [side, edgeId] of [['a', seam.a?.edgeId ?? ''], ['b', seam.b?.edgeId ?? '']] as const) {
      if (!pattern.edges[edgeId]) {
        issues.push({ code: 'seam_missing_edge', targetId: seam.id, message: `缝合 ${seam.id} 引用了不存在的边 ${edgeId}` });
        continue;
      }
      if (!topology.isOnLoop(edgeId)) {
        issues.push({ code: 'seam_unowned_edge', targetId: seam.id, message: `缝合 ${seam.id} 的边 ${edgeId} 不属于任何版片` });
      }
      const [t0, t1] = seamInterval(seam, side);
      if (!(t0 >= 0 && t0 < t1 && t1 <= 1)) {
        issues.push({ code: 'seam_bad_interval', targetId: seam.id, message: `缝合 ${seam.id} 的 ${side.toUpperCase()} 侧区间 [${t0}, ${t1}] 不合法` });
      }
      const list = intervalsPerEdge.get(edgeId);
      if (list) list.push({ seamId: seam.id, t0, t1 });
      else intervalsPerEdge.set(edgeId, [{ seamId: seam.id, t0, t1 }]);
    }
  }

  for (const [edgeId, intervals] of intervalsPerEdge) {
    const sorted = [...intervals].sort((x, y) => x.t0 - y.t0);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.t0 < sorted[i - 1]!.t1) {
        issues.push({ code: 'seam_overlap', targetId: edgeId, message: `边 ${edgeId} 上的缝合区间重叠（${sorted[i - 1]!.seamId} 与 ${sorted[i]!.seamId}）` });
        break;
      }
    }
  }
}

/** Dart legs and tip must resolve, and all belong to one panel. */
function checkDarts(pattern: Pattern, topology: PatternTopology, issues: PatternIssue[]): void {
  for (const dart of Object.values(pattern.darts)) {
    if (!pattern.points[dart.tipId]) {
      issues.push({ code: 'dart_missing_ref', targetId: dart.id, message: `省道 ${dart.id} 的省尖点 ${dart.tipId} 不存在` });
    }
    let owner: string | null = null;
    for (const legId of [dart.edge1Id, dart.edge2Id]) {
      const leg = pattern.edges[legId];
      if (!leg) {
        issues.push({ code: 'dart_missing_ref', targetId: dart.id, message: `省道 ${dart.id} 引用了不存在的省边 ${legId}` });
        continue;
      }
      const panelId = topology.panelOfEdge(legId);
      if (panelId === null) {
        issues.push({ code: 'dart_missing_ref', targetId: dart.id, message: `省道 ${dart.id} 的省边 ${legId} 不属于任何版片` });
      } else if (owner === null) {
        owner = panelId;
      } else if (owner !== panelId) {
        issues.push({ code: 'dart_cross_panel', targetId: dart.id, message: `省道 ${dart.id} 的两条省边分属不同版片` });
      }
    }
  }
}
