import { describe, expect, it } from 'vitest';
import { vec2 } from '../../../src/core/model/types';
import { pointAtT, sampleEdgeInterval } from '../../../src/pattern/geom/edgeSample';
import { sampleEdge, samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import { printFrame } from '../../../src/ui/viewport2D/tools';
import { DISPLAY, drawFrame, patternWithLines, samePath, screenPoints } from './canvasScene';

/** Colour and width of the select tool's pre-highlight. */
const HOVER_COLOR = 'rgba(255,215,94,0.7)';
const HOVER_WIDTH = 2.5;
const PANEL_TINT = 'rgba(255,215,94,0.07)';

/** Ring stroke at one screen point, or null when no ring of that colour was drawn. */
const hoverRing = (strokes: ReturnType<typeof drawFrame>['strokes'], style: string) =>
  strokes.find(s => s.style === style && s.width === 1.5 && s.points.length === 1)?.points[0] ?? null;

describe('select tool hover pre-highlight', () => {
  it('draws nothing extra without a hover target', () => {
    const { strokes, fills } = drawFrame();

    expect(strokes.some(s => s.style === HOVER_COLOR)).toBe(false);
    expect(fills.some(f => f.style === PANEL_TINT)).toBe(false);
  });

  it('rings a hovered outline vertex, red in the delete-point tool', () => {
    const pattern = patternWithLines();
    const point = screenPoints([pattern.points.p0!.pos])[0]!;

    expect(hoverRing(drawFrame({ hover: { kind: 'point', id: 'p0' } }).strokes, HOVER_COLOR)).toEqual(point);
    expect(hoverRing(drawFrame({ hover: { kind: 'point', id: 'p0' }, hoverDelete: true }).strokes, '#ff6b6b')).toEqual(point);
  });

  it('rings a hovered vertex of a selected internal line', () => {
    const line = patternWithLines().internalLines.fold!;
    const vertex = screenPoints([line.points[1]!])[0]!;

    expect(hoverRing(drawFrame({
      selection: ['@internal:fold'], hover: { kind: 'internalVertex', lineId: 'fold', index: 1 },
    }).strokes, HOVER_COLOR)).toEqual(vertex);
  });

  it('pre-highlights a hovered outline edge', () => {
    const pattern = patternWithLines();
    const edge = screenPoints(sampleEdge(pattern, 'e0'));
    const { strokes } = drawFrame({ hover: { kind: 'edge', id: 'e0' } });

    expect(strokes.some(s => s.style === HOVER_COLOR && s.width === HOVER_WIDTH
      && samePath(s.points, edge))).toBe(true);
  });

  it('pre-highlights a hovered internal line', () => {
    const line = patternWithLines().internalLines.fold!;
    const points = screenPoints(line.points);
    const { strokes } = drawFrame({ hover: { kind: 'internal', id: 'fold' } });

    expect(strokes.some(s => s.style === HOVER_COLOR && s.width === HOVER_WIDTH
      && samePath(s.points, points))).toBe(true);
    expect(strokes.some(s => s.style === HOVER_COLOR
      && samePath(s.points, screenPoints(patternWithLines().internalLines.split!.points)))).toBe(false);
  });

  it('tints and outlines a hovered panel', () => {
    const pattern = patternWithLines();
    const outline = screenPoints(samplePanelOutline(pattern, pattern.panels.panel!));
    const { strokes, fills } = drawFrame({ hover: { kind: 'panel', id: 'panel' } });

    expect(strokes.some(s => s.style === HOVER_COLOR && s.width === HOVER_WIDTH
      && samePath(s.points, outline))).toBe(true);
    expect(fills.some(f => f.style === PANEL_TINT)).toBe(true);
  });
});

describe('element hover pre-highlight', () => {
  it('rings a hovered notch and a trim symbol', () => {
    const pattern = patternWithLines();
    pattern.notches = { n1: { id: 'n1', edgeId: 'e0', t: 0.5 } };
    pattern.trims = {
      t1: {
        id: 't1', panelId: 'panel', kind: 'button', pos: vec2(4, 4),
        sizeMm: 12, color: '#fff', qty: 1, visible: true,
      },
    };
    const notchAt = screenPoints([pointAtT(pattern, 'e0', 0.5)!])[0]!;
    const trimAt = screenPoints([vec2(4, 4)])[0]!;

    const notchStrokes = drawFrame({ pattern, hover: { kind: 'element', elementKind: 'notch', id: 'n1' } }).strokes;
    expect(notchStrokes.some(s => s.style === HOVER_COLOR && s.width === HOVER_WIDTH
      && samePath(s.points, [notchAt]))).toBe(true);

    const trimStrokes = drawFrame({ pattern, hover: { kind: 'element', elementKind: 'trim', id: 't1' } }).strokes;
    expect(trimStrokes.some(s => s.style === HOVER_COLOR && s.width === HOVER_WIDTH
      && samePath(s.points, [trimAt]))).toBe(true);
  });

  it('tints a hovered print frame and strokes both sides of a seam', () => {
    const pattern = patternWithLines();
    pattern.prints = {
      p1: {
        id: 'p1', panelId: 'panel', imageUrl: 'data:,', center: vec2(0, 0), widthCm: 4, heightCm: 4,
        angleDeg: 0, opacity: 1, repeat: vec2(1, 1), visible: true,
      },
    };
    pattern.seams = {
      s1: {
        id: 's1', type: 'normal', a: { edgeId: 'e0', t0: 0, t1: 0.5 }, b: { edgeId: 'e1', t0: 0, t1: 0.5 },
        flip: false, strength: 1, threadColor: '#fff', stitchVisible: true,
      },
    };
    const frame = printFrame(pattern, pattern.prints.p1!)!;
    const outline = screenPoints([...frame, frame[0]!]);

    const printFrameResult = drawFrame({ pattern, hover: { kind: 'element', elementKind: 'print', id: 'p1' } });
    expect(printFrameResult.strokes.some(s => s.style === HOVER_COLOR && s.width === HOVER_WIDTH
      && samePath(s.points, outline))).toBe(true);
    expect(printFrameResult.fills.some(f => f.style === PANEL_TINT)).toBe(true);

    const seamStrokes = drawFrame({ pattern, hover: { kind: 'element', elementKind: 'seam', id: 's1' } }).strokes;
    expect(seamStrokes.some(s => s.style === HOVER_COLOR
      && samePath(s.points, screenPoints(sampleEdgeInterval(pattern, 'e0', 0, 0.5))))).toBe(true);
    expect(seamStrokes.some(s => s.style === HOVER_COLOR
      && samePath(s.points, screenPoints(sampleEdgeInterval(pattern, 'e1', 0, 0.5))))).toBe(true);
  });
});

describe('drawn notch position', () => {
  it('places the glyph at the arc-length fraction, not at a sampled endpoint', () => {
    const pattern = patternWithLines();
    for (const t of [0.25, 0.5, 0.75]) {
      pattern.notches = { n1: { id: 'n1', edgeId: 'e0', t } };
      const at = screenPoints([pointAtT(pattern, 'e0', t)!])[0]!;
      const { strokes } = drawFrame({ pattern, display: { ...DISPLAY, notches: true } });

      expect(strokes.some(s => s.style === '#ffd75e' && s.width === 1.5
        && samePath(s.points, [
          { x: at.x - 4, y: at.y - 4 }, at, { x: at.x + 4, y: at.y - 4 },
        ]))).toBe(true);
    }
  });
});

/** Colour of the ghost mark drawn at a mark tool's landing point. */
const MARK_COLOR = 'rgba(255,215,94,0.9)';

describe('mark tool landing preview', () => {
  it('draws nothing extra without a mark hint', () => {
    expect(drawFrame().strokes.some(s => s.style === MARK_COLOR)).toBe(false);
  });

  it('ghosts a V notch beside the pre-highlighted edge', () => {
    const pattern = patternWithLines();
    const at = screenPoints([vec2(10, 0)])[0]!;
    const { strokes } = drawFrame({
      hover: { kind: 'edge', id: 'e0' },
      markHint: { kind: 'notch', pos: vec2(10, 0) },
    });

    expect(strokes.some(s => s.style === MARK_COLOR && s.width === 1.5
      && samePath(s.points, [
        { x: at.x - 4, y: at.y - 4 }, at, { x: at.x + 4, y: at.y - 4 },
      ]))).toBe(true);
    expect(strokes.some(s => s.style === HOVER_COLOR && s.width === HOVER_WIDTH
      && samePath(s.points, screenPoints(sampleEdge(pattern, 'e0'))))).toBe(true);
  });

  it('ghosts a dashed annotation box and its text baseline', () => {
    const at = screenPoints([vec2(10, 10)])[0]!;
    const { strokes } = drawFrame({
      hover: { kind: 'panel', id: 'panel' },
      markHint: { kind: 'annotation', pos: vec2(10, 10) },
    });

    expect(strokes.some(s => s.style === MARK_COLOR && s.dash.join(',') === '3,2'
      && samePath(s.points, [
        { x: at.x - 12, y: at.y - 8 }, { x: at.x + 12, y: at.y - 8 },
        { x: at.x + 12, y: at.y + 8 }, { x: at.x - 12, y: at.y + 8 },
      ]))).toBe(true);
    expect(strokes.some(s => s.style === MARK_COLOR && s.dash.length === 0
      && samePath(s.points, [{ x: at.x - 7, y: at.y }, { x: at.x + 7, y: at.y }]))).toBe(true);
  });
});
