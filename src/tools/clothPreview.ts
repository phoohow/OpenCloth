/// <reference types="node" />
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AvatarParams, Pattern, Seam } from '@/model/types';
import { createDefaultAvatar } from '@/model';
import { buildPanelMesh, sampleEdge, type PanelMesh } from '@/pattern/panel';
import { bodyLandmarks } from '@/avatar';
import { generateAvatarCollider } from '@/avatar/collider';
import { drapePositions } from '@/pattern/drape';
import { flatLayout } from '@/tools/flatLayout';
import { explodeOffBody } from '@/pattern/drape';
import { collapseSeamPairs, type SeamPairRef } from '@/pattern/drape';
import { GARMENT_TEMPLATES } from '@/pattern/template';
import { SoftCanvas, capsuleTriangles, type Camera, type RGB, type XYZ } from '@/tools/softwareRender';
import { writePng } from '@/tools/pngOut';

const AVATAR: AvatarParams = createDefaultAvatar().params;

const BG: RGB = [40, 40, 45];
const BODY: RGB = [168, 166, 178];
const FLOOR: RGB = [70, 70, 80];
const PANEL_COLORS: RGB[] = [
  [196, 96, 104], [104, 150, 208], [116, 186, 122], [206, 170, 96], [156, 112, 196], [96, 190, 188],
];
const SEMANTIC_COLORS: Record<string, RGB> = {
  hem: [255, 255, 255],
  sideSeam: [126, 226, 132],
  armhole: [255, 174, 74],
  shoulder: [120, 198, 255],
  neckline: [255, 122, 222],
  sleeveCap: [255, 226, 120],
  waist: [206, 168, 255],
};

/** Views drawn side by side. */
const VIEWS = [0, 90, 180, -90];

/** Command-line selection of template, stage and output image. */
interface Options {
  template: string;
  /** `exploded` is the app's unsewn state; `sewn` collapses every seam pair onto one point. */
  stage: 'flat' | 'wrapped' | 'exploded' | 'sewn';
  out: string;
  width: number;
  chestCm?: number;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback: string): string => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const chest = get('chestCm', '');
  const stageArg = get('stage', 'flat');
  const stage: Options['stage'] =
    stageArg === 'wrapped' || stageArg === 'sewn' || stageArg === 'exploded' ? stageArg : 'flat';
  return {
    template: get('template', 'tshirt'),
    stage,
    out: get('out', `.preview/${get('template', 'tshirt')}-${get('stage', 'flat')}.png`),
    width: Number(get('width', '330')),
    chestCm: chest ? Number(chest) : undefined,
  };
}

/** One panel's mesh plus the positions its stage places it at. */
interface PanelEntry {
  panelId: string;
  name: string;
  mesh: PanelMesh;
  positions: Float32Array;
  color: RGB;
}

/** The pattern, its placed panels and its seams. */
interface Scene {
  pattern: Pattern;
  panels: PanelEntry[];
  seams: Seam[];
}

/** One meshed outline edge with the panel that owns it. */
interface EdgeRef {
  panel: PanelEntry;
  verts: number[];
}

/** One joined seam vertex: index `a` of `panelA` meets index `b` of `panelB`. */
interface SeamPair {
  a: number;
  b: number;
  panelA: PanelEntry;
  panelB: PanelEntry;
  seam: Seam;
  /** Panel and edge semantic of both sides, used to group the gap report. */
  label: string;
}

