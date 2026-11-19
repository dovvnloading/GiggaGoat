import * as THREE from 'three';
import { kitShape } from './kit-preview';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData } from './types';
import { gridSample } from './terrain';
import { DAM_ACCESS_SUPPORT_ID, DAM_BACK_GUARD, DAM_FRONT_GUARD,
  damAccess, damAccessGuards, getDamPlacement, makeDamColliderDescriptors } from './the-dam';
import { accessArrows, accessPathVisual, mergePaintedParts } from './visual-access-path';
import { publicAssetUrl } from './public-assets';
import { buildDamLandscape, DAM_SPILLWAY_IMPACTS } from './visual-dam-landscape';
import { damChannelAt } from './dam-landscape';
import { buildDamBypassPaint } from './visual-dam-bypass';

export interface DamVisuals {
  updateCulling(position: THREE.Vector3): void;
  group: THREE.Group;
  update(seconds: number): void;
  setWaterLevel(tide: number): void;
  refreshWaterLight(): void;
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

/** The splash route passes beside the water sheets at arm's length. */
function softenNearSpillway(material: THREE.Material): void {
  material.transparent = true;
  material.depthWrite = false;
  material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', [
      // Perspective clip W is view-space depth in world metres.
      'diffuseColor.a *= smoothstep(0.65, 2.60, 1.0 / gl_FragCoord.w);',
      '#include <opaque_fragment>',
    ].join('\n'));
  };
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

