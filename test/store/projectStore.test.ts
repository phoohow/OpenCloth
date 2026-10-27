import { beforeEach, describe, expect, it } from 'vitest';
import { computeClothSignature, useProjectStore } from '../../src/store/projectStore';
import { createStarterProject } from '../../src/pattern/template';
import type { Project } from '../../src/core/model/types';

/** Fresh starter project pushed through the store before each test. */
function resetStore(project?: Project): void {
  useProjectStore.getState().loadProject(project ?? createStarterProject());
}

describe('project store command commits', () => {
  beforeEach(() => resetStore());

  it('executes a command on a draft copy and keeps the committed project untouched', () => {
    const before = useProjectStore.getState().project;
    useProjectStore.getState().executeCommand({
      label: 'test edit',
      execute: ctx => { ctx.project.meta.name = 'renamed'; },
      undo: ctx => { ctx.project.meta.name = 'restored'; },
    });
    expect(before.meta.name).not.toBe('renamed');
    expect(useProjectStore.getState().project.meta.name).toBe('renamed');
  });

  it('undo and redo roll the committed data back and forth', () => {
    const original = useProjectStore.getState().project.meta.name;
    useProjectStore.getState().executeCommand({
      label: 'rename',
      execute: ctx => { ctx.project.meta.name = 'v2'; },
      undo: ctx => { ctx.project.meta.name = original; },
    });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.meta.name).toBe(original);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.meta.name).toBe('v2');
  });

  it('bumps the cloth signature when pattern content changes', () => {
    const start = useProjectStore.getState().clothSignature;
    useProjectStore.getState().executeCommand({
      label: 'move point',
      execute: ctx => {
        const id = Object.keys(ctx.project.pattern.points)[0];
        ctx.project.pattern.points[id].pos = { x: 99, y: 99 };
      },
      undo: () => {},
    });
    expect(useProjectStore.getState().clothSignature).not.toBe(start);
  });

  it('keeps the cloth signature for draw-only and body-placement edits', () => {
    const start = useProjectStore.getState().clothSignature;
    useProjectStore.getState().executeCommand({
      label: 'draw-only flags',
      execute: ctx => {
        ctx.project.avatar.display = 'hidden';
        ctx.project.avatar.transform = {
          position: { x: 5, y: 0, z: 0 }, rotationEuler: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        };
        for (const panel of Object.values(ctx.project.pattern.panels)) panel.visible = false;
        for (const seam of Object.values(ctx.project.pattern.seams)) seam.stitchVisible = false;
      },
      undo: () => {},
    });
    expect(useProjectStore.getState().clothSignature).toBe(start);
  });

  it('bumps the cloth signature for body measurements and the global mesh resolution', () => {
    const start = useProjectStore.getState().clothSignature;
    useProjectStore.getState().executeCommand({
      label: 'measurements',
      execute: ctx => { ctx.project.avatar.params.chestCm += 5; },
      undo: () => {},
    });
    expect(useProjectStore.getState().clothSignature).not.toBe(start);

    useProjectStore.getState().executeCommand({
      label: 'mesh resolution',
      execute: ctx => { ctx.project.scene.simulation.meshResolutionCm = 2.2; },
      undo: () => {},
    });
    expect(computeClothSignature(useProjectStore.getState().project)).not.toBe(start);
  });
});
