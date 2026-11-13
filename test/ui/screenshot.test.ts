import { describe, expect, it } from 'vitest';
import type { GarmentEngine } from '@/runtime';
import { createStarterProject } from '@/pattern/template/starterProject';
import { isolateSubject, screenshotName } from '@/ui/debug/screenshot';

/** Records the display calls a screenshot makes, in order. */
function recordingEngine(): { engine: GarmentEngine; calls: string[] } {
  const calls: string[] = [];
  const engine = {
    applyAvatarDisplay: (display: string) => { calls.push(`avatar:${display}`); },
    applyPanelVisibility: (project: ReturnType<typeof createStarterProject>) => {
      const visible = Object.values(project.pattern.panels).filter(p => p.visible !== false).length;
      calls.push(`panels:${visible}`);
    },
    revealCloth: (visible: boolean) => { calls.push(`overlays:${visible}`); },
    analysisOverride: () => null,
  };
  return { engine: engine as unknown as GarmentEngine, calls };
}

describe('screenshotName', () => {
  it('tells the pane and the isolated subject apart', () => {
    expect(screenshotName('衬衫', { viewport: '3d', content: 'body' })).toBe('衬衫-3D-仅人体.png');
    expect(screenshotName('衬衫', { viewport: '3d', content: 'garment' })).toBe('衬衫-3D-仅服装.png');
    expect(screenshotName('衬衫', { viewport: '2d', content: 'pattern' })).toBe('衬衫-2D-仅版片.png');
    expect(screenshotName('衬衫', { viewport: '2d', content: 'full' })).toBe('衬衫-2D-完整.png');
  });
});

describe('isolateSubject', () => {
  it('hides the body and restores the display the project asks for', () => {
    const project = { ...createStarterProject(), avatar: { ...createStarterProject().avatar, display: 'translucent' as const } };
    const { engine, calls } = recordingEngine();
    const restore = isolateSubject(engine, project, 'garment');
    expect(calls).toEqual(['avatar:hidden']);
    restore();
    expect(calls).toEqual(['avatar:hidden', 'avatar:translucent']);
  });

  it('hides every panel and restores the project pattern', () => {
    const project = createStarterProject();
    const panelCount = Object.keys(project.pattern.panels).length;
    expect(panelCount).toBeGreaterThan(0);
    const { engine, calls } = recordingEngine();
    const restore = isolateSubject(engine, project, 'body');
    expect(calls).toEqual(['panels:0', 'overlays:false']);
    restore();
    expect(calls).toEqual(['panels:0', 'overlays:false', `panels:${panelCount}`, 'overlays:true']);
    expect(Object.values(project.pattern.panels).every(p => p.visible !== false)).toBe(true);
  });

  it('leaves the scene untouched for the full frame', () => {
    const { engine, calls } = recordingEngine();
    const restore = isolateSubject(engine, createStarterProject(), 'full');
    restore();
    expect(calls).toEqual([]);
  });
});
