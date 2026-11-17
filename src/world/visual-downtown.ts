import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, PropDescriptor, PropKind, Vec3 } from './types';
import { gridSample } from './terrain';
import { publicAssetUrl } from './public-assets';
import { bakeLibraryGeometry, createLanternLampInstances,
  type LanternLampBatch, type HoofPlacement } from './visual-hoofington';
import { createDistrictLod, type BakedPlacement, type DistrictLod } from './district-lod';

/**
 * CC0-only sourced Downtown art. These are library paths, not page-relative
 * URLs: the public asset helper makes them work in /src/world/viewer/ too.
 * Blender-authored painting-palette buildings retain their GLB materials.
 */
export const DOWNTOWN_MODELS = {
  bakery: 'assets/library/custom/downtown-shops/shop-h-pink.glb',
  arcade: 'assets/library/custom/downtown-shops/shop-k-lavender.glb',
  cinema: 'assets/library/custom/downtown-shops/shop-d-mint.glb',
  cafe: 'assets/library/custom/downtown-shops/shop-e-peach.glb',
  market: 'assets/library/custom/downtown-shops/shop-g-yellow.glb',
  boutique: 'assets/library/custom/downtown-shops/shop-j-cream.glb',
  cornerShop: 'assets/library/custom/downtown-shops/shop-b-pink.glb',
  kayShop: 'assets/library/custom/downtown-shops/shop-c-yellow.glb',
  townhouse: 'assets/library/custom/downtown-shops/shop-l-peach.glb',
  brickHouse: 'assets/library/custom/downtown-shops/shop-m-pink.glb',
  kayHouse: 'assets/library/custom/downtown-shops/shop-f-lavender.glb',
  highrise: 'assets/library/custom/downtown-shops/shop-l-peach.glb',
  canopy: 'assets/library/kenney/city-kit-commercial/detail-awning-wide.glb',
  retroCanopy: 'assets/library/kenney/retro-urban-kit/detail-awning-wide.glb',
  retroWindow: 'assets/library/kenney/retro-urban-kit/window-wide-type-a.glb',
  retroBalcony: 'assets/library/kenney/retro-urban-kit/balcony-type-a.glb',
  lamp: 'assets/library/usdcraft/street-lamp-lantern.glb',
  bench: 'assets/library/kenney/furniture-kit/bench.glb',
  planter: 'assets/library/kenney/city-kit-suburban/planter.glb',
  flowerPink: 'assets/library/custom/hoofington-props/flowers-pink.glb',
  flowerPurple: 'assets/library/custom/hoofington-props/flowers-purple.glb',
  flowerSunny: 'assets/library/custom/hoofington-props/flowers-sunny.glb',
  bushA: 'assets/library/custom/hoofington-props/bush-round-a.glb',
  bushB: 'assets/library/custom/hoofington-props/bush-round-b.glb',
  oakA: 'assets/library/custom/hoofington-props/tree-round-a.glb',
  oakB: 'assets/library/custom/hoofington-props/tree-round-b.glb',
  oakC: 'assets/library/custom/hoofington-props/tree-round-c.glb',
  trash: 'assets/library/kenney/furniture-kit/trashcan.glb',
  ac: 'assets/library/kenney/modular-buildings/detail-ac-a.glb',
  waterTower: 'assets/library/kenney/city-kit-industrial/water-tower.glb',
  fountain: 'assets/library/kenney/fantasy-town-kit/fountain-round-detail.glb',
  cone: 'assets/library/kenney/city-kit-roads/construction-cone.glb',
  table: 'assets/library/kenney/furniture-kit/tableRound.glb',
  chair: 'assets/library/kaykit/furniture-bits/chair_A_wood.gltf',
  bread: 'assets/library/kenney/mini-shop/display-bread.glb',
  produce: 'assets/library/kenney/mini-shop/display-fruit.glb',
  clothes: 'assets/library/kenney/mini-shop/clothing-rack.glb',
  lights: 'assets/library/kenney/holiday-kit/lights-colored.glb',
  skylineCrane: 'assets/library/custom/crane-yard/skyline-tower-crane.glb',
} as const;
export type DowntownModel = keyof typeof DOWNTOWN_MODELS;
export type DowntownPlacement = HoofPlacement<DowntownModel>;

