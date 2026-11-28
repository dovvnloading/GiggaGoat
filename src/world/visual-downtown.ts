import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, PropDescriptor, PropKind, Vec3 } from './types';
import { gridSample } from './terrain';
import { roundOakArtCenterY } from './visual-tree-grounding';
import { publicAssetUrl } from './public-assets';
import { bakeLibraryGeometry, createLanternLampInstances,
  type LanternLampBatch, type HoofPlacement } from './visual-hoofington';
import { createDistrictLod, type BakedPlacement, type DistrictLod } from './district-lod';
import { BAKERY_NAME } from './bakery-sign';
import { buildDowntownStorefronts } from './visual-downtown-storefronts';

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
  produceStall: 'assets/library/kenney/fantasy-town-kit/stall-red.glb',
  flowerStall: 'assets/library/kenney/fantasy-town-kit/stall-green.glb',
  lights: 'assets/library/custom/crane-yard/bunting.glb',
} as const;
export type DowntownModel = keyof typeof DOWNTOWN_MODELS;
export type DowntownPlacement = HoofPlacement<DowntownModel>;

/** Seat contact on the shipped chair, whose back is on local -Z. The
 * placement includes the backrest in its bounds; sit just forward of centre. */
export function downtownChairSeat({ position, size, yaw }: DowntownPlacement): Vec3 {
  const scale = Math.min(size.x / .75, size.y / 1.2583, size.z / .8451);
  return { x: position.x + Math.sin(yaw) * .13 * scale,
    y: position.y - size.y / 2 + .5 * scale,
    z: position.z + Math.cos(yaw) * .13 * scale };
}

const FLOWER_VARIANTS = ['flowerPink', 'flowerPurple', 'flowerSunny'] as const;
const BUSH_VARIANTS = ['bushA', 'bushB'] as const;
const OAK_VARIANTS = ['oakA', 'oakB', 'oakC'] as const;
const SCENERY_MODELS = new Set<DowntownModel>([
  ...FLOWER_VARIANTS, ...BUSH_VARIANTS, ...OAK_VARIANTS, 'planter', 'bench',
]);

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
} as const satisfies Partial<Record<DowntownModel, Vec3>>;

export function downtownRearHouseModel(dz: number): 'townhouse' | 'kayHouse' | 'brickHouse' {
  return dz > 0 ? 'townhouse' : dz < 0 ? 'kayHouse' : 'brickHouse';
}

type DowntownBuildingModel = keyof typeof DOWNTOWN_BUILDING_SIZES | 'highrise';

/** Contact points on the fitted GLB roof surfaces, in building-local metres. */
export const DOWNTOWN_ROOF_MOUNTS: Record<Exclude<DowntownBuildingModel, 'highrise'>, {
  ac: Vec3;
  tank?: Vec3;
}> = {
  cornerShop: { ac: { x: 0, y: 4.382, z: -2.35 } },
  kayShop: { ac: { x: 0, y: 2.818, z: -1.81 } },
  cinema: { ac: { x: 1.08, y: 4.382, z: .35 } },
  cafe: { ac: { x: 1, y: 2.818, z: -2.5 }, tank: { x: 2.25, y: 2.818, z: 0 } },
  market: { ac: { x: 0, y: 5.950, z: -1.81 } },
  bakery: { ac: { x: -.75, y: 4.382, z: -2.25 }, tank: { x: 1.25, y: 4.382, z: -.5 } },
  boutique: { ac: { x: -1.75, y: 5.950, z: 0 }, tank: { x: .25, y: 5.950, z: -1.75 } },
  arcade: { ac: { x: 0, y: 3.689, z: -1.81 } },
  townhouse: { ac: { x: 0, y: 6.825, z: -1.81 } },
  brickHouse: { ac: { x: 0, y: 9.957, z: -.73 } },
  kayHouse: { ac: { x: 0, y: 5.950, z: 1.5 }, tank: { x: 0, y: 5.950, z: -1.5 } },
};

export interface DowntownVisuals {
  group: THREE.Group;
  isFallbackHidden(mesh: THREE.InstancedMesh): boolean;
  consumeShadowChange(): boolean;
  setShopLighting(baking: boolean, recordGlow: number): void;
  updateCulling(position: THREE.Vector3, frustum: THREE.Frustum, daylight?: number, sightseeing?: boolean): boolean;
  dispose(): void;
}

