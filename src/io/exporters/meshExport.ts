/** One exportable mesh: world-space positions and triangle indices. */
export interface ExportMesh {
  /** Mesh name used as the object name in the exported file. */
  name: string;
  /** Flat world-space positions in meters, three per vertex. */
  positions: Float32Array;
  /** Triangle indices, three per face. */
  indices: Uint32Array;
}

/** Formats a number without exponent notation. */
function num(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** A name that is safe inside an FBX or USD identifier/key. */
function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return cleaned || fallback;
}

/** Last vertex of every FBX polygon is stored as its bitwise complement. */
function fbxPolygonIndices(indices: Uint32Array): string {
  const parts: string[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    parts.push(String(indices[i]), String(indices[i + 1]), String(-(indices[i + 2]!) - 1));
  }
  return parts.join(',');
}

/**
 * ASCII FBX 7.4 document holding one Geometry/Model pair per mesh. Positions are baked
 * into world space, polygons are triangles, and no materials or scene hierarchy are written.
 */
export function fbxText(meshes: ExportMesh[]): string {
  const lines: string[] = [
    '; FBX 7.4.0 project file',
    'FBXHeaderExtension:  {',
    '  FBXHeaderVersion: 1003',
    '  FBXVersion: 7400',
    '  Creator: "OpenCloth"',
    '}',
    'GlobalSettings:  {',
    '  Version: 1000',
    '  Properties70:  {',
    '    P: "UpAxis", "int", "Integer", "",1',
    '    P: "UpAxisSign", "int", "Integer", "",1',
    '    P: "FrontAxis", "int", "Integer", "",2',
    '    P: "FrontAxisSign", "int", "Integer", "",1',
    '    P: "CoordAxis", "int", "Integer", "",0',
    '    P: "CoordAxisSign", "int", "Integer", "",1',
    '    P: "UnitScaleFactor", "double", "Number", "",100',
    '  }',
    '}',
    'Objects:  {',
  ];

  const connections: string[] = [];
  meshes.forEach((mesh, index) => {
    const name = safeName(mesh.name, `mesh${index + 1}`);
    const geometryId = 1000 + index;
    const modelId = 2000 + index;
    const vertices = Array.from(mesh.positions, num).join(',');
    lines.push(
      `  Geometry: ${geometryId}, "Geometry::${name}", "Mesh" {`,
      '    GeometryVersion: 124',
      `    Vertices: *${mesh.positions.length} {`,
      `      a: ${vertices}`,
      '    }',
      `    PolygonVertexIndex: *${mesh.indices.length} {`,
      `      a: ${fbxPolygonIndices(mesh.indices)}`,
      '    }',
      '  }',
      `  Model: ${modelId}, "Model::${name}", "Mesh" {`,
      '    Version: 232',
      '    Properties70:  {',
      '      P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0',
      '    }',
      '    Shading: T',
      '    Culling: "CullingOff"',
      '  }',
    );
    connections.push(`  C: "OO", ${modelId}, ${geometryId}`);
  });

  lines.push('}', 'Connections:  {', ...connections, '}');
  return lines.join('\n') + '\n';
}

/** USDA document with one Xform holding a Mesh per export mesh. */
export function usdaText(meshes: ExportMesh[], rootName = 'OpenCloth'): string {
  const root = safeName(rootName, 'OpenCloth');
  const lines: string[] = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${root}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Y"',
    ')',
    '',
    `def Xform "${root}"`,
    '{',
  ];

  meshes.forEach((mesh, index) => {
    const name = safeName(mesh.name, `mesh${index + 1}`);
    const counts: string[] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) counts.push('3');
    const faceIndices = Array.from(mesh.indices).join(', ');
    const points: string[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      points.push(`(${num(mesh.positions[i]!)}, ${num(mesh.positions[i + 1]!)}, ${num(mesh.positions[i + 2]!)})`);
    }
    lines.push(
      `    def Mesh "${name}"`,
      '    {',
      `        int[] faceVertexCounts = [${counts.join(', ')}]`,
      `        int[] faceVertexIndices = [${faceIndices}]`,
      `        point3f[] points = [${points.join(', ')}]`,
      '    }',
    );
  });

  lines.push('}', '');
  return lines.join('\n');
}
