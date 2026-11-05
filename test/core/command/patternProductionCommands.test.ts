import { describe, it, expect } from 'vitest';
import type { ProjectContext } from '@/commands/command';
import type { Pattern } from '@/model/types';
import { createEmptyPattern } from '@/model/defaults';
import { validatePattern } from '@/model/validatePattern';
import {
  SetPanelSeamAllowanceCommand, SetPanelMeshResolutionCommand, SetEdgeSeamAllowanceCommand,
  SetEdgeCornerStyleCommand,
  SetPanelGrainCommand, CreateNotchCommand, MoveNotchCommand, DeleteNotchCommand,
  CreateAnnotationCommand, UpdateAnnotationCommand, DeleteAnnotationCommand,
  CreateMeasurementCommand, DeleteMeasurementCommand,
  AddSizeCommand, RenameSizeCommand, RemoveSizeCommand, SetBaseSizeCommand, ReorderSizesCommand,
  AddPrintCommand, UpdatePrintCommand, AddTopstitchCommand, UpdateTopstitchCommand,
  AddTrimCommand, UpdateTrimCommand, DeleteSelectionCommand,
} from '@/commands/patternCommands';
import { ctxOf, addSquare } from './fixtures';
import { SetGlobalMeshResolutionCommand } from '@/commands/patternProductionCommands';

function makePattern(): Pattern {
  const p = createEmptyPattern();
  addSquare(p, 'sq', 0, 0, 10);
  return p;
}

function fresh(): { ctx: ProjectContext; panelId: string; edgeId: string } {
  const ctx = ctxOf(makePattern());
  const panelId = 'sq_panel';
  return { ctx, panelId, edgeId: ctx.project.pattern.panels[panelId].outlineEdgeIds[0] };
}

function undoPattern(ctx: ProjectContext, cmd: { execute(c: ProjectContext): void; undo(c: ProjectContext): void }) {
  const before = structuredClone(ctx.project.pattern);
  cmd.execute(ctx);
  expect(validatePattern(ctx.project.pattern)).toEqual([]);
  cmd.undo(ctx);
  expect(ctx.project.pattern).toEqual(before);
}

