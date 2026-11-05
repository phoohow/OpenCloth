import * as THREE from 'three/webgpu';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { bundledAssetUrl } from '@/common/platform/assetUrls';

/** Bundled equirectangular environment used when the project selects none. */
export const DEFAULT_ENV_URL = '/env/royal_esplanade_1k.hdr';

/** Scene background while no environment image is loaded. */
export const FALLBACK_BACKGROUND = new THREE.Color(0x2a2a2e);

/** One texture per environment url, kept across scene switches. */
const envTextures = new Map<string, THREE.Texture>();
/** In-flight loads keyed by url, so concurrent requests share one download. */
const envLoads = new Map<string, Promise<THREE.Texture>>();

/** Loads an equirectangular environment image, reusing one texture per url. */
function loadEnvironment(url: string, extension: string): Promise<THREE.Texture> {
  let pending = envLoads.get(url);
  if (!pending) {
    const loader = extension === 'hdr'
      ? new RGBELoader()
      : extension === 'exr'
        ? new EXRLoader()
        : new THREE.TextureLoader();
    pending = loader.loadAsync(bundledAssetUrl(url)).then(texture => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      if (extension !== 'hdr' && extension !== 'exr') texture.colorSpace = THREE.SRGBColorSpace;
      envTextures.set(url, texture);
      return texture;
    }).catch(err => {
      envLoads.delete(url);
      throw err;
    });
    envLoads.set(url, pending);
  }
  return pending;
}

/** Uses an environment image as the scene backdrop and image-based lighting source. */
export async function applySceneEnvironment(
  scene: THREE.Scene, url: string, filename = url,
): Promise<boolean> {
  if (scene.userData.envUrl === url) return true;
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  try {
    const texture = await loadEnvironment(url, extension);
    scene.background = texture;
    scene.environment = texture;
    scene.userData.envUrl = url;
    return true;
  } catch (err) {
    console.warn('Environment image failed to load, keeping the flat background:', err);
    return false;
  }
}

/** Frees the texture cached for an environment image that is no longer selected. */
export function releaseSceneEnvironment(scene: THREE.Scene, url: string): void {
  envLoads.delete(url);
  const texture = envTextures.get(url);
  envTextures.delete(url);
  if (!texture) return;
  if (scene.userData.envUrl === url) {
    scene.userData.envUrl = '';
    scene.background = FALLBACK_BACKGROUND;
    scene.environment = null;
  }
  texture.dispose();
}