/** Builds the pattern, its panel placement for the chosen stage and its seams. */
function buildScene(opts: Options): Scene {
  const template = GARMENT_TEMPLATES.find(t => t.key === opts.template);
  if (!template) throw new Error(`unknown template ${opts.template}`);
  const params = { ...template.defaults };
  if (opts.chestCm) {
    if ('chestCm' in params) params.chestCm = opts.chestCm;
    if ('waistCm' in params) params.waistCm = opts.chestCm * 0.82;
    if ('hemCm' in params) params.hemCm = opts.chestCm * 1.6;
  }
  const pattern = template.generate(params, 'fabric_default');
  const body = bodyLandmarks(AVATAR);

  const inputs: Array<{ panelId: string; mesh: PanelMesh }> = [];
  for (const panelId of Object.keys(pattern.panels)) {
    const mesh = buildPanelMesh(pattern, panelId, 3);
    if (mesh) inputs.push({ panelId, mesh });
  }

  const flat = flatLayout(inputs.map(i => ({ panel: pattern.panels[i.panelId], mesh: i.mesh })), body);
  const panels = inputs.map((input, index) => {
    const panel = pattern.panels[input.panelId];
    const positions = opts.stage === 'flat'
      ? flat[index]
      : opts.stage === 'exploded'
        ? explodeOffBody(drapePositions(input.mesh, panel, body))
        : drapePositions(input.mesh, panel, body);
    return {
      panelId: input.panelId,
      name: panel.name,
      mesh: input.mesh,
      positions,
      color: PANEL_COLORS[index % PANEL_COLORS.length],
    };
  });

  const scene: Scene = { pattern, panels, seams: Object.values(pattern.seams) as Seam[] };
  if (opts.stage === 'sewn') {
    collapseSeamPairs(seamPairs(scene).map(
      ({ a, b, panelA, panelB }): SeamPairRef => [
        { positions: panelA.positions, index: a },
        { positions: panelB.positions, index: b },
      ],
    ));
  }
  return scene;
}

/** Camera that fits the whole scene, body included, into one view column. */
function fitCamera(canvas: SoftCanvas, viewIndex: number, viewWidth: number, scene: Scene): Camera {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of scene.panels) {
    for (let i = 0; i < p.positions.length / 3; i++) {
      minX = Math.min(minX, p.positions[i * 3]);
      maxX = Math.max(maxX, p.positions[i * 3]);
      minY = Math.min(minY, p.positions[i * 3 + 1]);
      maxY = Math.max(maxY, p.positions[i * 3 + 1]);
      maxZ = Math.max(maxZ, Math.abs(p.positions[i * 3 + 2]));
    }
  }
  const height = AVATAR.heightCm / 100;
  minY = Math.min(minY, 0);
  maxY = Math.max(maxY, height);
  maxX = Math.max(maxX, maxZ * 1.2);
  minX = Math.min(minX, -maxX);

  const spanX = Math.max(maxX - minX, 0.3);
  const spanY = Math.max(maxY - minY, 0.3);
  const scale = Math.min((viewWidth * 0.86) / spanX, (canvas.height * 0.9) / spanY);
  return {
    yawDeg: VIEWS[viewIndex],
    scale,
    originX: viewWidth * viewIndex + viewWidth / 2,
    originY: canvas.height / 2,
    centerY: (minY + maxY) / 2,
  };
}

function drawFloor(canvas: SoftCanvas, cam: Camera): void {
  const extent = 1.1;
  for (let i = -4; i <= 4; i++) {
    const t = (i / 4) * extent;
    canvas.polyline(cam, [[t, 0, -extent], [t, 0, extent]], FLOOR);
    canvas.polyline(cam, [[-extent, 0, t], [extent, 0, t]], FLOOR);
  }
}

function drawBody(canvas: SoftCanvas, cam: Camera): void {
  const collider = generateAvatarCollider(AVATAR);
  for (const c of collider.capsules) {
    const tris = capsuleTriangles([c.ax, c.ay, c.az], [c.bx, c.by, c.bz], c.radius, 10, 14, c.radiusZ);
    for (const [a, b, cc] of tris) canvas.triangle(cam, a, b, cc, BODY);
  }
}

