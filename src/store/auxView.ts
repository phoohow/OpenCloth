/** Auxiliary display groups shared by the 3D toolbar, the viewport and the renderer. */

import type { WireMode } from '@/model/types';

/**
 * One auxiliary group's setting: `off` hides the guide, `only` shows it in place of the shaded
 * counterpart, `over` adds it to the shaded scene.
 */
export type AuxGroupMode = 'off' | 'only' | 'over';

/**
 * Two independent groups: the wireframe drives the cloth panels, the proxy drives the model.
 * The groups stack; the two modes inside each group are mutually exclusive.
 */
export interface AuxState {
  /** Cloth wireframe: edges only, or edges over the fill. */
  wire: AuxGroupMode;
  /** Simplified body proxy: proxy alone, or proxy over the model. */
  proxy: AuxGroupMode;
}

/** Both groups hidden. */
export const DEFAULT_AUX: AuxState = { wire: 'off', proxy: 'off' };

/** Values a persisted group accepts. */
export const AUX_GROUP_VALUES: readonly AuxGroupMode[] = ['off', 'only', 'over'];

/** A group's active (non-off) modes. */
export type ActiveAuxMode = Exclude<AuxGroupMode, 'off'>;

/** Cloth wire mode behind the auxiliary state. */
export function auxWire(aux: AuxState): WireMode {
  return aux.wire;
}

/** Whether the simplified body model is drawn. */
export function auxShowsProxy(aux: AuxState): boolean {
  return aux.proxy !== 'off';
}

/** Whether the model is hidden so the proxy stands in for it. */
export function auxProxyOnly(aux: AuxState): boolean {
  return aux.proxy === 'only';
}

/**
 * Picks a wire mode, or clears the group when its active mode is picked again. Selecting one mode
 * replaces the other, so the two wire modes stay mutually exclusive.
 */
export function toggleWire(aux: AuxState, mode: ActiveAuxMode): AuxState {
  return { ...aux, wire: aux.wire === mode ? 'off' : mode };
}

/** Picks a proxy mode, or clears the group when its active mode is picked again. */
export function toggleProxy(aux: AuxState, mode: ActiveAuxMode): AuxState {
  return { ...aux, proxy: aux.proxy === mode ? 'off' : mode };
}