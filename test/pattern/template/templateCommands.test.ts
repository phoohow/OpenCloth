import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import {
  AppendTemplateCommand, ApplyTemplateCommand, ArrangePanelsCommand,
} from '@/pattern/template/templateCommands';
import type { ProjectContext } from '@/model/types';

import { FILE_TEMPLATES, presetPattern } from '@/pattern/template';
import type { GarmentTemplate } from '@/pattern/template';

const shirtTemplate = FILE_TEMPLATES.find(template => template.key === 'shirt')!;

/** A template whose generated copy carries one notch, so an append adds a mark. */
const notchedTemplate: GarmentTemplate = {
  key: 'notched',
  name: '带刀口的版型',
  icon: 'panel',
  summary: '前片',
  source: 'file',
  generate: fabricId => {
    const pattern = presetPattern('tshirt', fabricId);
    pattern.notches.extra = { id: 'extra', edgeId: Object.keys(pattern.edges)[0]!, t: 0.5 };
    return pattern;
  },
};

/** Trim positions keyed by id, as the sheet stores them. */
function trimPositions(ctx: ProjectContext): Array<[string, number, number]> {
  return Object.values(ctx.project.pattern.trims).map(trim => [trim.id, trim.pos.x, trim.pos.y]);
}

describe('template commands', () => {
  it('carries the trims of an appended garment onto the sheet', () => {
    const ctx: ProjectContext = { project: createStarterProject() };
    new AppendTemplateCommand(shirtTemplate).execute(ctx);
    const trims = Object.values(ctx.project.pattern.trims);
    expect(trims.length).toBeGreaterThan(0);
    for (const trim of trims) {
      expect(ctx.project.pattern.panels[trim.panelId], trim.id).toBeDefined();
    }
  });

  it('restores trim positions when the arrangement is undone', () => {
    const ctx: ProjectContext = { project: createStarterProject() };
    new ApplyTemplateCommand(shirtTemplate).execute(ctx);
    const before = trimPositions(ctx);
    const command = new ArrangePanelsCommand();
    command.execute(ctx);
    command.undo(ctx);
    expect(trimPositions(ctx)).toEqual(before);
  });

  it('drops the appended notches when the append is undone', () => {
    const ctx: ProjectContext = { project: createStarterProject() };
    const command = new AppendTemplateCommand(notchedTemplate);

    command.execute(ctx);
    expect(ctx.project.pattern.notches.extra).toBeDefined();

    command.undo(ctx);
    expect(ctx.project.pattern.notches.extra).toBeUndefined();
  });
});