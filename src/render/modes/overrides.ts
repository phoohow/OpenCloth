/** Diagnostic fill materials, substituted for the real ones during the scene pass. */

import * as THREE from 'three/webgpu';
import { normalView, normalWorldGeometry, pow } from 'three/tsl';
import type { FillMode } from '@/model/types';

/** Checkerboard shared by every uvChecked mesh. */
let checker: THREE.DataTexture | null = null;

/** One material per fill, shared by every mesh the diagnostic substitutes it on. */
const materials = new Map<FillMode, THREE.Material>();
/** Material arrays per fill and slot count, for meshes that carry one material per group. */
const arrays = new Map<string, THREE.Material[]>();

/** Checkerboard texture drawn into a data texture instead of shipped as an asset. */
function checkerTexture(): THREE.DataTexture {
  if (checker) return checker;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const cell = size / 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const value = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 220 : 80;
      data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  checker = texture;
  return texture;
}

/** UV checkerboard shown as the surface colour. */
function uvCheckMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide });
}

/** View-space shading normal shown as colour, pre-decoded for the canvas sRGB encode. */
function normalMaterial(): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false });
  material.colorNode = pow(normalView.normalize().mul(0.5).add(0.5), 2.2);
  return material;
}

/** Interpolated world-space vertex normal shown as colour, pre-decoded the same way. */
function vertexNormalMaterial(): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false });
  material.colorNode = pow(normalWorldGeometry.normalize().mul(0.5).add(0.5), 2.2);
  return material;
}

/**
 * Material the diagnostic fill puts on one mesh, in the same shape the mesh already had.
 *
 * The shape is not cosmetic: three only walks a geometry's groups when `material` is an array, so
 * handing `[material]` to a mesh whose geometry has no groups draws nothing at all — the subject
 * silently disappears instead of changing fill. Meshes with one material per group keep an array
 * of the same length, because a shorter one leaves the extra groups without a material.
 *
 * Both the material and the arrays are cached: the scene pass asks for them every frame, and a
 * fresh node material per frame would rebuild its pipeline every frame.
 */
export function fillOverride(
  fill: FillMode,
  original: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] | null {
  const material = fillMaterial(fill);
  if (!material) return null;
  if (!Array.isArray(original)) return material;
  const key = `${fill}:${original.length}`;
  const cached = arrays.get(key);
  if (cached) return cached;
  const list = Array.from({ length: original.length }, () => material);
  arrays.set(key, list);
  return list;
}

/** Builders for the diagnostic fills, keyed so every fill has one. */
const builders: Record<Exclude<FillMode, 'physical'>, () => THREE.Material> = {
  uvCheck: uvCheckMaterial,
  normal: normalMaterial,
  vertexNormal: vertexNormalMaterial,
};

/** The single fill material, built once per fill. */
function fillMaterial(fill: FillMode): THREE.Material | null {
  if (fill === 'physical') return null;
  const known = materials.get(fill);
  if (known) return known;
  const material = builders[fill]();
  materials.set(fill, material);
  return material;
}

/** Frees every diagnostic material and the checkerboard; called when the viewport goes away. */
export function disposeFillOverrides(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
  arrays.clear();
  checker?.dispose();
  checker = null;
}
