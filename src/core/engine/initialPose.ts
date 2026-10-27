import * as THREE from 'three/webgpu';
import type { AvatarParams, Panel } from '../model/types';
import type { PanelMesh } from '../../pattern/panel/panelBuilder';
import { IDENTITY_TRANSFORM } from '../model/defaults';
import { bodyLandmarks, type BodyLandmarks } from '../../avatar/landmarks';
import { drapePositions, resolveDrape } from '../../pattern/drape/drapePlacement';
import { explodeOffBody } from '../../pattern/drape/explodedLayout';
import { applyObjectTransform } from './objectTransforms';

const CM_TO_M = 0.01;

/** Converts a panel's flat 2D mesh into rest-length positions in meters. */
export function flatRestPositions(mesh: PanelMesh): Float32Array {
  const rest = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i++) {
    rest[i * 3] = mesh.positions2D[i * 2] * CM_TO_M;
    rest[i * 3 + 1] = mesh.positions2D[i * 2 + 1] * CM_TO_M;
    rest[i * 3 + 2] = 0;
  }
  return rest;
}

/** Panel's posed 3D positions, wrapped around the body unless a placement pins it flat. */
export function posedPositions3D(mesh: PanelMesh, panel: Panel, landmarks: BodyLandmarks): Float32Array {
  const positions = panel.placement
    ? flatPanelPositions(mesh, panel.placement)
    : drapePositions(mesh, panel, landmarks);
  applyObjectTransform(positions, panel.transform ?? IDENTITY_TRANSFORM);
  return positions;
}

/** Unsewn start pose: hanging panels stay where they drape, laid-out panels float off the body. */
export function initialPositions3D(positions3D: Float32Array, panel: Panel): Float32Array {
  return panel.placement ? positions3D : explodeOffBody(positions3D);
}

/** Particle indices of the top band a hanging panel is basted from. */
export function topBandParticles(mesh: PanelMesh, panel: Panel): number[] {
  if (panel.placement || !resolveDrape(panel).pinTop) return [];
  let miny = Infinity, maxy = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const y = mesh.positions2D[i * 2 + 1];
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  const band = (maxy - miny) * 0.12;
  const pinned: number[] = [];
  for (let i = 0; i < mesh.vertexCount; i++) {
    if (mesh.positions2D[i * 2 + 1] >= maxy - band) pinned.push(i);
  }
  return pinned;
}

/** Lays a flat panel out at its stored placement. */
function flatPanelPositions(mesh: PanelMesh, placement: { position: { x: number; y: number; z: number }; rotationEuler: { x: number; y: number; z: number } }): Float32Array {
  const positions3D = new Float32Array(mesh.vertexCount * 3);
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(placement.rotationEuler.x, placement.rotationEuler.y, placement.rotationEuler.z),
  );
  const offset = new THREE.Vector3(placement.position.x, placement.position.y, placement.position.z);
  const v = new THREE.Vector3();
  for (let i = 0; i < mesh.vertexCount; i++) {
    v.set(mesh.positions2D[i * 2] * CM_TO_M, mesh.positions2D[i * 2 + 1] * CM_TO_M, 0);
    v.applyQuaternion(quat).add(offset);
    positions3D[i * 3] = v.x; positions3D[i * 3 + 1] = v.y; positions3D[i * 3 + 2] = v.z;
  }
  return positions3D;
}

/** Body landmarks memoized by measurement set, reused by every panel wrap. */
export class BodyLandmarkCache {
  private key = '';
  private cached: BodyLandmarks | null = null;

  /** Landmarks for these measurements, rebuilt only when they change. */
  resolve(avatar: AvatarParams): BodyLandmarks {
    const key = `${avatar.heightCm}/${avatar.chestCm}/${avatar.waistCm}/${avatar.hipCm}/${avatar.poseArmAngleRad ?? 0.12}`;
    if (this.key !== key || !this.cached) {
      this.cached = bodyLandmarks(avatar);
      this.key = key;
    }
    return this.cached;
  }
}