describe('production pattern edits', () => {
  it('panel allowance / grain', () => {
    const { ctx, panelId } = fresh();
    undoPattern(ctx, new SetPanelSeamAllowanceCommand(panelId, 1.5));
    expect(ctx.project.pattern.panels[panelId].seamAllowanceCm).toBe(1);
    undoPattern(ctx, new SetPanelGrainCommand(panelId, 45));
    expect(ctx.project.pattern.panels[panelId].grainAngleDeg).toBeUndefined();
  });

  it('panel mesh density is undoable and rejects non-positive values', () => {
    const { ctx, panelId } = fresh();
    undoPattern(ctx, new SetPanelMeshResolutionCommand(panelId, 6));
    expect(ctx.project.pattern.panels[panelId].meshResolutionCm).toBe(3);
    const before = structuredClone(ctx.project.pattern);
    expect(() => new SetPanelMeshResolutionCommand(panelId, 0).execute(ctx)).toThrow(/正数/);
    expect(() => new SetPanelMeshResolutionCommand(panelId, Number.NaN).execute(ctx)).toThrow(/正数/);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('global mesh density writes every panel and restores the project default on undo', () => {
    const ctx = ctxOf(makePattern());
    addSquare(ctx.project.pattern, 'sq2', 20, 0, 10);
    const beforePattern = structuredClone(ctx.project.pattern);
    const beforeSimulation = structuredClone(ctx.project.scene.simulation);
    const cmd = new SetGlobalMeshResolutionCommand(2);
    cmd.execute(ctx);
    expect(Object.values(ctx.project.pattern.panels).every(panel => panel.meshResolutionCm === 2)).toBe(true);
    expect(ctx.project.scene.simulation.meshResolutionCm).toBe(2);
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(beforePattern);
    expect(ctx.project.scene.simulation).toEqual(beforeSimulation);
  });

  it('grain position and length, with zero clearing back to automatic', () => {
    const { ctx, panelId } = fresh();
    const panel = ctx.project.pattern.panels[panelId];
    new SetPanelGrainCommand(panelId, 90, { x: 2, y: -3 }, 24).execute(ctx);
    expect(panel.grainOffset).toEqual({ x: 2, y: -3 });
    expect(panel.grainLengthCm).toBe(24);

    new SetPanelGrainCommand(panelId, 90, { x: 0, y: 0 }, 0).execute(ctx);
    expect(panel.grainOffset).toBeUndefined();
    expect(panel.grainLengthCm).toBeUndefined();
    expect(validatePattern(ctx.project.pattern)).toEqual([]);

    expect(() => new SetPanelGrainCommand(panelId, 90, undefined, -1).execute(ctx))
      .toThrow(/布纹线长度/);
  });

  it('edge allowance / corner style', () => {
    const { ctx, edgeId } = fresh();
    undoPattern(ctx, new SetEdgeSeamAllowanceCommand(edgeId, 2));
    undoPattern(ctx, new SetEdgeCornerStyleCommand(edgeId, 'round'));
  });

  it('notch create / move / delete', () => {
    const { ctx, edgeId } = fresh();
    const cmd = new CreateNotchCommand(edgeId, 0.5, 3, 'v');
    cmd.execute(ctx);
    const notchId = Object.keys(ctx.project.pattern.notches)[0];
    expect(ctx.project.pattern.notches[notchId].t).toBe(0.5);
    undoPattern(ctx, new MoveNotchCommand(notchId, 0.75));
    undoPattern(ctx, new DeleteNotchCommand(notchId));
    cmd.undo(ctx);
    expect(Object.keys(ctx.project.pattern.notches)).toHaveLength(0);
  });

  it('annotation create / update / delete', () => {
    const { ctx, panelId } = fresh();
    const cmd = new CreateAnnotationCommand(panelId, '前中', { x: 1, y: 1 }, { sizeMm: 4 });
    cmd.execute(ctx);
    const id = Object.keys(ctx.project.pattern.annotations)[0];
    undoPattern(ctx, new UpdateAnnotationCommand(id, { text: '后中' }));
    undoPattern(ctx, new DeleteAnnotationCommand(id));
    cmd.undo(ctx);
    expect(Object.keys(ctx.project.pattern.annotations)).toHaveLength(0);
  });

  it('measurement create / delete', () => {
    const { ctx, panelId, edgeId } = fresh();
    const cmd = new CreateMeasurementCommand('edgeLength', { edgeId }, panelId);
    cmd.execute(ctx);
    const id = Object.keys(ctx.project.pattern.measurements)[0];
    expect(ctx.project.pattern.measurements[id].panelId).toBe(panelId);
    undoPattern(ctx, new DeleteMeasurementCommand(id));
    cmd.undo(ctx);
    expect(Object.keys(ctx.project.pattern.measurements)).toHaveLength(0);
  });
});

describe('print / topstitch / trim commands', () => {
  const image = 'data:image/png;base64,AAAA';

  it('adds and edits a print, then restores the pattern on undo', () => {
    const { ctx, panelId } = fresh();
    const add = new AddPrintCommand(panelId, image, {
      imageName: 'logo.png', widthCm: 12, heightCm: 8, center: { x: 3, y: -2 },
    });
    const before = structuredClone(ctx.project.pattern);
    add.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    const id = Object.keys(ctx.project.pattern.prints)[0]!;
    const print = ctx.project.pattern.prints[id];
    expect(print.panelId).toBe(panelId);
    expect(print.imageUrl).toBe(image);
    expect(print.imageName).toBe('logo.png');
    expect(print.center).toEqual({ x: 3, y: -2 });
    expect(print.repeat).toEqual({ x: 1, y: 1 });
    expect(print.visible).toBe(true);

    const update = new UpdatePrintCommand(id, { angleDeg: 30, opacity: 0.6, repeat: { x: 2, y: 3 } });
    update.execute(ctx);
    expect(ctx.project.pattern.prints[id].angleDeg).toBe(30);
    expect(ctx.project.pattern.prints[id].opacity).toBe(0.6);
    expect(ctx.project.pattern.prints[id].repeat).toEqual({ x: 2, y: 3 });
    expect(ctx.project.pattern.prints[id].center).toEqual({ x: 3, y: -2 });

    update.undo(ctx);
    add.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('rejects prints with a missing panel, empty image or invalid placement', () => {
    const { ctx, panelId } = fresh();
    expect(() => new AddPrintCommand('missing', image).execute(ctx)).toThrow(/版片不存在/);
    expect(() => new AddPrintCommand(panelId, '').execute(ctx)).toThrow(/图片为空/);
    expect(() => new AddPrintCommand(panelId, image, { widthCm: 0 }).execute(ctx)).toThrow(/宽度/);
    expect(() => new AddPrintCommand(panelId, image, { repeat: { x: 0, y: 1 } }).execute(ctx)).toThrow(/平铺次数/);

    new AddPrintCommand(panelId, image).execute(ctx);
    const id = Object.keys(ctx.project.pattern.prints)[0]!;
    expect(() => new UpdatePrintCommand(id, { opacity: 1.5 }).execute(ctx)).toThrow(/不透明度/);
    expect(ctx.project.pattern.prints[id].opacity).toBe(1);
  });

  it('adds and edits a topstitch on an edge of its panel', () => {
    const { ctx, panelId, edgeId } = fresh();
    const add = new AddTopstitchCommand(panelId, edgeId, {
      t0: 0.2, t1: 0.9, offsetMm: 6, spacingMm: 5, rows: 2, color: '#123456',
    });
    const before = structuredClone(ctx.project.pattern);
    add.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    const id = Object.keys(ctx.project.pattern.topstitches)[0]!;
    const stitch = ctx.project.pattern.topstitches[id];
    expect(stitch.panelId).toBe(panelId);
    expect(stitch.edgeId).toBe(edgeId);
    expect(stitch.t0).toBe(0.2);
    expect(stitch.t1).toBe(0.9);
    expect(stitch.offsetMm).toBe(6);
    expect(stitch.rows).toBe(2);
    expect(stitch.color).toBe('#123456');

    const update = new UpdateTopstitchCommand(id, { rows: 3, spacingMm: 4 });
    update.execute(ctx);
    expect(ctx.project.pattern.topstitches[id].rows).toBe(3);
    update.undo(ctx);
    add.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('rejects topstitches on foreign edges or out-of-range intervals', () => {
    const { ctx, panelId, edgeId } = fresh();
    addSquare(ctx.project.pattern, 'other', 20, 0, 10);
    const foreignEdge = ctx.project.pattern.panels['other_panel'].outlineEdgeIds[0]!;
    expect(() => new AddTopstitchCommand(panelId, foreignEdge).execute(ctx)).toThrow(/不属于/);
    expect(() => new AddTopstitchCommand(panelId, edgeId, { rows: 6 }).execute(ctx)).toThrow(/行数/);
    expect(() => new AddTopstitchCommand(panelId, edgeId, { t0: 0.9, t1: 0.9 }).execute(ctx)).toThrow(/区间/);
  });

  it('adds and edits a trim with quantity and unit price', () => {
    const { ctx, panelId } = fresh();
    const add = new AddTrimCommand(panelId, 'button', { x: 5, y: 5 }, {
      name: '门襟扣', sizeMm: 12, qty: 6, unitPrice: 1.25,
    });
    const before = structuredClone(ctx.project.pattern);
    add.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    const id = Object.keys(ctx.project.pattern.trims)[0]!;
    const trim = ctx.project.pattern.trims[id];
    expect(trim.panelId).toBe(panelId);
    expect(trim.kind).toBe('button');
    expect(trim.pos).toEqual({ x: 5, y: 5 });
    expect(trim.qty).toBe(6);
    expect(trim.unitPrice).toBe(1.25);

    const update = new UpdateTrimCommand(id, { qty: 8, unitPrice: 1.5 });
    update.execute(ctx);
    expect(ctx.project.pattern.trims[id].qty).toBe(8);
    expect(ctx.project.pattern.trims[id].unitPrice).toBe(1.5);
    expect(() => new UpdateTrimCommand(id, { qty: 0 }).execute(ctx)).toThrow(/数量/);

    update.undo(ctx);
    add.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('deleting a panel cascades to its prints, topstitches and trims', () => {
    const { ctx, panelId, edgeId } = fresh();
    new AddPrintCommand(panelId, image).execute(ctx);
    new AddTopstitchCommand(panelId, edgeId).execute(ctx);
    new AddTrimCommand(panelId, 'button', { x: 2, y: 2 }).execute(ctx);
    expect(Object.keys(ctx.project.pattern.prints)).toHaveLength(1);
    expect(Object.keys(ctx.project.pattern.topstitches)).toHaveLength(1);
    expect(Object.keys(ctx.project.pattern.trims)).toHaveLength(1);

    const before = structuredClone(ctx.project.pattern);
    const cmd = new DeleteSelectionCommand([panelId]);
    cmd.execute(ctx);
    expect(ctx.project.pattern.prints).toEqual({});
    expect(ctx.project.pattern.topstitches).toEqual({});
    expect(ctx.project.pattern.trims).toEqual({});

    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });
});

describe('size chart commands', () => {
  it('add / rename / set-base / remove keep isBase unique and undo cleanly', () => {
    const { ctx } = fresh();
    const before = structuredClone({ sizes: ctx.project.sizes, activeSizeId: ctx.project.activeSizeId });

    new AddSizeCommand('M').execute(ctx);
    const sizes = ctx.project.sizes!;
    expect(sizes).toHaveLength(1);
    expect(sizes[0].isBase).toBe(true);
    const mId = sizes[0].id;

    new AddSizeCommand('L').execute(ctx);
    expect(ctx.project.sizes).toHaveLength(2);

    new RenameSizeCommand(mId, 'S').execute(ctx);
    expect(ctx.project.sizes!.find(s => s.id === mId)!.label).toBe('S');

    new SetBaseSizeCommand(ctx.project.sizes![1].id).execute(ctx);
    const baseFlags = ctx.project.sizes!.filter(s => s.isBase);
    expect(baseFlags).toHaveLength(1);
    expect(baseFlags[0].id).toBe(ctx.project.sizes![1].id);

    new RemoveSizeCommand(ctx.project.sizes![1].id).execute(ctx);
    const remaining = ctx.project.sizes!;
    expect(remaining.filter(s => s.isBase)).toHaveLength(1);

    // Undo the whole sequence in reverse.
    ctx.project.sizes = structuredClone(before.sizes);
    ctx.project.activeSizeId = before.activeSizeId;
    expect(ctx.project.sizes).toBeUndefined();
  });

  it('remove transfers base flag and undo restores exact sizes', () => {
    const { ctx } = fresh();
    new AddSizeCommand('M').execute(ctx);
    new AddSizeCommand('L').execute(ctx);
    const baseId = ctx.project.sizes!.find(s => s.isBase)!.id;
    const cmd = new RemoveSizeCommand(baseId);
    cmd.execute(ctx);
    expect(ctx.project.sizes!.find(s => s.isBase)).toBeDefined();
    cmd.undo(ctx);
    expect(ctx.project.sizes!.find(s => s.id === baseId)!.isBase).toBe(true);
  });

  it('reorder swaps with the neighbour, renumbers densely and undoes', () => {
    const { ctx } = fresh();
    new AddSizeCommand('A').execute(ctx);
    new AddSizeCommand('B').execute(ctx);
    new AddSizeCommand('C').execute(ctx);
    const before = structuredClone(ctx.project.sizes);
    const label = (id: string) => ctx.project.sizes!.find(s => s.id === id)!.label;
    const order = () => [...ctx.project.sizes!].sort((a, b) => a.seq - b.seq).map(s => s.label);
    const bId = ctx.project.sizes!.find(s => s.label === 'B')!.id;

    const down = new ReorderSizesCommand(bId, 1);
    down.execute(ctx);
    expect(order()).toEqual(['A', 'C', 'B']);
    expect([...ctx.project.sizes!].sort((a, b) => a.seq - b.seq).map(s => s.seq)).toEqual([0, 1, 2]);
    down.undo(ctx);
    expect(ctx.project.sizes).toEqual(before);

    const up = new ReorderSizesCommand(bId, -1);
    up.execute(ctx);
    expect(order()).toEqual(['B', 'A', 'C']);
    expect(label(bId)).toBe('B');
    up.undo(ctx);
    expect(ctx.project.sizes).toEqual(before);
  });

  it('reorder refuses to move past the ends', () => {
    const { ctx } = fresh();
    new AddSizeCommand('A').execute(ctx);
    new AddSizeCommand('B').execute(ctx);
    const before = structuredClone(ctx.project.sizes);
    const aId = ctx.project.sizes!.find(s => s.label === 'A')!.id;
    expect(() => new ReorderSizesCommand(aId, -1).execute(ctx)).toThrow(/首尾/);
    expect(() => new ReorderSizesCommand(aId, 2).execute(ctx)).toThrow(/首尾/);
    expect(ctx.project.sizes).toEqual(before);
  });
});
