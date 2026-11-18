import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData } from './types';
import { gridSample } from './terrain';
import { DAM_FRONT_GUARD, getDamPlacement, makeDamColliderDescriptors } from './the-dam';
import { publicAssetUrl } from './public-assets';
import { buildDamLandscape } from './visual-dam-landscape';

export interface DamVisuals {
  group: THREE.Group;
  update(seconds: number): void;
  /** Async model arrival changes the static shadow casters. */
  consumeShadowChange(): boolean;
  dispose(): void;
}

interface DamMeshes {
  group: THREE.Group;
  waterfallMaps: THREE.Texture[];
}

function namedPart(object: THREE.Object3D, prefix: RegExp): boolean {
  for (let part: THREE.Object3D | null = object; part; part = part.parent) {
    if (prefix.test(part.name)) return true;
  }
  return false;
}

/** The authored rocks are only needed where the island has no existing cliff. */
function needsAbutmentRock(mesh: THREE.Mesh, island: IslandData): boolean {
  const { position, scale } = getDamPlacement(island);
  const bounds = new THREE.Box3().setFromObject(mesh);
  const centre = bounds.getCenter(new THREE.Vector3());
  const x = position.x + centre.x * scale, z = position.z + centre.z * scale;
  const radius = 3.5 * scale;
  const heights = [
    gridSample(island, x, z),
    gridSample(island, x - radius, z), gridSample(island, x + radius, z),
    gridSample(island, x, z - radius), gridSample(island, x, z + radius),
  ];
  const steep = Math.max(...heights) - Math.min(...heights) > 3.2 * scale;
  const buried = heights[0]! > position.y + bounds.max.y * scale - 0.5 * scale;
  return !steep && !buried;
}