const FLOWER_VARIANTS = ['flowerPink', 'flowerPurple', 'flowerSunny'] as const;
const BUSH_VARIANTS = ['bushA', 'bushB'] as const;
const OAK_VARIANTS = ['oakA', 'oakB', 'oakC'] as const;

/** Fractions of each Blender model's fitted height, measured from its base. */
export const DOWNTOWN_SIGN_ANCHORS = {
  bakery: { centre: 0.318, halfHeight: 0.029 }, // shop-h-pink
  arcade: { centre: 0.280, halfHeight: 0.026 }, // shop-k-lavender
  cinema: { centre: 0.318, halfHeight: 0.029 }, // shop-d-mint
  cafe: { centre: 0.335, halfHeight: 0.030 }, // shop-e-peach
  market: { centre: 0.243, halfHeight: 0.022 }, // shop-g-yellow
  boutique: { centre: 0.243, halfHeight: 0.022 }, // shop-j-cream
  cornerShop: { centre: 0.318, halfHeight: 0.029 }, // shop-b-pink
  kayShop: { centre: 0.335, halfHeight: 0.030 }, // shop-c-yellow
  kayHouse: { centre: 0.243, halfHeight: 0.022 }, // shop-f-lavender
  townhouse: { centre: 0.182, halfHeight: 0.017 }, // shop-l-peach
  brickHouse: { centre: 0.131, halfHeight: 0.012 }, // shop-m-pink
  highrise: { centre: 0.182, halfHeight: 0.017 }, // same shop-l-peach GLB
} as const satisfies Partial<Record<DowntownModel, {
  centre: number; halfHeight: number;
}>>;
type DowntownBuildingModel = keyof typeof DOWNTOWN_SIGN_ANCHORS;

export interface DowntownSign {
  source: PropDescriptor;
  model: DowntownBuildingModel;
  title: string;
  background: number;
  ink: number;
}

export interface DowntownVisuals {
  group: THREE.Group;
  isFallbackHidden(mesh: THREE.InstancedMesh): boolean;
  consumeShadowChange(): boolean;
  updateCulling(position: THREE.Vector3, frustum: THREE.Frustum): boolean;
  dispose(): void;
}

const SHOP_FRONTS: readonly (readonly {
  model: DowntownBuildingModel; title: string;
}[])[] = [
  // Looking from bookmark 11 toward -Z: pink bakery and purple arcade left.
  [
    { model: 'cafe', title: 'CAFE' },
    { model: 'cinema', title: 'GOATFLIX' },
    { model: 'boutique', title: 'BOUTIQUE' },
    { model: 'arcade', title: 'KID ARCADE' },
    { model: 'bakery', title: 'BAAKERY' },
  ],
  // Warm cream shop, green market and teal cafe along the right pavement.
  [
    { model: 'cornerShop', title: 'FLOWERS' },
    { model: 'kayShop', title: 'BOOKS' },
    { model: 'market', title: 'ICE CREAM' },
    { model: 'market', title: 'HAY MART' },
    { model: 'cornerShop', title: 'HOOF & CO' },
  ],
];

