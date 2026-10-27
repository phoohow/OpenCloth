import { describe, it, expect } from 'vitest';
import type { Project } from '../../../src/core/model/types';
import { createDefaultProject, createFabric, FABRIC_PRESET_LABELS } from '../../../src/core/model/defaults';
import { fabricSlotPlan, panelsUsingFabric, uniqueFabricName } from '../../../src/core/model/fabric';
import type { ProjectContext } from '../../../src/core/command/command';
import { AddFabricCommand, AssignFabricCommand, DetachFabricCommand } from '../../../src/core/command/fabricCommands';

function makeCtx(project: Project): ProjectContext {
  return { project };
}

/** Project with one material record and the given number of panels wearing it. */
function projectWithPanels(count: number): Project {
  const project = createDefaultProject();
  const fabricId = Object.keys(project.fabrics)[0];
  for (let i = 0; i < count; i++) {
    const id = `panel_${i}`;
    project.pattern.panels[id] = {
      id, name: `片${i}`, outlineEdgeIds: [], dartIds: [], internalLineIds: [],
      seamAllowanceCm: 1, fabricId, meshResolutionCm: 1.5, visible: true, locked: false,
    };
  }
  return project;
}

describe('uniqueFabricName', () => {
  it('keeps a free base name and counts up when it is taken', () => {
    const project = projectWithPanels(1);
    expect(uniqueFabricName(project, '丝绸')).toBe('丝绸');
    const silk = createFabric('silk', '丝绸');
    project.fabrics[silk.id] = silk;
    expect(uniqueFabricName(project, '丝绸')).toBe('丝绸 2');
    const again = createFabric('silk', '丝绸 2');
    project.fabrics[again.id] = again;
    expect(uniqueFabricName(project, '丝绸')).toBe('丝绸 3');
  });
});

describe('fabricSlotPlan', () => {
  it('gives one slot per distinct material and a null slot for a dangling reference', () => {
    const project = projectWithPanels(3);
    const first = Object.keys(project.fabrics)[0];
    const other = createFabric('denim');
    project.fabrics[other.id] = other;
    project.pattern.panels.panel_1.fabricId = other.id;
    project.pattern.panels.panel_2.fabricId = 'gone';

    const plan = fabricSlotPlan(project, ['panel_0', 'panel_1', 'panel_2']);
    expect(plan.fabrics.map(f => f?.id ?? null)).toEqual([first, other.id, null]);
    expect(plan.slotForPanel).toEqual([0, 1, 2]);
  });
});

describe('AssignFabricCommand', () => {
  it('switches the material of a panel and restores it on undo', () => {
    const project = projectWithPanels(2);
    const before = Object.keys(project.fabrics)[0];
    const other = createFabric('knit');
    project.fabrics[other.id] = other;
    const ctx = makeCtx(project);
    const pattern = project.pattern;
    const cmd = new AssignFabricCommand(['panel_0'], other.id);

    cmd.execute(ctx);
    expect(project.pattern.panels.panel_0.fabricId).toBe(other.id);
    expect(project.pattern.panels.panel_1.fabricId).toBe(before);
    // The pattern reference stays, so the cloth is not rebuilt by a material switch.
    expect(project.pattern).toBe(pattern);

    cmd.undo(ctx);
    expect(project.pattern.panels.panel_0.fabricId).toBe(before);
  });
});

describe('AddFabricCommand', () => {
  it('adds a uniquely named material and wears it on the panel', () => {
    const project = projectWithPanels(1);
    const ctx = makeCtx(project);
    const cmd = new AddFabricCommand(['panel_0'], project, 'cotton');
    cmd.execute(ctx);

    expect(cmd.fabric.name).toBe(`${FABRIC_PRESET_LABELS.cotton} 2`);
    expect(project.fabrics[cmd.fabric.id]).toBe(cmd.fabric);
    expect(project.pattern.panels.panel_0.fabricId).toBe(cmd.fabric.id);

    cmd.undo(ctx);
    expect(project.fabrics[cmd.fabric.id]).toBeUndefined();
    expect(Object.keys(project.fabrics)).toHaveLength(1);
    expect(project.pattern.panels.panel_0.fabricId).not.toBe(cmd.fabric.id);
  });
});

describe('DetachFabricCommand', () => {
  it('copies the shared material for one panel only', () => {
    const project = projectWithPanels(2);
    const shared = Object.keys(project.fabrics)[0];
    const ctx = makeCtx(project);
    const cmd = new DetachFabricCommand(['panel_0'], project, 'panel_0');
    cmd.execute(ctx);

    const copy = cmd.fabric!;
    expect(copy.id).not.toBe(shared);
    expect(copy.appearance).toEqual(project.fabrics[shared].appearance);
    expect(copy.physics).toEqual(project.fabrics[shared].physics);
    expect(project.pattern.panels.panel_0.fabricId).toBe(copy.id);
    expect(panelsUsingFabric(project, copy.id).map(p => p.id)).toEqual(['panel_0']);

    cmd.undo(ctx);
    expect(project.fabrics[copy.id]).toBeUndefined();
    expect(project.pattern.panels.panel_0.fabricId).toBe(shared);
  });
});