/** Rebuild the authored front rail with the same opening as the physics guards. */
function buildDamFrontRail(material: THREE.Material): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const [left, right] of DAM_FRONT_GUARD.spans) {
    for (const y of [19.45, 20.10]) {
      parts.push(new THREE.BoxGeometry(right - left, .22, .22)
        .translate((left + right) / 2, y, DAM_FRONT_GUARD.z));
    }
  }
  for (let i = 0; i < 23; i++) {
    const x = -29.7 + i * 2.6;
    if (!DAM_FRONT_GUARD.spans.some(([left, right]) => x >= left && x <= right)) continue;
    parts.push(new THREE.BoxGeometry(.30, 1.35, DAM_FRONT_GUARD.depth)
      .translate(x, 19.48, DAM_FRONT_GUARD.z));
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Could not batch the Dam front rail');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'dam-front-rail';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Reduce the GLB's many static parts to a draw per material and vertex layout.
 * Keep water sheets in their own material buckets so their texture transform
 * never moves the reservoir, lips, or foam.
 *
 * Exported for headless tests: this stage needs no fetch, DOM, or WebGL context.
 */
export function prepareDamModel(root: THREE.Object3D, island: IslandData): DamMeshes {
  root.updateMatrixWorld(true);
  const group = new THREE.Group();
  group.name = 'the-dam-model';
  type Bucket = { material: THREE.Material; geometries: THREE.BufferGeometry[];
    shadow: boolean; waterfall: boolean; names: string[] };
  const buckets = new Map<string, Bucket>();
  const clonedFalls = new Map<THREE.Material, THREE.Material>();
  const waterfallMaps: THREE.Texture[] = [];
  const oldGeometries = new Set<THREE.BufferGeometry>();
  let frontRailMaterial: THREE.Material | undefined;

  function waterfallMaterial(original: THREE.Material): THREE.Material {
    const existing = clonedFalls.get(original);
    if (existing) return existing;
    const material = original.clone();
    // GLTF's falling-water streaks have a texture. Isolate it before scrolling
    // so any shared reservoir/foam texture stays stationary.
    const textured = material as THREE.MeshStandardMaterial;
    if (textured.map) {
      textured.map = textured.map.clone();
      textured.map.wrapT = THREE.RepeatWrapping;
      textured.map.needsUpdate = true;
      waterfallMaps.push(textured.map);
    }
    clonedFalls.set(original, material);
    return material;
  }

  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (namedPart(object, /^RailFront_(?:Bar|Post)_/i)) {
      oldGeometries.add(object.geometry);
      if (!Array.isArray(object.material)) frontRailMaterial ??= object.material;
      return;
    }
    const isFall = namedPart(object, /^Water_Fall_/i);
    const isRock = namedPart(object, /^Abutment_Rock_/i);
    const shadow = namedPart(object, /^(?:Wall_|Dam_Wall|ControlHouse_)/i);
    if (isRock && !needsAbutmentRock(object, island)) return;
    oldGeometries.add(object.geometry);
    const transformed = object.geometry.clone();
    transformed.applyMatrix4(object.matrixWorld);
    const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
    if (geometry !== transformed) transformed.dispose();

    // The authored model uses one material per part, but retain a safe path
    // for a future multi-material part without discarding its geometry groups.
    if (Array.isArray(object.material)) {
      const materials = object.material.map(material =>
        isFall ? waterfallMaterial(material) : material);
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.name = object.name;
      mesh.castShadow = shadow;
      mesh.receiveShadow = !isFall;
      group.add(mesh);
      return;
    }
    const material = isFall ? waterfallMaterial(object.material) : object.material;
    const signature = Object.keys(geometry.attributes).sort()
      .map(name => {
        const attr = geometry.getAttribute(name);
        return name + ':' + attr.itemSize + ':' + attr.normalized;
      }).join(',');
    const key = material.uuid + ':' + (shadow ? 'S' : 's') + ':' + signature;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, geometries: [], shadow, waterfall: isFall, names: [] };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(geometry);
    bucket.names.push(object.name);
  });

  for (const [i, bucket] of [...buckets.values()].entries()) {
    const merged = bucket.geometries.length > 1
      ? mergeGeometries(bucket.geometries, false) : bucket.geometries[0]!;
    // On an unusual attribute mismatch, render separate meshes instead of
    // silently omitting an asset component.
    const parts = merged ? [merged] : bucket.geometries;
    if (merged && bucket.geometries.length > 1) {
      bucket.geometries.forEach(geometry => geometry.dispose());
    }
    for (const [part, geometry] of parts.entries()) {
      const mesh = new THREE.Mesh(geometry, bucket.material);
      mesh.name = bucket.waterfall ? 'Water_Fall_merged-' + i + '-' + part :
        bucket.shadow ? 'Dam_architecture_merged-' + i + '-' + part :
          'Dam_details_merged-' + i + '-' + part;
      mesh.castShadow = bucket.shadow;
      mesh.receiveShadow = !bucket.waterfall;
      group.add(mesh);
    }
  }
  // No longer needed after baking every source node's world transform.
  oldGeometries.forEach(geometry => geometry.dispose());
  if (frontRailMaterial) group.add(buildDamFrontRail(frontRailMaterial));
  return { group, waterfallMaps };
}

export function scrollDamWaterfallUVs(maps: readonly THREE.Texture[], seconds: number): void {
  const offset = -((Math.max(0, seconds) * 0.42) % 1);
  for (const texture of maps) texture.offset.y = offset;
}

