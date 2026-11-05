import type { Pattern } from '@/model/types';

/** Edge ids referenced by any outline, hole, dart or seam. */
function edgesInUse(pattern: Pattern): Set<string> {
  const used = new Set<string>();
  for (const panel of Object.values(pattern.panels)) {
    for (const e of panel.outlineEdgeIds) used.add(e);
    for (const loop of panel.holes ?? []) for (const e of loop) used.add(e);
  }
  for (const d of Object.values(pattern.darts)) { used.add(d.edge1Id); used.add(d.edge2Id); }
  for (const s of Object.values(pattern.seams)) { used.add(s.a.edgeId); used.add(s.b.edgeId); }
  return used;
}

/** Drops edges, points, seams and darts that no longer resolve, keeping the pattern valid. */
export function prunePattern(pattern: Pattern): void {
  const usedE = edgesInUse(pattern);
  for (const id of Object.keys(pattern.edges)) if (!usedE.has(id)) delete pattern.edges[id];
  const usedP = new Set<string>();
  for (const id of Object.keys(pattern.edges)) {
    const e = pattern.edges[id];
    usedP.add(e.startPointId);
    usedP.add(e.endPointId);
  }
  for (const id of Object.keys(pattern.points)) if (!usedP.has(id)) delete pattern.points[id];
  for (const id of Object.keys(pattern.seams)) {
    const s = pattern.seams[id];
    if (!pattern.edges[s.a.edgeId] || !pattern.edges[s.b.edgeId]) delete pattern.seams[id];
  }
  for (const [id, d] of Object.entries(pattern.darts)) {
    if (!pattern.edges[d.edge1Id] || !pattern.edges[d.edge2Id] || !pattern.points[d.tipId]) {
      delete pattern.darts[id];
      for (const panel of Object.values(pattern.panels)) {
        const idx = panel.dartIds.indexOf(id);
        if (idx >= 0) panel.dartIds.splice(idx, 1);
      }
    }
  }
  // Production marks belong to a panel; stitches also need their edge.
  for (const [id, print] of Object.entries(pattern.prints ?? {})) {
    if (!pattern.panels[print.panelId]) delete pattern.prints[id];
  }
  for (const [id, stitch] of Object.entries(pattern.topstitches ?? {})) {
    if (!pattern.panels[stitch.panelId] || !pattern.edges[stitch.edgeId]) delete pattern.topstitches[id];
  }
  for (const [id, trim] of Object.entries(pattern.trims ?? {})) {
    if (!pattern.panels[trim.panelId]) delete pattern.trims[id];
  }
}
