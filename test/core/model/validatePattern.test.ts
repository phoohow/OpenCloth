import { describe, it, expect } from 'vitest';
import { vec2, type Panel, type Pattern } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { createStarterProject } from '../../../src/pattern/template/starterProject';
import { seamInterval, validatePattern, type PatternIssueCode } from '../../../src/core/model/validatePattern';
import { buildPatternGraph, panelOfEdge, panelsOfEdge } from '../../../src/core/model/patternGraph';

/** Builds one valid triangular panel; `p` prefixes the ids so several panels can coexist. */
function addTriangle(pattern: Pattern, p: string, counterclockwise = true): Panel {
  const [a, b, c] = counterclockwise ? [vec2(0, 0), vec2(4, 0), vec2(0, 4)] : [vec2(0, 0), vec2(0, 4), vec2(4, 0)];
  pattern.points[`${p}1`] = { id: `${p}1`, pos: a };
  pattern.points[`${p}2`] = { id: `${p}2`, pos: b };
  pattern.points[`${p}3`] = { id: `${p}3`, pos: c };
  for (const [i, from, to] of [[1, `${p}1`, `${p}2`], [2, `${p}2`, `${p}3`], [3, `${p}3`, `${p}1`]] as const) {
    pattern.edges[`e${i}`] = { id: `e${i}`, type: 'line', startPointId: from, endPointId: to };
  }
  pattern.panels[p] = {
    id: p, name: p, outlineEdgeIds: ['e1', 'e2', 'e3'], dartIds: [], internalLineIds: [],
    seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
  };
  return pattern.panels[p];
}

function makePattern(): Pattern {
  const project = createDefaultProject();
  return project.pattern;
}

function codes(pattern: Pattern): PatternIssueCode[] {
  return validatePattern(pattern).map(i => i.code);
}

describe('validatePattern', () => {
  it('accepts a minimal valid pattern', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    expect(validatePattern(pattern)).toEqual([]);
  });

  it('accepts the starter project', () => {
    expect(codes(createStarterProject().pattern)).toEqual([]);
  });

  it('reports outlines with fewer than three edges', () => {
    const pattern = makePattern();
    const panel = addTriangle(pattern, 'p');
    panel.outlineEdgeIds = ['e1', 'e2'];
    expect(codes(pattern)).toContain('outline_too_short');
  });

  it('reports a break between two outline edges', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    pattern.edges.e2 = { ...pattern.edges.e2!, startPointId: 'p3', endPointId: 'p1' };
    const found = validatePattern(pattern);
    expect(found.map(i => i.code)).toContain('chain_break');
  });

  it('reports an outline whose ends do not meet', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    pattern.points.p3 = { id: 'p3', pos: vec2(9, 9) };
    pattern.edges.e3 = { ...pattern.edges.e3!, endPointId: 'p2' };
    const found = validatePattern(pattern);
    expect(found.map(i => i.code)).toContain('not_closed');
  });

  it('reports a dangling edge reference in an outline', () => {
    const pattern = makePattern();
    const panel = addTriangle(pattern, 'p');
    panel.outlineEdgeIds = ['e1', 'e2', 'gone'];
    expect(codes(pattern)).toContain('dangling_edge');
  });

  it('reports a duplicate edge reference in an outline', () => {
    const pattern = makePattern();
    const panel = addTriangle(pattern, 'p');
    panel.outlineEdgeIds = ['e1', 'e2', 'e3', 'e1'];
    expect(codes(pattern)).toContain('duplicate_edge_ref');
  });

  it('reports an orphan edge and an orphan point', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    pattern.points.p9 = { id: 'p9', pos: vec2(1, 1) };
    pattern.edges.e9 = { id: 'e9', type: 'line', startPointId: 'p9', endPointId: 'p9' };
    const found = codes(pattern);
    expect(found).toContain('orphan_edge');
    expect(found).toContain('orphan_point');
  });

  it('lets open drafts pass with allowOpen', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    pattern.points.p9 = { id: 'p9', pos: vec2(1, 1) };
    pattern.edges.e9 = { id: 'e9', type: 'line', startPointId: 'p1', endPointId: 'p9' };
    expect(validatePattern(pattern, { allowOpen: true })).toEqual([]);
    expect(codes(pattern)).toContain('orphan_edge');
  });

  it('still reports isolated points when drafting is open', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    pattern.points.p9 = { id: 'p9', pos: vec2(1, 1) };
    expect(validatePattern(pattern, { allowOpen: true }).map(i => i.code)).toContain('orphan_point');
  });

  it('reports a seam referencing a missing edge', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    pattern.seams.s1 = {
      id: 's1', type: 'normal', a: { edgeId: 'e1', t0: 0, t1: 1 }, b: { edgeId: 'gone', t0: 0, t1: 1 }, flip: true,
      strength: 1, threadColor: '#000', stitchVisible: true,
    };
    expect(codes(pattern)).toContain('seam_missing_edge');
  });

  it('reports two seams covering the same edge interval', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    const seam = (id: string, bEdgeId: string) => ({
      id, type: 'normal' as const, a: { edgeId: 'e1', t0: 0, t1: 1 }, b: { edgeId: bEdgeId, t0: 0, t1: 1 }, flip: true,
      strength: 1, threadColor: '#000', stitchVisible: true,
    });
    pattern.seams.s1 = seam('s1', 'e2');
    pattern.seams.s2 = seam('s2', 'e3');
    expect(codes(pattern)).toContain('seam_overlap');
  });

  it('honours seamInterval when reporting bad bounds', () => {
    expect(seamInterval({ id: 's' } as never, 'a')).toEqual([0, 1]);
  });

  it('reports a dart whose legs sit on different panels', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'a');
    for (const [i, from, to] of [[4, 'a1', 'a2'], [5, 'a2', 'a3'], [6, 'a3', 'a1']] as const) {
      pattern.edges[`e${i}`] = { id: `e${i}`, type: 'line', startPointId: from, endPointId: to };
    }
    pattern.panels.b = { ...pattern.panels.a!, id: 'b', name: 'b', outlineEdgeIds: ['e4', 'e5', 'e6'] };
    pattern.darts.d1 = { id: 'd1', tipId: 'a3', edge1Id: 'e1', edge2Id: 'e4', intakeCm: 2 };
    expect(codes(pattern)).toContain('dart_cross_panel');
  });

  it('reports a dart with a missing reference', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    pattern.darts.d1 = { id: 'd1', tipId: 'ghost', edge1Id: 'e1', edge2Id: 'e2', intakeCm: 2 };
    expect(codes(pattern)).toContain('dart_missing_ref');
  });
});

describe('buildPatternGraph', () => {
  it('indexes edge ownership and point references', () => {
    const pattern = makePattern();
    addTriangle(pattern, 'p');
    const graph = buildPatternGraph(pattern);
    expect(panelsOfEdge(graph, 'e1')).toEqual(['p']);
    expect(panelOfEdge(graph, 'e1')).toBe('p');
    expect(panelOfEdge(graph, 'missing')).toBeNull();
    expect(graph.pointRefs.get('p2')?.length).toBe(2);
  });

  it('lists both panels for a shared outline edge', () => {
    const pattern = makePattern();
    const a = addTriangle(pattern, 'a');
    pattern.panels.b = { ...a, id: 'b', name: 'b' };
    expect(panelsOfEdge(buildPatternGraph(pattern), 'e1')).toEqual(['a', 'b']);
  });
});
