import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import {
  AppendTemplateCommand, ApplyTemplateCommand, ArrangePanelsCommand,
} from '@/pattern/template/templateCommands';
import { shirtTemplate } from '@/pattern/template/shirtTemplate';
import type { ProjectContext } from '@/model/types';

/** Trim positions keyed by id, as the sheet stores them. */
function trimPositions(ctx: ProjectContext): Array<[string, number, number]> {
  return Object.values(ctx.project.pattern.trims).map(trim => [trim.id, trim.pos.x, trim.pos.y]);
}

describe('template commands', () => {
  it('carries the trims of an appended garment onto the sheet', () => {
    const ctx: ProjectContext = { project: createStarterProject() };
    new AppendTemplateCommand(shirtTemplate, shirtTemplate.defaults).execute(ctx);
    const trims = Object.values(ctx.project.pattern.trims);
    expect(trims.length).toBeGreaterThan(0);
    for (const trim of trims) {
      expect(ctx.project.pattern.panels[trim.panelId], trim.id).toBeDefined();
    }
  });

  it('restores trim positions when the arrangement is undone', () => {
    const ctx: ProjectContext = { project: createStarterProject() };
    new ApplyTemplateCommand(shirtTemplate, shirtTemplate.defaults).execute(ctx);
    const before = trimPositions(ctx);
    const command = new ArrangePanelsCommand();
    command.execute(ctx);
    command.undo(ctx);
    expect(trimPositions(ctx)).toEqual(before);
  });
});