/** Diagnostic fill materials: uv checker, view normal and world vertex normal. */

import * as THREE from 'three/webgpu';
import { normalView, normalWorldGeometry, pow } from 'three/tsl';
import type { FillMode } from '@/render/common';

/** Checkerboard shared by every uvChecked mesh. */
let checker: THREE.DataTexture | null = null;
const materials = new Map<FillMode, THREE.Material>();

/** Diagnostic material for one fill; null for the physical fill. */
export function diagnosticMaterial(fill: FillMode): THREE.Material | null {
  if (fill === 'physical') return null;
  const known = materials.get(fill);
  if (known) return known;
  const material = build(fill);
  materials.set(fill, material);
  return material;
}

/** Frees every diagnostic material and the checkerboard. */
export function disposeDiagnosticMaterials(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
  checker?.dispose();
  checker = null;
}

function build(fill: Exclude<FillMode, 'physical'>): THREE.Material {
  switch (fill) {
    case 'uvCheck': return new THREE.MeshBasicMaterial({
      map: checkerTexture(), side: THREE.DoubleSide, toneMapped: false,
    });
    case 'normal': return normalMaterial();
    case 'vertexNormal': return vertexNormalMaterial();
  }
}

/** Checkerboard texture drawn once instead of shipped as an asset. */
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

/** View-space shading normal shown as colour, pre-decoded for the sRGB canvas. */
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
