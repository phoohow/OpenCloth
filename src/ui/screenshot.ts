import type { Project } from '@/model/types';
import type { GarmentEngine, Viewport } from '@/runtime';
import type { DisplayOptions } from '@/ui/viewport2D/render';

import { useProjectStore } from '@/store';

export const CAPTURE_3D_SUBJECTS: ReadonlyArray<{ key: Capture3DSubject; label: string }> = [
  { key: 'avatar', label: '模特' },
  { key: 'panels', label: '版片' },
  { key: 'seams', label: '缝合线' },
  { key: 'topstitches', label: '明线' },
  { key: 'trims', label: '辅料' },
  { key: 'references', label: '参考物' },
];

let render2D: Render2D | null = null;

export type CaptureViewport = '2d' | '3d';

export type Capture3DSubject = 'avatar' | 'panels' | 'seams' | 'topstitches' | 'trims' | 'references';

export interface Capture2DOptions {
  panels: boolean;
  display: DisplayOptions;
}

export type CaptureRequest =
  | { readonly viewport: '3d'; readonly subjects: readonly Capture3DSubject[] }
  | { readonly viewport: '2d'; readonly options: Capture2DOptions };

type Render2D = (options: Capture2DOptions) => HTMLCanvasElement | null;

export function registerViewport2DCapture(render: Render2D): () => void {
  render2D = render;
  return () => {
    if (render2D === render) render2D = null;
  };
}

export function screenshotName(projectName: string, request: CaptureRequest): string {
  return `${projectName}-${request.viewport === '2d' ? '2D' : '3D'}-截帧.png`;
}

export async function renderCapture(
  viewport: Viewport | null,
  request: CaptureRequest,
): Promise<Blob | null> {
  if (request.viewport === '2d') {
    const canvas = render2D?.(request.options) ?? null;
    return canvas ? canvasToPng(canvas) : null;
  }

  if (!viewport || viewport.size().width <= 1) return null;
  const project = useProjectStore.getState().project;
  const undo: Array<() => void> = [];
  try {
    isolateSubjects(viewport.engine, project, request.subjects, undo);
    await nextFrames(3);
    await new Promise(resolve => setTimeout(resolve, 120));
    return await canvasToPng(viewport.canvas);
  } finally {
    restoreScene(undo);
  }
}

export function exportFrame(blob: Blob, request: CaptureRequest): void {
  saveBlob(blob, screenshotName(useProjectStore.getState().project.meta.name, request));
}

function isolateSubjects(
  engine: GarmentEngine,
  project: Project,
  subjects: readonly Capture3DSubject[],
  undo: Array<() => void>,
): void {
  const keep = new Set(subjects);

  if (!keep.has('avatar')) {
    undo.push(() => engine.applyAvatarDisplay(project.avatar.display));
    engine.applyAvatarDisplay('hidden');
  }

  if (!keep.has('panels') || !keep.has('seams') || !keep.has('topstitches') || !keep.has('trims')) {
    const pruned = projectWithSubjects(project, keep);
    undo.push(() => {
      engine.applyPanelVisibility(project);
      engine.applySeamStitchVisibility(project);
      engine.applyThreadOverlays(project);
      engine.applyTrimInstances(project);
    });
    engine.applyPanelVisibility(pruned);
    engine.applySeamStitchVisibility(pruned);
    engine.applyThreadOverlays(pruned);
    engine.applyTrimInstances(pruned);
  }

  if (!keep.has('references')) {
    const shown = engine.listReferenceObjects().filter(reference => reference.visible);
    undo.push(() => {
      for (const reference of shown) engine.setReferenceVisible(reference.id, true);
    });
    for (const reference of shown) engine.setReferenceVisible(reference.id, false);
  }
}

function restoreScene(undo: Array<() => void>): void {
  for (const step of undo.reverse()) {
    try {
      step();
    } catch (err) {
      console.warn('Debug capture restore step failed:', err);
    }
  }
}

function projectWithSubjects(project: Project, keep: Set<Capture3DSubject>): Project {
  const pattern = project.pattern;
  return {
    ...project,
    pattern: {
      ...pattern,
      panels: keep.has('panels')
        ? pattern.panels
        : mapValues(pattern.panels, panel => ({ ...panel, visible: false })),
      seams: keep.has('seams')
        ? pattern.seams
        : mapValues(pattern.seams, seam => ({ ...seam, stitchVisible: false })),
      topstitches: keep.has('topstitches')
        ? pattern.topstitches
        : mapValues(pattern.topstitches, stitch => ({ ...stitch, visible: false })),
      trims: keep.has('trims')
        ? pattern.trims
        : mapValues(pattern.trims, trim => ({ ...trim, visible: false })),
    },
  };
}

function mapValues<T>(record: Record<string, T>, map: (value: T) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([id, value]) => [id, map(value)]));
}

function nextFrames(count: number): Promise<void> {
  return new Promise(resolve => {
    let left = count;
    const step = (): void => {
      if (left <= 0) {
        setTimeout(resolve, 0);
        return;
      }

      left -= 1;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
