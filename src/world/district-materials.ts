import * as THREE from 'three';
import { blendPeriod, blendSize, groundBlendField } from './ground-blend';
import { publicAssetUrl } from './public-assets';
import type { PoiId } from './types';

type FinishMaterial = THREE.MeshLambertMaterial | THREE.MeshToonMaterial | THREE.MeshBasicMaterial;
export type ApplyGroundMap = (material: FinishMaterial, zone: PoiId, texturedTint?: number) => void;
export type GroundLayers = [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture];

interface Layers {
  maps?: GroundLayers;
  mix: { value: number };
}

export const groundLayers = new WeakMap<THREE.Texture, Layers>();
const suffixes = ['-a', '-b', '-c', '-edge'] as const;

function prepare(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.userData.groundFinish = true;
  return texture;
}

function createDistrict(base: THREE.Texture) {
  return {
    base, layers: { mix: { value: 0 } } as Layers,
    samplers: suffixes.map(() => ({ value: base })),
    pending: [] as ((texture: THREE.Texture) => void)[],
    wanted: false, loading: false, retryAfter: 0, loadedAt: 0, distance: Infinity
  };
}
type District = ReturnType<typeof createDistrict>;

function addShader(material: FinishMaterial, district: District, field: THREE.DataTexture) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => previousKey + '-district-ground-v1';
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, {
      groundA: district.samplers[0], groundB: district.samplers[1],
      groundC: district.samplers[2], groundEdge: district.samplers[3],
      groundField: { value: field }, groundMix: district.layers.mix
    });
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>',
      `#include <map_pars_fragment>
      uniform sampler2D groundA, groundB, groundC, groundEdge, groundField;
      uniform float groundMix;`)
      .replace('#include <map_fragment>', `
      vec4 baseFinish = texture2D(map, vMapUv);
      if (groundMix > 0.0) {
        vec3 field = texture2D(groundField, vMapUv / ${blendPeriod.toFixed(1)}).rgb;
        vec3 first = mix(baseFinish.rgb, texture2D(groundA, vMapUv).rgb, field.r);
        vec3 second = mix(texture2D(groundB, vMapUv).rgb, texture2D(groundC, vMapUv).rgb, field.r);
        vec3 interior = mix(first, second, field.g);
        #ifdef USE_COLOR_ALPHA
          float interiorWeight = smoothstep(0.22, 0.73, vColor.a + (field.b - 0.5) * 0.22);
          vec3 edge = texture2D(groundEdge, vMapUv).rgb;
          interior = mix(edge, interior, interiorWeight);
          // Keep individual stones visible a little further into the grass.
          vec3 pigment = sqrt(edge);
          float stone = clamp((0.35 - pigment.g / max(dot(pigment, vec3(1.0)), 0.001)) * 10.0, -0.55, 0.55);
          baseFinish.a *= 1.0 + groundMix * (1.0 - vColor.a) * (1.0 - interiorWeight) * stone * 1.35;
        #endif
        baseFinish.rgb = mix(baseFinish.rgb, interior, groundMix);
      }
      diffuseColor *= baseFinish;`);
  };
}

export function districtMaterials() {
  const zones = new Map<PoiId, District>();
  const loader = new THREE.TextureLoader();
  const field = new THREE.DataTexture(groundBlendField, blendSize, blendSize);
  field.wrapS = field.wrapT = THREE.RepeatWrapping;
  field.minFilter = field.magFilter = THREE.LinearFilter;
  field.needsUpdate = true;
  let disposed = false, active = 0;

  const applyMap: ApplyGroundMap = (material, zone, texturedTint) => {
    if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') return;
    let entry = zones.get(zone);
    if (!entry) {
      const base = prepare(loader.load(publicAssetUrl('assets/terrain/' + zone + '.webp'), loaded => {
        if (disposed) return;
        for (const bind of entry!.pending.splice(0)) bind(loaded);
      }));
      entry = createDistrict(base);
      zones.set(zone, entry);
      groundLayers.set(base, entry.layers);
    }
    const bind = (texture: THREE.Texture) => {
      material.map = texture;
      if (texturedTint !== undefined) material.color.setHex(texturedTint);
      addShader(material, entry, field);
      material.needsUpdate = true;
    };
    if (entry.base.image) bind(entry.base);
    else entry.pending.push(bind);
  };

  function release(entry: District) {
    for (const map of entry.layers.maps ?? []) map.dispose();
    entry.layers.maps = undefined;
    entry.layers.mix.value = 0;
    for (const sampler of entry.samplers) sampler.value = entry.base;
  }

  // Only two districts stream at once, with one image in flight per district.
  // Fast travel can abandon a partially decoded set without exposing it on screen.
  async function load(zone: PoiId, entry: District) {
    active++; entry.loading = true;
    const maps: THREE.Texture[] = [];
    try {
      for (const suffix of suffixes) {
        const url = publicAssetUrl('assets/terrain/' + zone + suffix + '.webp');
        maps.push(prepare(await loader.loadAsync(url)));
        if (disposed || !entry.wanted) return;
      }
      entry.layers.maps = maps as GroundLayers;
      entry.samplers.forEach((s, i) => { s.value = maps[i]!; });
      entry.loadedAt = performance.now();
    } catch {
      entry.retryAfter = performance.now() + 30_000;
    } finally {
      if (entry.layers.maps !== maps) for (const texture of maps) texture.dispose();
      active--; entry.loading = false;
      pump();
    }
  }

  function pump() {
    if (disposed || active >= 2) return;
    const now = performance.now();
    const candidates = [...zones].filter(([, e]) => e.wanted && !e.loading && !e.layers.maps && e.retryAfter <= now);
    candidates.sort((a, b) => a[1].distance - b[1].distance);
    for (const [zone, entry] of candidates.slice(0, 2 - active)) void load(zone, entry);
  }

  return {
    applyMap,
    distance(zone: PoiId, distance: number) {
      const entry = zones.get(zone);
      if (!entry) return;
      entry.distance = distance;
      entry.wanted = distance < (entry.wanted ? 134 : 90);
      if (entry.layers.maps) {
        if (entry.wanted) entry.layers.mix.value = THREE.MathUtils.smoothstep(performance.now() - entry.loadedAt, 0, 520)
          * (1 - THREE.MathUtils.smoothstep(distance, 101, 132));
        else release(entry);
      }
    },
    update() {
      if (active < 2) {
        for (const e of zones.values()) {
          if (e.wanted && !e.layers.maps && !e.loading && e.retryAfter <= performance.now()) { pump(); break; }
        }
      }
    },
    dispose() {
      disposed = true;
      for (const e of zones.values()) { release(e); e.base.dispose(); e.pending.length = 0; }
      field.dispose();
      zones.clear();
    }
  };
}
