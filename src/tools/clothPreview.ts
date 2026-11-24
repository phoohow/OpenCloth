import type { Vec3Tuple } from '@/base/math';
import type { AvatarParams, Pattern, Seam } from '@/model/types';

import { FILE_TEMPLATES } from '@/app/assembly';
import { bodyLandmarks, makehumanBody } from '@/avatar';
import { polylineLength } from '@/base/geom';
import { drapePositions, planWraps, collapseSeamPairs, type SeamPairRef } from '@/garment';
import { createDefaultAvatar } from '@/model';
import { buildPanelMesh, sampleEdge, type PanelMesh } from '@/pattern/panel';
import { flatLayout } from '@/tools/flatLayout';
import { installMakehumanDataFromDisk } from '@/tools/makehumanData';
import { writePng } from '@/tools/png';
import { SoftCanvas, type Camera, type RGB } from '@/tools/softCanvas';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

const VIEWS = [0, 90, 180, -90];

interface Options {
  template: string;
  stage: 'flat' | 'wrapped' | 'sewn';
  out: string;
  width: number;
}

interface PanelEntry {
  panelId: string;
  name: string;
  mesh: PanelMesh;
  positions: Float32Array;
  color: RGB;
}

interface Scene {
  pattern: Pattern;
  panels: PanelEntry[];
  seams: Seam[];
}

interface EdgeRef {
  panel: PanelEntry;
  verts: number[];
}

interface SeamPair {
  a: number;
  b: number;
  panelA: PanelEntry;
  panelB: PanelEntry;
  seam: Seam;
  label: string;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback: string): string => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const stageArg = get('stage', 'flat');
  const stage: Options['stage'] =
    stageArg === 'wrapped' || stageArg === 'sewn' ? stageArg : 'flat';
  const template = get('template', FILE_TEMPLATES[0]?.key ?? '');
  const width = Number(get('width', '330'));
  return {
    template,
    stage,
    out: get('out', `.preview/${template}-${stage}.png`),
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 330,
  };
}

function buildScene(opts: Options): Scene {
  const template = FILE_TEMPLATES.find(t => t.key === opts.template);
  if (!template) throw new Error(`unknown template ${opts.template}`);
  const pattern = template.generate('fabric_default');
  const body = bodyLandmarks(AVATAR);

  const inputs: Array<{ panelId: string; mesh: PanelMesh }> = [];
  for (const panelId of Object.keys(pattern.panels)) {
    const mesh = buildPanelMesh(pattern, panelId, 3);
    if (mesh) inputs.push({ panelId, mesh });
  }

  const slots = planWraps(pattern);
  const flat = flatLayout(inputs.map(i => ({ panel: pattern.panels[i.panelId], mesh: i.mesh })), body, pattern);
  const panels = inputs.map((input, index) => {
    const panel = pattern.panels[input.panelId];
    const positions = opts.stage === 'flat'
      ? flat[index]
      : drapePositions(input.mesh, panel, body, slots.get(panel.id));
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

function fitCamera(canvas: SoftCanvas, viewWidth: number, scene: Scene): Camera {
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
    yawDeg: 0,
    scale,
    originX: viewWidth / 2,
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
  const body = makehumanBody(AVATAR);
  const p = body.positions;
  for (let t = 0; t < body.bodyIndices.length; t += 3) {
    const i0 = body.bodyIndices[t] * 3;
    const i1 = body.bodyIndices[t + 1] * 3;
    const i2 = body.bodyIndices[t + 2] * 3;
    canvas.triangle(
      cam,
      [p[i0], p[i0 + 1], p[i0 + 2]],
      [p[i1], p[i1 + 1], p[i1 + 2]],
      [p[i2], p[i2 + 1], p[i2 + 2]],
      BODY,
    );
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

function edgePanels(scene: Scene): Map<string, EdgeRef> {
  const map = new Map<string, EdgeRef>();
  for (const panel of scene.panels) {
    for (const [edgeId, verts] of panel.mesh.edgeVertexMap) map.set(edgeId, { panel, verts });
  }

  return map;
}

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

function drawEdges(canvas: SoftCanvas, cam: Camera, scene: Scene): void {
  for (const panel of scene.panels) {
    for (const [edgeId, verts] of panel.mesh.edgeVertexMap) {
      const edge = scene.pattern.edges[edgeId];
      const color = SEMANTIC_COLORS[edge?.semantic ?? '?'] ?? [220, 220, 220];
      canvas.polyline(cam, verts.map(i => at(panel.positions, i)), color, 1);
    }
  }
}

function drawSeams(canvas: SoftCanvas, cam: Camera, scene: Scene): void {
  for (const pair of seamPairs(scene)) {
    const a = at(pair.panelA.positions, pair.a);
    const b = at(pair.panelB.positions, pair.b);
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.015) continue;
    canvas.segment(cam, a, b, hexToRgb(pair.seam.threadColor), 1);
  }
}

function bodyReport(): string[] {
  const body = bodyLandmarks(AVATAR);
  return [`body: chest girth ${AVATAR.chestCm} waist ${AVATAR.waistCm} hip ${AVATAR.hipCm} `
    + `radii c${(body.chestR * 100).toFixed(1)} w${(body.waistR * 100).toFixed(1)} h${(body.hipR * 100).toFixed(1)} `
    + `arm${(body.armR * 100).toFixed(1)} shoulderX ${(body.shoulderX * 100).toFixed(1)} `
    + `shoulderY ${(body.shoulderTopY * 100).toFixed(1)}`];
}

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
      + `x[${(minX * 100).toFixed(1)}..${(maxX * 100).toFixed(1)}] bboxPerim~${(perim * 100).toFixed(0)}cm `
      + `tris ${panel.mesh.triangleCount}`;
  });
}

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

  const stats = [...gaps].map(([key, g]) => `  ${key}: avg${(g.sum / g.n * 100).toFixed(1)}cm `
    + `max${(g.max * 100).toFixed(1)}cm`);
  return [`seam gaps (${stage}):`, ...stats];
}

function seamLengthReport(scene: Scene): string[] {
  const lengths = scene.seams.map(seam => {
    const a = sampleEdge(scene.pattern, seam.a.edgeId);
    const b = sampleEdge(scene.pattern, seam.b.edgeId, seam.flip);
    return `${seam.type === 'gather' ? 'gather' : 'seam'} ${polylineLength(a).toFixed(1)}/`
      + `${polylineLength(b).toFixed(1)}cm`;
  });
  return ['seam edge lengths (a/b):', ...lengths.map(line => `  ${line}`)];
}

function report(scene: Scene, opts: Options): string[] {
  return [
    ...bodyReport(),
    ...panelBoundsReport(scene),
    ...seamGapReport(scene, opts.stage),
    ...seamLengthReport(scene),
  ];
}

function render(opts: Options): void {
  const scene = buildScene(opts);
  const viewWidth = opts.width;
  const canvas = new SoftCanvas(viewWidth * VIEWS.length, 620);
  canvas.clear(BG);
  const cam = fitCamera(canvas, viewWidth, scene);
  const cameras = VIEWS.map((yawDeg, i) => ({ ...cam, yawDeg, originX: viewWidth * i + viewWidth / 2 }));

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
  mkdirSync(dirname(out), { recursive: true });
  writePng(out, canvas.width, canvas.height, canvas.px);
  console.log(report(scene, opts).join('\n'));
  console.log(`wrote ${out}`);
}

function at(positions: Float32Array, i: number): Vec3Tuple {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

installMakehumanDataFromDisk(resolve('assets/makehuman'));

render(parseArgs(process.argv.slice(2)));