/** No RNG is consumed and no gameplay prop/collider/rooftop is moved. */
export function makeDowntownPlacements(island: IslandData): DowntownPlacement[] {
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  const plan: DowntownPlacement[] = [];
  let flowerIndex = 0, bushIndex = 0, oakIndex = 0;
  const buildings = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
    (p.kind === 'shop' || p.kind === 'house'));
  const nearestBuilding = (p: PropDescriptor): PropDescriptor | undefined =>
    buildings.reduce<PropDescriptor | undefined>((best, candidate) => {
      const distance = Math.hypot(p.transform.position.x - candidate.transform.position.x,
        p.transform.position.z - candidate.transform.position.z);
      const bestDistance = best ? Math.hypot(
        p.transform.position.x - best.transform.position.x,
        p.transform.position.z - best.transform.position.z) : Infinity;
      return distance < bestDistance ? candidate : best;
    }, undefined);

  for (const source of island.props) {
    if (source.poiId !== 'downtown-bleatsville' || source.body.type === 'dynamic') continue;
    const { position, rotationY: yaw } = source.transform;
    const dz = (position.z - centre.z) / scale;
    const side = position.x < centre.x ? 0 : 1;
    let model: DowntownModel | undefined;
    let place = position;
    switch (source.kind) {
      case 'shop': {
        const row = Math.max(0, Math.min(4, Math.round(dz / 19 + 2)));
        const front = SHOP_FRONTS[side]![row]!;
        model = front.model;
        break;
      }
      case 'house':
        model = dz > 0 ? 'townhouse' : dz < 0 ? 'kayHouse' : 'brickHouse';
        break;
      case 'tower':
        model = 'highrise'; break;
      case 'awning': {
        const front = nearestBuilding(source);
        if (!front) break;
        model = side ? 'canopy' : 'retroCanopy';
        // The old awning colliders are deliberately unchanged. Only the art
        // is lowered to the ground-floor shopfront shown in the painting.
        place = { ...position, y: front.transform.position.y -
          front.size.y / 2 + 3.35 * scale };
        break;
      }
      case 'lamp': model = 'lamp'; break;
      case 'bench': model = 'bench'; break;
      case 'planter': model = 'planter'; break;
      case 'flower': model = FLOWER_VARIANTS[flowerIndex++ % FLOWER_VARIANTS.length]!; break;
      case 'water-tower': model = 'waterTower'; break;
      case 'ac-unit': model = 'ac'; break;
      case 'fountain': model = 'fountain'; break;
      default: break;
    }
    if (model) plan.push({
      model, source, position: place, size: source.size, yaw,
    });
  }

  function scatter(model: DowntownModel, dx: number, dz: number,
    sx: number, sy: number, sz: number, yaw = 0,
    y?: number, wall?: number): void {
    const x = centre.x + dx * scale, z = centre.z + dz * scale;
    const h = sy * scale;
    plan.push({
      model, position: { x, y: y ?? gridSample(island, x, z) + h / 2, z },
      size: { x: sx * scale, y: h, z: sz * scale },
      yaw, ...(wall === undefined ? {} : { wall }),
    });
  }

  // Window-box flowers, imported retro glazing and balconies on the upper
  // floors. They sit beyond the facade so roofs remain clear for parkour.
  for (const shop of buildings.filter(p => p.kind === 'shop')) {
    const { position, rotationY: yaw } = shop.transform;
    const frontX = Math.sin(yaw), frontZ = Math.cos(yaw);
    const base = position.y - shop.size.y / 2;
    const face = shop.size.z / 2 + 0.12 * scale;
    for (const level of [0.56, 0.77]) {
      const y = base + level * shop.size.y;
      const x = position.x + frontX * face, z = position.z + frontZ * face;
      plan.push({ model: 'retroWindow', position: { x, y, z },
        size: { x: 2.25 * scale, y: 2.25 * scale, z: 0.19 * scale }, yaw });
      if (level > 0.7 && (position.z > centre.z)) {
        plan.push({ model: 'retroBalcony',
          position: { x, y: y - 1.0 * scale, z },
          size: { x: 2.5 * scale, y: 0.7 * scale, z: 1.1 * scale }, yaw });
      }
      for (const offset of [-2.2, 2.2]) {
        const lateralX = Math.cos(yaw) * offset * scale;
        const lateralZ = -Math.sin(yaw) * offset * scale;
        plan.push({ model: 'planter',
          position: { x: x + lateralX, y: y - 0.85 * scale, z: z + lateralZ },
          size: { x: 1.45 * scale, y: 0.48 * scale, z: 0.65 * scale }, yaw });
        plan.push({ model: FLOWER_VARIANTS[flowerIndex++ % FLOWER_VARIANTS.length]!,
          position: { x: x + lateralX, y: y - 0.48 * scale, z: z + lateralZ },
          size: { x: 0.9 * scale, y: 0.65 * scale, z: 0.62 * scale }, yaw });
      }
    }
  }

  // The central road is kept open. Furniture sits on the pavements, and the
  // smaller cones and shop-window displays have no new physics descriptors.
  for (const side of [-1, 1]) {
    for (const dz of [-28, 2, 29]) {
      scatter('trash', side * 13.9, dz, 0.85, 1.2, 0.85);
    }
    for (const dz of [-21, 13]) {
      scatter('table', side * 13.4, dz, 1.55, 1.15, 1.55);
      scatter('chair', side * 13.0, dz - 1.65, 0.82, 1.4, 0.82, side * 0.3);
      scatter('chair', side * 13.0, dz + 1.65, 0.82, 1.4, 0.82, -side * 0.3);
    }
    for (const dz of [-34, 5, 32]) {
      scatter(BUSH_VARIANTS[bushIndex++ % BUSH_VARIANTS.length]!,
        side * 15, dz, 2.4, 1.6, 2.0);
    }
    for (const dz of [-25, 9, 28]) {
      scatter(OAK_VARIANTS[oakIndex++ % OAK_VARIANTS.length]!,
        side * 43, dz, 6.8, 13.5, 6.8);
    }
  }
  scatter('bread', -14.5, 35, 2.7, 2.05, 1.2, Math.PI / 2);
  scatter('produce', 14.5, 15, 2.2, 1.85, 1.2, -Math.PI / 2);
  scatter('clothes', 14.6, 34, 2.2, 2.4, 1.5, -Math.PI / 2);
  for (const dz of [5, 22]) {
    scatter('cone', -2.1, dz, 0.65, 1.15, 0.65);
    scatter('cone', 2.2, dz + 1.4, 0.65, 1.15, 0.65);
  }
  // Two slender source-model garlands cross the street; keep their span.
  for (const dz of [-14, 6])
    scatter('lights', 0, dz, 27, 0.162, 0.126, 0,
      gridSample(island, centre.x, centre.z + dz * scale) + 14.2 * scale);
  // Skyline machinery is intentionally behind the roofs, not on the route.
  scatter('skylineCrane', 32, -48, 19, 22, 8, Math.PI / 2,
    gridSample(island, centre.x + 32 * scale, centre.z - 48 * scale) + 27 * scale);
  return plan;
}

