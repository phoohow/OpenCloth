import type { Seam } from '@/model/types';
import { seamNumbers } from '@/pattern/seam';
import { gridStepCm } from '@/ui/viewport2D/viewMath';
import { createPen } from '@/ui/viewport2D/pen';
import { drawGrid, drawRuler } from '@/ui/viewport2D/drawPrimitives';
import { drawPanel } from '@/ui/viewport2D/drawPanels';
import { drawSeam, drawSeamDraft, drawSeamJoints } from '@/ui/viewport2D/drawSeams';
import {
  drawAnnotation, drawDart, drawGrain, drawInternalLine, drawMeasurement, drawNotch, drawPrint,
  drawTopstitch, drawTrim,
} from '@/ui/viewport2D/drawMarks';
import {
  drawDraft, drawElementSelection, drawGhost, drawHover, drawInsertHint, drawMarkHint,
  drawRubberBand, drawSnapHint,
} from '@/ui/viewport2D/drawInteraction';
import { type DisplayOptions, type DrawLayer, type SceneState } from '@/ui/viewport2D/renderTypes';

export type {
  DisplayOptions, DrawLayer, InteractionState, PreviewDrag, SceneState,
} from '@/ui/viewport2D/renderTypes';

/** Display switches used when the pane does not name any. */
const DEFAULT_DISPLAY: DisplayOptions = {
  internal: true, darts: true, seamAllowance: false, notches: true, grain: true,
  annotations: true, measurements: true, gradingOverlay: false, seamJoin: false,
  prints: true, topstitches: true, trims: true, wireframe: false,
};

/** Factory thread colour; a seam still carrying it is drawn with a palette hue instead. */
const DEFAULT_SEAM_THREAD = '#ff4444';

/** Hues cycled across seams so neighbouring pairs never share a colour. */
const SEAM_PALETTE = [
  '#ff6b8b', '#4da6ff', '#ffb84d', '#5fd6a6', '#b48cff',
  '#ff9a4d', '#5ad1e6', '#e07bff', '#8ad14b', '#ff7ad1',
];

/**
 * Display colour of a seam: the thread colour the user picked, or a palette hue for its display
 * order. Past the palette length the hue keeps stepping by the golden angle, so a long seam list
 * still gets distinct colours instead of repeats.
 */
function seamColor(seam: Seam, index: number): string {
  const custom = seam.threadColor?.toLowerCase();
  if (custom && custom !== DEFAULT_SEAM_THREAD) return seam.threadColor;
  const entry = SEAM_PALETTE[index];
  return entry ?? `hsl(${((index * 137.508) % 360).toFixed(0)} 70% 62%)`;
}

