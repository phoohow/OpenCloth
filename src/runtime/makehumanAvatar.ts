/** The MakeHuman body as plain mesh data, free of any scene library. */

import type { AssetMesh, MaterialData, MeshData } from '@/render/common';
import type { MakehumanBody } from '@/avatar';
import { computeVertexNormals } from '@/base/geom';

/** Skin surface of the body. */
const SKIN: MaterialData = {
  kind: 'surface',
  name: 'skin',
  color: '#e8c4a8',
  roughness: 0.62,
  metalness: 0,
  clearcoat: 0.12,
  side: 'double',
};

/** Eye surface: matte and much darker than the skin. */
const EYE: MaterialData = {
  kind: 'surface',
  name: 'eye',
  color: '#2c2a28',
  roughness: 0.3,
  metalness: 0,
  side: 'front',
};

/** Wraps one index range of a shared vertex buffer as mesh data. */
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

/** Body surface and eyeballs of a built MakeHuman body, in meters. */
export function makehumanAvatarMeshes(body: MakehumanBody): AssetMesh[] {
  return [
    { name: 'body', mesh: meshOf(body, body.bodyIndices), material: SKIN },
    { name: 'eyes', mesh: meshOf(body, body.eyeIndices), material: EYE },
  ];
}

/** Vertex and triangle counts of the built body surface and its eyes. */
export function makehumanAvatarCounts(body: MakehumanBody): { vertices: number; triangles: number } {
  return {
    vertices: body.positions.length / 3,
    triangles: (body.bodyIndices.length + body.eyeIndices.length) / 3,
  };
}
