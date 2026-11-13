/**
 * Extracts the MakeHuman body mesh and the morph targets this project drives it with.
 *
 * Reads the base mesh and the packed target table shipped by `makehuman-data`, keeps the body
 * surface plus the eyeballs, and writes three compact files into `assets/makehuman/`, which Vite
 * serves from publicDir and the site build streams from Storage:
 *
 *   body.bin       Float32 vertex positions in meters, body and eye triangle indices, then the
 *                  per-vertex weight of each arm chain, used to pose the arms
 *   targets.bin    Int8 vertex offsets, one row per target, with a per-row scale in the manifest
 *   manifest.json  names of those targets, in row order, plus the joint vertices
 *
 * Run with `npm run data:makehuman`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = resolve(ROOT, 'node_modules/makehuman-data/public/data');
const OUT = resolve(ROOT, 'assets/makehuman');

/** Decimeters in the MakeHuman source data. */
const DM_TO_M = 0.1;
/** Meters per unit of the packed target table. */
const TARGET_SCALE = 1e-4;

/** Materials of the body surface; every helper and joint group is dropped. */
const BODY_MATERIAL = 'body';
/** Materials of the two eyeball spheres. */
const EYE_MATERIALS = new Set(['helper-l-eye', 'helper-r-eye']);

/**
 * Morph tables of the body build, the two MakeHuman drives separately.
 *
 * `age` rows carry the shape of a gender at an age, the average of the threeethnicities, which is
 * the mix the base mesh already is. `muscle` rows carry the weight and muscle deltas around that
 * shape, one corner of MakeHuman's 3 x 3 grid. Age and gender blend the first family, muscle and
 * weight blend the second, exactly as the two modifiers of MakeHuman do.
 */
const GENDERS = ['female', 'male'];
const AGES = ['baby', 'child', 'young', 'old'];
const MUSCLES = ['minmuscle', 'averagemuscle', 'maxmuscle'];
const WEIGHTS = ['minweight', 'averageweight', 'maxweight'];
const ETHNICITIES = ['caucasian', 'asian', 'african'];

/** Circumference rows of MakeHuman's measurement modifier, one pair per girth. */
const MEASURE_ROWS = [
  ['measure/bust-increase', 'measure-bust-increase'],
  ['measure/bust-decrease', 'measure-bust-decrease'],
  ['measure/waist-increase', 'measure-waist-increase'],
  ['measure/waist-decrease', 'measure-waist-decrease'],
  ['measure/hips-increase', 'measure-hips-increase'],
  ['measure/hips-decrease', 'measure-hips-decrease'],
];

/** Joints the runtime reads off the deformed mesh, by packed name. */
const JOINTS = {
  leftShoulder: 'upperarm01.L____head',
  leftElbow: 'lowerarm01.L____head',
  leftWrist: 'wrist.L____head',
  rightShoulder: 'upperarm01.R____head',
  rightElbow: 'lowerarm01.R____head',
  rightWrist: 'wrist.R____head',
  leftHip: 'upperleg01.L____head',
  leftKnee: 'lowerleg01.L____head',
  leftAnkle: 'foot.L____head',
  rightHip: 'upperleg01.R____head',
  rightKnee: 'lowerleg01.R____head',
  rightAnkle: 'foot.R____head',
};

/** Bones whose skin weights move with each arm, rooted at the shoulder. */
const ARM_BONES = {
  left: 'upperarm01.L____head',
  right: 'upperarm01.R____head',
};

/** Reads the makehuman-JSON face stream into flat per-face vertex and material lists. */
function readFaces(faces) {
  const triangles = [];
  let i = 0;
  while (i < faces.length) {
    const type = faces[i++];
    const count = (type & 1) ? 4 : 3;
    const corners = faces.slice(i, i + count);
    i += count;
    let material = 0;
    if (type & 2) material = faces[i++];
    if (type & 4) i += count * 2;
    if (type & 8) i += count;
    triangles.push({ corners, material });
  }
  return triangles;
}

/** Signed volume of a closed triangle mesh, positive when the faces wind counter-clockwise. */
function signedVolume(positions, indices) {
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return volume / 6;
}

/** Fan-triangulates the kept faces of a face list. */
function triangleIndices(faces, keep) {
  const out = [];
  for (const face of faces) {
    if (!keep(face.material)) continue;
    const [a, b, c, d] = face.corners;
    out.push(a, b, c);
    if (d !== undefined) out.push(a, c, d);
  }
  return out;
}

/** Flips the winding of every triangle when the mesh came out inside out. */
function windOutward(positions, indices) {
  if (signedVolume(positions, indices) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = swap;
    }
  }
}