/** Background, panels, markings, seams and interaction overlays, back to front. */
export const DRAW_LAYERS: readonly DrawLayer[] = [
  {
    id: 'background',
    draw: (pen) => {
      pen.ctx.fillStyle = '#252528';
      pen.ctx.fillRect(0, 0, pen.width, pen.height);
      drawGrid(pen.ctx, pen.width, pen.height, pen.view, gridStepCm(pen.scale));
    },
  },
  {
    id: 'grading',
    when: (_state, display) => display.gradingOverlay,
    draw: (pen, state) => {
      for (const size of state.gradingOutlines ?? []) {
        pen.ctx.strokeStyle = 'rgba(160,160,180,0.4)';
        pen.ctx.lineWidth = 1;
        for (const poly of size.polygons) {
          pen.ctx.beginPath();
          poly.forEach((p, i) => {
            const s = pen.screen(p);
            if (i === 0) pen.ctx.moveTo(s.x, s.y); else pen.ctx.lineTo(s.x, s.y);
          });
          pen.ctx.closePath();
          pen.ctx.stroke();
        }
      }
    },
  },
  {
    id: 'panels',
    draw: (pen, state, display) => {
      for (const panel of Object.values(state.pattern.panels)) {
        drawPanel(pen.ctx, state, panel.id, pen.screen, display);
      }
    },
  },
  {
    id: 'prints',
    when: (_state, display) => display.prints,
    draw: (pen, state) => {
      for (const print of Object.values(state.pattern.prints ?? {})) {
        drawPrint(pen.ctx, state, print, pen.screen, pen.scale);
      }
    },
  },
  {
    id: 'internalLines',
    when: (_state, display) => display.internal,
    draw: (pen, state) => {
      for (const panel of Object.values(state.pattern.panels)) {
        for (const lineId of panel.internalLineIds) {
          drawInternalLine(pen.ctx, state.pattern, lineId, pen.screen);
        }
      }
    },
  },
  {
    id: 'darts',
    when: (_state, display) => display.darts,
    draw: (pen, state) => {
      for (const panel of Object.values(state.pattern.panels)) {
        for (const dartId of panel.dartIds) {
          drawDart(pen.ctx, state, state.pattern, dartId, pen.screen);
        }
      }
    },
  },
  {
    id: 'notches',
    when: (_state, display) => display.notches,
    draw: (pen, state) => {
      for (const notch of Object.values(state.pattern.notches ?? {})) {
        drawNotch(pen.ctx, state.pattern, notch, pen.screen);
      }
    },
  },
  {
    id: 'grain',
    when: (_state, display) => display.grain,
    draw: (pen, state) => {
      for (const panel of Object.values(state.pattern.panels)) {
        drawGrain(pen.ctx, state, panel.id, pen.screen);
      }
    },
  },
  {
    id: 'topstitches',
    when: (_state, display) => display.topstitches,
    draw: (pen, state) => {
      for (const stitch of Object.values(state.pattern.topstitches ?? {})) {
        drawTopstitch(pen.ctx, state.pattern, stitch, pen.screen, pen.scale);
      }
    },
  },
  {
    id: 'trims',
    when: (_state, display) => display.trims,
    draw: (pen, state) => {
      for (const trim of Object.values(state.pattern.trims ?? {})) {
        drawTrim(pen.ctx, state.pattern, trim, pen.screen, pen.scale);
      }
    },
  },
  {
    id: 'annotations',
    when: (_state, display) => display.annotations,
    draw: (pen, state) => {
      for (const note of Object.values(state.pattern.annotations ?? {})) {
        drawAnnotation(pen.ctx, note.pos, note.text, note.angleDeg ?? 0, pen.screen);
      }
    },
  },
  {
    id: 'measurements',
    when: (_state, display) => display.measurements,
    draw: (pen, state) => {
      for (const measurement of Object.values(state.pattern.measurements ?? {})) {
        drawMeasurement(pen.ctx, state.pattern, measurement, pen.screen);
      }
    },
  },
  {
    id: 'seams',
    when: state => state.showSeams,
    draw: (pen, state) => {
      const numbers = seamNumbers(state.pattern);
      Object.values(state.pattern.seams).forEach((seam, index) => {
        if (seam.stitchVisible === false) return;
        drawSeam(pen.ctx, state.pattern, seam, pen.screen, seamColor(seam, index), numbers.get(seam.id) ?? index + 1);
      });
    },
  },
  {
    id: 'seamJoints',
    when: (_state, display) => display.seamJoin,
    draw: (pen, state) => drawSeamJoints(pen.ctx, state, pen.screen),
  },
  {
    id: 'selection',
    draw: (pen, state) => drawElementSelection(pen.ctx, state, pen.screen, pen.scale),
  },
  {
    id: 'draft',
    draw: (pen, state) => drawDraft(pen.ctx, state, pen.screen),
  },
  {
    id: 'seamDraft',
    draw: (pen, state) => drawSeamDraft(pen.ctx, state, pen.screen),
  },
  {
    id: 'insertHint',
    draw: (pen, state) => drawInsertHint(pen.ctx, state, pen.screen),
  },
  {
    id: 'snapHint',
    draw: (pen, state) => drawSnapHint(pen.ctx, state, pen.screen),
  },
  {
    id: 'hover',
    draw: (pen, state) => drawHover(pen.ctx, state, pen.screen),
  },
  {
    id: 'markHint',
    draw: (pen, state) => drawMarkHint(pen.ctx, state, pen.screen),
  },
  {
    id: 'ghost',
    draw: (pen, state) => drawGhost(pen.ctx, state, pen.screen),
  },
  {
    id: 'rubberBand',
    draw: (pen, state) => drawRubberBand(pen.ctx, state, pen.screen),
  },
  {
    id: 'ruler',
    draw: (pen) => drawRuler(pen.ctx, pen.width, pen.height, pen.view),
  },
];

/** Full frame: every draw layer, in its declared back-to-front order. */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: SceneState): void {
  const state = scene.preview ? { ...scene, pattern: scene.preview.pattern } : scene;
  const display = state.display ?? DEFAULT_DISPLAY;
  const pen = createPen(ctx, w, h, state.view);
  for (const layer of DRAW_LAYERS) {
    if (layer.when && !layer.when(state, display)) continue;
    layer.draw(pen, state, display);
  }
}
