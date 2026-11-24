import type { SurfaceMode } from '@/render/common';

import { max, normalWorldGeometry, pow } from 'three/tsl';
import * as THREE from 'three/webgpu';

let checker: THREE.DataTexture | null = null;

const materials = new Map<DiagnosticFill, THREE.Material>();

type DiagnosticFill = Exclude<SurfaceMode, 'material'>;

export function getDiagnosticMaterial(fill: SurfaceMode): THREE.Material | null {
  if (fill === 'material') return null;
  const known = materials.get(fill);
  if (known) return known;
  const material = createDiagnosticMaterial(fill);
  materials.set(fill, material);
  return material;
}

export function disposeDiagnosticMaterials(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
  checker?.dispose();
  checker = null;
}

function createDiagnosticMaterial(fill: DiagnosticFill): THREE.Material {
  switch (fill) {
    case 'uv': return createUvMaterial();
    case 'normal': return createNormalMaterial();
  }
}

function createUvMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({
    map: getCheckerTexture(), side: THREE.DoubleSide, toneMapped: false,
  });
}

function createNormalMaterial(): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false });
  material.colorNode = pow(max(normalWorldGeometry.normalize().mul(0.5).add(0.5), 0), 2.2);
  return material;
}

function getCheckerTexture(): THREE.DataTexture {
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