function drawCloth(canvas: SoftCanvas, cam: Camera, scene: Scene): void {
  for (const panel of scene.panels) {
    const { mesh, positions } = panel;
    for (let t = 0; t < mesh.triangleCount; t++) {
      const i0 = mesh.indices[t * 3], i1 = mesh.indices[t * 3 + 1], i2 = mesh.indices[t * 3 + 2];
      canvas.triangle(cam, at(positions, i0), at(positions, i1), at(positions, i2), panel.color);
    }
  }
}

/** Maps every meshed outline edge to its panel boundary vertex indices. */
function edgePanels(scene: Scene): Map<string, EdgeRef> {
  const map = new Map<string, EdgeRef>();
  for (const panel of scene.panels) {
    for (const [edgeId, verts] of panel.mesh.edgeVertexMap) map.set(edgeId, { panel, verts });
  }
  return map;
}

/** Paired seam vertex index pairs in the same arc-length order the engine uses. */
function seamPairs(scene: Scene): SeamPair[] {
  const byEdge = edgePanels(scene);
  const out: SeamPair[] = [];
  for (const seam of scene.seams) {
    const ea = byEdge.get(seam.a.edgeId);
    const eb = byEdge.get(seam.b.edgeId);
    if (!ea || !eb) continue;
    const semA = scene.pattern.edges[seam.a.edgeId]?.semantic ?? '?';
    const semB = scene.pattern.edges[seam.b.edgeId]?.semantic ?? '?';
    const label = `${ea.panel.name}.${semA}+${eb.panel.name}.${semB}`;
    const vb = seam.flip ? [...eb.verts].reverse() : eb.verts;
    const n = Math.max(ea.verts.length, vb.length);
    for (let i = 0; i < n; i++) {
      const a = ea.verts[Math.min(Math.floor(i * ea.verts.length / n), ea.verts.length - 1)];
      const b = vb[Math.min(Math.floor(i * vb.length / n), vb.length - 1)];
      if (a === undefined || b === undefined) continue;
      out.push({ a, b, panelA: ea.panel, panelB: eb.panel, seam, label });
    }
  }
  return out;
}

/** Draws each panel outline in its current stage placement. */
function drawEdges(canvas: SoftCanvas, cam: Camera, scene: Scene): void {
  for (const panel of scene.panels) {
    for (const [edgeId, verts] of panel.mesh.edgeVertexMap) {
      const edge = scene.pattern.edges[edgeId];
      const color = SEMANTIC_COLORS[edge?.semantic ?? ''] ?? [220, 220, 220];
      canvas.polyline(cam, verts.map(i => at(panel.positions, i)), color, 1);
    }
  }
}

/** Draws stitch threads between the paired boundary vertices of each seam. */
function drawSeams(canvas: SoftCanvas, cam: Camera, scene: Scene): void {
  for (const pair of seamPairs(scene)) {
    const a = at(pair.panelA.positions, pair.a);
    const b = at(pair.panelB.positions, pair.b);
    // Threads shorter than this disappear inside the joined panels.
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.015) continue;
    canvas.segment(cam, a, b, hexToRgb(pair.seam.threadColor), 1);
  }
}

/** Body girths and landmark radii the garment is measured against. */
function bodyReport(): string[] {
  const body = bodyLandmarks(AVATAR);
  return [`body: chest girth ${AVATAR.chestCm} waist ${AVATAR.waistCm} hip ${AVATAR.hipCm} `
    + `radii c${(body.chestR * 100).toFixed(1)} w${(body.waistR * 100).toFixed(1)} h${(body.hipR * 100).toFixed(1)} `
    + `arm${(body.armR * 100).toFixed(1)} shoulderX ${(body.shoulderX * 100).toFixed(1)} `
    + `shoulderY ${(body.shoulderTopY * 100).toFixed(1)}`];
}

