import * as THREE from 'three/webgpu';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { bundledAssetUrl } from '@/common/platform/assetUrls';
import type { SceneMgr } from '@/render/scene/manager';

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
  sceneMgr: SceneMgr, url: string, filename = url,
): Promise<boolean> {
  if (sceneMgr.environmentUrl === url) return true;
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  try {
    const texture = await loadEnvironment(url, extension);
    sceneMgr.setEnvironment(texture, url);
    return true;
  } catch (err) {
    console.warn('Environment image failed to load, keeping the flat background:', err);
    return false;
  }
}

/** Frees the texture cached for an environment image that is no longer selected. */
export function releaseSceneEnvironment(sceneMgr: SceneMgr, url: string): void {
  envLoads.delete(url);
  const texture = envTextures.get(url);
  envTextures.delete(url);
  if (!texture) return;
  if (sceneMgr.environmentUrl === url) {
    sceneMgr.setEnvironment(null);
    sceneMgr.setBackground(FALLBACK_BACKGROUND);
  }
  texture.dispose();
}