export const SHOP_FRONTS: readonly (readonly {
  model: keyof typeof DOWNTOWN_BUILDING_SIZES; title: string;
  paint: readonly [wall: number, trim: number];
}[])[] = [
  // The shop colours carry from their counters into the street-facing stories.
  [
    { model: 'cafe', title: 'CAFE', paint: [0xd69876, 0xf0d3ac] },
    { model: 'cinema', title: 'GOATFLIX', paint: [0x567c78, 0xf0c987] },
    { model: 'boutique', title: 'BOUTIQUE', paint: [0xd6bbad, 0x806f81] },
    { model: 'arcade', title: 'KID ARCADE', paint: [0x77649f, 0x8acac4] },
    { model: 'bakery', title: BAKERY_NAME, paint: [0xc76571, 0xffdea2] },
  ],
  [
    { model: 'cornerShop', title: 'FLOWERS', paint: [0x819e83, 0xffdfb3] },
    { model: 'kayShop', title: 'BOOKS', paint: [0x688a99, 0xe6c797] },
    { model: 'market', title: 'ICE CREAM', paint: [0xe9aebb, 0xffebcf] },
    { model: 'market', title: 'HAY MART', paint: [0xd9ae67, 0x82967e] },
    { model: 'cornerShop', title: 'HOOF & CO', paint: [0x66828b, 0xd5bd9a] },
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
      // Courier ramps bridge the west shop roofs. Keep infill roofs below
      // their lowest supported end so the ramp and house have separate space.
      const roofLimit = side < 0 ? Math.min(DOWNTOWN_BUILDING_SIZES[left].y,
        DOWNTOWN_BUILDING_SIZES[right].y) : Infinity;
      const fitting = INFILL_MODELS.filter(model =>
        DOWNTOWN_BUILDING_SIZES[model].x <= rightEdge - leftEdge - 0.8 &&
        DOWNTOWN_BUILDING_SIZES[model].y <= roofLimit)
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

export function downtownBuildingModel(
  source: PropDescriptor, centre: Vec3, scale: number,
): DowntownBuildingModel {
  const { x, z } = source.transform.position;
  const dz = (z - centre.z) / scale;
  if (source.kind === 'tower') return 'highrise';
  if (source.kind === 'shop') return downtownShopFront(source, centre, scale).model;
  if (Math.abs(x - centre.x) >= 30 * scale) return downtownRearHouseModel(dz);
  const side = x < centre.x ? -1 : 1;
  const infill = DOWNTOWN_INFILL.find(item => item.side === side && Math.abs(item.z - dz) < .001);
  if (!infill) throw new Error('No Downtown infill model for ' + source.id);
  return infill.model;
}

/** The infill on the east pavement between Ice Cream and Hay Mart. */
export function noniStorefront(island: IslandData): PropDescriptor | undefined {
  const city = island.pois.find(p => p.id === 'downtown-bleatsville');
  const lot = DOWNTOWN_INFILL.find(p => p.side === 1 && p.z > 0 && p.z < 19);
  if (!city || !lot) return;
  const k = island.size / 600;
  const x = city.center.x + (14.3 + DOWNTOWN_BUILDING_SIZES[lot.model].z / 2) * k;
  return island.props.find(p => p.poiId === city.id && p.kind === 'house' &&
    Math.abs(p.transform.position.x - x) < .01 * k &&
    Math.abs(p.transform.position.z - city.center.z - lot.z * k) < .01 * k);
}

export function downtownShopFront(source: PropDescriptor, centre: Vec3, scale: number) {
  const { x, z } = source.transform.position;
  const row = Math.max(0, Math.min(4, Math.round((z - centre.z) / (scale * 19) + 2)));
  return SHOP_FRONTS[x < centre.x ? 0 : 1]![row]!;
}

/** Reads authored placements without consuming RNG or mutating descriptors. */
export function makeDowntownPlacements(island: IslandData): DowntownPlacement[] {
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  const recordLot = noniStorefront(island);
  const plan: DowntownPlacement[] = [];
  let flowerIndex = 0, bushIndex = 0, oakIndex = 0;
  for (const source of island.props) {
    if (source.poiId !== 'downtown-bleatsville' || source.body.type === 'dynamic') continue;
    const { position, rotationY: yaw } = source.transform;
    let model: DowntownModel | undefined;
    switch (source.kind) {
      case 'shop':
      case 'house':
      case 'tower': model = downtownBuildingModel(source, centre, scale); break;
      case 'lamp': model = 'lamp'; break;
      case 'bench': model = 'bench'; break;
      case 'planter': model = 'planter'; break;
      case 'flower': model = FLOWER_VARIANTS[flowerIndex++ % FLOWER_VARIANTS.length]!; break;
      case 'water-tower': model = 'waterTower'; break;
      case 'ac-unit': model = 'ac'; break;
      case 'fountain': model = 'fountain'; break;
      case 'booth': model = source.id === 'downtown-market-stall-produce' ? 'produceStall' : 'flowerStall'; break;
      default: break;
    }
    const shop = source.kind === 'shop' ? downtownShopFront(source, centre, scale) : undefined;
    if (model) plan.push({
      model, source, position, size: source.size,
      yaw: source.kind === 'bench' ? yaw + Math.PI : yaw,
      ...(shop ? { storefront: shop.title, upperPaint: shop.paint } : {}),
      ...(source === recordLot ? { upperPaint: [0x3a5358, 0xc89674] as const } : {}),
    });
  }

  function scatter(model: DowntownModel, dx: number, dz: number,
    sx: number, sy: number, sz: number, yaw = 0,
    y?: number, wall?: number): void {
    const x = centre.x + dx * scale, z = centre.z + dz * scale;
    if (SCENERY_MODELS.has(model) &&
        isInsideDowntownInfillFootprint(island, x, z)) return;
    const h = sy * scale;
    const position = { x, y: y ?? gridSample(island, x, z) + h / 2, z };
    const size = { x: sx * scale, y: h, z: sz * scale };
    plan.push({
      model, position, size,
      treeCenterY: OAK_VARIANTS.some(variant => model === variant) ? roundOakArtCenterY(island, position, size) : undefined,
      yaw, ...(wall === undefined ? {} : { wall }),
    });
  }

  // The north cafe, south bakery and clothes shop display different uses
  // instead of repeating the same cafe tables on both sides of the street.
  // Keep bins between the authored benches and planters along both sidewalks.
  for (const [x, z] of [[-13.4, -26.3], [-13.3, 5.9], [-12.9, 26],
    [13.5, -29.8], [13.1, -2], [13.2, 22]] as const) {
    scatter('trash', x, z, .85, 1.2, .85);
  }
  for (const { table: [x, z], chairs } of [
    { table: [-11.8, -40], chairs: [[-11.7, -41.6], [-12.1, -38.3]] },
    { table: [16.5, 52.4], chairs: [[16.3, 50.85], [16.6, 53.95]] },
  ] as const) {
    scatter('table', x, z, 1.55, 1.15, 1.55);
    for (const [seatX, seatZ] of chairs) {
      scatter('chair', seatX, seatZ, .82, 1.4, .82, Math.atan2(x - seatX, z - seatZ));
    }
  }
  for (const [x, z] of [[-13.05,-33], [-12.9, 14.2], [-13.1, 30],
    [12.9, -25.5], [13, -6.3], [12.9, 32.5]] as const) {
    scatter(BUSH_VARIANTS[bushIndex++ % BUSH_VARIANTS.length]!, x, z, 2, 1.55, 1.8);
  }
  for (const side of [-1, 1]) {
    for (const dz of [-25, 9, 28]) {
      scatter(OAK_VARIANTS[oakIndex++ % OAK_VARIANTS.length]!,
        side * 43, dz, 6.8, 13.5, 6.8);
    }
  }
  scatter('bread', -12.85, 35.2, 2.7, 2.05, 1.2, Math.PI / 2);
  scatter('produce', 20.3, 51.2, 2.2, 1.85, 1.2, -Math.PI / 2);
  scatter('clothes', 12.65, 37.7, 2.2, 2.4, 1.5, -Math.PI / 2);
  for (const dz of [5, 22]) {
    scatter('cone', -2.1, dz, 0.45, 0.7, 0.45);
    scatter('cone', 2.2, dz + 1.4, 0.45, 0.7, 0.45);
  }
  // Both garlands cross the street with their tops 8 m above the pavement.
  for (const dz of [-14, 6])
    scatter('lights', 0, dz, 27, 1.4, 0.12, 0,
      gridSample(island, centre.x, centre.z + dz * scale) + (8 - 1.4 / 2) * scale);
  return plan;
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

function fallbackChair(): THREE.Group {
  const chair = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x99684d });
  const part = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
    mesh.position.set(x, y, z);
    chair.add(mesh);
  };
  part(0, .4, 0, .65, .2, .65);
  for (const x of [-.319, .319]) for (const z of [-.319, .319]) part(x, .16, z, .112, .32, .112);
  part(0, .825, -.38755, .75, .8666, .1651);
  return chair;
}

