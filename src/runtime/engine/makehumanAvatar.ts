import type { AssetMesh, AssetSource, MaterialData, MeshData } from '@/render/common';

import { makehumanMotionRig, type MakehumanBody } from '@/avatar';
import { computeVertexNormals } from '@/base/geom';
import { makehumanMotion } from '@/runtime/engine/makehumanClips';

const SKIN_MESH_NAME = 'body';

const SKIN: MaterialData = {
  kind: 'surface',
  name: 'skin',
  color: '#e8c4a8',
  roughness: 0.62,
  metalness: 0,
  clearcoat: 0.12,
  side: 'double',
};

const EYE: MaterialData = {
  kind: 'surface',
  name: 'eye',
  color: '#2c2a28',
  roughness: 0.3,
  metalness: 0,
  side: 'front',
};

function meshOf(body: MakehumanBody, indices: Uint32Array): MeshData {
  return {
    topology: 'triangle',
    streams: {
      position: body.positions,
      normal: computeVertexNormals(body.positions, indices),
    },
    index: indices,
  };
}

export function makehumanAvatarMeshes(body: MakehumanBody): AssetMesh[] {
  return [
    { name: SKIN_MESH_NAME, mesh: meshOf(body, body.bodyIndices), material: SKIN },
    { name: 'eyes', mesh: meshOf(body, body.eyeIndices), material: EYE },
  ];
}

export function makehumanAvatarSource(body: MakehumanBody): AssetSource {
  return {
    kind: 'meshes',
    meshes: makehumanAvatarMeshes(body),
    motionMesh: SKIN_MESH_NAME,
    motion: makehumanMotion(makehumanMotionRig(body)),
  };
}

export function makehumanAvatarCounts(body: MakehumanBody): { vertices: number; triangles: number } {
  return {
    vertices: body.positions.length / 3,
    triangles: (body.bodyIndices.length + body.eyeIndices.length) / 3,
  };
}