/** Cut the same openings in the authored paint and the physical guard spans. */
function damRailGeometry(side: 'front' | 'back'): THREE.BufferGeometry {
  const guard = side === 'front' ? DAM_FRONT_GUARD : DAM_BACK_GUARD;
  const parts: THREE.BufferGeometry[] = [];
  for (const [left, right] of guard.spans) {
    for (const y of [19.45, 20.10]) {
      parts.push(new THREE.BoxGeometry(right - left, .22, .22)
        .translate((left + right) / 2, y, guard.z));
    }
  }
  for (let i = 0; i < 23; i++) {
    const x = -29.7 + i * 2.6;
    if (!guard.spans.some(([left, right]) => x >= left && x <= right)) continue;
    parts.push(new THREE.BoxGeometry(.30, 1.35, guard.depth)
      .translate(x, 19.48, guard.z));
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Could not batch the Dam ' + side + ' rail');
  return geometry;
}

function buildDamFrontRail(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(damRailGeometry('front'), material);
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
    shadow: boolean; waterfall: boolean; water: boolean; names: string[] };
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
    softenNearSpillway(material);
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
    if (namedPart(object, /^Water_Reservoir$/i)) {
      oldGeometries.add(object.geometry);
      return;
    }
    const front = namedPart(object, /^RailFront_(?:Bar|Post)_/i);
    const back = namedPart(object, /^RailBack_(?:Bar|Post)_/i);
    if (front || back) {
      oldGeometries.add(object.geometry);
      if (front && !Array.isArray(object.material)) frontRailMaterial ??= object.material;
      return;
    }
    const isFall = namedPart(object, /^Water_Fall_/i);
    const isWater = isFall || namedPart(object, /^Water_Foam_/i);
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
      mesh.userData['damWater'] = isWater;
      group.add(mesh);
      return;
    }
    const material = isFall ? waterfallMaterial(object.material) : object.material;
    const signature = Object.keys(geometry.attributes).sort()
      .map(name => {
        const attr = geometry.getAttribute(name);
        return name + ':' + attr.itemSize + ':' + attr.normalized;
      }).join(',');
    const key = material.uuid + ':' + Number(shadow) + ':' + Number(isWater) + ':' + signature;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, geometries: [], shadow, waterfall: isFall, water: isWater, names: [] };
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
      mesh.userData['damWater'] = bucket.water;
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
function buildDamKitPreview(): THREE.Group {
  const fallback = new THREE.Group();
  fallback.name = 'the-dam-kit-preview';
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
  // Keep the masonry shadow pass separate from the roof and deck.
  addBatch('dam-fallback-stone', new THREE.MeshToonMaterial({ vertexColors: true }),
    [kitShape('damMasonry', true)], true);
  addBatch('dam-fallback-house-and-deck', new THREE.MeshToonMaterial({ vertexColors: true }),
    [kitShape('damWorks', true)], false);
  fallback.add(buildDamFrontRail(new THREE.MeshToonMaterial({ color: 0xf2c12e })));

  const water = new THREE.MeshToonMaterial({
    color: 0x40c9e6, transparent: true, opacity: 0.88,
    side: THREE.DoubleSide, depthWrite: false,
  });
  softenNearSpillway(water);
  const { x: outlets, z: impactZ, halfWidth } = DAM_SPILLWAY_IMPACTS;
  const impactY = damChannelAt(impactZ).level + 0.20;
  const lipY = 12.68, lipZ = 3.7;
  const drop = lipY - impactY, run = impactZ - lipZ;
  const falls = outlets.map(x => {
    const geometry = new THREE.PlaneGeometry(2 * halfWidth, Math.hypot(drop, run) + 0.55);
    geometry.rotateX(-Math.atan2(run, drop));
    geometry.translate(x, (lipY + impactY) / 2, (lipZ + impactZ) / 2);
    return geometry;
  });
  addBatch('dam-fallback-spillways', water, falls, false);
  fallback.getObjectByName('dam-fallback-spillways')!.userData['damWater'] = true;
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
export function buildDamVisuals(island: IslandData,
  light = new THREE.Vector3(1, 1, 1)): DamVisuals {
  const group = new THREE.Group();
  group.name = 'the-dam-hero';
  const placement = getDamPlacement(island);
  group.position.set(placement.position.x, placement.position.y, placement.position.z);
  group.scale.setScalar(placement.scale);
  const fallback = buildDamKitPreview();
  const paths = damAccess(island);
  const supports = makeDamColliderDescriptors(island)
    .filter(collider => collider.id.startsWith(DAM_ACCESS_SUPPORT_ID))
    .map(({ size, transform }) => ({
      geometry: new THREE.BoxGeometry(size.x, size.y, size.z)
        .translate(transform.position.x, transform.position.y, transform.position.z),
      color: 0x9e7d52,
    }));
  const { position, scale } = placement;
  const backRail = damRailGeometry('back').scale(scale, scale, scale)
    .translate(position.x, position.y, position.z);
  const [ramp, transfer] = paths;
  const turn = transfer[0]!;
  const turnZ = ramp[2]!.outer.z + .24 * scale;
  const landingGuide = [{ outer: { ...turn.outer, z: turnZ },
    inner: { ...turn.inner, z: turnZ } }, ...transfer];
  const paint = 0x72512e;
  const bypassPaint = buildDamBypassPaint(island, ramp[0]!.outer, scale);
  // The same static batch stays visible when the authored model replaces the fallback.
  const approach = accessPathVisual('dam-board-access-ramp', paths, damAccessGuards(paths, scale),
    .38 * scale, scale, 0xdeb665, 0xd69d28, [
      ...supports, { geometry: backRail, color: 0xf2c12e },
      accessArrows(ramp.slice(0, 2), scale, paint),
      accessArrows(landingGuide, scale, paint),
      ...(bypassPaint ? [bypassPaint] : []),
    ]);
  approach.position.copy(group.position).multiplyScalar(-1 / placement.scale);
  approach.scale.setScalar(1 / placement.scale);
  group.add(fallback, approach);
  let waterfallMaps: THREE.Texture[] = [];
  let shadowChange = false;
  let disposed = false;
  let tide = island.seaLevel;
  const landscape = buildDamLandscape(island, () => {}, light);
  group.add(landscape.group);

  let detailed: THREE.Group | undefined;
  let distant = false;
  const waterMeshes: Array<{ mesh: THREE.Mesh; highest: number }> = [];
  const emissive = new Map<THREE.MeshStandardMaterial, number>();
  function trackWater(model: THREE.Group): void {
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.userData['damWater'] !== true) return;
      object.geometry.computeBoundingBox();
      waterMeshes.push({ mesh: object,
        highest: placement.position.y + object.geometry.boundingBox!.max.y * placement.scale });
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial && material.emissive.getHex() !== 0) {
          emissive.set(material, material.emissiveIntensity);
        }
      }
    });
  }
  function setWaterLevel(level: number): void {
    tide = level;
    landscape.setWaterLevel(tide);
    for (const { mesh, highest } of waterMeshes) mesh.visible = tide < highest;
  }
  function refreshWaterLight(): void {
    for (const [material, intensity] of emissive) material.emissiveIntensity = intensity * light.x;
  }
  function selectDamModel(): void {
    if (!detailed) return;
    const next = distant ? fallback : detailed;
    if (next.parent === group) return;
    group.remove(distant ? detailed : fallback);
    group.add(next);
    shadowChange = true;
  }

  trackWater(fallback);
  setWaterLevel(tide);

  if (typeof document !== 'undefined') {
    const url = publicAssetUrl('assets/library/custom/the-dam/the-dam.glb');
    const fail = (error: unknown): void => {
      if (!disposed) {
        console.error('Failed to load The Dam hero model from ' + url +
          '; retaining the embedded Dam kit:', error);
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
          detailed = prepared.group;
          trackWater(detailed);
          selectDamModel();
          setWaterLevel(tide);
          refreshWaterLight();
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
    updateCulling(cameraPosition): void {
      // Across the island, the same Dam kit can be drawn in a handful of batches.
      // Keep the detailed materials and animated sheets around the actual site.
      const distance = group.position.distanceToSquared(cameraPosition);
      distant = distance > ((distant ? 165 : 185) * scale) ** 2;
      selectDamModel();
    },
    update(seconds: number): void {
      scrollDamWaterfallUVs(waterfallMaps, seconds);
      landscape.update(seconds);
    },
    setWaterLevel,
    refreshWaterLight,
    consumeShadowChange(): boolean {
      const changed = shadowChange;
      shadowChange = false;
      return changed;
    },
    dispose(): void {
      disposed = true;
      landscape.dispose();
      if (fallback.parent !== group) disposeMeshes(fallback);
      if (detailed && detailed.parent !== group) disposeMeshes(detailed);
      disposeMeshes(group);
      group.clear();
      group.removeFromParent();
    },
  };
}
