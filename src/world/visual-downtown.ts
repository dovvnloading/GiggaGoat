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
  highrise: 'assets/library/custom/town/downtown-tower.glb',
  canopy: 'assets/library/kenney/city-kit-commercial/detail-awning-wide.glb',
  retroCanopy: 'assets/library/kenney/retro-urban-kit/detail-awning-wide.glb',
  retroWindow: 'assets/library/kenney/retro-urban-kit/window-wide-type-a.glb',
  retroBalcony: 'assets/library/kenney/retro-urban-kit/balcony-type-a.glb',
  lamp: 'assets/library/usdcraft/street-lamp-lantern.glb',
  bench: 'assets/library/custom/town/park-bench.glb',
  planter: 'assets/library/custom/town/planter.glb',
  flowerPink: 'assets/library/custom/hoofington-props/flowers-pink.glb',
  flowerPurple: 'assets/library/custom/hoofington-props/flowers-purple.glb',
  flowerSunny: 'assets/library/custom/hoofington-props/flowers-sunny.glb',
  bushA: 'assets/library/custom/hoofington-props/bush-round-a.glb',
  bushB: 'assets/library/custom/hoofington-props/bush-round-b.glb',
  oakA: 'assets/library/custom/hoofington-props/tree-round-a.glb',
  oakB: 'assets/library/custom/hoofington-props/tree-round-b.glb',
  oakC: 'assets/library/custom/hoofington-props/tree-round-c.glb',
  trash: 'assets/library/kenney/furniture-kit/trashcan.glb',
  ac: 'assets/library/custom/town/ac-unit.glb',
  waterTower: 'assets/library/custom/town/water-tower-timber.glb',
  fountain: 'assets/library/kenney/fantasy-town-kit/fountain-round-detail.glb',
  cone: 'assets/library/kenney/city-kit-roads/construction-cone.glb',
  table: 'assets/library/kenney/furniture-kit/tableRound.glb',
  chair: 'assets/library/kaykit/furniture-bits/chair_A_wood.gltf',
  bread: 'assets/library/kenney/mini-shop/display-bread.glb',
  produce: 'assets/library/kenney/mini-shop/display-fruit.glb',
  clothes: 'assets/library/kenney/mini-shop/clothing-rack.glb',
  lights: 'assets/library/custom/crane-yard/bunting.glb',
  skylineCrane: 'assets/library/custom/crane-yard/skyline-tower-crane.glb',
} as const;
export type DowntownModel = keyof typeof DOWNTOWN_MODELS;
export type DowntownPlacement = HoofPlacement<DowntownModel>;

const FLOWER_VARIANTS = ['flowerPink', 'flowerPurple', 'flowerSunny'] as const;
const BUSH_VARIANTS = ['bushA', 'bushB'] as const;
const OAK_VARIANTS = ['oakA', 'oakB', 'oakC'] as const;
const SCENERY_MODELS = new Set<DowntownModel>([
  ...FLOWER_VARIANTS, ...BUSH_VARIANTS, ...OAK_VARIANTS, 'planter', 'bench',
]);

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
  highrise: { centre: 0.182, halfHeight: 0.017 }, // tower has no storefront label
} as const satisfies Partial<Record<DowntownModel, {
  centre: number; halfHeight: number;
}>>;
type DowntownBuildingModel = keyof typeof DOWNTOWN_SIGN_ANCHORS;

/** DT-4: native Blender dimensions × one shared 8 m per model unit.
 * Highrise uses its separately authored 8 × 27 × 8 m tower box.
 */
export const DOWNTOWN_BUILDING_SIZES = {
  cornerShop: { x: 7.76, y: 10.43, z: 9.50 }, // shop-b-pink
  kayShop: { x: 7.12, y: 7.24, z: 10.30 }, // shop-c-yellow
  cinema: { x: 6.72, y: 10.43, z: 8.70 }, // shop-d-mint
  cafe: { x: 13.12, y: 7.24, z: 9.82 }, // shop-e-peach
  market: { x: 7.76, y: 13.63, z: 8.70 }, // shop-g-yellow
  bakery: { x: 7.07, y: 10.43, z: 9.32 }, // shop-h-pink
  boutique: { x: 17.12, y: 13.63, z: 12.30 }, // shop-j-cream
  arcade: { x: 16.67, y: 11.85, z: 8.79 }, // shop-k-lavender
  townhouse: { x: 11.36, y: 18.25, z: 12.71 }, // shop-l-peach
  brickHouse: { x: 9.92, y: 25.29, z: 11.51 }, // shop-m-pink
  kayHouse: { x: 6.72, y: 13.63, z: 9.50 }, // shop-f-lavender
} as const satisfies Record<Exclude<DowntownBuildingModel, 'highrise'>, Vec3>;

