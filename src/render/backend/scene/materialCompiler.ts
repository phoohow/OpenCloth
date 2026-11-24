import type { TextureCache } from '@/render/backend/textures';
import type { SurfaceMode, MaterialData, ResolvedMaterial } from '@/render/common';

import { getDiagnosticMaterial } from '@/render/backend/scene/diagnostics';
import { attribute, float, mix, step, uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';

interface CompiledEntry {
  readonly material: THREE.Material;
  readonly usesTexture: boolean;
  readonly revision?: number;
}

export class MaterialCompiler {
  private readonly entries = new Map<string, CompiledEntry>();
  private fallback: THREE.Material | null = null;
  private textureVersion = -1;

  get(variant: ResolvedMaterial, textures: TextureCache): THREE.Material {
    if (textures.version !== this.textureVersion) {
      this.textureVersion = textures.version;
      for (const [key, entry] of this.entries) {
        if (!entry.usesTexture) continue;
        entry.material.dispose();
        this.entries.delete(key);
      }
    }

    const key = cacheKey(variant);
    const known = this.entries.get(key);
    if (known && known.revision === variant.revision) return known.material;
    known?.material.dispose();
    const material = buildMaterial(variant, textures);
    this.entries.set(key, { material, usesTexture: referencesTextures(variant), revision: variant.revision });
    return material;
  }

  defaultMaterial(): THREE.Material {
    if (this.fallback) return this.fallback;
    this.fallback = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.8, metalness: 0, toneMapped: false,
    });
    return this.fallback;
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.material.dispose();
    this.entries.clear();
    this.fallback?.dispose();
    this.fallback = null;
  }
}

function cacheKey(variant: ResolvedMaterial): string {
  const identity = variant.revision !== undefined
    ? JSON.stringify(variant.source)
    : JSON.stringify(variant.data);
  return `${variant.technique}|${variant.diagnostic ?? ''}|${identity}`;
}

function referencesTextures(variant: ResolvedMaterial): boolean {
  if (variant.technique !== 'surface' && variant.technique !== 'unlit') return false;
  const maps = variant.data?.maps;
  return Boolean(maps && Object.values(maps).some(Boolean));
}

function buildMaterial(variant: ResolvedMaterial, textures: TextureCache): THREE.Material {
  if (variant.technique === 'asset') return new THREE.MeshBasicMaterial({ toneMapped: false });
  if (variant.technique === 'diagnostic') {
    return getDiagnosticMaterial((variant.diagnostic ?? 'uv') as SurfaceMode)
      ?? new THREE.MeshBasicMaterial({ toneMapped: false });
  }

  const desc = variant.data ?? { kind: 'surface' };
  const transparent = desc.blending === 'alpha' || desc.blending === 'additive';
  const common = {
    color: new THREE.Color(desc.color ?? '#ffffff'),
    transparent,
    opacity: desc.opacity ?? 1,
    side: sideOf(desc),
    depthTest: desc.depth !== 'always',
    depthWrite: desc.depthWrite ?? (desc.depth !== 'always' && !transparent),
    toneMapped: false,
    vertexColors: desc.vertexColors === true,
  } as const;
  const polygonOffset = desc.polygonOffset
    ? {
      polygonOffset: true,
      polygonOffsetFactor: desc.polygonOffset.factor,
      polygonOffsetUnits: desc.polygonOffset.units,
    }
    : {};
  switch (variant.technique) {
    case 'surface': {
      const material = new THREE.MeshPhysicalMaterial({
        ...common,
        roughness: desc.roughness ?? 0.8,
        metalness: desc.metalness ?? 0,
        ...physicalExtras(desc),
        ...polygonOffset,
      });
      bindMaps(material, desc, textures);
      return material;
    }
    case 'unlit': {
      const material = new THREE.MeshBasicMaterial({ ...common, ...polygonOffset });
      bindMaps(material, desc, textures);
      return material;
    }
    case 'line': {
      return new THREE.LineBasicMaterial({
        color: common.color,
        transparent,
        opacity: common.opacity,
        depthTest: common.depthTest,
        depthWrite: common.depthWrite,
        blending: desc.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexColors: desc.vertexColors === true,
        toneMapped: false,
      });
    }
    case 'heatmap': {
      return heatmapMaterial(desc);
    }
    case 'wire': {
      return new THREE.MeshBasicMaterial({
        ...common,
        side: THREE.DoubleSide,
        wireframe: true,
        ...polygonOffset,
      });
    }
  }
}

function heatmapMaterial(desc: MaterialData): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const palette = desc.heatmap?.palette ?? ['#2f6d92', '#ffd166', '#e05a5a'];
  const low = uniform(new THREE.Color(palette[0] ?? '#2f6d92'));
  const high = uniform(new THREE.Color(palette[palette.length - 1] ?? '#e05a5a'));
  const mid = uniform(new THREE.Color(palette[1] ?? palette[palette.length - 1] ?? '#ffd166'));
  const t = float(attribute<'float'>('field', 'float')).clamp(0, 1);
  const first = mix(low, mid, t.mul(2).clamp(0, 1));
  const second = mix(mid, high, t.sub(0.5).mul(2).clamp(0, 1));
  material.colorNode = mix(first, second, step(0.5, t));
  return material;
}

function physicalExtras(desc: MaterialData): Partial<THREE.MeshPhysicalMaterialParameters> {
  const extras: Partial<THREE.MeshPhysicalMaterialParameters> = {};
  if (desc.sheen !== undefined) extras.sheen = desc.sheen;
  if (desc.sheenColor !== undefined) extras.sheenColor = new THREE.Color(desc.sheenColor);
  if (desc.sheenRoughness !== undefined) extras.sheenRoughness = desc.sheenRoughness;
  if (desc.transmission !== undefined) extras.transmission = desc.transmission;
  if (desc.thickness !== undefined) extras.thickness = desc.thickness;
  if (desc.clearcoat !== undefined) extras.clearcoat = desc.clearcoat;
  if (desc.clearcoatRoughness !== undefined) extras.clearcoatRoughness = desc.clearcoatRoughness;
  if (desc.anisotropy !== undefined) extras.anisotropy = desc.anisotropy;
  if (desc.iridescence !== undefined) extras.iridescence = desc.iridescence;
  if (desc.normalScale !== undefined) {
    extras.normalScale = new THREE.Vector2(desc.normalScale, desc.normalScale);
  }

  return extras;
}

function bindMaps(
  material: THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial,
  desc: MaterialData,
  textures: TextureCache,
): void {
  const albedo = desc.maps?.albedo ? textures.get(desc.maps.albedo) : null;
  if (albedo) material.map = albedo;
  if (material instanceof THREE.MeshPhysicalMaterial) {
    const normal = desc.maps?.normal ? textures.get(desc.maps.normal) : null;
    const roughness = desc.maps?.roughness ? textures.get(desc.maps.roughness) : null;
    const metallic = desc.maps?.metallic ? textures.get(desc.maps.metallic) : null;
    if (normal) material.normalMap = normal;
    if (roughness) material.roughnessMap = roughness;
    if (metallic) material.metalnessMap = metallic;
  }

  material.needsUpdate = true;
}

function sideOf(desc: MaterialData): THREE.Side {
  switch (desc.side) {
    case 'front': return THREE.FrontSide;
    case 'back': return THREE.BackSide;
    default: return THREE.DoubleSide;
  }
}
