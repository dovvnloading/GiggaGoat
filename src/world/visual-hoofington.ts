import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, PropDescriptor, PropKind, Vec3 } from './types';
import { gridSample } from './terrain';
import { publicAssetUrl } from './public-assets';
import { createDistrictLod, type BakedPlacement, type DistrictLod } from './district-lod';
import { WORLD_LOD, simplifiedWorldGeometry } from './lod';

/**
 * CC0 models only. The Poly Pizza trampoline is CC-BY and CREDITS.md is
 * outside this lane; the CC0 Kenney spring deck is used for the play pad.
 * All URLs are resolved by publicAssetUrl (including the nested World Lab).
 */
export const HOOFINGTON_MODELS = {
  // One building family (Kenney suburban), recoloured per part in Blender
  // from the Hoofington painting. See docs/art/WORLD_ART_PLAN.md.
  pinkHome: 'assets/library/custom/hoofington-houses/house-f-pink.glb',
  creamHome: 'assets/library/custom/hoofington-houses/house-t-cream.glb',
  yellowHome: 'assets/library/custom/hoofington-houses/house-e-yellow.glb',
  farmhouse: 'assets/library/custom/hoofington-houses/house-c-white.glb',
  cottage: 'assets/library/custom/hoofington-houses/house-r-sky.glb',
  barn: 'assets/library/polypizza/barn/barn_A6UkPq33aZ.glb',
  silo: 'assets/library/custom/hoofington-props/silo.glb',
  windmill: 'assets/library/custom/hoofington-props/windmill.glb',
  fence: 'assets/library/custom/hoofington-props/picket-fence.glb',
  mailbox: 'assets/library/custom/hoofington-props/mailbox.glb',
  bench: 'assets/library/quaternius/medieval-village-pack/bench_7uSlZo3n9Y.glb',
  gnome: 'assets/library/meshy/garden-gnome/garden-gnome.glb',
  playPad: 'assets/library/kenney/platformer-kit/spring.glb',
  lamp: 'assets/library/usdcraft/street-lamp-lantern.glb',
  planter: 'assets/library/kenney/city-kit-suburban/planter.glb',
  flowerPink: 'assets/library/custom/hoofington-props/flowers-pink.glb',
  flowerPurple: 'assets/library/custom/hoofington-props/flowers-purple.glb',
  flowerSunny: 'assets/library/custom/hoofington-props/flowers-sunny.glb',
  bushA: 'assets/library/custom/hoofington-props/bush-round-a.glb',
  bushB: 'assets/library/custom/hoofington-props/bush-round-b.glb',
  oakA: 'assets/library/custom/hoofington-props/tree-round-a.glb',
  oakB: 'assets/library/custom/hoofington-props/tree-round-b.glb',
  oakC: 'assets/library/custom/hoofington-props/tree-round-c.glb',
  pine: 'assets/library/kenney/nature-kit/tree_pineTallA.glb',
  hay: 'assets/library/quaternius/medieval-village-pack/hay_Yu8TOERkpw.glb',
  cow: 'assets/library/quaternius/farm-animal-pack/cow_5XSc2Fka3F.glb',
  sheep: 'assets/library/quaternius/farm-animal-pack/sheep_C39AUXUUes.glb',
  pig: 'assets/library/quaternius/farm-animal-pack/pig_TNvG3QUFlp.glb',
  horse: 'assets/library/quaternius/farm-animal-pack/horse_F8HAAcLeBL.glb',
} as const;
export type HoofModel = keyof typeof HOOFINGTON_MODELS;

const FLOWER_VARIANTS = ['flowerPink', 'flowerPurple', 'flowerSunny'] as const;
const BUSH_VARIANTS = ['bushA', 'bushB'] as const;
const OAK_VARIANTS = ['oakA', 'oakB', 'oakC'] as const;