export function makeDowntownSigns(island: IslandData): DowntownSign[] {
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  return island.props.filter(p => p.kind === 'shop' &&
    p.poiId === 'downtown-bleatsville').map(source => {
    const side = source.transform.position.x < centre.x ? 0 : 1;
    const row = Math.max(0, Math.min(4,
      Math.round((source.transform.position.z - centre.z) / scale / 19 + 2)));
    const facade = SHOP_FRONTS[side]![row]!;
    return { source, model: facade.model, title: facade.title,
      background: 0xf6ead2, ink: 0x543b3d };
  });
}

/** Sign quads lie just off the GLB's +Z cream boards, never above awnings. */
export function downtownSignGeometry(signs: readonly DowntownSign[]): THREE.BufferGeometry {
  const columns = 2, rows = Math.ceil(signs.length / columns);
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i < signs.length; i++) {
    const sign = signs[i]!;
    const p = sign.source;
    const yaw = p.transform.rotationY;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const anchor = DOWNTOWN_SIGN_ANCHORS[sign.model];
    const center = new THREE.Vector3(
      p.transform.position.x,
      p.transform.position.y - p.size.y / 2 + anchor.centre * p.size.y,
      p.transform.position.z,
    ).addScaledVector(forward, p.size.z / 2 + 0.04);
    const halfW = p.size.x * 0.40, halfH = p.size.y * anchor.halfHeight;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      positions.push(center.x + right.x * u * halfW,
        center.y + v * halfH, center.z + right.z * u * halfW);
    }
    const col = i % columns, row = Math.floor(i / columns);
    const left = col / columns, rightUv = (col + 1) / columns;
    const top = 1 - row / rows, bottom = 1 - (row + 1) / rows;
    uv.push(left, bottom, rightUv, bottom, rightUv, top, left, top);
    const index = i * 4;
    indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function signAtlas(signs: readonly DowntownSign[]): THREE.Mesh | null {
  if (!signs.length || typeof document === 'undefined') return null;
  const columns = 2, rows = Math.ceil(signs.length / columns);
  const cellWidth = 512, cellHeight = 116;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth; canvas.height = rows * cellHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (let i = 0; i < signs.length; i++) {
    const sign = signs[i]!;
    const col = i % columns, row = Math.floor(i / columns);
    const x = col * cellWidth, y = row * cellHeight;
    const background = new THREE.Color(sign.background);
    ctx.fillStyle = '#' + background.getHexString();
    ctx.fillRect(x + 3, y + 3, cellWidth - 6, cellHeight - 6);
    ctx.strokeStyle = '#fff5de'; ctx.lineWidth = 9;
    ctx.strokeRect(x + 10, y + 10, cellWidth - 20, cellHeight - 20);
    ctx.fillStyle = '#' + new THREE.Color(sign.ink).getHexString();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fontSize = 64;
    do { ctx.font = 'bold ' + fontSize + 'px sans-serif'; fontSize -= 2; }
    while (ctx.measureText(sign.title).width > cellWidth - 46 && fontSize > 24);
    ctx.fillText(sign.title, x + cellWidth / 2, y + cellHeight / 2 + 3);
  }
  const geometry = downtownSignGeometry(signs);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(geometry,
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  mesh.name = 'downtown-shop-signs';
  return mesh;
}

function disposeModels(models: ReadonlyMap<DowntownModel, THREE.Group>): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const model of models.values()) model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(m);
      for (const value of Object.values(m))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
  textures.forEach(t => t.dispose());
}

