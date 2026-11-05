import * as THREE from 'three';
import type { Project } from '../model/types';
import type { ClothSimInput } from '../../sim/clothSimulator';
import type { SeamPair } from '../build/seamPair';
import { SeamThreads } from './seamThreads';
import { TopstitchThreads, topstitchSegments } from './topstitchThreads';
import { TrimInstances, trimInstances } from './trimInstances';
import { SketchOverlay } from './sketchOverlay';
import { MeasureOverlay } from './measureOverlay';

/**
 * The four decorative overlays that live on top of the cloth: seam threads, topstitch rows,
 * trim instances, plus the two gesture overlays (sketch stroke and measurement).
 *
 * They share one lifecycle — attach when the merged layout changes, move with every readback,
 * detach when the cloth goes away — so they share one owner. Signatures are kept here as well:
 * a rebuild is needed exactly when the records or the merged layout behind them changed.
 */
export class OverlayKit {
  private readonly seams = new SeamThreads();
  private readonly topstitches = new TopstitchThreads();
  private readonly trims = new TrimInstances();
  private readonly sketch = new SketchOverlay();
  private readonly measure = new MeasureOverlay();
  /** Seam pair count the thread overlay was last built for; -1 when it is not attached. */
  private pairCount = -1;
  /** Signature of the topstitch records and merged layout the overlay was built for. */
  private topstitchKey = '';
  /** Signature of the trim records and merged layout the instances were built for. */
  private trimKey = '';
  /** World points of the pending 3D measurement, in placement order. */
  private measurePoints: THREE.Vector3[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Drops the seam, topstitch and trim overlays, forcing a rebuild on the next apply. */
  reset(): void {
    this.seams.detach(this.scene);
    this.topstitches.detach(this.scene);
    this.trims.detach(this.scene);
    this.pairCount = -1;
    this.topstitchKey = '';
    this.trimKey = '';
  }

  /**
   * Re-reads each seam record onto the thread overlay: color and viewport visibility, drawn over
   * the positions the cloth currently holds. The overlay is rebuilt whenever the pair set changes
   * size, which is what closing a dart does.
   */
  applySeams(project: Project, pairs: SeamPair[], positions: Float32Array): void {
    if (pairs.length !== this.pairCount) {
      this.pairCount = pairs.length;
      this.seams.attach(this.scene, pairs, positions, project.pattern.seams);
      return;
    }
    this.seams.setSeams(project.pattern.seams);
    this.seams.update(pairs, positions);
  }

  /** Rebuilds the topstitch overlay when its records or the merged layout change. */
  applyTopstitches(
    project: Project, input: ClothSimInput, positions: Float32Array, normals?: Float32Array,
  ): void {
    const signature = topstitchSignature(project, input);
    if (signature !== this.topstitchKey) {
      this.topstitchKey = signature;
      this.topstitches.attach(this.scene, topstitchSegments(project, input.panels), positions, normals);
      return;
    }
    this.topstitches.update(positions, normals);
  }

  /** Rebuilds the 3D trim instances when their records or the merged layout change. */
  applyTrims(
    project: Project, input: ClothSimInput, positions: Float32Array, normals?: Float32Array,
  ): void {
    const signature = trimSignature(project, input);
    if (signature !== this.trimKey) {
      this.trimKey = signature;
      this.trims.attach(this.scene, trimInstances(project, input.panels), positions, normals);
      return;
    }
    this.trims.update(positions, normals);
  }

  /** Moves the three cloth-bound overlays onto a simulated frame. */
  followSimulation(pairs: SeamPair[], positions: Float32Array, normals: Float32Array): void {
    this.seams.update(pairs, positions);
    this.topstitches.update(positions, normals);
    this.trims.update(positions, normals);
  }

  /** Moves the three cloth-bound overlays onto the initial (unsewn) positions. */
  followRest(pairs: SeamPair[], positions: Float32Array): void {
    this.seams.update(pairs, positions);
    this.topstitches.update(positions);
    this.trims.update(positions);
  }

  /** Hides the thread and trim overlays while a heatmap stands in for the cloth. */
  setVisible(visible: boolean): void {
    this.topstitches.setVisible(visible);
    this.trims.setVisible(visible);
  }

  /** Starts a sketch stroke at a picked surface point; the caller owns the stroke extent. */
  beginSketch(world: THREE.Vector3): void {
    this.sketch.begin(this.scene, world);
  }

  /** Extends the active sketch stroke by one picked surface point. */
  extendSketch(world: THREE.Vector3): void {
    this.sketch.extend(world);
  }

  /** Drops the sketch stroke overlay. */
  endSketch(): void {
    this.sketch.detach(this.scene);
  }

  /**
   * Adds one measurement point. A third call starts a new measurement. Returns the points kept
   * so far, so the caller can report a reading once two exist.
   */
  addMeasurePoint(world: THREE.Vector3): readonly THREE.Vector3[] {
    if (this.measurePoints.length >= 2) this.measurePoints = [];
    this.measurePoints.push(world.clone());
    this.measure.setPoints(this.scene, this.measurePoints);
    return this.measurePoints;
  }

  /** Drops the measurement overlay and its placed points. */
  clearMeasurement(): void {
    this.measurePoints = [];
    this.measure.clear(this.scene);
  }
}

/** Topstitch records plus the merged layout the segment indices point into. */
function topstitchSignature(project: Project, input: ClothSimInput): string {
  const stitches = Object.values(project.pattern.topstitches ?? {}).map(stitch => JSON.stringify([
    stitch.id, stitch.panelId, stitch.edgeId, stitch.t0, stitch.t1, stitch.offsetMm, stitch.spacingMm,
    stitch.rows, stitch.color, stitch.stitchMm, stitch.gapMm, stitch.visible !== false,
    project.pattern.panels[stitch.panelId]?.visible !== false,
  ]));
  const panels = input.panels.map(panel => `${panel.panelId}@${panel.vertexOffset}x${panel.mesh.vertexCount}`);
  return JSON.stringify([stitches, panels]);
}

/** Trim records plus the merged layout their particle indices point into. */
function trimSignature(project: Project, input: ClothSimInput): string {
  const trims = Object.values(project.pattern.trims ?? {}).map(trim => JSON.stringify([
    trim.id, trim.panelId, trim.kind, trim.pos.x, trim.pos.y, trim.sizeMm, trim.color,
    trim.visible !== false, project.pattern.panels[trim.panelId]?.visible !== false,
  ]));
  const panels = input.panels.map(panel => `${panel.panelId}@${panel.vertexOffset}x${panel.mesh.vertexCount}`);
  return JSON.stringify([trims, panels]);
}
