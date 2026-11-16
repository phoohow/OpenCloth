/**
 * Draws catalogue previews: one still frame per asset, composed from the backend's primitives by the
 * preview graph and read back as a PNG data url. Sits beside `Renderer`, over its own backend.
 */

import { degToRad } from '@/base/math';
import { pixelsToPngDataUrl, waitForChange, whenImagesReady } from '@/base/platform';
import type {
  AssetMesh, AssetSource, Bounds, CameraState, LightData, SceneItem, SceneSnapshot, Transform,
  VersionStamp,
} from '@/render/common';
import type { Backend } from '@/render/backend';
import { PreviewGraph } from '@/render/renderer/frame/previewGraph';
import type { PreviewResources } from '@/render/renderer/frame/pass';
import { PreviewScenePass } from '@/render/renderer/passes/previewScenePass';
import { PreviewTonePass } from '@/render/renderer/passes/previewTonePass';

/** Edge of a generated preview, in pixels; a row is 512 bytes, which keeps the readback unpadded. */
const PREVIEW_SIZE = 128;

/** Backdrop of a preview, matching the asset-panel row. */
const BACKGROUND = '#1f1f24';

/** Framing of the model portrait: share of the frame the body fills, in model heights. */
const BODY_FILL = 0.92;

/** Framing of a garment portrait: share of the frame its bounding sphere fills at most. */
const GARMENT_FILL = 0.96;

/** Turn of the garment camera, so the icon reads as a volume rather than a flat silhouette. */
const GARMENT_YAW_DEG = 24;

/** Field of view of the model camera, in degrees. */
const MODEL_FOV = 30;

/** Field of view of the environment camera, wide enough to read the panorama around the horizon. */
const ENVIRONMENT_FOV = 70;

/** Level horizon of a viewer standing in the panorama, in metres. */
const EYE_HEIGHT = 1.6;

const IDENTITY: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotationEuler: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

/** One revision of every input, so the scene store rebuilds from a fresh snapshot. */
const STAMP: VersionStamp = {
  topology: 1, geometry: 1, transform: 1, material: 1, visibility: 1, lights: 1, environment: 1,
};

/** Assembly inputs of the preview pipeline; only `src/main.tsx` builds them. */
export interface PreviewDeps {
  readonly backend: Backend;
}

/** Narrow preview facade the catalogue consumes. */
export interface Previewer {
  /** Draws a body model as a portrait; null when the file cannot be loaded. */
  model(url: string): Promise<string | null>;
  /** Draws procedural body meshes as a portrait; null when they cannot be built. */
  body(meshes: readonly AssetMesh[]): Promise<string | null>;
  /** Draws a settled garment on its own, with no body behind it. */
  garment(meshes: readonly AssetMesh[]): Promise<string | null>;
  /** Draws an equirectangular image as it looks around the horizon; null when it cannot be read. */
  environment(url: string): Promise<string | null>;
  dispose(): void;
}

/** Builds the preview pipeline over the Backend instance it is given. */
export function createPreviewer(deps: PreviewDeps): Previewer {
  return new PreviewPipeline(deps);
}

/** Preview graph, still-frame targets and the serialized requests of one catalogue. */
class PreviewPipeline implements Previewer {
  private readonly backend: Backend;
  private readonly graph: PreviewGraph;
  /** Requests queue here: they share one target pool, one command stream and one scene store. */
  private tail: Promise<unknown> = Promise.resolve();
  /** Distinguishes the asset keys of successive procedural bodies. */
  private bodyCount = 0;
  /** Distinguishes the asset keys of successive settled garments. */
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

  /** Releases the preview graph; the backend belongs to the caller that built it. */
  dispose(): void {
    this.graph.dispose();
  }

  /** Loads one asset and frames its portrait with the given camera. */
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
    // Decoded images land on the next microtask; HDR and EXR arrive later and only show in the version.
    await whenImagesReady();
    await waitForChange(() => textures.version, before);
    try {
      return await this.frame(environmentScene(key), environmentCamera());
    } finally {
      textures.release(key);
    }
  }

  /** Draws one snapshot through the graph and turns the readback into a PNG data url. */
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

  /** Runs one request at a time, so a second thumbnail cannot draw into the first one's frame. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

/** Snapshot holding one asset entity under the portrait lights. */
function assetScene(key: string): SceneSnapshot {
  const item: SceneItem = {
    key: 1,
    mesh: { kind: 'asset', key },
    transform: IDENTITY,
    rasterStage: 'scene',
    bucket: 'opaque',
    // One variant marks the asset slot as drawn; the asset object keeps its own materials.
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

/** Snapshot showing the panorama behind the asset rows. */
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

/** Key and fill, so the body reads as a solid silhouette on the dark backdrop. */
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

/** Camera facing the body from the front, framing it from the feet to just above the head. */
function portraitCamera(bounds: Bounds): CameraState {
  const height = Math.max(bounds.max.y - bounds.min.y, 1e-3);
  const distance = height / BODY_FILL / (2 * Math.tan(degToRad(MODEL_FOV) / 2));
  return lookingCamera(bounds, distance, 0, height);
}

/** Camera turned off the garment's front, so the icon shows the drape and not just an outline. */
function garmentCamera(bounds: Bounds): CameraState {
  const width = Math.max(bounds.max.x - bounds.min.x, 1e-3);
  const height = Math.max(bounds.max.y - bounds.min.y, 1e-3);
  const depth = Math.max(bounds.max.z - bounds.min.z, 1e-3);
  // Fit the bounding sphere, so no turn of the piece can push a sleeve out of the square frame.
  const radius = Math.hypot(width, height, depth) / 2;
  const distance = radius / Math.sin(degToRad(MODEL_FOV) / 2) / GARMENT_FILL;
  return lookingCamera(bounds, distance, GARMENT_YAW_DEG, radius * 2);
}

/** Camera centred on `bounds`, `distance` away and turned by `yawDeg` around the vertical axis. */
function lookingCamera(
  bounds: Bounds,
  distance: number,
  yawDeg: number,
  viewHeightMeters: number,
): CameraState {
  const center = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const yaw = degToRad(yawDeg);
  return {
    projection: 'perspective',
    position: {
      x: center.x + Math.sin(yaw) * distance,
      y: center.y,
      z: center.z + Math.cos(yaw) * distance,
    },
    target: center,
    up: { x: 0, y: 1, z: 0 },
    fovDeg: MODEL_FOV,
    viewHeightMeters,
    aspect: 1,
    near: 0.05,
    far: 20,
  };
}

/** Camera at eye height, level with the horizon. */
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
