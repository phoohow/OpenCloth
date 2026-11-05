/**
 * Field-level repair for documents that came from an older build, an importer or a hand edit.
 *
 * Each function takes one slice of the document, fills what is optional, clamps what must stay in
 * range and drops records that can no longer be drawn (a mark whose panel is gone). Nothing here
 * throws: structural damage is `codec`'s job to reject, this file's job is to make a readable
 * document usable. Migrations that *restructure* live in `io/migrations.ts` and run first.
 */
import type { Fabric, GarmentLayer, Notch, Pattern, PomPoint } from '@/model/types';
import { DEFAULT_LAYER_THICKNESS_CM, GARMENT_LAYERS, normalizeFabricPhysics } from '@/model/defaults';

/** Fills the material appearance and physics fields a parsed fabric may omit. */
export function normalizeFabrics(fabrics: Record<string, Fabric>): Record<string, Fabric> {
  for (const fabric of Object.values(fabrics ?? {})) {
    if (!fabric?.appearance) continue;
    fabric.physics = normalizeFabricPhysics(fabric.physics, fabric.presetKey);
    fabric.appearance.maps ??= {};
    fabric.appearance.uvTiling ??= { x: 1, y: 1 };
    fabric.appearance.uvOffset ??= { x: 0, y: 0 };
    fabric.appearance.transmission ??= 0;
    fabric.appearance.thickness ??= 0.4;
    fabric.appearance.clearcoat ??= 0;
    fabric.appearance.clearcoatRoughness ??= 0.5;
    fabric.appearance.anisotropy ??= 0;
    fabric.appearance.iridescence ??= 0;
    fabric.appearance.sheenRoughness ??= 0.4;
  }
  return fabrics;
}

/** Fills the construction-layer thickness table an old file may omit. */
export function normalizeLayers(raw: Partial<Record<GarmentLayer, number>> | undefined): Record<GarmentLayer, number> {
  const out: Record<GarmentLayer, number> = { ...DEFAULT_LAYER_THICKNESS_CM };
  for (const layer of GARMENT_LAYERS) {
    const value = raw?.[layer];
    if (typeof value === 'number' && Number.isFinite(value)) out[layer] = Math.min(2, Math.max(0, value));
  }
  return out;
}

/** Drops POM records without a usable value table, filling the fields an old file may omit. */
export function normalizePoms(poms: PomPoint[] | undefined): PomPoint[] {
  if (!Array.isArray(poms)) return [];
  const out: PomPoint[] = [];
  for (const pom of poms) {
    if (!pom || typeof pom.id !== 'string' || typeof pom.name !== 'string') continue;
    out.push({ ...pom, part: pom.part ?? '', refs: pom.refs ?? {}, values: pom.values ?? {} });
  }
  return out;
}

/** Fills collections and panel fields that a parsed or imported pattern may omit. */
export function normalizePattern(pattern: Pattern): Pattern {
  pattern.notches ??= {} as Record<string, Notch>;
  pattern.annotations ??= {};
  pattern.measurements ??= {};
  pattern.prints ??= {};
  pattern.topstitches ??= {};
  pattern.trims ??= {};
  for (const panel of Object.values(pattern.panels ?? {})) {
    panel.holes ??= [];
  }
  // Drop marks whose owner no longer exists.
  for (const [id, print] of Object.entries(pattern.prints)) {
    print.repeat ??= { x: 1, y: 1 };
    print.opacity ??= 1;
    print.angleDeg ??= 0;
    print.visible ??= true;
    if (!pattern.panels[print.panelId]) delete pattern.prints[id];
  }
  for (const [id, stitch] of Object.entries(pattern.topstitches)) {
    stitch.rows ??= 1;
    stitch.spacingMm ??= 4;
    stitch.stitchMm ??= 3;
    stitch.gapMm ??= 2;
    stitch.visible ??= true;
    if (!pattern.panels[stitch.panelId] || !pattern.edges[stitch.edgeId]) delete pattern.topstitches[id];
  }
  for (const [id, trim] of Object.entries(pattern.trims)) {
    trim.qty ??= 1;
    trim.sizeMm ??= 12;
    trim.visible ??= true;
    if (!pattern.panels[trim.panelId]) delete pattern.trims[id];
  }
  return pattern;
}
