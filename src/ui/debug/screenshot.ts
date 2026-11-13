/**
 * Debug screenshots of one viewport, with the garment and the body separable.
 *
 * The 3D pane is read from its canvas, so isolating a subject applies the pane's own display state
 * for the frames the canvas is read and restores it right after. The 2D pane renders a fresh frame
 * offscreen; it registers that renderer with this module when it mounts.
 */

import type { Project } from '@/model/types';
import type { GarmentEngine, Viewport } from '@/runtime';
import { useProjectStore } from '@/store';

/** Pane a screenshot is taken from. */
export type ScreenshotViewport = '2d' | '3d';

/** What the 2D pane draws: the whole frame, the pattern alone, or the body alone. */
export type Screenshot2DContent = 'full' | 'pattern' | 'body';

/** What the 3D pane draws: the whole frame, the garment alone, or the body alone. */
export type Screenshot3DContent = 'full' | 'garment' | 'body';

/** One request from the debug screenshot dialog. */
export type ScreenshotRequest =
  | { readonly viewport: '2d'; readonly content: Screenshot2DContent }
  | { readonly viewport: '3d'; readonly content: Screenshot3DContent };

/** Renders the 2D pane offscreen; null while the pane is not mounted. */
type Capture2D = (content: Screenshot2DContent) => HTMLCanvasElement | null;

let capture2D: Capture2D | null = null;

/** Hands the mounted 2D pane's offscreen renderer to the menu; returns its unregister function. */
export function registerViewport2DCapture(capture: Capture2D): () => void {
  capture2D = capture;
  return () => {
    if (capture2D === capture) capture2D = null;
  };
}

/** Content label used in the exported file name. */
const CONTENT_LABEL: Record<string, string> = {
  full: '完整',
  pattern: '仅版片',
  garment: '仅服装',
  body: '仅人体',
};

/** File name of one screenshot; the viewport and the isolated subject tell the images apart. */
export function screenshotName(projectName: string, request: ScreenshotRequest): string {
  return `${projectName}-${request.viewport === '2d' ? '2D' : '3D'}-${CONTENT_LABEL[request.content]}.png`;
}

/** Exports one screenshot; returns the file name, or null when the pane cannot be read. */
export async function exportDebugScreenshot(
  viewport: Viewport | null,
  request: ScreenshotRequest,
): Promise<string | null> {
  const project = useProjectStore.getState().project;
  const blob = request.viewport === '2d'
    ? await capture2DBlob(request.content)
    : await capture3DBlob(viewport, project, request.content);
  if (!blob) return null;
  const name = screenshotName(project.meta.name, request);
  saveBlob(blob, name);
  return name;
}

/** Applies the display state that leaves one subject on screen; returns the undo step. */
export function isolateSubject(
  engine: GarmentEngine,
  project: Project,
  content: Screenshot3DContent,
): () => void {
  if (content === 'garment') {
    // Restore the body to the display the project asks for, not to a fixed one.
    engine.applyAvatarDisplay('hidden');
    return () => engine.applyAvatarDisplay(project.avatar.display);
  }
  if (content === 'body') {
    engine.applyPanelVisibility(withoutPanels(project));
    // Seam ends and trims follow the cloth even when no cloth is drawn.
    engine.revealCloth(false);
    return () => {
      engine.applyPanelVisibility(project);
      // A heatmap already keeps the overlays off; only the plain view wants them back.
      engine.revealCloth(engine.analysisOverride() === null);
    };
  }
  return () => {};
}

/** PNG of the 2D pane's current scene, rendered offscreen. */
async function capture2DBlob(content: Screenshot2DContent): Promise<Blob | null> {
  const canvas = capture2D?.(content) ?? null;
  return canvas ? canvasToPng(canvas) : null;
}

/** PNG of the 3D canvas, taken with the requested subject isolated. */
async function capture3DBlob(
  viewport: Viewport | null,
  project: Project,
  content: Screenshot3DContent,
): Promise<Blob | null> {
  if (!viewport || viewport.size().width <= 1) return null;
  const restore = isolateSubject(viewport.engine, project, content);
  try {
    // The pane redraws on its own loop; the canvas holds the isolated scene after two frames.
    await nextFrames(2);
    return await canvasToPng(viewport.canvas);
  } finally {
    restore();
  }
}

/** Copy of a project whose panels all draw nothing, so only the body stays visible. */
function withoutPanels(project: Project): Project {
  const panels = Object.fromEntries(
    Object.entries(project.pattern.panels).map(([id, panel]) => [id, { ...panel, visible: false }]),
  );
  return { ...project, pattern: { ...project.pattern, panels } };
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
