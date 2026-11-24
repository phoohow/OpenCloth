import type { Backend } from '@/render/backend';
import type {
  AssetMesh, AssetSource, Bounds, CameraState, LightData, SceneItem, SceneSnapshot, Transform,
  VersionStamp,
} from '@/render/common';
import type { PreviewResources } from '@/render/renderer/frame/pass';

import { degToRad } from '@/base/math';
import { pixelsToPngDataUrl, waitForChange, whenImagesReady } from '@/base/platform';
import { PreviewGraph } from '@/render/renderer/frame/previewGraph';
import { PreviewScenePass } from '@/render/renderer/passes/previewScenePass';
import { PreviewTonePass } from '@/render/renderer/passes/previewTonePass';

const PREVIEW_SIZE = 128;

const BACKGROUND = '#1f1f24';

const BODY_FILL = 0.92;

const UPPER_BODY_SPAN = 0.30;

const GARMENT_FILL = 0.96;

const MODEL_FOV = 30;

const ENVIRONMENT_FOV = 70;

const EYE_HEIGHT = 1.6;

const IDENTITY: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotationEuler: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

const STAMP: VersionStamp = {
  topology: 1, geometry: 1, transform: 1, material: 1, visibility: 1, lights: 1, environment: 1,
};

export interface PreviewDeps {
  readonly backend: Backend;
}

export interface Previewer {
  model(url: string): Promise<string | null>;
  body(meshes: readonly AssetMesh[]): Promise<string | null>;
  garment(meshes: readonly AssetMesh[]): Promise<string | null>;
  environment(url: string): Promise<string | null>;
  dispose(): void;
}

export function createPreviewer(deps: PreviewDeps): Previewer {
  return new PreviewPipeline(deps);
}

class PreviewPipeline implements Previewer {
  private readonly backend: Backend;
  private readonly graph: PreviewGraph;
  private tail: Promise<unknown> = Promise.resolve();
  private bodyCount = 0;
  private garmentCount = 0;

  constructor(deps: PreviewDeps) {
    this.backend = deps.backend;
    this.graph = new PreviewGraph([
      new PreviewScenePass(),
      new PreviewTonePass(this.backend.programs),
    ]);
  }

  model(url: string): Promise<string | null> {
    return this.enqueue(() => this.drawAsset(`preview:model:${url}`, { kind: 'model', url }));
  }

  body(meshes: readonly AssetMesh[]): Promise<string | null> {
    const key = `preview:body:${++this.bodyCount}`;
    return this.enqueue(() => this.drawAsset(key, { kind: 'meshes', meshes }));
  }

  garment(meshes: readonly AssetMesh[]): Promise<string | null> {
    const key = `preview:garment:${++this.garmentCount}`;
    return this.enqueue(() => this.drawAsset(key, { kind: 'meshes', meshes }, garmentCamera));
  }

  environment(url: string): Promise<string | null> {
    return this.enqueue(() => this.drawEnvironment(url));
  }

  dispose(): void {
    this.graph.dispose();
  }

  private async drawAsset(
    key: string,
    source: AssetSource,
    camera: (bounds: Bounds) => CameraState = portraitCamera,
  ): Promise<string | null> {
    const handle = await this.backend.assets.load(key, source).catch(() => null);
    if (!handle) return null;
    try {
      return await this.frame(assetScene(key), camera(handle.bounds));
    } finally {
      this.backend.assets.release(key);
    }
  }

  private async drawEnvironment(url: string): Promise<string | null> {
    const key = `preview:environment:${url}`;
    const { textures } = this.backend;
    const before = textures.version;
    textures.load(key, url);
    await whenImagesReady();
    await waitForChange(() => textures.version, before);
    try {
      return await this.frame(environmentScene(key), environmentCamera());
    } finally {
      textures.release(key);
    }
  }