/** A collider-aligned stand-in until the GLB loads (or if it fails). */
function buildProceduralDamFallback(island: IslandData): THREE.Group {
  const fallback = new THREE.Group();
  fallback.name = 'the-dam-procedural-fallback';
  const { position, scale } = getDamPlacement(island);
  const stone = new THREE.MeshToonMaterial({ color: 0xb9c3c7 });
  const deck = new THREE.MeshToonMaterial({ color: 0xd6d6c9 });
  const house = new THREE.MeshToonMaterial({ color: 0xf3eee0 });
  const stoneParts: THREE.BufferGeometry[] = [];
  const deckParts: THREE.BufferGeometry[] = [];
  const houseParts: THREE.BufferGeometry[] = [];

  for (const collider of makeDamColliderDescriptors(island)) {
    if (collider.id.startsWith(DAM_FRONT_GUARD.prefix)) continue;
    const geometry = new THREE.BoxGeometry(
      collider.size.x / scale, collider.size.y / scale, collider.size.z / scale,
    );
    geometry.translate(
      (collider.transform.position.x - position.x) / scale,
      (collider.transform.position.y - position.y) / scale,
      (collider.transform.position.z - position.z) / scale,
    );
    const parts = collider.id === 'the-dam-control-house' ? houseParts :
      collider.id === 'the-dam-deck' ? deckParts : stoneParts;
    parts.push(geometry);
  }

  function addBatch(name: string, material: THREE.Material,
    parts: THREE.BufferGeometry[], castShadow: boolean): void {
    const geometry = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    if (!geometry) throw new Error('Could not batch Dam fallback: ' + name);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    fallback.add(mesh);
  }
  // One draw call per solid material, not a shadow caster for every ladder rung.
  addBatch('dam-fallback-stone', stone, stoneParts, true);
  addBatch('dam-fallback-deck', deck, deckParts, false);
  addBatch('dam-fallback-house', house, houseParts, false);
  fallback.add(buildDamFrontRail(new THREE.MeshToonMaterial({ color: 0xf2c12e })));

  const water = new THREE.MeshToonMaterial({
    color: 0x40c9e6, transparent: true, opacity: 0.88,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const falls = [-7, 3, 13, 23].map(x => {
    const geometry = new THREE.PlaneGeometry(7, 16);
    geometry.rotateX(-0.16);
    geometry.translate(x, 9.5, 4.2);
    return geometry;
  });
  addBatch('dam-fallback-spillways', water, falls, false);
  return fallback;
}

function disposeMeshes(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    geometries.add(part.geometry);
    const mats = Array.isArray(part.material) ? part.material : [part.material];
    for (const mat of mats) materials.add(mat);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

/** Load only at runtime; headless island creation and Rapier require no GLB. */
export function buildDamVisuals(island: IslandData): DamVisuals {
  const group = new THREE.Group();
  group.name = 'the-dam-hero';
  const placement = getDamPlacement(island);
  group.position.set(placement.position.x, placement.position.y, placement.position.z);
  group.scale.setScalar(placement.scale);
  const fallback = buildProceduralDamFallback(island);
  group.add(fallback);
  let waterfallMaps: THREE.Texture[] = [];
  let shadowChange = false;
  let disposed = false;
  // Scenery uses non-shadow-casting instances, so its asynchronous arrival
  // must NOT hide the procedural reservoir before the hero GLB is ready.
  const landscape = buildDamLandscape(island, () => {});
  group.add(landscape.group);

  if (typeof document !== 'undefined') {
    const url = publicAssetUrl('assets/library/custom/the-dam/the-dam.glb');
    const fail = (error: unknown): void => {
      if (!disposed) {
        console.error('Failed to load The Dam hero model from ' + url +
          '; keeping procedural fallback visible:', error);
      }
    };
    try {
      new GLTFLoader().load(url, gltf => {
        if (disposed) {
          disposeMeshes(gltf.scene);
          return;
        }
        try {
          const prepared = prepareDamModel(gltf.scene, island);
          if (prepared.group.children.length === 0) {
            throw new Error('Dam GLB contains no renderable meshes');
          }
          waterfallMaps = prepared.waterfallMaps;
          group.add(prepared.group);
          group.remove(fallback);
          disposeMeshes(fallback);
          shadowChange = true;
        } catch (error) {
          fail(error);
        }
      }, undefined, fail);
    } catch (error) {
      fail(error);
    }
  }

  return {
    group,
    update(seconds: number): void {
      scrollDamWaterfallUVs(waterfallMaps, seconds);
      landscape.update(seconds);
    },
    consumeShadowChange(): boolean {
      const changed = shadowChange;
      shadowChange = false;
      return changed;
    },
    dispose(): void {
      disposed = true;
      landscape.dispose();
      disposeMeshes(group);
      group.clear();
      group.removeFromParent();
    },
  };
}
