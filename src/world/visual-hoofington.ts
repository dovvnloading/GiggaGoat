import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, PropDescriptor, PropKind, Vec3 } from './types';
import { gridSample } from './terrain';
import { publicAssetUrl } from './public-assets';
import { TOON_RAMP } from './visual-props';

/**
 * CC0 models only. The Poly Pizza trampoline is CC-BY and CREDITS.md is
 * outside this lane; the CC0 Kenney spring deck is used for the play pad.
 * All URLs are resolved by publicAssetUrl (including the nested World Lab).
 */
export const HOOFINGTON_MODELS = {
  pinkHome: 'assets/library/kenney/city-kit-suburban/building-type-a.glb',
  creamHome: 'assets/library/kenney/city-kit-suburban/building-type-f.glb',
  yellowHome: 'assets/library/kenney/city-kit-suburban/building-type-d.glb',
  farmhouse: 'assets/library/quaternius/medieval-village-pack/fantasy-house_BH2XHWUNmF.glb',
  cottage: 'assets/library/quaternius/medieval-village-pack/fantasy-house_dcPho4SUA3.glb',
  barn: 'assets/library/polypizza/barn/barn_A6UkPq33aZ.glb',
  silo: 'assets/library/quaternius/farm-buildings-bundle/silo_5GhLrv5Ce3.glb',
  windmill: 'assets/library/quaternius/farm-buildings-bundle/tower-windmill_52yaPyaAAG.glb',
  fence: 'assets/library/kenney/city-kit-suburban/fence-1x4.glb',
  mailbox: 'assets/library/polypizza/mailbox/mailbox_2olZ0G8iur.glb',
  bench: 'assets/library/quaternius/medieval-village-pack/bench_7uSlZo3n9Y.glb',
  gnome: 'assets/library/meshy/garden-gnome/garden-gnome.glb',
  playPad: 'assets/library/kenney/platformer-kit/spring.glb',
  lamp: 'assets/library/kenney/city-kit-roads/light-curved.glb',
  banner: 'assets/library/kenney/fantasy-town-kit/banner-red.glb',
  planter: 'assets/library/kenney/city-kit-suburban/planter.glb',
  flower: 'assets/library/kenney/nature-kit/flower_purpleA.glb',
  bush: 'assets/library/quaternius/stylized-nature-megakit/bush-with-flowers_U1ymDy8tbY.glb',
  oak: 'assets/library/quaternius/stylized-nature-megakit/tree_QVOop92WmG.glb',
  pine: 'assets/library/kenney/nature-kit/tree_pineTallA.glb',
  hay: 'assets/library/quaternius/medieval-village-pack/hay_Yu8TOERkpw.glb',
  cow: 'assets/library/quaternius/farm-animal-pack/cow_5XSc2Fka3F.glb',
  sheep: 'assets/library/quaternius/farm-animal-pack/sheep_C39AUXUUes.glb',
  pig: 'assets/library/quaternius/farm-animal-pack/pig_TNvG3QUFlp.glb',
  horse: 'assets/library/quaternius/farm-animal-pack/horse_F8HAAcLeBL.glb',
} as const;
export type HoofModel = keyof typeof HOOFINGTON_MODELS;

export interface HoofPlacement<Model extends string = HoofModel> {
  model: Model;
  position: Vec3;
  size: Vec3;
  yaw: number;
  /** Pastel plaster / contrasting tiled roof; baked into vertex colours. */
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
  dispose(): void;
}

const PALETTES = {
  pink: { wall: 0xf28fb5, roof: 0x54647f },
  cream: { wall: 0xffecdb, roof: 0xc85842 },
  yellow: { wall: 0xf3d15d, roof: 0x526c82 },
  blue: { wall: 0xaed9eb, roof: 0x57657a },
  red: { wall: 0xde5343, roof: 0x596778 },
};

