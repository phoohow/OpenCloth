import type { AvatarParams, Panel } from '@/model/types';
import type { PanelMesh } from '@/pattern/panel';

import { bodyLandmarks, bodyKey, type BodyLandmarks } from '@/avatar';
import { drapePositions, type WrapSlot } from '@/garment';
import { IDENTITY_TRANSFORM } from '@/model';
import { transformMatrix } from '@/render/world';
import { applyObjectTransform } from '@/runtime/world/objectTransforms';

const CM_TO_M = 0.01;

export function flatRestPositions(mesh: PanelMesh): Float32Array {
  const rest = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i++) {
    rest[i * 3] = mesh.positions2D[i * 2] * CM_TO_M;
    rest[i * 3 + 1] = mesh.positions2D[i * 2 + 1] * CM_TO_M;
    rest[i * 3 + 2] = 0;
  }

  return rest;
}

export function posedPositions3D(
  mesh: PanelMesh,
  panel: Panel,
  landmarks: BodyLandmarks,
  slot?: WrapSlot,
): Float32Array {
  const positions = panel.placement
    ? flatPanelPositions(mesh, panel.placement)
    : panel.drape
      ? drapePositions(mesh, panel, landmarks, slot)
      : flatRestPositions(mesh);
  applyObjectTransform(positions, panel.transform ?? IDENTITY_TRANSFORM);
  return positions;
}

function flatPanelPositions(mesh: PanelMesh, placement: { position: { x: number; y: number; z: number }; rotationEuler: { x: number; y: number; z: number } }): Float32Array {
  const positions3D = new Float32Array(mesh.vertexCount * 3);
  const m = transformMatrix({ ...placement, scale: { x: 1, y: 1, z: 1 } });
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2]! * CM_TO_M;
    const y = mesh.positions2D[i * 2 + 1]! * CM_TO_M;
    positions3D[i * 3] = m[0]! * x + m[4]! * y + m[12]!;
    positions3D[i * 3 + 1] = m[1]! * x + m[5]! * y + m[13]!;
    positions3D[i * 3 + 2] = m[2]! * x + m[6]! * y + m[14]!;
  }

  return positions3D;
}

export class BodyLandmarkCache {
  private key = '';
  private cached: BodyLandmarks | null = null;

  resolve(avatar: AvatarParams): BodyLandmarks {
    const key = bodyKey(avatar);
    if (this.key !== key || !this.cached) {
      this.cached = bodyLandmarks(avatar);
      this.key = key;
    }

    return this.cached;
  }
}