// Blender already authored these colours. Guard the generic baker against
// accidental wall/roof overrides even if a caller supplies legacy paint.
const UNPAINTED_HOOF_MODELS = new Set<string>([
  'barn', 'silo', 'windmill', 'fence', 'mailbox',
  ...FLOWER_VARIANTS, ...BUSH_VARIANTS, ...OAK_VARIANTS,
]);

export interface HoofPlacement<Model extends string = HoofModel> {
  model: Model;
  position: Vec3;
  size: Vec3;
  yaw: number;
  /** Optional legacy overrides; Blender-painted Hoofington props never use these. */
  wall?: number;
  roof?: number;
  /** Original descriptor/collider is retained; only its old art is hidden. */
  source?: PropDescriptor;
}

export interface HoofingtonVisuals {
  group: THREE.Group;
  /** The old whole-kind draws are suppressed even when culling is updated. */
  isFallbackHidden(mesh: THREE.InstancedMesh): boolean;
  consumeShadowChange(): boolean;
  updateCulling(position: THREE.Vector3, frustum: THREE.Frustum): boolean;
  dispose(): void;
}

/** A deterministic village art plan that does not touch RNG or physics. */
export function makeHoofingtonPlacements(island: IslandData): HoofPlacement[] {
  const farm = island.pois.find(p => p.id === 'hoofington')!.center;
  const scale = island.size / 600;
  const plan: HoofPlacement[] = [];
  let flowerIndex = 0, bushIndex = 0, oakIndex = 0;

  for (const prop of island.props) {
    if (prop.poiId !== 'hoofington' || prop.kind === 'hay-bale') continue;
    const dx = (prop.transform.position.x - farm.x) / scale;
    const dz = (prop.transform.position.z - farm.z) / scale;
    let model: HoofModel | null = null;
    switch (prop.kind) {
      // Houses are pre-painted per part (walls, roof, trim, glass, door,
      // shutters, window boxes) in their GLBs; never repaint them here.
      case 'house':
        if (dx < 0 && dz > 0) model = 'pinkHome';
        else if (dx > 0 && dz > 0) model = 'creamHome';
        else if (dx > 0) model = 'yellowHome';
        else model = 'farmhouse';
        break;
      case 'cottage': model = 'cottage'; break;
      case 'barn': model = 'barn'; break;
      case 'silo': model = 'silo'; break;
      case 'windmill': model = 'windmill'; break;
      case 'fence': model = 'fence'; break;
      case 'mailbox': model = 'mailbox'; break;
      case 'bench': model = 'bench'; break;
      case 'gnome': model = 'gnome'; break;
      case 'trampoline': model = 'playPad'; break;
      case 'lamp': model = 'lamp'; break;
      case 'planter': model = 'planter'; break;
      case 'flower': model = FLOWER_VARIANTS[flowerIndex++ % FLOWER_VARIANTS.length]!; break;
      case 'bush': model = BUSH_VARIANTS[bushIndex++ % BUSH_VARIANTS.length]!; break;
      case 'tree-oak': model = OAK_VARIANTS[oakIndex++ % OAK_VARIANTS.length]!; break;
      case 'tree-pine': model = 'pine'; break;
      default: break;
    }
    if (model) plan.push({
      model, source: prop, position: prop.transform.position,
      size: prop.size, yaw: prop.transform.rotationY,
    });
  }

  function scatter(model: HoofModel, dx: number, dz: number,
    width: number, height: number, depth: number,
    yaw = 0): void {
    const x = farm.x + dx * scale, z = farm.z + dz * scale;
    const h = height * scale;
    plan.push({
      model, position: { x, y: gridSample(island, x, z) + h / 2, z },
      size: { x: width * scale, y: h, z: depth * scale }, yaw,
    });
  }

  // The painting reads from +Z along the street toward the mountain:
  // large shady trees at the edges, flowers against front windows,
  // livestock and hay behind the white fence.
  scatter(OAK_VARIANTS[oakIndex++ % OAK_VARIANTS.length]!, -52, 35, 12, 17, 12);
  scatter(OAK_VARIANTS[oakIndex++ % OAK_VARIANTS.length]!, 53, -10, 12, 18, 12);
  scatter(OAK_VARIANTS[oakIndex++ % OAK_VARIANTS.length]!, 49, 42, 11, 15, 11);
  scatter(BUSH_VARIANTS[bushIndex++ % BUSH_VARIANTS.length]!, -16, 30, 3, 2, 3);
  scatter(BUSH_VARIANTS[bushIndex++ % BUSH_VARIANTS.length]!, 15.45, 30, 3, 2, 3);
  for (const side of [-1, 1]) {
    for (const dz of [10, 28]) {
      scatter('planter', side * 16 + (side < 0 && dz === 10 ? 1.1 : 0),
        dz, 1.5, 0.85, 1.05, Math.PI / 2);
      for (const colorOffset of [-0.48, 0.48]) {
        // The west garden borders, not the pink house's collider, own this bed.
        const flowerX = side * 15.3 + colorOffset +
          (side < 0 && dz === 10 && colorOffset < 0 ? 0.7 : 0);
        scatter(FLOWER_VARIANTS[flowerIndex++ % FLOWER_VARIANTS.length]!,
          flowerX, dz, 0.65, 0.72, 0.65);
      }
    }
  }
  for (const [dx, dz, yaw] of [
    [-41, -16, 0.2], [-39, -14, 1.1], [-42, -13, -0.3],
    [-39, -10, 0.5], [-37, -14, 1.3],
  ] as const) scatter('hay', dx, dz, 2.15, 1.45, 2.2, yaw);
  scatter('cow', -43, 12, 4, 2.8, 2, -0.8);
  scatter('sheep', -40, 26, 2.5, 1.9, 1.65, 0.9);
  scatter('sheep', 43, -20, 2.4, 1.9, 1.6, -1.2);
  scatter('pig', -43, 31, 2, 1.6, 1.5, -0.2);
  scatter('horse', 45, -35, 4, 3.5, 1.85, -0.3);
  return plan;
}