/** Suppress only loaded replacements; other POIs and failed loads keep fallbacks. */
function suppressOldArt(island: IslandData, oldProps: THREE.Group,
  replacements: readonly DowntownPlacement[], loaded: ReadonlySet<DowntownModel>,
  signedShops: ReadonlySet<string>, fullyHidden: Set<PropKind>): void {
  const byKind = new Map<PropKind, Set<string>>();
  function hide(p: PropDescriptor): void {
    const ids = byKind.get(p.kind) ?? new Set<string>();
    ids.add(p.id); byKind.set(p.kind, ids);
  }
  for (const p of replacements) if (p.source && loaded.has(p.model)) hide(p.source);
  for (const signboard of island.props.filter(p =>
    p.poiId === 'downtown-bleatsville' && p.kind === 'signboard')) {
    // Keep the legacy signboard if its corresponding shop model failed.
    const matchingShop = island.props.find(p => p.kind === 'shop' &&
      p.poiId === 'downtown-bleatsville' &&
      Math.hypot(signboard.transform.position.x - p.transform.position.x,
        signboard.transform.position.z - p.transform.position.z) < 8 * island.size / 600);
    if (matchingShop && signedShops.has(matchingShop.id)) hide(signboard);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const [kind, ids] of byKind) {
    const entries = island.props.filter(p => p.kind === kind &&
      !p.id.startsWith('the-dam-compat-'));
    if (ids.size === entries.length) { fullyHidden.add(kind); continue; }
    const mesh = oldProps.getObjectByName('props-' + kind) as THREE.InstancedMesh | undefined;
    const details = oldProps.getObjectByName('architecture-details-' + kind) as
      THREE.InstancedMesh | undefined;
    if (!mesh) continue;
    entries.forEach((p, i) => {
      if (!ids.has(p.id)) return;
      mesh.setMatrixAt(i, zero);
      details?.setMatrixAt(i, zero);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    if (details) {
      details.instanceMatrix.needsUpdate = true; details.computeBoundingSphere();
    }
  }
}

/** Browser-only GLTF loading with one static toon batch and two lightweight overlays. */
export function buildDowntownVisuals(island: IslandData, oldProps: THREE.Group): DowntownVisuals {
  const group = new THREE.Group();
  group.name = 'downtown-library-models';
  group.userData['ready'] = typeof document === 'undefined';
  group.userData['loadedModels'] = 0;
  group.userData['signCount'] = 0;
  const fullyHidden = new Set<PropKind>();
  let disposed = false, shadowChanged = false;
  let districtLod: DistrictLod | undefined;
  let lanterns: LanternLampBatch | null = null;
  if (typeof document !== 'undefined') {
    const plan = makeDowntownPlacements(island);
    const signs = makeDowntownSigns(island);
    const required = new Set(plan.map(p => p.model));
    const loader = new GLTFLoader();
    const load = (id: DowntownModel): Promise<[DowntownModel, THREE.Group]> =>
      new Promise((resolve, reject) => {
        loader.load(publicAssetUrl(DOWNTOWN_MODELS[id]),
          gltf => resolve([id, gltf.scene]), undefined, reject);
      });
    void Promise.allSettled([...required].map(load)).then(async results => {
      const models = new Map<DowntownModel, THREE.Group>();
      for (const result of results) {
        if (result.status === 'fulfilled') models.set(...result.value);
        else if (!disposed) console.warn('Downtown model unavailable:', result.reason);
      }
      try {
        if (disposed) return;
        const visible = plan.filter(p => models.has(p.model));
        const staticPlan = visible.filter(p => p.model !== 'lamp');
        const lampModel = models.get('lamp');
        lanterns = lampModel ? await createLanternLampInstances(
          visible.filter(p => p.model === 'lamp'), lampModel, island.size) : null;
        if (disposed) { lanterns?.dispose(); return; }
        if (lanterns) group.add(lanterns.group);
        const ranges: BakedPlacement<DowntownModel>[] = [];
        const geometry = bakeLibraryGeometry(staticPlan, models,
          (placement, start, count) => ranges.push({ placement, start, count }),
          DOWNTOWN_MODELS);
        if (!geometry && !lanterns) return;
        if (geometry) {
          const lod = await createDistrictLod(island, geometry, ranges, group,
            'downtown-library-batched');
          if (disposed) { lod.dispose(); return; }
          districtLod = lod;
        }
        const loadedShops = signs.filter(sign => {
          const planned = plan.find(p => p.source?.id === sign.source.id);
          return planned && models.has(planned.model);
        });
        const labels = signAtlas(loadedShops);
        if (labels) group.add(labels);
        group.userData['signCount'] = loadedShops.length;
        suppressOldArt(island, oldProps, lanterns ? visible : staticPlan,
          new Set(models.keys()),
          new Set(loadedShops.map(s => s.source.id)), fullyHidden);
        shadowChanged = true;
      } catch (error) {
        if (!disposed) console.error('Could not assemble Downtown library art:', error);
      } finally {
        group.userData['ready'] = true;
        group.userData['loadedModels'] = models.size;
        disposeModels(models);
      }
    });
  }
  return {
    group,
    isFallbackHidden(mesh: THREE.InstancedMesh): boolean {
      const kind = mesh.name.replace(/^(?:props-|architecture-details-|outline-)/, '');
      return fullyHidden.has(kind as PropKind);
    },
    consumeShadowChange(): boolean {
      const changed = shadowChanged; shadowChanged = false; return changed;
    },
    updateCulling(position, frustum): boolean {
      const districtChanged = districtLod?.updateCulling(position, frustum) ?? false;
      return (lanterns?.updateCulling(position, frustum) ?? false) || districtChanged;
    },
    dispose(): void {
      disposed = true;
      districtLod?.dispose();
      lanterns?.dispose();
      group.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          const map = (material as THREE.MeshBasicMaterial).map;
          map?.dispose(); material.dispose();
        }
      });
      group.clear();
      group.removeFromParent();
    },
  };
}
