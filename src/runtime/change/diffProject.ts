import type { Project } from '@/model/types';
import { avatarBodySignature } from './buildSignatures';
import { ChangeSet, type Aspect } from './changeSet';

/** Pattern fields that only affect drawing; a change to them never rebuilds the cloth. */
const DRAW_ONLY_FIELDS = new Set([
  'display', 'visible', 'stitchVisible', 'name', 'locked',
  'notches', 'annotations', 'measurements', 'threadColor',
  'prints', 'topstitches', 'trims',
]);

/**
 * Compares two project revisions and reports the runtime concerns that have to re-read something.
 * This is the only place that knows which document fields feed which concern.
 */
export function diffProject(prev: Project, next: Project): ChangeSet {
  const aspects = new Set<Aspect>();
  const panelIds = new Set<string>();

  // The merged cloth reads the pattern minus its draw-only fields, the body and the mesh settings.
  if (clothInputSignature(prev) !== clothInputSignature(next)) {
    aspects.add('cloth.geometry');
    aspects.add('cloth.constraints');
  }
  if (fabricDiffers(prev, next)) aspects.add('cloth.fabric');
  if (markingDiffers(prev, next)) aspects.add('cloth.marking');
  if (!sameJson(lookOf(prev), lookOf(next))) aspects.add('avatar.look');
  if (!sameJson(prev.scene.lights, next.scene.lights)) {
    aspects.add('scene.light');
    aspects.add('scene.environment');
  }
  if (!sameJson(prev.scene.render, next.scene.render)) aspects.add('scene.render');
  if (!sameJson(prev.scene.simulation, next.scene.simulation)) aspects.add('scene.simulation');
  if (!sameJson(prev.scene.referenceObjects ?? [], next.scene.referenceObjects ?? [])) {
    aspects.add('scene.references');
  }

  collectPanelChanges(prev, next, aspects, panelIds);
  return ChangeSet.of(aspects, panelIds);
}

/** Everything the merged cloth and the solver input are built from. */
function clothInputSignature(project: Project): string {
  const pattern = JSON.stringify(project.pattern, (key, value) => (
    DRAW_ONLY_FIELDS.has(key) ? undefined : value
  ));
  const body = avatarBodySignature(project.avatar);
  return `${pattern}|${body}|${project.scene.simulation.meshResolutionCm ?? null}|${project.scene.simulation.meshSampling ?? null}`;
}

/** Panels each panel-scoped aspect applies to. */
function collectPanelChanges(
  prev: Project, next: Project, aspects: Set<Aspect>, panelIds: Set<string>,
): void {
  const before = prev.pattern.panels;
  const after = next.pattern.panels;
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) {
    const a = before[id];
    const b = after[id];
    if (!a || !b) {
      aspects.add('cloth.geometry');
      panelIds.add(id);
      continue;
    }
    if (a.visible !== b.visible) {
      aspects.add('cloth.visibility');
      panelIds.add(id);
    }
    if (a.fabricId !== b.fabricId) {
      aspects.add('cloth.fabric');
      panelIds.add(id);
    }
    if (a.layer !== b.layer || a.collisionLayer !== b.collisionLayer) {
      aspects.add('cloth.layer');
      panelIds.add(id);
    }
  }
}

/** Material records, prints and the render mode feed the cloth materials. */
function fabricDiffers(prev: Project, next: Project): boolean {
  if (prev.scene.render.fill !== next.scene.render.fill) return true;
  return !sameJson(prev.fabrics, next.fabrics)
    || !sameJson(prev.pattern.prints ?? {}, next.pattern.prints ?? {});
}

/** Stitch, trim and drafting marks are drawn on top of the cloth without touching it. */
function markingDiffers(prev: Project, next: Project): boolean {
  // Thread colour and viewport visibility of a seam live on the seam record itself.
  const seamMarks = (project: Project): unknown => Object.values(project.pattern.seams ?? {})
    .map(seam => [seam.id, seam.threadColor, seam.stitchVisible, seam.name]);
  return !sameJson(seamMarks(prev), seamMarks(next))
    || !sameJson(prev.pattern.topstitches ?? {}, next.pattern.topstitches ?? {})
    || !sameJson(prev.pattern.trims ?? {}, next.pattern.trims ?? {})
    || !sameJson(prev.pattern.notches ?? {}, next.pattern.notches ?? {})
    || !sameJson(prev.pattern.annotations ?? {}, next.pattern.annotations ?? {})
    || !sameJson(prev.pattern.measurements ?? {}, next.pattern.measurements ?? {});
}

/** Body fields the renderer re-reads without rebuilding anything. */
function lookOf(project: Project): unknown {
  const { display, name, transform, appearance, softBody } = project.avatar;
  return { display, name, transform, appearance, softBody };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