export function downtownRearHouseModel(dz: number): 'townhouse' | 'kayHouse' | 'brickHouse' {
  return dz > 0 ? 'townhouse' : dz < 0 ? 'kayHouse' : 'brickHouse';
}

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

export const SHOP_FRONTS: readonly (readonly {
  model: keyof typeof DOWNTOWN_BUILDING_SIZES; title: string;
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

type DowntownInfillModel = 'cornerShop' | 'bakery' | 'kayShop' | 'cinema' | 'kayHouse';
export interface DowntownInfill {
  side: -1 | 1;
  /** Centre along the street, in unscaled metres relative to the Downtown POI. */
  z: number;
  model: DowntownInfillModel;
}
const INFILL_MODELS: readonly DowntownInfillModel[] = [
  'cornerShop', 'bakery', 'kayShop', 'cinema', 'kayHouse',
];

/** DT-14: select the widest fitting model in each real shop side-wall gap.
 * Leave at least 0.4 m clear per side and avoid repeating neighbours where possible.
 */
export const DOWNTOWN_INFILL: readonly DowntownInfill[] = (() => {
  const result: DowntownInfill[] = [];
  for (const side of [-1, 1] as const) {
    const shops = SHOP_FRONTS[side < 0 ? 0 : 1]!;
    for (let row = 0; row < shops.length - 1; row++) {
      const left = shops[row]!.model, right = shops[row + 1]!.model;
      // Shop local X runs along world Z after its +/-90 degree rotation.
      const leftEdge = (row - 2) * 19 + DOWNTOWN_BUILDING_SIZES[left].x / 2;
      const rightEdge = (row - 1) * 19 - DOWNTOWN_BUILDING_SIZES[right].x / 2;
      const fitting = INFILL_MODELS.filter(model =>
        DOWNTOWN_BUILDING_SIZES[model].x <= rightEdge - leftEdge - 0.8)
        .sort((a, b) => DOWNTOWN_BUILDING_SIZES[b].x -
          DOWNTOWN_BUILDING_SIZES[a].x);
      const model = fitting.find(choice => choice !== left && choice !== right)
        ?? fitting[0];
      if (model) result.push({ side, z: (leftEdge + rightEdge) / 2, model });
    }
  }
  return result;
})();

/** Test a scenery centre against every infill box, expanded by 0.3 blueprint metres. */
export function isInsideDowntownInfillFootprint(
  island: IslandData, x: number, z: number,
): boolean {
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  return DOWNTOWN_INFILL.some(infill => {
    const size = DOWNTOWN_BUILDING_SIZES[infill.model];
    const cx = centre.x + infill.side * (20 - 11.4 / 2 + size.z / 2) * scale;
    const cz = centre.z + infill.z * scale;
    return Math.abs(x - cx) <= (size.z / 2 + 0.3) * scale &&
      Math.abs(z - cz) <= (size.x / 2 + 0.3) * scale;
  });
}

/** Reads authored placements without consuming RNG or mutating descriptors. */
export function makeDowntownPlacements(island: IslandData): DowntownPlacement[] {
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  const plan: DowntownPlacement[] = [];
  let flowerIndex = 0, bushIndex = 0, oakIndex = 0;
  for (const source of island.props) {
    if (source.poiId !== 'downtown-bleatsville' || source.body.type === 'dynamic') continue;
    const { position, rotationY: yaw } = source.transform;
    const dz = (position.z - centre.z) / scale;
    const side = position.x < centre.x ? 0 : 1;
    let model: DowntownModel | undefined;
    switch (source.kind) {
      case 'shop': {
        const row = Math.max(0, Math.min(4, Math.round(dz / 19 + 2)));
        const front = SHOP_FRONTS[side]![row]!;
        model = front.model;
        break;
      }
      case 'house':
        if (Math.abs(position.x - centre.x) < 30 * scale) {
          const infillSide = position.x < centre.x ? -1 : 1;
          const infill = DOWNTOWN_INFILL.find(item =>
            item.side === infillSide && Math.abs(item.z - dz) < 0.001);
          if (!infill) throw new Error('No Downtown infill model for ' + source.id);
          model = infill.model;
        } else {
          model = downtownRearHouseModel(dz);
        }
        break;
      case 'tower':
        model = 'highrise'; break;
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
      model, source, position, size: source.size,
      yaw: source.kind === 'bench' ? yaw + Math.PI : yaw,
    });
  }

  function scatter(model: DowntownModel, dx: number, dz: number,
    sx: number, sy: number, sz: number, yaw = 0,
    y?: number, wall?: number): void {
    const x = centre.x + dx * scale, z = centre.z + dz * scale;
    if (SCENERY_MODELS.has(model) &&
        isInsideDowntownInfillFootprint(island, x, z)) return;
    const h = sy * scale;
    plan.push({
      model, position: { x, y: y ?? gridSample(island, x, z) + h / 2, z },
      size: { x: sx * scale, y: h, z: sz * scale },
      yaw, ...(wall === undefined ? {} : { wall }),
    });
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
    scatter('cone', -2.1, dz, 0.45, 0.7, 0.45);
    scatter('cone', 2.2, dz + 1.4, 0.45, 0.7, 0.45);
  }
  // Both garlands cross the street with their tops 8 m above the pavement.
  for (const dz of [-14, 6])
    scatter('lights', 0, dz, 27, 1.4, 0.12, 0,
      gridSample(island, centre.x, centre.z + dz * scale) + (8 - 1.4 / 2) * scale);
  // Skyline machinery is intentionally behind the roofs, not on the route.
  scatter('skylineCrane', 32, -48, 19, 22, 8, Math.PI / 2,
    gridSample(island, centre.x + 32 * scale, centre.z - 48 * scale) + 11 * scale);
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
  const loadedFacades = new Set(replacements.flatMap(p =>
    p.source && (p.source.kind === 'shop' || p.source.kind === 'house') &&
      loaded.has(p.model) ? [p.source.id] : []));
  for (const overlay of island.props.filter(p =>
    p.poiId === 'downtown-bleatsville' &&
    (p.kind === 'awning' || p.kind === 'signboard'))) {
    // Preserve the legacy overlay only when its corresponding GLB failed.
    // Shops and houses both have authored awnings; only shops use sign atlases.
    const building = island.props.find(p =>
      p.poiId === 'downtown-bleatsville' &&
      (p.kind === 'shop' || (overlay.kind === 'awning' && p.kind === 'house')) &&
      Math.hypot(overlay.transform.position.x - p.transform.position.x,
        overlay.transform.position.z - p.transform.position.z) < 8 * island.size / 600);
    if (building && (overlay.kind === 'awning'
      ? loadedFacades.has(building.id) : signedShops.has(building.id))) hide(overlay);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const [kind, ids] of byKind) {
    const entries = island.props.filter(p => p.kind === kind &&
      !p.id.startsWith('the-dam-compat-'));
    if (ids.size === entries.length) { fullyHidden.add(kind); continue; }
    const mesh = oldProps.getObjectByName('props-' + kind) as THREE.InstancedMesh | undefined;
    const details = oldProps.getObjectByName('architecture-details-' + kind) as
      THREE.InstancedMesh | undefined;
    const outline = oldProps.getObjectByName('outline-' + kind) as
      THREE.InstancedMesh | undefined;
    if (!mesh) continue;
    entries.forEach((p, i) => {
      if (!ids.has(p.id)) return;
      mesh.setMatrixAt(i, zero);
      details?.setMatrixAt(i, zero);
      outline?.setMatrixAt(i, zero);
    });
    for (const batch of [mesh, details, outline]) {
      if (!batch) continue;
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
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
