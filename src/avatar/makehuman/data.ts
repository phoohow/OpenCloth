import { bundledAssetUrl } from '@/base/platform/assetUrls';

const BODY_PATH = '/makehuman/body.bin';

const TARGETS_PATH = '/makehuman/targets.bin';

const MANIFEST_PATH = '/makehuman/manifest.json';

let loaded: MakehumanData | null = null;

let pending: Promise<MakehumanData> | null = null;

const WEIGHT_SUM_TOLERANCE = 0.01;

export interface MakehumanManifest {
  readonly vertices: number;
  readonly bodyIndices: number;
  readonly eyeIndices: number;
  readonly armWeightOffset: number;
  readonly motionWeightOffset: number;
  readonly motionRegions: readonly string[];
  readonly targets: readonly string[];
  readonly targetScales: readonly number[];
  readonly joints: MakehumanJoints;
}

export interface MakehumanJoints {
  readonly leftShoulder: readonly number[];
  readonly leftElbow: readonly number[];
  readonly leftWrist: readonly number[];
  readonly rightShoulder: readonly number[];
  readonly rightElbow: readonly number[];
  readonly rightWrist: readonly number[];
  readonly leftHip: readonly number[];
  readonly leftKnee: readonly number[];
  readonly leftAnkle: readonly number[];
  readonly rightHip: readonly number[];
  readonly rightKnee: readonly number[];
  readonly rightAnkle: readonly number[];
}

export interface MakehumanData {
  readonly rest: Float32Array;
  readonly bodyIndices: Uint32Array;
  readonly eyeIndices: Uint32Array;
  readonly targets: Int16Array;
  readonly names: readonly string[];
  readonly targetScales: Float32Array;
  readonly vertexCount: number;
  readonly armWeights: Float32Array;
  readonly motionRegions: readonly string[];
  readonly motionWeights: Float32Array;
  readonly joints: MakehumanJoints;
}

export function makehumanBodyData(): MakehumanData {
  if (!loaded) throw new Error('MakeHuman body data has not loaded yet');
  return loaded;
}

export function installMakehumanData(data: MakehumanData): void {
  loaded = data;
  pending = Promise.resolve(data);
}

export function loadMakehumanBody(): Promise<MakehumanData> {
  pending ??= Promise.all([
    fetchBinary(bundledAssetUrl(BODY_PATH)),
    fetchBinary(bundledAssetUrl(TARGETS_PATH)),
    fetchManifest(bundledAssetUrl(MANIFEST_PATH)),
  ])
    .then(([body, targets, manifest]) => parseMakehumanBodyData(body, targets, manifest))
    .then((data) => {
      loaded = data;
      return data;
    });
  return pending;
}

function motionRegionsOf(vertices: number, manifest: MakehumanManifest, byteLength: number): readonly string[] {
  const regions = manifest.motionRegions;
  const offset = manifest.motionWeightOffset;
  const end = offset + vertices * (regions?.length ?? 0);
  if (!Array.isArray(regions) || regions.length === 0 || !Number.isInteger(offset) || end > byteLength) {
    throw new Error('MakeHuman body data is stale: repack assets/makehuman/body.bin');
  }

  return regions;
}

function checkMotionWeights(vertices: number, regions: number, weights: Float32Array): void {
  if (weights.length !== vertices * regions) {
    throw new Error(`MakeHuman motion weights cover ${weights.length} entries, expected ${vertices * regions}`);
  }

  for (let vertex = 0; vertex < vertices; vertex++) {
    let sum = 0;
    for (let region = 0; region < regions; region++) sum += weights[vertex * regions + region]!;
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      throw new Error(`MakeHuman motion weights of vertex ${vertex} add up to ${sum.toFixed(3)}, not 1`);
    }
  }
}

export function parseMakehumanBodyData(
  body: ArrayBuffer,
  targets: ArrayBuffer,
  manifest: MakehumanManifest,
): MakehumanData {
  const { vertices, bodyIndices, eyeIndices, armWeightOffset, motionWeightOffset, joints } = manifest;
  const motionRegions = motionRegionsOf(vertices, manifest, body.byteLength);
  const floats = vertices * 3;
  const rest = new Float32Array(body.slice(0, floats * 4));
  const bodyIndexBytes = bodyIndices * 4;
  const eyeIndexBytes = eyeIndices * 4;
  const indexOffset = floats * 4;
  const bodyIndexData = new Uint32Array(body.slice(indexOffset, indexOffset + bodyIndexBytes));
  const eyeIndexData = new Uint32Array(
    body.slice(indexOffset + bodyIndexBytes, indexOffset + bodyIndexBytes + eyeIndexBytes),
  );
  const quantized = new Uint8Array(body, armWeightOffset, vertices * 2);
  const armWeights = new Float32Array(vertices * 2);
  for (let i = 0; i < armWeights.length; i++) armWeights[i] = quantized[i]! / 255;
  const packedMotion = new Uint8Array(body, motionWeightOffset, vertices * motionRegions.length);
  const motionWeights = new Float32Array(packedMotion.length);
  for (let i = 0; i < motionWeights.length; i++) motionWeights[i] = packedMotion[i]! / 255;
  checkMotionWeights(vertices, motionRegions.length, motionWeights);
  return {
    rest,
    bodyIndices: bodyIndexData,
    eyeIndices: eyeIndexData,
    targets: new Int16Array(targets),
    names: manifest.targets,
    targetScales: Float32Array.from(manifest.targetScales),
    vertexCount: vertices,
    armWeights,
    motionRegions,
    motionWeights,
    joints,
  };
}

async function fetchAsset(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MakeHuman data request failed (${response.status}): ${url}`);
  return response;
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
  return (await fetchAsset(url)).arrayBuffer();
}

async function fetchManifest(url: string): Promise<MakehumanManifest> {
  return (await (await fetchAsset(url)).json()) as MakehumanManifest;
}
