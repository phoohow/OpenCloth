import type { AvatarCollider } from '@/avatar/collider';
import type { DisplayOverride } from '@/render/common';
import type { ClothPresenter } from '@/runtime/world/presenters/clothPresenter';
import type { ClothSimInput } from '@/sim/common';

import {
  bilateralStop, computeFitField, computePressureField, computeVertexStrain, fitStats, fitStop,
  pressureStats, pressureStop, strainBounds, strainStats, strainStop, type FitStats,
  type PressureStats, type StrainBounds, type StrainStats,
} from '@/analysis';
import { CHANNEL_RASTER } from '@/render/common';

const PALETTES: Record<AnalysisKind, readonly string[]> = {
  fit: ['#d91e1e', '#33bf40', '#3373e6'],
  strain: ['#2244ff', '#ffffff', '#ff2d2d'],
  pressure: ['#f2f2f2', '#ffd166', '#e03a3a'],
};

const REFRESH_FRAMES = 5;

export type AnalysisKind = 'fit' | 'strain' | 'pressure';

export interface AnalysisDeps {
  cloth: () => ClothPresenter | null;
  lastGoodPositions: () => Float32Array;
  initialPositions: () => Float32Array;
  restPositions: () => Float32Array;
  clothInput: () => ClothSimInput | null;
  collider: () => AvatarCollider | null;
  contact: () => Float32Array | null;
  revealCloth: (visible: boolean) => void;
}

interface AnalysisSample {
  kind: AnalysisKind;
  values: Float32Array;
  bounds?: StrainBounds;
}

export class AnalysisPresenter {
  private activeKind: AnalysisKind | null = null;
  private countdown = 0;
  private sample: AnalysisSample | null = null;
  private stops = new Float32Array(0);
  private fitParams = { tightCm: 0.5, looseCm: 2 };
  private strainParams = { min: -0.25, max: 0.25, byFabric: false };
  private pressureParams = { maxKpa: 4 };

  constructor(private readonly deps: AnalysisDeps) {}

  get active(): boolean {
    return this.activeKind !== null;
  }

  override(): DisplayOverride | null {
    const kind = this.activeKind;
    if (!kind) return null;
    return {
      tags: ['subjectSurface'],
      technique: 'heatmap',
      channels: CHANNEL_RASTER,
      stage: 'postTone',
      mode: 'replace',
      params: { heatmap: { palette: PALETTES[kind] } },
    };
  }

  resetTimers(): void {
    this.countdown = 0;
    if (!this.activeKind) return;
    if (this.activeKind === 'fit') this.refreshFit(this.fitParams.tightCm, this.fitParams.looseCm, true);
    else if (this.activeKind === 'strain') {
      this.refreshStrain(this.strainParams.min, this.strainParams.max, this.strainParams.byFabric, true);
    } else this.refreshPressure(this.pressureParams.maxKpa, true);
  }

  resetFlags(): void {
    if (this.activeKind) this.deps.cloth()?.clearField();
    this.activeKind = null;
    this.sample = null;
    this.countdown = 0;
    this.deps.revealCloth(true);
  }

  setFit(enabled: boolean, tightCm: number, looseCm: number): FitStats | null {
    const changed = tightCm !== this.fitParams.tightCm || looseCm !== this.fitParams.looseCm;
    this.fitParams = { tightCm, looseCm };
    return this.activate('fit', enabled, () => {
      const sample = this.sample;
      if (!changed || sample?.kind !== 'fit') return this.refreshFit(tightCm, looseCm, true);
      this.paint();
      return fitStats({ clearanceCm: sample.values, thresholds: { tightCm, looseCm } });
    });
  }

  refreshFit(tightCm: number, looseCm: number, force = false): FitStats | null {
    if (!this.starts('fit', force)) return null;
    const collider = this.deps.collider();
    const positions = liveOr(this.deps.initialPositions(), this.deps.lastGoodPositions());
    if (!collider || positions.length === 0) return null;
    this.fitParams = { tightCm, looseCm };
    const field = computeFitField(positions, collider, { thresholds: { tightCm, looseCm } });
    this.sample = { kind: 'fit', values: field.clearanceCm };
    this.paint();
    return fitStats(field);
  }

  setStrain(enabled: boolean, min: number, max: number, byFabric = false): StrainStats | null {
    const changed = min !== this.strainParams.min || max !== this.strainParams.max
      || byFabric !== this.strainParams.byFabric;
    this.strainParams = { min, max, byFabric };
    return this.activate('strain', enabled, () => {
      const sample = this.sample;
      if (!changed || sample?.kind !== 'strain') return this.refreshStrain(min, max, byFabric, true);
      if (byFabric && !sample.bounds) {
        const input = this.deps.clothInput();
        if (input) sample.bounds = boundsOfAssembly(input);
      }

      this.paint();
      return strainStats(sample.values, byFabric ? sample.bounds : undefined);
    });
  }