  private async frame(snapshot: SceneSnapshot, camera: CameraState): Promise<string> {
    const { commands, targets, scene } = this.backend;
    const size = PREVIEW_SIZE;
    targets.ensure({ width: size, height: size, traceWidth: size, traceHeight: size });
    scene.apply(snapshot);
    const resources: PreviewResources = {
      color: targets.color,
      display: targets.scratchAt(0, size, size, 'display'),
      texture: target => targets.texture(target),
    };
    this.graph.execute({ commands, scene, resources, camera });
    commands.restore();
    return pixelsToPngDataUrl(await commands.readTarget(resources.display, size, size), size, size);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

function assetScene(key: string): SceneSnapshot {
  const item: SceneItem = {
    key: 1,
    mesh: { kind: 'asset', key },
    transform: IDENTITY,
    rasterStage: 'scene',
    bucket: 'opaque',
    rasterMaterials: [{
      technique: 'asset',
      data: { kind: 'surface' },
      source: { kind: 'asset', key, slot: 0 },
    }],
    traceMaterials: [],
    wire: null,
  };
  return {
    items: [item],
    meshes: [],
    lights: portraitLights(),
    environment: { background: 'color', color: BACKGROUND, textureKey: null, intensity: 1, url: '' },
    versions: STAMP,
  };
}

function environmentScene(key: string): SceneSnapshot {
  return {
    items: [],
    meshes: [],
    lights: [],
    environment: {
      background: 'texture', color: BACKGROUND, textureKey: key, intensity: 1, url: '',
    },
    versions: STAMP,
  };
}

function portraitLights(): LightData[] {
  const light = (
    name: string, direction: { x: number; y: number; z: number }, intensity: number,
  ): LightData => ({
    type: 'directional',
    name,
    color: '#ffffff',
    intensity,
    position: direction,
    target: { x: 0, y: 0, z: 0 },
    distance: 0,
    coneAngleDeg: 0,
    penumbra: 0,
    width: 0,
    height: 0,
    enabled: true,
  });
  return [
    light('preview-key', { x: 1.2, y: 2, z: 2.4 }, 2.4),
    light('preview-fill', { x: -1.6, y: 0.6, z: 1.2 }, 0.7),
  ];
}

function portraitCamera(bounds: Bounds): CameraState {
  const height = Math.max(bounds.max.y - bounds.min.y, 1e-3);
  const span = height * UPPER_BODY_SPAN / BODY_FILL;
  const distance = span / (2 * Math.tan(degToRad(MODEL_FOV) / 2));
  const center = boundsCenter(bounds);
  return lookingCamera({ x: center.x, y: bounds.max.y - span / 2, z: center.z }, distance, span);
}

function garmentCamera(bounds: Bounds): CameraState {
  const width = Math.max(bounds.max.x - bounds.min.x, 1e-3);
  const height = Math.max(bounds.max.y - bounds.min.y, 1e-3);
  const depth = Math.max(bounds.max.z - bounds.min.z, 1e-3);
  const radius = Math.hypot(width, height, depth) / 2;
  const distance = radius / Math.sin(degToRad(MODEL_FOV) / 2) / GARMENT_FILL;
  return lookingCamera(boundsCenter(bounds), distance, radius * 2);
}

function boundsCenter(bounds: Bounds): { x: number; y: number; z: number } {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

function lookingCamera(
  center: { x: number; y: number; z: number },
  distance: number,
  viewHeightMeters: number,
): CameraState {
  return {
    projection: 'perspective',
    position: { x: center.x, y: center.y, z: center.z + distance },
    target: center,
    up: { x: 0, y: 1, z: 0 },
    fovDeg: MODEL_FOV,
    viewHeightMeters,
    aspect: 1,
    near: 0.05,
    far: 20,
  };
}

function environmentCamera(): CameraState {
  return {
    projection: 'perspective',
    position: { x: 0, y: EYE_HEIGHT, z: 0 },
    target: { x: 0, y: EYE_HEIGHT, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    fovDeg: ENVIRONMENT_FOV,
    viewHeightMeters: 2 * EYE_HEIGHT,
    aspect: 1,
    near: 0.1,
    far: 100,
  };
}