/** Bone indices of everything hanging off one arm joint, in the bone tree. */
function armBoneSet(bones, rootName) {
  const children = new Map();
  bones.forEach((bone, index) => {
    if (bone.parent < 0) return;
    if (!children.has(bone.parent)) children.set(bone.parent, []);
    children.get(bone.parent).push(index);
  });
  const root = bones.findIndex(bone => bone.name === rootName);
  if (root < 0) throw new Error(`bone missing from the skeleton: ${rootName}`);
  const out = new Set();
  const walk = (index) => {
    out.add(index);
    for (const child of children.get(index) ?? []) walk(child);
  };
  walk(root);
  return out;
}

/** Per-vertex weight of one arm chain, quantized to a byte. */
function armWeights(model, boneSet, vertexCount) {
  const out = new Uint8Array(vertexCount);
  const influences = model.influencesPerVertex;
  for (let v = 0; v < vertexCount; v++) {
    let sum = 0;
    for (let k = 0; k < influences; k++) {
      const bone = model.skinIndices[v * influences + k];
      if (boneSet.has(bone)) sum += model.skinWeights[v * influences + k];
    }
    out[v] = Math.max(0, Math.min(255, Math.round(sum * 255)));
  }
  return out;
}

function main() {
  const model = JSON.parse(readFileSync(resolve(DATA, 'models/human_full_size.json'), 'utf8'));
  const materialNames = model.materials.map(m => m.DbgName ?? m.name ?? '');
  const bodyMaterial = materialNames.indexOf(BODY_MATERIAL);
  const eyeMaterials = new Set([...EYE_MATERIALS].map(name => materialNames.indexOf(name)));

  const sourceCount = model.vertices.length / 3;
  const positions = new Float32Array(sourceCount * 3);
  let minY = Infinity;
  for (let i = 0; i < sourceCount; i++) {
    // MakeHuman authors the figure in decimeters, centred on the origin.
    positions[i * 3] = model.vertices[i * 3] * DM_TO_M;
    positions[i * 3 + 1] = model.vertices[i * 3 + 1] * DM_TO_M;
    positions[i * 3 + 2] = model.vertices[i * 3 + 2] * DM_TO_M;
    if (model.vertices[i * 3 + 1] < minY) minY = model.vertices[i * 3 + 1];
  }
  if (Math.abs(minY * DM_TO_M) > 1e-4) {
    for (let i = 0; i < sourceCount; i++) positions[i * 3 + 1] -= minY * DM_TO_M;
  }

  const faces = readFaces(model.faces);
  const bodyIndices = triangleIndices(faces, m => m === bodyMaterial);
  const eyeIndices = triangleIndices(faces, m => eyeMaterials.has(m));
  windOutward(positions, bodyIndices);
  windOutward(positions, eyeIndices);

  // Keep only the vertices the kept triangles reference; the source mesh also carries helper
  // geometry that never shows in the viewport and would only cost memory in every target row.
  const used = new Uint8Array(sourceCount);
  for (const index of bodyIndices) used[index] = 1;
  for (const index of eyeIndices) used[index] = 1;
  // Joint rings sit on the rig, not on the surface, so they are kept without being drawn.
  const jointIds = Object.values(JOINTS).flatMap(name => model.metadata.joint_pos_idxs[name] ?? []);
  for (const index of jointIds) used[index] = 1;
  const remap = new Int32Array(sourceCount).fill(-1);
  const kept = [];
  for (let v = 0; v < sourceCount; v++) {
    if (!used[v]) continue;
    remap[v] = kept.length;
    kept.push(v);
  }
  const vertexCount = kept.length;
  const compact = (array) => {
    const out = new Float32Array(vertexCount * 3);
    kept.forEach((v, i) => {
      out[i * 3] = array[v * 3];
      out[i * 3 + 1] = array[v * 3 + 1];
      out[i * 3 + 2] = array[v * 3 + 2];
    });
    return out;
  };
  const rest = compact(positions);
  const remapList = (list) => Uint32Array.from(list, (index) => remap[index]);

  // Rows of the packed target table: the age shapes, the muscle and weight deltas, then girths.
  const sources = [];
  for (const gender of GENDERS) {
    for (const age of AGES) {
      sources.push([
        `age/${gender}-${age}`,
        ETHNICITIES.map(race => `macrodetails/${race}-${gender}-${age}.target`),
      ]);
    }
  }
  for (const gender of GENDERS) {
    for (const age of AGES) {
      for (const muscle of MUSCLES) {
        for (const weight of WEIGHTS) {
          sources.push([
            `muscle/${gender}-${age}-${muscle}-${weight}`,
            [`macrodetails/universal-${gender}-${age}-${muscle}-${weight}.target`],
          ]);
        }
      }
    }
  }
  for (const [name, file] of MEASURE_ROWS) sources.push([name, [`measure/${file}.target`]]);

  const targetList = JSON.parse(readFileSync(resolve(DATA, '../../src/json/targets/target-list.json'), 'utf8'));
  const paths = Object.keys(targetList.targets).sort();
  const packedBytes = new Uint8Array(readFileSync(resolve(DATA, 'targets/targets.bin')));
  const packed = new Int16Array(packedBytes.buffer, 0, packedBytes.byteLength / 2);
  const rowLength = sourceCount * 3;

  /** Averaged Int16 row of one packed target, in the source vertex order. */
  const readRow = (files) => {
    if (files.length === 1) {
      const source = paths.indexOf(`data/targets/${files[0]}`);
      if (source < 0) throw new Error(`target missing from the makehuman table: ${files[0]}`);
      return packed.subarray(source * rowLength, (source + 1) * rowLength);
    }
    const out = new Int16Array(rowLength);
    for (const file of files) {
      const source = paths.indexOf(`data/targets/${file}`);
      if (source < 0) throw new Error(`target missing from the makehuman table: ${file}`);
      const base = source * rowLength;
      for (let i = 0; i < rowLength; i++) out[i] += Math.round(packed[base + i] / files.length);
    }
    return out;
  };

  // One byte per offset with a per-row scale: the rows are smooth, and a byte keeps the step far
  // below the millimetre while the whole table stays small.
  const targets = new Int8Array(sources.length * vertexCount * 3);
  const scales = [];
  const names = sources.map(([name, files], row) => {
    const source = readRow(files);
    let maxAbs = 0;
    for (let i = 0; i < rowLength; i++) maxAbs = Math.max(maxAbs, Math.abs(source[i]));
    const scale = maxAbs > 0 ? (maxAbs * TARGET_SCALE) / 127 : 0;
    const out = row * vertexCount * 3;
    if (scale > 0) {
      kept.forEach((v, i) => {
        for (let axis = 0; axis < 3; axis++) {
          targets[out + i * 3 + axis] = Math.round(source[v * 3 + axis] / (maxAbs / 127));
        }
      });
    }
    scales.push(scale);
    return name;
  });

  const armLeft = armWeights(model, armBoneSet(model.bones, ARM_BONES.left), sourceCount);
  const armRight = armWeights(model, armBoneSet(model.bones, ARM_BONES.right), sourceCount);

  const packedBodyIndices = remapList(bodyIndices);
  const packedEyeIndices = remapList(eyeIndices);

  mkdirSync(OUT, { recursive: true });
  const indexBytes = packedBodyIndices.length * 4 + packedEyeIndices.length * 4;
  const weightOffset = rest.byteLength + indexBytes;
  const body = new Uint8Array(weightOffset + vertexCount * 2);
  body.set(new Uint8Array(rest.buffer), 0);
  body.set(new Uint8Array(packedBodyIndices.buffer), rest.byteLength);
  body.set(new Uint8Array(packedEyeIndices.buffer), rest.byteLength + packedBodyIndices.length * 4);
  kept.forEach((v, i) => {
    body[weightOffset + i * 2] = armLeft[v];
    body[weightOffset + i * 2 + 1] = armRight[v];
  });
  writeFileSync(resolve(OUT, 'body.bin'), body);
  writeFileSync(resolve(OUT, 'targets.bin'), new Uint8Array(targets.buffer));

  const joints = Object.fromEntries(
    Object.entries(JOINTS).map(([key, name]) => {
      const ids = model.metadata.joint_pos_idxs[name];
      if (!ids) throw new Error(`joint missing from the mesh metadata: ${name}`);
      // Joint rings occasionally reference the helper geometry the body triangles drop.
      return [key, ids.map((v) => remap[v]).filter((v) => v >= 0)];
    }),
  );

  const manifest = {
    vertices: vertexCount,
    bodyIndices: packedBodyIndices.length,
    eyeIndices: packedEyeIndices.length,
    armWeightOffset: weightOffset,
    targets: names,
    targetScales: scales,
    joints,
    grid: { genders: GENDERS, ages: AGES, muscles: MUSCLES, weights: WEIGHTS },
    source: 'makehuman-data 0.0.2 / MakeHuman 1.1 basemesh (CC0)',
    bodyHash: createHash('sha1').update(body).digest('hex').slice(0, 12),
    targetHash: createHash('sha1').update(new Uint8Array(targets.buffer)).digest('hex').slice(0, 12),
  };
  writeFileSync(resolve(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `body ${(body.byteLength / 1024).toFixed(0)} KiB` +
    ` (${vertexCount} vertices, ${packedBodyIndices.length / 3} body triangles, ${packedEyeIndices.length / 3} eye)` +
    `, targets ${(targets.byteLength / 1024).toFixed(0)} KiB (${names.length} rows)`,
  );
}

main();
