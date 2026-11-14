import { describe, expect, it } from 'vitest';
import { GARMENT_TEMPLATES } from '@/pattern/template';
import { buildPanelMesh } from '@/pattern/panel/panelBuilder';
import type { Pattern } from '@/model/types';

/** Every template's default pattern, keyed by template key. */
const patterns: Array<[string, Pattern]> = GARMENT_TEMPLATES.map(template =>
  [template.key, template.generate(template.defaults, 'fabric_default')]);

describe('template panels', () => {
  for (const [key, pattern] of patterns) {
    it(`meshes every ${key} panel`, () => {
      const panels = Object.values(pattern.panels);
      expect(panels.length).toBeGreaterThan(0);
      for (const panel of panels) {
        // A panel whose outline crosses itself meshes to nothing and would silently leave the
        // garment, so the draft has to stay a simple closed loop.
        const mesh = buildPanelMesh(pattern, panel.id);
        expect(mesh, panel.name).not.toBeNull();
        expect(mesh!.triangleCount, panel.name).toBeGreaterThan(0);
      }
    });

    it(`keeps every ${key} outline closed`, () => {
      for (const panel of Object.values(pattern.panels)) {
        const edges = panel.outlineEdgeIds.map(id => pattern.edges[id]);
        expect(edges.every(Boolean), panel.name).toBe(true);
        for (let i = 0; i < edges.length; i++) {
          const current = edges[i]!;
          const next = edges[(i + 1) % edges.length]!;
          expect(current.endPointId, `${panel.name} edge ${i}`).toBe(next.startPointId);
        }
      }
    });
  }
});