  refreshStrain(min: number, max: number, byFabric = false, force = false): StrainStats | null {
    if (!this.starts('strain', force)) return null;
    const input = this.deps.clothInput();
    if (!input) return null;
    const rest = this.deps.restPositions();
    const positions = liveOr(rest, this.deps.lastGoodPositions());
    if (rest.length === 0 || positions.length === 0) return null;
    this.strainParams = { min, max, byFabric };
    const values = computeVertexStrain(rest, positions, input.indices);
    const bounds = byFabric ? boundsOfAssembly(input) : undefined;
    this.sample = { kind: 'strain', values, bounds };
    this.paint();
    return strainStats(values, bounds);
  }

  setPressure(enabled: boolean, maxKpa: number): PressureStats | null {
    const changed = maxKpa !== this.pressureParams.maxKpa;
    this.pressureParams = { maxKpa };
    return this.activate('pressure', enabled, () => {
      const sample = this.sample;
      if (!changed || sample?.kind !== 'pressure') return this.refreshPressure(maxKpa, true);
      this.paint();
      return pressureStats(this.pressureFieldOf(sample.values), this.panelRanges());
    });
  }

  refreshPressure(maxKpa: number, force = false): PressureStats | null {
    if (!this.starts('pressure', force)) return null;
    const contact = this.deps.contact();
    if (!contact) return null;
    this.pressureParams = { maxKpa };
    const field = computePressureField(contact);
    this.sample = { kind: 'pressure', values: field.pressureKpa };
    this.paint();
    return pressureStats(field, this.panelRanges());
  }

  private activate<T>(kind: AnalysisKind, enabled: boolean, first: () => T | null): T | null {
    if (enabled) {
      this.activeKind = kind;
    } else if (this.activeKind === kind) {
      this.activeKind = null;
      this.sample = null;
      this.countdown = 0;
      this.deps.cloth()?.clearField();
    }

    this.deps.revealCloth(!this.active);
    return enabled ? first() : null;
  }

  private starts(kind: AnalysisKind, force: boolean): boolean {
    if (this.activeKind !== kind) return false;
    if (!force && this.countdown > 0) {
      this.countdown -= 1;
      return false;
    }

    this.countdown = REFRESH_FRAMES;
    return true;
  }

  private paint(): void {
    const sample = this.sample;
    const cloth = this.deps.cloth();
    if (!sample || !cloth) return;
    const values = sample.values;
    if (this.stops.length !== values.length) this.stops = new Float32Array(values.length);
    const stops = this.stops;
    const stop = this.stopOf(sample);
    for (let i = 0; i < values.length; i++) {
      stops[i] = stop(values[i]!, i);
    }

    cloth.setField(stops);
  }

  private stopOf(sample: AnalysisSample): (value: number, index: number) => number {
    if (sample.kind === 'fit') {
      const { tightCm, looseCm } = this.fitParams;
      return value => fitStop(value, tightCm, looseCm);
    }

    if (sample.kind === 'strain') {
      const { min, max, byFabric } = this.strainParams;
      const bounds = sample.bounds;
      if (byFabric && bounds) {
        return (value, index) => index < bounds.stretch.length
          ? bilateralStop(value, bounds.stretch[index]!, bounds.compression[index]!)
          : 0;
      }

      return value => strainStop(value, min, max);
    }

    const { maxKpa } = this.pressureParams;
    return value => pressureStop(value, maxKpa);
  }

  private pressureFieldOf(values: Float32Array): { pressureKpa: Float32Array; contactVertices: number } {
    let contactVertices = 0;
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!;
      if (Number.isFinite(value) && value > 0) contactVertices += 1;
    }

    return { pressureKpa: values, contactVertices };
  }

  private panelRanges(): { panelId: string; vertexOffset: number; vertexCount: number }[] {
    return this.deps.clothInput()?.panels.map(panel => ({
      panelId: panel.panelId,
      vertexOffset: panel.vertexOffset,
      vertexCount: panel.mesh.vertexCount,
    })) ?? [];
  }
}

function liveOr(rest: Float32Array, fallback: Float32Array): Float32Array {
  if (fallback.length === rest.length && fallback.length > 0) return fallback;
  return rest;
}

function boundsOfAssembly(input: ClothSimInput): StrainBounds {
  return strainBounds(input.particleCount, input.panels.map(panel => ({
    vertexOffset: panel.vertexOffset,
    vertexCount: panel.mesh.vertexCount,
    stretchLimit: panel.physics.stretchLimit,
    compressionLimit: panel.physics.compressionLimit,
  })));
}
