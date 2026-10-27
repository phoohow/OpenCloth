import { describe, it, expect } from 'vitest';
import type { Project } from '../../../src/core/model/types';
import { CommandHistory } from '../../../src/core/command/command';
import type { ProjectContext } from '../../../src/core/command/command';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { AppendTemplateCommand, ApplyTemplateCommand } from '../../../src/pattern/template/templateCommands';
import { sleeveTemplate, tShirtTemplate } from '../../../src/pattern/template/index';

function harness(): { project: Project; history: CommandHistory; ctx: ProjectContext } {
  const project = createDefaultProject();
  const history = new CommandHistory();
  const ctx: ProjectContext = { project };
  return { project, history, ctx };
}

describe('模板命令', () => {
  it('应用替换版型，撤销恢复原版型', () => {
    const { project, history, ctx } = harness();
    const before = project.pattern;

    history.execute(new ApplyTemplateCommand(tShirtTemplate, tShirtTemplate.defaults), ctx);
    const applied = project.pattern;
    expect(Object.keys(applied.panels)).toHaveLength(4);
    expect(applied).not.toBe(before);

    history.undo(ctx);
    expect(project.pattern).toBe(before);

    history.redo(ctx);
    expect(Object.keys(project.pattern.panels)).toHaveLength(4);
  });

  it('追加保留已有版型片并排在其右侧', () => {
    const { project, history, ctx } = harness();
    history.execute(new ApplyTemplateCommand(tShirtTemplate, tShirtTemplate.defaults), ctx);
    const beforeIds = Object.keys(project.pattern.panels);

    history.execute(new AppendTemplateCommand(sleeveTemplate, sleeveTemplate.defaults), ctx);
    const afterIds = Object.keys(project.pattern.panels);
    expect(afterIds).toHaveLength(6);
    expect(beforeIds.every(id => afterIds.includes(id))).toBe(true);

    history.undo(ctx);
    expect(Object.keys(project.pattern.panels)).toHaveLength(4);
  });

  it('面板引用项目已有面料', () => {
    const { project, history, ctx } = harness();
    history.execute(new ApplyTemplateCommand(tShirtTemplate, tShirtTemplate.defaults), ctx);
    const fabricId = Object.keys(project.fabrics)[0];
    history.execute(new ApplyTemplateCommand(sleeveTemplate, sleeveTemplate.defaults), ctx);

    expect(Object.keys(project.fabrics)).toHaveLength(1);
    for (const panel of Object.values(project.pattern.panels)) expect(panel.fabricId).toBe(fabricId);
  });
});