type ModelScene = THREE.Group;
interface PixelMap { data: Uint8ClampedArray; width: number; height: number }
const white = new THREE.Color(0xffffff);
const texel = new THREE.Color();
const sampleUv = new THREE.Vector2();

/**
 * Bake all GLB submeshes, material colours and sampled atlas texels into the
 * same position/normal/vertex-colour layout. One merged draw replaces several
 * procedural kind draws; no separate draw is created per source material.
 * Textured roofs/windows keep their broad colours without needing N materials.
 */
export function bakeLibraryGeometry<Model extends string>(
  placements: readonly HoofPlacement<Model>[],
  models: ReadonlyMap<Model, ModelScene>,
  onPlacement?: (placement: HoofPlacement<Model>, start: number, count: number) => void,
): THREE.BufferGeometry | null {
  const coordinates: number[] = [], colours: number[] = [];
  const imageCache = new WeakMap<THREE.Texture, PixelMap | null>();
  const vertex = new THREE.Vector3();
  const tint = new THREE.Color();
  const body = new THREE.Color(), roof = new THREE.Color();
  const quat = new THREE.Quaternion(), local = new THREE.Vector3();

  function pixels(map: THREE.Texture): PixelMap | null {
    if (imageCache.has(map)) return imageCache.get(map)!;
    let result: PixelMap | null = null;
    if (typeof document !== 'undefined') {
      try {
        const image = map.image as CanvasImageSource & { width?: number; height?: number };
        if (image && image.width && image.height) {
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(512, image.width);
          canvas.height = Math.min(512, image.height);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            result = { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
              width: canvas.width, height: canvas.height };
          }
        }
      } catch { /* Cross-origin or unsupported texture: retain vertex/material paint. */ }
    }
    imageCache.set(map, result);
    return result;
  }

  for (const placement of placements) {
    const start = coordinates.length / 3;
    const root = models.get(placement.model);
    if (!root) continue;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) continue;
    const span = bounds.getSize(new THREE.Vector3());
    if (Math.min(span.x, span.y, span.z) <= 0.00001) continue;
    // Only the legacy alpha-cutout pine needs height-based paint. The new
    // round trees, bushes and flower clumps retain their authored materials.
    const foliageModel = placement.model === 'pine';
    const allowPaint = !UNPAINTED_HOOF_MODELS.has(placement.model);
    const wallColor = !allowPaint || placement.wall === undefined
      ? null : body.setHex(placement.wall).clone();
    const roofColor = !allowPaint || placement.roof === undefined
      ? null : roof.setHex(placement.roof).clone();
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw);
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const mesh = object;
      const positions = mesh.geometry.getAttribute('position');
      if (!positions || positions.itemSize < 3) return;
      const indices = mesh.geometry.index;
      const uvs = mesh.geometry.getAttribute('uv');
      const painted = mesh.geometry.getAttribute('color');
      const groups = mesh.geometry.groups;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let groupIndex = 0;
      const count = indices ? indices.count : positions.count;
      // GLTF primitives are triangles. Trim an incomplete primitive safely.
      for (let k = 0; k + 2 < count; k += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const order = k + corner;
          while (groupIndex < groups.length - 1 &&
            order >= groups[groupIndex]!.start + groups[groupIndex]!.count) groupIndex++;
          const material = materials[groups[groupIndex]?.materialIndex ?? 0] ?? materials[0]!;
          const idx = indices ? indices.getX(order) : order;
          vertex.fromBufferAttribute(positions as THREE.BufferAttribute, idx);
          if (mesh instanceof THREE.SkinnedMesh) mesh.applyBoneTransform(idx, vertex);
          vertex.applyMatrix4(mesh.matrixWorld);
          const height = (vertex.y - bounds.min.y) / span.y;
          const normalizedX = (vertex.x - bounds.min.x) / span.x - 0.5;
          const normalizedZ = (vertex.z - bounds.min.z) / span.z - 0.5;
          local.set(normalizedX * placement.size.x * 0.96,
            (height - 0.5) * placement.size.y * 0.98,
            normalizedZ * placement.size.z * 0.96).applyQuaternion(quat);
          coordinates.push(placement.position.x + local.x,
            placement.position.y + local.y, placement.position.z + local.z);

          const base = (material as THREE.MeshStandardMaterial).color;
          tint.copy(base instanceof THREE.Color ? base : white);
          if (painted && painted.itemSize >= 3) {
            tint.r *= painted.getX(idx);
            tint.g *= painted.getY(idx);
            tint.b *= painted.getZ(idx);
          }
          const map = (material as THREE.MeshStandardMaterial).map;
          if (!foliageModel && map && uvs && uvs.itemSize >= 2) {
            const data = pixels(map);
            if (data) {
              sampleUv.set(uvs.getX(idx), uvs.getY(idx));
              map.transformUv(sampleUv);
              // Sample the nearest texel centre to avoid adjacent palette swatches.
              const x = Math.min(data.width - 1,
                Math.max(0, Math.floor(sampleUv.x * data.width)));
              // GLTFLoader textures have flipY=false: transformed v is top-down.
              const v = map.flipY ? 1 - sampleUv.y : sampleUv.y;
              const y = Math.min(data.height - 1,
                Math.max(0, Math.floor(v * data.height)));
              const index = (y * data.width + x) * 4;
              // Transparent atlas padding is black; it is not surface paint.
              if (data.data[index + 3]! > 24) {
                texel.setRGB(data.data[index]! / 255,
                  data.data[index + 1]! / 255, data.data[index + 2]! / 255,
                  THREE.SRGBColorSpace);
                tint.multiply(texel);
              }
            }
          }
          const hint = (mesh.name + ' ' + material.name).toLowerCase();
          if (placement.model === 'pine') {
            tint.setHex(height > 0.23 ? 0x478f62 : 0x8d694b);
          } else if (placement.model === 'planter') {
            // Sourced planters use an alpha atlas with black padding at the
            // leaf tips; keep the pot terracotta and the leaves lively green.
            tint.setHex(height > 0.58 ? 0x73b65c : 0xbd8865);
          } else if (placement.model === 'retroWindow') {
            // Decorative upper windows should read as reflective blue glass,
            // not as black alpha-atlas voids in the sunny concept painting.
            tint.lerp(new THREE.Color(0x9bc8e5), 0.86);
          } else if (placement.model === 'lights') {
            // Holiday-kit bulbs are tiny on the atlas; UV vertex samples can
            // otherwise read the transparent black padding instead of bulbs.
            const bulbPalette = [0xffdf70, 0xf5a1c9, 0x8fd2ef, 0x95d675];
            const bulb = Math.floor((normalizedX + 0.5) * 16) & 3;
            tint.setHex(height > 0.7 ? 0xffe6aa : bulbPalette[bulb]!);
          }
          const detail = /window|glass|door|shutter|trim|metal|flower/.test(hint);
          const roofVertex = /roof|tile|shingle|thatch/.test(hint) || height > 0.71;
          if (roofColor && roofVertex) tint.lerp(roofColor, 0.82);
          else if (wallColor && !detail) tint.lerp(wallColor, 0.68);
          // Keep the source's lit windows and decorative contrast, even on
          // otherwise pastel/cream buildings.
          colours.push(tint.r, tint.g, tint.b);
        }
      }
    });
    onPlacement?.(placement, start, coordinates.length / 3 - start);
  }
  if (!coordinates.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The original Hoofington API remains available to existing consumers. */
export const bakeHoofingtonGeometry = bakeLibraryGeometry;

function disposeModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

/** One 0.5 m Meshy statue per garden, all sharing a single textured draw. */
export const GNOME_STATUE_HEIGHT = 0.5;

/**
 * The CC0 Meshy GLB is one UV-mapped mesh/primitive with a WebP baseColor map.
 * Clone its geometry, material and map before the loader scene is disposed;
 * never send gnomes through the vertex-colour geometry baker.
 */
export function createTexturedGnomeInstances(
  placements: readonly HoofPlacement[], model: ModelScene, streetX: number,
  groundAt: (x: number, z: number) => number,
): THREE.InstancedMesh | null {
  if (!placements.length) return null;
  model.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const source = meshes[0];
  if (meshes.length !== 1 || !source ||
      !(source.material instanceof THREE.MeshStandardMaterial) ||
      !source.material.map || !source.geometry.getAttribute('uv')) return null;

  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (sourceHeight <= 0.00001) {
    geometry.dispose();
    return null;
  }
  const material = source.material.clone();
  material.map = source.material.map.clone();
  material.vertexColors = false;
  const scale = GNOME_STATUE_HEIGHT / sourceHeight;
  const batch = new THREE.InstancedMesh(geometry, material, placements.length);
  batch.name = 'hoofington-garden-gnomes';
  batch.castShadow = true;
  batch.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < placements.length; i++) {
    const { x, z } = placements[i]!.position;
    dummy.position.set(x, groundAt(x, z) - bounds.min.y * scale, z);
    // The statue faces local +Z. Gardens on opposite sides face the road.
    dummy.rotation.set(0, x < streetX ? Math.PI / 2 : -Math.PI / 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    batch.setMatrixAt(i, dummy.matrix);
  }
  batch.instanceMatrix.needsUpdate = true;
  batch.computeBoundingSphere();
  return batch;
}

/**
 * Preserve the native materials and authored geometry of every USDCraft lamp.
 * Compact visible instances into shared near/far meshes per GLB primitive,
 * avoiding a separate material draw for every street cell. Far meshes use the
 * existing geometric LOD simplifier, never vertex-colour baking or paint.
 */
export interface LanternLampBatch {
  group: THREE.Group;
  updateCulling(position: THREE.Vector3, frustum: THREE.Frustum): boolean;
  dispose(): void;
}

export async function createLanternLampInstances<Model extends string>(
  placements: readonly HoofPlacement<Model>[], model: THREE.Group, islandSize: number,
): Promise<LanternLampBatch | null> {
  if (!placements.length) return null;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return null;
  const span = bounds.getSize(new THREE.Vector3());
  const parts: Array<{
    high: THREE.BufferGeometry; low: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
  }> = [];
  const meshes: THREE.Mesh[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  for (const source of meshes) {
    const high = source.geometry.clone();
    high.applyMatrix4(source.matrixWorld);
    // A GLTF primitive normally has one material. Keep grouped multi-material
    // geometry at full detail if simplifying would discard its group indices.
    const low = Array.isArray(source.material) && source.material.length > 1
      ? high : await simplifiedWorldGeometry(await simplifiedWorldGeometry(high));
    const material = Array.isArray(source.material)
      ? source.material.map(m => m.clone()) : source.material.clone();
    parts.push({ high, low, material });
  }
  if (!parts.length) return null;

  const group = new THREE.Group();
  group.name = 'usdcraft-lantern-lamps';
  const nearMeshes: THREE.InstancedMesh[] = [], farMeshes: THREE.InstancedMesh[] = [];
  for (const { high, low, material } of parts) {
    const near = new THREE.InstancedMesh(high, material, placements.length);
    const far = new THREE.InstancedMesh(low, material, placements.length);
    near.name = 'usdcraft-lantern-near';
    far.name = 'usdcraft-lantern-far';
    for (const batch of [near, far]) {
      batch.count = 0;
      batch.visible = false; // do not draw zero-instance batches
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.frustumCulled = false; // visible instances are compacted below
      group.add(batch);
    }
    nearMeshes.push(near);
    farMeshes.push(far);
  }

  const matrices: THREE.Matrix4[] = [], spheres: THREE.Sphere[] = [];
  const dummy = new THREE.Object3D();
  const radius = Math.hypot(span.x, span.y, span.z) / 2;
  for (const placement of placements) {
    const baseY = placement.position.y - placement.size.y / 2;
    dummy.position.set(placement.position.x, baseY - bounds.min.y, placement.position.z);
    dummy.rotation.set(0, placement.yaw, 0);
    dummy.scale.set(1, 1, 1); // native asset scale, not collider dimensions
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    spheres.push(new THREE.Sphere(new THREE.Vector3(
      placement.position.x, baseY - bounds.min.y + bounds.getCenter(new THREE.Vector3()).y,
      placement.position.z), radius));
  }
  let previousNear: number[] = [], previousFar: number[] = [], disposed = false;
  function same(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  function compact(batches: readonly THREE.InstancedMesh[], indices: readonly number[]): void {
    for (const batch of batches) {
      for (let i = 0; i < indices.length; i++)
        batch.setMatrixAt(i, matrices[indices[i]!]!);
      batch.count = indices.length;
      batch.visible = indices.length > 0;
      batch.instanceMatrix.needsUpdate = true;
      if (indices.length) batch.computeBoundingSphere();
    }
  }
  return {
    group,
    updateCulling(position, frustum): boolean {
      if (disposed) return false;
      const near: number[] = [], far: number[] = [];
      for (let i = 0; i < placements.length; i++) {
        const sphere = spheres[i]!;
        const distance = position.distanceTo(sphere.center);
        if (distance - sphere.radius > Math.min(WORLD_LOD.smallPropDistance, islandSize * 1.4) ||
          !frustum.intersectsSphere(sphere)) continue;
        (distance > WORLD_LOD.detailedDistance ? far : near).push(i);
      }
      const nearChanged = !same(previousNear, near), farChanged = !same(previousFar, far);
      if (nearChanged) { compact(nearMeshes, near); previousNear = near; }
      if (farChanged) { compact(farMeshes, far); previousFar = far; }
      return nearChanged || farChanged;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.clear();
      group.removeFromParent();
      for (const { high, low, material } of parts) {
        high.dispose();
        if (low !== high) low.dispose();
        for (const m of Array.isArray(material) ? material : [material]) m.dispose();
      }
    },
  };
}

/** Keep the exact original descriptor order, physics and dynamic hay updates. */
function suppressOldArt(
  island: IslandData, oldProps: THREE.Group,
  loaded: ReadonlySet<HoofModel>, plan: readonly HoofPlacement[],
  fullyHidden: Set<PropKind>,
): void {
  const byKind = new Map<PropKind, Set<string>>();
  for (const placement of plan) {
    if (!placement.source || !loaded.has(placement.model)) continue;
    const kind = placement.source.kind;
    const set = byKind.get(kind) ?? new Set<string>();
    set.add(placement.source.id);
    byKind.set(kind, set);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const [kind, ids] of byKind) {
    const entries = island.props.filter(p => p.kind === kind &&
      !p.id.startsWith('the-dam-compat-'));
    if (entries.length === ids.size) {
      // Suppress entire old draw, including the roof-detail and outline draw.
      fullyHidden.add(kind);
      continue;
    }
    const mesh = oldProps.getObjectByName('props-' + kind) as THREE.InstancedMesh | undefined;
    const ornaments = oldProps.getObjectByName('architecture-details-' + kind) as
      THREE.InstancedMesh | undefined;
    if (!mesh) continue;
    for (let i = 0; i < entries.length; i++) {
      if (!ids.has(entries[i]!.id)) continue;
      mesh.setMatrixAt(i, zero);
      ornaments?.setMatrixAt(i, zero);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (ornaments) {
      ornaments.instanceMatrix.needsUpdate = true;
      ornaments.computeBoundingSphere();
    }
  }
}

/** Runtime-only loading; node tests never initiate browser/GLTF requests. */
export function buildHoofingtonVisuals(island: IslandData, oldProps: THREE.Group): HoofingtonVisuals {
  const group = new THREE.Group();
  group.name = 'hoofington-library-models';
  group.userData['ready'] = typeof document === 'undefined';
  group.userData['loadedModels'] = 0;
  const fullyHidden = new Set<PropKind>();
  let shadowChanged = false, disposed = false;
  let districtLod: DistrictLod | undefined;
  let lanterns: LanternLampBatch | null = null;
  if (typeof document !== 'undefined') {
    const villagePlan = makeHoofingtonPlacements(island);
    // Hoofington owns lamps on roads and the Baa-ardwalk too. Downtown owns
    // its own district lamps; all positions and collider descriptors stay put.
    const roadLamps: HoofPlacement[] = island.props.filter(p =>
      p.kind === 'lamp' && p.poiId !== 'hoofington' &&
      p.poiId !== 'downtown-bleatsville').map(source => ({
        model: 'lamp', source, position: source.transform.position,
        size: source.size, yaw: source.transform.rotationY,
      }));
    const plan = [...villagePlan, ...roadLamps];
    // Dynamic hay bales must remain on their existing instanced mesh so the
    // game integrator can continue moving them after Rapier collisions.
    const required = new Set(plan.map(p => p.model));
    required.add('hay');
    const loader = new GLTFLoader();
    const load = (id: HoofModel): Promise<[HoofModel, ModelScene]> =>
      new Promise((resolve, reject) => {
        loader.load(publicAssetUrl(HOOFINGTON_MODELS[id]),
          gltf => resolve([id, gltf.scene]), undefined, reject);
      });
    void Promise.allSettled([...required].map(load)).then(async results => {
      const models = new Map<HoofModel, ModelScene>();
      for (const result of results) {
        if (result.status === 'fulfilled') models.set(...result.value);
        else if (!disposed) console.warn('Hoofington library model unavailable:', result.reason);
      }
      try {
        if (disposed) return;
        // Gnomes and material-authored lamps must never be vertex-colour baked.
        const staticPlan = plan.filter(p => p.model !== 'gnome' &&
          p.model !== 'lamp' && models.has(p.model));
        const ranges: BakedPlacement<HoofModel>[] = [];
        const geometry = bakeLibraryGeometry(staticPlan, models,
          (placement, start, count) => ranges.push({ placement, start, count }));
        if (geometry) {
          const lod = await createDistrictLod(island, geometry, ranges, group,
            'hoofington-library-batched');
          if (disposed) { lod.dispose(); return; }
          districtLod = lod;
        }
        const gnomePlan = plan.filter(p => p.model === 'gnome');
        const gnomeModel = models.get('gnome');
        const streetX = island.pois.find(p => p.id === 'hoofington')!.center.x;
        const gnomes = gnomeModel
          ? createTexturedGnomeInstances(gnomePlan, gnomeModel, streetX,
            (x, z) => gridSample(island, x, z))
          : null;
        if (gnomes) group.add(gnomes);
        else if (gnomeModel && gnomePlan.length)
          console.warn('Hoofington gnome GLB needs one UV-mapped, textured mesh');
        const lampPlan = plan.filter(p => p.model === 'lamp');
        const lampModel = models.get('lamp');
        lanterns = lampModel ? await createLanternLampInstances(lampPlan, lampModel, island.size) : null;
        if (disposed) { lanterns?.dispose(); return; }
        if (lanterns) group.add(lanterns.group);
        if (geometry || gnomes || lanterns) {
          const drawn = [...(geometry ? staticPlan : []), ...(gnomes ? gnomePlan : []),
            ...(lanterns ? lampPlan : [])];
          suppressOldArt(island, oldProps, new Set(drawn.map(p => p.model)),
            drawn, fullyHidden);
          shadowChanged = true;
        }
        // The one dynamic category stays a single draw and keeps the original
        // InstancedMesh reference expected by external physics bindings.
        if (models.has('hay')) {
          const hay = oldProps.getObjectByName('props-hay-bale');
          const entries = island.props.filter(p => p.kind === 'hay-bale');
          if (hay instanceof THREE.InstancedMesh &&
              entries.every(p => p.poiId === 'hoofington')) {
            const unit: HoofPlacement = { model: 'hay',
              position: { x: 0, y: 0, z: 0 },
              size: { x: 1, y: 1, z: 1 }, yaw: 0 };
            const replacement = bakeHoofingtonGeometry([unit], models);
            if (replacement) {
              const old = hay.geometry;
              hay.geometry = replacement;
              old.dispose();
              for (let i = 0; i < entries.length; i++)
                hay.setColorAt(i, white);
              if (hay.instanceColor) hay.instanceColor.needsUpdate = true;
              hay.computeBoundingSphere();
            }
          }
        }
      } catch (error) {
        if (!disposed) console.error('Could not assemble Hoofington model batch:', error);
      } finally {
        group.userData['loadedModels'] = models.size;
        group.userData['ready'] = true;
        for (const root of models.values()) disposeModel(root);
      }
    });
  }
  return {
    group,
    isFallbackHidden(mesh: THREE.InstancedMesh): boolean {
      const name = mesh.name.replace(/^(?:props-|architecture-details-|outline-)/, '');
      return fullyHidden.has(name as PropKind);
    },
    consumeShadowChange(): boolean {
      const changed = shadowChanged;
      shadowChanged = false;
      return changed;
    },
    updateCulling(position, frustum): boolean {
      const districtChanged = districtLod?.updateCulling(position, frustum) ?? false;
      return (lanterns?.updateCulling(position, frustum) ?? false) || districtChanged;
    },
    dispose(): void {
      disposed = true;
      districtLod?.dispose();
      lanterns?.dispose();
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => {
          // The gnome batch owns a cloned WebP map, not the loader's map.
          if (object.name === 'hoofington-garden-gnomes' &&
              material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
          material.dispose();
        });
      });
      group.clear();
      group.removeFromParent();
    },
  };
}
