/**
 * Frames of one viewport for the debug capture dialog.
 *
 * The 3D pane is read from its canvas, so a subject switched off applies the pane's own display
 * state for the frames the canvas is read and restores it right after. The 2D pane renders a fresh
 * frame offscreen; it registers that renderer with this module when it mounts.
 */

import type { Project } from '@/model/types';
import type { GarmentEngine, Viewport } from '@/runtime';
import { useProjectStore } from '@/store';
import type { DisplayOptions } from '@/ui/viewport2D/render';

/** Pane a frame is taken from. */
export type CaptureViewport = '2d' | '3d';

/** Subjects the 3D frame can keep; every other one is hidden for the shot. */
export type Capture3DSubject = 'avatar' | 'panels' | 'seams' | 'topstitches' | 'trims' | 'references';

/** The 3D subject list, in the order the capture rail shows it. */
export const CAPTURE_3D_SUBJECTS: ReadonlyArray<{ key: Capture3DSubject; label: string }> = [
  { key: 'avatar', label: '模特' },
  { key: 'panels', label: '版片' },
  { key: 'seams', label: '缝线' },
  { key: 'topstitches', label: '明线' },
  { key: 'trims', label: '辅料' },
  { key: 'references', label: '参考对象' },
];

/** What the 2D frame draws: the panels plus the pane's display layers. */
export interface Capture2DOptions {
  /** Whether the panels and everything on them are drawn. */
  panels: boolean;
  display: DisplayOptions;
}

/** One frame the capture dialog asks for. */
export type CaptureRequest =
  | { readonly viewport: '3d'; readonly subjects: readonly Capture3DSubject[] }
  | { readonly viewport: '2d'; readonly options: Capture2DOptions };

/** Renders the 2D pane offscreen; null while the pane is not mounted. */
type Render2D = (options: Capture2DOptions) => HTMLCanvasElement | null;

let render2D: Render2D | null = null;

/** Hands the mounted 2D pane's offscreen renderer to the menu; returns its unregister function. */
export function registerViewport2DCapture(render: Render2D): () => void {
  render2D = render;
  return () => {
    if (render2D === render) render2D = null;
  };
}

/** File name of one captured frame. */
export function screenshotName(projectName: string, request: CaptureRequest): string {
  return `${projectName}-${request.viewport === '2d' ? '2D' : '3D'}-截帧.png`;
}

/**
 * PNG of one pane with the request's subjects drawn and nothing else changed; null when the pane
 * cannot be read. The bytes are detached from the pane, so the caller may hold on to them.
 */
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
    // The pane redraws on its own loop and the canvas bitmap lands a present later, so the read
    // waits for a few frames plus a beat.
    await nextFrames(3);
    await new Promise(resolve => setTimeout(resolve, 120));
    // Read through the PNG snapshot: a GPU-backed canvas does not paint into a 2D context.
    return await canvasToPng(viewport.canvas);
  } finally {
    restoreScene(undo);
  }
}

/** Hands a captured frame to the browser as a PNG download. */
export function exportFrame(blob: Blob, request: CaptureRequest): void {
  saveBlob(blob, screenshotName(useProjectStore.getState().project.meta.name, request));
}

/**
 * Applies the display state that leaves the listed subjects on screen, pushing one undo step per
 * change as it goes, so a step that throws still leaves the scene restorable.
 */
function isolateSubjects(
  engine: GarmentEngine,
  project: Project,
  subjects: readonly Capture3DSubject[],
  undo: Array<() => void>,
): void {
  const keep = new Set(subjects);

  if (!keep.has('avatar')) {
    // Restore the body to the display the project asks for, not to a fixed one.
    undo.push(() => engine.applyAvatarDisplay(project.avatar.display));
    engine.applyAvatarDisplay('hidden');
  }

  // Panels, threads and trims each follow a record flag, so one pruned copy hides them all.
  if (!keep.has('panels') || !keep.has('seams') || !keep.has('topstitches') || !keep.has('trims')) {
    const pruned = projectWithSubjects(project, keep);
    undo.push(() => {
      engine.applyPanelVisibility(project);
      engine.applySeamStitchVisibility(project);
      engine.applyTopstitchThreads(project);
      engine.applyTrimInstances(project);
    });
    engine.applyPanelVisibility(pruned);
    engine.applySeamStitchVisibility(pruned);
    engine.applyTopstitchThreads(pruned);
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

/** Puts the scene back after a capture, whatever happened to the individual steps. */
function restoreScene(undo: Array<() => void>): void {
  for (const step of undo.reverse()) {
    try {
      step();
    } catch (err) {
      console.warn('Debug capture restore step failed:', err);
    }
  }
}

/** Copy of a project drawing only the listed subjects. */
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

/** Copy of a record with every value passed through `map`. */
function mapValues<T>(record: Record<string, T>, map: (value: T) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([id, value]) => [id, map(value)]));
}

/** Waits for a number of pane frames plus the present that follows them. */
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

/** PNG bytes of a canvas. */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/** Hands a blob to the browser as a download. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