/** A deterministic village art plan that does not touch RNG or physics. */
export function makeHoofingtonPlacements(island: IslandData): HoofPlacement[] {
  const farm = island.pois.find(p => p.id === 'hoofington')!.center;
  const scale = island.size / 600;
  const plan: HoofPlacement[] = [];

  for (const prop of island.props) {
    if (prop.poiId !== 'hoofington' || prop.kind === 'hay-bale') continue;
    const dx = (prop.transform.position.x - farm.x) / scale;
    const dz = (prop.transform.position.z - farm.z) / scale;
    let model: HoofModel | null = null;
    let paint: { wall?: number; roof?: number } = {};
    switch (prop.kind) {
      case 'house':
        if (dx < 0 && dz > 0) { model = 'pinkHome'; paint = PALETTES.pink; }
        else if (dx > 0 && dz > 0) { model = 'creamHome'; paint = PALETTES.cream; }
        else if (dx > 0) { model = 'yellowHome'; paint = PALETTES.yellow; }
        else { model = 'farmhouse'; paint = PALETTES.red; }
        break;
      case 'cottage': model = 'cottage'; paint = PALETTES.blue; break;
      case 'barn': model = 'barn'; paint = PALETTES.red; break;
      case 'silo': model = 'silo'; paint = { wall: 0xf6ead8, roof: 0xce5648 }; break;
      case 'windmill': model = 'windmill'; paint = { wall: 0xffeedc, roof: 0xc75c48 }; break;
      case 'fence': model = 'fence'; paint = { wall: 0xfff8e9 }; break;
      case 'mailbox': model = 'mailbox';
        paint = { wall: 0xce493d, roof: 0xc84338 }; break;
      case 'bench': model = 'bench'; break;
      case 'gnome': model = 'gnome'; break;
      case 'trampoline': model = 'playPad'; break;
      case 'lamp': model = 'lamp'; break;
      case 'planter': model = 'planter'; break;
      case 'flower': model = 'flower'; break;
      case 'bush': model = 'bush'; break;
      case 'tree-oak': model = 'oak'; break;
      case 'tree-pine': model = 'pine'; break;
      default: break;
    }
    if (model) plan.push({
      model, source: prop, position: prop.transform.position,
      size: prop.size, yaw: prop.transform.rotationY, ...paint,
    });
  }

  function scatter(model: HoofModel, dx: number, dz: number,
    width: number, height: number, depth: number,
    yaw = 0, paint: { wall?: number; roof?: number } = {}): void {
    const x = farm.x + dx * scale, z = farm.z + dz * scale;
    const h = height * scale;
    plan.push({
      model, position: { x, y: gridSample(island, x, z) + h / 2, z },
      size: { x: width * scale, y: h, z: depth * scale }, yaw, ...paint,
    });
  }

  // The painting reads from +Z along the street toward the mountain:
  // large shady trees at the edges, flowers against front windows,
  // livestock and hay behind the white fence, banners on the lamp posts.
  scatter('oak', -52, 35, 12, 17, 12);
  scatter('oak', 53, -10, 12, 18, 12);
  scatter('oak', 49, 42, 11, 15, 11);
  scatter('bush', -16, 30, 3, 2, 3);
  scatter('bush', 17, 30, 3, 2, 3);
  for (const side of [-1, 1]) {
    for (const dz of [10, 28]) {
      scatter('planter', side * 16, dz, 1.5, 0.85, 1.05,
        Math.PI / 2);
      for (const colorOffset of [-0.48, 0.48]) {
        scatter('flower', side * 15.3 + colorOffset, dz,
          0.65, 0.72, 0.65);
      }
    }
    for (const dz of [-30, 0, 30]) {
      scatter('banner', side * 9.4, dz, 1.3, 2.2, 0.17,
        side < 0 ? 0 : Math.PI);
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
    const root = models.get(placement.model);
    if (!root) continue;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) continue;
    const span = bounds.getSize(new THREE.Vector3());
    if (Math.min(span.x, span.y, span.z) <= 0.00001) continue;
    // Nature-kit leaves frequently use alpha-cutout atlases. Sampling only
    // their triangle vertices hits transparent black texels (black hedges).
    // These stylized foliage models are instead painted by part/height into
    // solid green and blossom colours; they still occupy one merged draw.
    const foliageModel = placement.model === 'oak' || placement.model === 'pine' ||
      placement.model === 'bush' || placement.model === 'flower';
    const wallColor = placement.wall === undefined ? null : body.setHex(placement.wall).clone();
    const roofColor = placement.roof === undefined ? null : roof.setHex(placement.roof).clone();
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
              const x = Math.min(data.width - 1,
                Math.max(0, Math.floor(sampleUv.x * (data.width - 1))));
              const y = Math.min(data.height - 1,
                Math.max(0, Math.floor((1 - sampleUv.y) * (data.height - 1))));
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
          if (placement.model === 'oak') {
            tint.setHex(height > 0.28 ? 0x72b94d : 0x916947);
          } else if (placement.model === 'pine') {
            tint.setHex(height > 0.23 ? 0x478f62 : 0x8d694b);
          } else if (placement.model === 'bush') {
            // Many bundled shrubs use 'flower' in the name for every leaf
            // mesh. Keep the canopy green; separate flower GLBs add blossoms.
            tint.setHex(0x6db85b);
          } else if (placement.model === 'flower') {
            tint.setHex(height > 0.38 ? 0xc68ee6 : 0x6ba955);
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
  if (typeof document !== 'undefined') {
    const plan = makeHoofingtonPlacements(island);
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
    void Promise.allSettled([...required].map(load)).then(results => {
      const models = new Map<HoofModel, ModelScene>();
      for (const result of results) {
        if (result.status === 'fulfilled') models.set(...result.value);
        else if (!disposed) console.warn('Hoofington library model unavailable:', result.reason);
      }
      try {
        if (disposed) return;
        // UV-mapped gnomes must not go through the vertex-colour baker.
        const staticPlan = plan.filter(p => p.model !== 'gnome' && models.has(p.model));
        const geometry = bakeHoofingtonGeometry(staticPlan, models);
        if (geometry) {
          const material = new THREE.MeshToonMaterial({
            color: 0xffffff, vertexColors: true, gradientMap: TOON_RAMP,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = 'hoofington-library-batched';
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
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
        if (geometry || gnomes) {
          const drawn = gnomes ? [...staticPlan, ...gnomePlan] : staticPlan;
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
    dispose(): void {
      disposed = true;
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
