import { describe, expect, it } from 'vitest';
import type { Pattern, Seam } from '../../../src/core/model/types';
import { createEmptyPattern } from '../../../src/core/model/defaults';
import { inferCollisionLayers } from '../../../src/pattern/auto/autoLayer';
import { AutoAssignCollisionLayersCommand } from '../../../src/core/command/patternCommands';
import { ctxOf, addSquare } from '../../core/command/fixtures';

/** Joins two panel edges across their full length. */
function seam(pattern: Pattern, id: string, edgeA: string, edgeB: string): void {
  const record: Seam = {
    id, type: 'normal',
    a: { edgeId: edgeA, t0: 0, t1: 1 },
    b: { edgeId: edgeB, t0: 0, t1: 1 },
    flip: false, strength: 0.8, threadColor: '#ffffff', stitchVisible: true,
  };
  pattern.seams[id] = record;
}

/** Two garments: panels a+b sewn together, panels c+d sewn together, nothing between them. */
function twoGarments(): Pattern {
  const pattern = createEmptyPattern();
  addSquare(pattern, 'a', 0, 0, 10);
  addSquare(pattern, 'b', 20, 0, 10);
  addSquare(pattern, 'c', 0, 20, 10);
  addSquare(pattern, 'd', 20, 20, 10);
  seam(pattern, 's_ab', 'a_e0', 'b_e0');
  seam(pattern, 's_cd', 'c_e0', 'd_e0');
  return pattern;
}

describe('inferCollisionLayers', () => {
  it('groups panels joined by a seam into one layer', () => {
    const layers = inferCollisionLayers(twoGarments());
    expect(layers.get('a_panel')).toBe(layers.get('b_panel'));
    expect(layers.get('c_panel')).toBe(layers.get('d_panel'));
    expect(layers.get('a_panel')).not.toBe(layers.get('c_panel'));
  });

  it('puts every panel of a single connected garment on the innermost layer', () => {
    const pattern = createEmptyPattern();
    addSquare(pattern, 'a', 0, 0, 10);
    addSquare(pattern, 'b', 20, 0, 10);
    seam(pattern, 's_ab', 'a_e0', 'b_e0');
    const layers = inferCollisionLayers(pattern);
    expect(layers.get('a_panel')).toBe(0);
    expect(layers.get('b_panel')).toBe(0);
  });

  it('orders separate garments by mean drape ease, innermost first', () => {
    const pattern = twoGarments();
    // The looser garment supports a body wrap with extra ease, so it sorts to the outer layer.
    pattern.panels.c_panel.drape = { region: 'torso', easeCm: 5 };
    pattern.panels.d_panel.drape = { region: 'torso', easeCm: 5 };
    const layers = inferCollisionLayers(pattern);
    expect(layers.get('a_panel')).toBe(0);
    expect(layers.get('c_panel')).toBe(1);
  });
});

describe('AutoAssignCollisionLayersCommand', () => {
  it('writes the inferred layers and rolls back cleanly', () => {
    const ctx = ctxOf(twoGarments());
    const before = structuredClone(ctx.project.pattern);
    const cmd = new AutoAssignCollisionLayersCommand();

    cmd.execute(ctx);
    expect(ctx.project.pattern.panels.a_panel.collisionLayer).toBe(0);
    expect(ctx.project.pattern.panels.b_panel.collisionLayer).toBe(0);
    expect(ctx.project.pattern.panels.c_panel.collisionLayer).toBe(1);
    expect(ctx.project.pattern.panels.d_panel.collisionLayer).toBe(1);

    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });
});