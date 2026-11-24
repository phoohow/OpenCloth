import type { Vec3 } from '@/base/math';
import type { Project } from '@/model/types';
import type { SeamPair } from '@/runtime/engine/seamPair';
import type { PresenterHost } from '@/runtime/world/presenters/host';
import type { ClothSimInput } from '@/sim/common';

import { internalLineSegments } from '@/runtime/world/internalLineThreads';
import { MeasureOverlay } from '@/runtime/world/measureOverlay';
import { SeamThreads } from '@/runtime/world/seamThreads';
import { SketchOverlay } from '@/runtime/world/sketchOverlay';
import { ThreadRibbon, type ThreadSegment } from '@/runtime/world/threadRibbon';
import { topstitchSegments } from '@/runtime/world/topstitchThreads';
import { TrimInstances, trimInstances } from '@/runtime/world/trimInstances';

const INTERNAL_LINE_WIDTH_SCALE = 0.65;

type ThreadSignature = (project: Project, input: ClothSimInput) => string;

type ThreadBuilder = (project: Project, panels: ClothSimInput['panels']) => ThreadSegment[];

class ThreadLayer {
  private key = '';
  vertices = 0;

  constructor(
    private readonly ribbon: ThreadRibbon,
    private readonly name: string,
    private readonly bindKey: string,
    private readonly build: ThreadBuilder,
    private readonly signature: ThreadSignature,
  ) {}

  apply(
    host: PresenterHost, project: Project, input: ClothSimInput,
    positions: Float32Array, normals: Float32Array | undefined, width: number,
  ): void {
    const signature = this.signature(project, input);
    if (signature !== this.key) {
      this.key = signature;
      const segments = this.build(project, input.panels);
      this.vertices = segments.length * 2;
      this.ribbon.attach(host, segments, positions, normals, width, this.name, this.bindKey);
      return;
    }

    this.ribbon.update(positions, normals, width);
  }

  follow(positions: Float32Array, normals: Float32Array | undefined, width: number): void {
    this.ribbon.update(positions, normals, width);
  }

  setVisible(visible: boolean): void {
    this.ribbon.setVisible(visible);
  }

  reset(host: PresenterHost): void {
    this.key = '';
    this.vertices = 0;
    this.ribbon.detach(host);
  }
}

export class OverlayKit {
  private readonly seams = new SeamThreads();
  private readonly threads: readonly ThreadLayer[] = [
    new ThreadLayer(
      new ThreadRibbon(), 'topstitchThreads', 'topstitch', topstitchSegments, topstitchSignature,
    ),
    new ThreadLayer(
      new ThreadRibbon(INTERNAL_LINE_WIDTH_SCALE), 'internalLineThreads', 'internalLine',
      internalLineSegments, internalLineSignature,
    ),
  ];
  private readonly trims = new TrimInstances();
  private readonly sketch = new SketchOverlay();
  private readonly measure = new MeasureOverlay();
  private pairCount = -1;
  private trimKey = '';
  private measurePoints: Vec3[] = [];

  constructor(private readonly host: PresenterHost) {}

  get threadVertices(): number {
    return this.threads.reduce((sum, layer) => sum + layer.vertices, 0);
  }

  reset(): void {
    this.seams.detach(this.host);
    for (const layer of this.threads) layer.reset(this.host);
    this.trims.detach(this.host);
    this.pairCount = -1;
    this.trimKey = '';
  }

  applySeams(project: Project, pairs: SeamPair[], positions: Float32Array): void {
    if (pairs.length !== this.pairCount) {
      this.pairCount = pairs.length;
      this.seams.attach(this.host, pairs, positions, project.pattern.seams);
      return;
    }

    this.seams.setSeams(project.pattern.seams);
    this.seams.update(pairs, positions);
  }

  applyThreads(
    project: Project, input: ClothSimInput, positions: Float32Array,
    normals: Float32Array | undefined, width: number,
  ): void {
    for (const layer of this.threads) layer.apply(this.host, project, input, positions, normals, width);
  }

  applyTrims(
    project: Project, input: ClothSimInput, positions: Float32Array, normals?: Float32Array,
  ): void {
    const signature = trimSignature(project, input);
    if (signature !== this.trimKey) {
      this.trimKey = signature;
      this.trims.attach(this.host, trimInstances(project, input.panels), positions, normals);
      return;
    }

    this.trims.update(positions, normals);
  }

  follow(
    pairs: SeamPair[], positions: Float32Array, normals: Float32Array | undefined, width: number,
  ): void {
    this.seams.update(pairs, positions);
    for (const layer of this.threads) layer.follow(positions, normals, width);
    this.trims.update(positions, normals);
  }

  setVisible(visible: boolean): void {
    this.seams.setVisible(visible);
    for (const layer of this.threads) layer.setVisible(visible);
    this.trims.setVisible(visible);
  }

  beginSketch(world: Vec3): void {
    this.sketch.begin(this.host, world);
  }

  extendSketch(world: Vec3): void {
    this.sketch.extend(world);
  }

  endSketch(): void {
    this.sketch.detach(this.host);
  }

  addMeasurePoint(world: Vec3): readonly Vec3[] {
    if (this.measurePoints.length >= 2) this.measurePoints = [];
    this.measurePoints.push({ x: world.x, y: world.y, z: world.z });
    this.measure.setPoints(this.host, this.measurePoints);
    return this.measurePoints;
  }

  clearMeasurement(): void {
    this.measurePoints = [];
    this.measure.clear(this.host);
  }
}

function topstitchSignature(project: Project, input: ClothSimInput): string {
  const stitches = Object.values(project.pattern.topstitches ?? {}).map(stitch => JSON.stringify([
    stitch.id, stitch.panelId, stitch.edgeId, stitch.t0, stitch.t1, stitch.offsetMm, stitch.spacingMm,
    stitch.rows, stitch.color, stitch.stitchMm, stitch.gapMm, stitch.visible !== false,
    project.pattern.panels[stitch.panelId]?.visible !== false,
  ]));
  return JSON.stringify([stitches, layoutOf(input)]);
}

function internalLineSignature(project: Project, input: ClothSimInput): string {
  const lines = Object.values(project.pattern.internalLines).map(line => JSON.stringify([
    line.id, line.kind, line.points,
  ]));
  return JSON.stringify([lines, layoutOf(input, project)]);
}

function trimSignature(project: Project, input: ClothSimInput): string {
  const trims = Object.values(project.pattern.trims ?? {}).map(trim => JSON.stringify([
    trim.id, trim.panelId, trim.kind, trim.pos.x, trim.pos.y, trim.sizeMm, trim.color,
    trim.visible !== false, project.pattern.panels[trim.panelId]?.visible !== false,
  ]));
  return JSON.stringify([trims, layoutOf(input)]);
}

function layoutOf(input: ClothSimInput, project?: Project): string[] {
  return input.panels.map(panel => [
    panel.panelId, panel.vertexOffset, panel.mesh.vertexCount,
    ...(project ? [project.pattern.panels[panel.panelId]?.visible !== false] : []),
  ].join('@'));
}
