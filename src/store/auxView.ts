import type { WireMode } from '@/model/types';

export const DEFAULT_AUX: AuxState = { wire: 'off', proxy: 'off', girthLines: 'off', skeleton: 'off' };

export const AUX_GROUP_VALUES: readonly AuxGroupMode[] = ['off', 'only', 'over'];

export type AuxGroupMode = 'off' | 'only' | 'over';

export interface AuxState {
  wire: AuxGroupMode;
  proxy: AuxGroupMode;
  girthLines: AuxGroupMode;
  skeleton: AuxGroupMode;
}

export type ActiveAuxMode = Exclude<AuxGroupMode, 'off'>;

export function auxWire(aux: AuxState): WireMode {
  return aux.wire;
}

export function auxShowsProxy(aux: AuxState): boolean {
  return aux.proxy !== 'off';
}

export function auxProxyOnly(aux: AuxState): boolean {
  return aux.proxy === 'only';
}

export function auxShowsGirthLines(aux: AuxState): boolean {
  return aux.girthLines !== 'off';
}

export function auxGirthLinesOnly(aux: AuxState): boolean {
  return aux.girthLines === 'only';
}

export function auxShowsSkeleton(aux: AuxState): boolean {
  return aux.skeleton !== 'off';
}

export function auxSkeletonOnly(aux: AuxState): boolean {
  return aux.skeleton === 'only';
}

export function auxHidesModel(aux: AuxState, measured = true): boolean {
  if (auxProxyOnly(aux)) return true;
  return measured && (auxGirthLinesOnly(aux) || auxSkeletonOnly(aux));
}

export function toggleWire(aux: AuxState, mode: ActiveAuxMode): AuxState {
  return { ...aux, wire: aux.wire === mode ? 'off' : mode };
}

export function toggleProxy(aux: AuxState, mode: ActiveAuxMode): AuxState {
  return { ...aux, proxy: aux.proxy === mode ? 'off' : mode };
}

export function toggleGirthLines(aux: AuxState, mode: ActiveAuxMode): AuxState {
  return { ...aux, girthLines: aux.girthLines === mode ? 'off' : mode };
}

export function toggleSkeleton(aux: AuxState, mode: ActiveAuxMode): AuxState {
  return { ...aux, skeleton: aux.skeleton === mode ? 'off' : mode };
}