/** Placed width, height and bounds of every panel, in centimeters. */
function panelBoundsReport(scene: Scene): string[] {
  return scene.panels.map(panel => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < panel.positions.length / 3; i++) {
      minX = Math.min(minX, panel.positions[i * 3]);
      maxX = Math.max(maxX, panel.positions[i * 3]);
      minY = Math.min(minY, panel.positions[i * 3 + 1]);
      maxY = Math.max(maxY, panel.positions[i * 3 + 1]);
    }
    const perim = 2 * Math.max(maxX - minX, maxY - minY);
    return `panel ${panel.name}: w${((maxX - minX) * 100).toFixed(1)}cm `
      + `h${((maxY - minY) * 100).toFixed(1)}cm y[${(minY * 100).toFixed(1)}..${(maxY * 100).toFixed(1)}] `
      + `x[${(minX * 100).toFixed(1)}..${(maxX * 100).toFixed(1)}] flatPerim~${perim.toFixed(2)}m tris ${panel.mesh.triangleCount}`;
  });
}

/** Average and worst join distance of each seam pair, in centimeters. */
function seamGapReport(scene: Scene, stage: Options['stage']): string[] {
  const gaps = new Map<string, { sum: number; n: number; max: number }>();
  for (const pair of seamPairs(scene)) {
    const a = at(pair.panelA.positions, pair.a);
    const b = at(pair.panelB.positions, pair.b);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const hit = gaps.get(pair.label) ?? { sum: 0, n: 0, max: 0 };
    hit.sum += d; hit.n++; hit.max = Math.max(hit.max, d);
    gaps.set(pair.label, hit);
  }
  const stats = [...gaps].map(([key, g]) => `${key} avg${(g.sum / g.n * 100).toFixed(1)} max${(g.max * 100).toFixed(1)}`);
  return [`seam gaps (${stage}): ${stats.join(' | ')}`];
}

/** Arc lengths of the two edges each seam joins, in centimeters. */
function seamLengthReport(scene: Scene): string[] {
  const lengths = scene.seams.map(seam => {
    const a = sampleEdge(scene.pattern, seam.a.edgeId);
    const b = sampleEdge(scene.pattern, seam.b.edgeId, seam.flip);
    return `${seam.type === 'gather' ? 'gather' : 'seam'} ${(polylineLength(a) * 100).toFixed(1)}/`
      + `${(polylineLength(b) * 100).toFixed(1)}cm`;
  });
  return [`seam edge lengths: ${lengths.join(' | ')}`];
}

/** Prints geometry diagnostics that the render alone cannot show. */
function report(scene: Scene, opts: Options): string[] {
  return [
    ...bodyReport(),
    ...panelBoundsReport(scene),
    ...seamGapReport(scene, opts.stage),
    ...seamLengthReport(scene),
  ];
}

function polylineLength(pts: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i + 1 < pts.length; i++) sum += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return sum * 0.01;
}

function render(opts: Options): void {
  const scene = buildScene(opts);
  const viewWidth = opts.width;
  const canvas = new SoftCanvas(viewWidth * VIEWS.length, 620);
  canvas.clear(BG);
  const cam = fitCamera(canvas, 0, viewWidth, scene);
  const cameras = VIEWS.map((_, i) => ({ ...cam, yawDeg: VIEWS[i], originX: viewWidth * i + viewWidth / 2 }));

  for (const c of cameras) {
    drawFloor(canvas, c);
    drawBody(canvas, c);
    drawCloth(canvas, c, scene);
    drawSeams(canvas, c, scene);
    drawEdges(canvas, c, scene);
    for (let y = 1; y < canvas.height; y += 2) {
      const idx = (y * canvas.width + Math.round(c.originX + viewWidth / 2)) * 3;
      canvas.px[idx] = 90; canvas.px[idx + 1] = 90; canvas.px[idx + 2] = 100;
    }
  }

  const out = resolve(process.cwd(), opts.out);
  mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
  writePng(out, canvas.width, canvas.height, canvas.px);
  console.log(report(scene, opts).join('\n'));
  console.log(`wrote ${out}`);
}

function at(positions: Float32Array, i: number): XYZ {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}
function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

render(parseArgs(process.argv.slice(2)));