/** Suppress only loaded replacements; other POIs and failed loads keep fallbacks. */
function suppressOldArt(island: IslandData, oldProps: THREE.Group,
  replacements: readonly DowntownPlacement[], loaded: ReadonlySet<DowntownModel>,
  fullyHidden: Set<PropKind>): void {
  const byKind = new Map<PropKind, Set<string>>();
  function hide(p: PropDescriptor): void {
    const ids = byKind.get(p.kind) ?? new Set<string>();
    ids.add(p.id); byKind.set(p.kind, ids);
  }
  for (const p of replacements) if (p.source && loaded.has(p.model)) hide(p.source);
  const loadedFacades = new Set(replacements.flatMap(p =>
    p.source && (p.source.kind === 'shop' || p.source.kind === 'house') &&
      loaded.has(p.model) ? [p.source.id] : []));
  for (const overlay of island.props.filter(p => p.poiId === 'downtown-bleatsville' && p.kind === 'awning')) {
    const building = island.props.find(p => p.poiId === 'downtown-bleatsville' &&
      (p.kind === 'shop' || p.kind === 'house') &&
      Math.hypot(overlay.transform.position.x - p.transform.position.x,
        overlay.transform.position.z - p.transform.position.z) < 8 * island.size / 600);
    if (building && loadedFacades.has(building.id)) hide(overlay);
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

/** Browser-only GLTF loading for the painted storefronts, street props and lanterns. */
export function buildDowntownVisuals(
  island: IslandData, oldProps: THREE.Group, destroyedProps?: ReadonlySet<string>,
): DowntownVisuals {
  const group = new THREE.Group();
  group.name = 'downtown-library-models';
  group.userData['ready'] = typeof document === 'undefined';
  group.userData['loadedModels'] = 0;
  const fullyHidden = new Set<PropKind>();
  const city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  let disposed = false, shadowChanged = false;
  let districtLod: DistrictLod | undefined;
  let lanterns: LanternLampBatch | null = null;
  let storefronts: ReturnType<typeof buildDowntownStorefronts> | undefined;
  let baking = false, recordGlow = 0;
  if (typeof document !== 'undefined') {
    const plan = makeDowntownPlacements(island);
    const required = new Set(plan.map(p => p.model));
    const loader = new GLTFLoader();
    const load = (id: DowntownModel): Promise<[DowntownModel, THREE.Group]> =>
      new Promise((resolve, reject) => {
        loader.load(publicAssetUrl(DOWNTOWN_MODELS[id]),
          gltf => resolve([id, gltf.scene]), undefined, error => {
            if (id !== 'chair') { reject(error); return; }
            // Seats retain their measured support if the small library GLTF
            // cannot load. Both renderers use the same fitted fallback.
            resolve([id, fallbackChair()]);
          });
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
          visible.filter(p => p.model === 'lamp'), lampModel, island.size, destroyedProps) : null;
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
        storefronts = buildDowntownStorefronts(staticPlan, models, noniStorefront(island)?.id);
        group.add(storefronts.group);
        suppressOldArt(island, oldProps, lanterns ? visible : staticPlan, new Set(models.keys()), fullyHidden);
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
    setShopLighting(oven, rehearsal) { baking = oven; recordGlow = rehearsal; },
    isFallbackHidden(mesh: THREE.InstancedMesh): boolean {
      const kind = mesh.name.replace(/^(?:props-|architecture-details-|outline-)/, '');
      return fullyHidden.has(kind as PropKind);
    },
    consumeShadowChange(): boolean {
      const changed = shadowChanged; shadowChanged = false; return changed;
    },
    updateCulling(position, frustum, daylight = 1, sightseeing = false): boolean {
      if (storefronts) {
        const distance = Math.hypot(position.x - city.x, position.z - city.z);
        const limit = (storefronts.group.visible ? 235 : 215) * scale;
        storefronts.group.visible = distance < limit;
        if (storefronts.group.visible) storefronts.update(daylight, distance < 105 * scale, baking, recordGlow);
      }
      const districtChanged = districtLod?.updateCulling(position, frustum, sightseeing) ?? false;
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
