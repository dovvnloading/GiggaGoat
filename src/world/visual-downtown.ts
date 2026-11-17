import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, PropDescriptor, PropKind, Vec3 } from './types';
import { gridSample } from './terrain';
import { publicAssetUrl } from './public-assets';
import { TOON_RAMP } from './visual-props';
import { bakeLibraryGeometry, createLanternLampInstances,
  type LanternLampBatch, type HoofPlacement } from './visual-hoofington';
import { createDistrictLod, type BakedPlacement, type DistrictLod } from './district-lod';

/**
 * CC0-only sourced Downtown art. These are library paths, not page-relative
 * URLs: the public asset helper makes them work in /src/world/viewer/ too.
 * KayKit's .gltf files load their adjacent .bin and atlas through GLTFLoader.
 */
export const DOWNTOWN_MODELS = {
  bakery: 'assets/library/kenney/city-kit-commercial/building-h.glb',
  arcade: 'assets/library/kenney/city-kit-commercial/building-k.glb',
  cinema: 'assets/library/kenney/city-kit-commercial/building-d.glb',
  cafe: 'assets/library/kenney/city-kit-commercial/building-e.glb',
  market: 'assets/library/kenney/city-kit-commercial/building-g.glb',
  boutique: 'assets/library/kenney/city-kit-commercial/building-j.glb',
  cornerShop: 'assets/library/kenney/city-kit-commercial/building-b.glb',
  kayShop: 'assets/library/kaykit/city-builder-bits/building_D_withoutBase.gltf',
  townhouse: 'assets/library/kenney/modular-buildings/building-sample-tower-a.glb',
  brickHouse: 'assets/library/kenney/modular-buildings/building-sample-tower-d.glb',
  kayHouse: 'assets/library/kaykit/city-builder-bits/building_F_withoutBase.gltf',
  highrise: 'assets/library/kenney/city-kit-commercial/building-skyscraper-c.glb',
  canopy: 'assets/library/kenney/city-kit-commercial/detail-awning-wide.glb',
  retroCanopy: 'assets/library/kenney/retro-urban-kit/detail-awning-wide.glb',
  retroWindow: 'assets/library/kenney/retro-urban-kit/window-wide-type-a.glb',
  retroBalcony: 'assets/library/kenney/retro-urban-kit/balcony-type-a.glb',
  lamp: 'assets/library/usdcraft/street-lamp-lantern.glb',
  bench: 'assets/library/kenney/furniture-kit/bench.glb',
  planter: 'assets/library/kenney/city-kit-suburban/planter.glb',
  flower: 'assets/library/kenney/nature-kit/flower_purpleA.glb',
  bush: 'assets/library/kenney/nature-kit/plant_bushDetailed.glb',
  oak: 'assets/library/kenney/nature-kit/tree_detailed.glb',
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
  skylineCrane: 'assets/library/kenney/factory-kit/crane.glb',
} as const;
export type DowntownModel = keyof typeof DOWNTOWN_MODELS;
export type DowntownPlacement = HoofPlacement<DowntownModel>;

export interface DowntownSign {
  source: PropDescriptor;
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
  model: DowntownModel; title: string; wall: number; roof: number; sign: number;
}[])[] = [
  // Looking from bookmark 11 toward -Z: pink bakery and purple arcade left.
  [
    { model: 'cafe', title: 'CAFE', wall: 0xb9dce3, roof: 0x608da3, sign: 0xffedbf },
    { model: 'cinema', title: 'GOATFLIX', wall: 0xffc457, roof: 0xce5c65, sign: 0xffeecc },
    { model: 'boutique', title: 'BOUTIQUE', wall: 0xf4ce68, roof: 0x668e9c, sign: 0xfbe8ab },
    { model: 'arcade', title: 'KID ARCADE', wall: 0xd08cdd, roof: 0x5d4d9a, sign: 0x5b3b9c },
    { model: 'bakery', title: 'BAAKERY', wall: 0xf08cae, roof: 0xb25278, sign: 0xffead0 },
  ],
  // Warm cream shop, green market and teal cafe along the right pavement.
  [
    { model: 'cornerShop', title: 'FLOWERS', wall: 0xb7d2ec, roof: 0x5b7895, sign: 0xf9e5c9 },
    { model: 'kayShop', title: 'BOOKS', wall: 0xffc2a0, roof: 0x6c91a4, sign: 0xffe5b8 },
    { model: 'market', title: 'ICE CREAM', wall: 0xa3c4ee, roof: 0x477cc1, sign: 0xe5edfd },
    { model: 'market', title: 'HAY MART', wall: 0xa7d479, roof: 0x4f995d, sign: 0x87bf68 },
    { model: 'cornerShop', title: 'HOOF & CO', wall: 0xf5cfb2, roof: 0x8e6d7e, sign: 0xffe2ac },
  ],
];

/** No RNG is consumed and no gameplay prop/collider/rooftop is moved. */
export function makeDowntownPlacements(island: IslandData): DowntownPlacement[] {
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  const plan: DowntownPlacement[] = [];
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
    let wall: number | undefined, roof: number | undefined;
    let place = position;
    switch (source.kind) {
      case 'shop': {
        const row = Math.max(0, Math.min(4, Math.round(dz / 19 + 2)));
        const front = SHOP_FRONTS[side]![row]!;
        model = front.model; wall = front.wall; roof = front.roof;
        break;
      }
      case 'house':
        model = dz > 0 ? 'townhouse' : dz < 0 ? 'kayHouse' : 'brickHouse';
        wall = side ? 0xf6dac0 : 0xcab9e9; roof = 0x5a728a;
        break;
      case 'tower':
        model = 'highrise'; wall = 0xaed1e9; roof = 0x5c8aa7; break;
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
      case 'flower': model = 'flower'; break;
      case 'water-tower': model = 'waterTower'; break;
      case 'ac-unit': model = 'ac'; break;
      case 'fountain': model = 'fountain'; break;
      default: break;
    }
    if (model) plan.push({
      model, source, position: place, size: source.size, yaw,
      ...(wall === undefined ? {} : { wall }),
      ...(roof === undefined ? {} : { roof }),
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
        plan.push({ model: 'flower',
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
      scatter('bush', side * 15, dz, 2.4, 1.6, 2.0);
    }
    for (const dz of [-25, 9, 28]) {
      scatter('oak', side * 43, dz, 6.8, 13.5, 6.8);
    }
  }
  scatter('bread', -14.5, 35, 2.7, 2.05, 1.2, Math.PI / 2);
  scatter('produce', 14.5, 15, 2.2, 1.85, 1.2, -Math.PI / 2);
  scatter('clothes', 14.6, 34, 2.2, 2.4, 1.5, -Math.PI / 2);
  for (const dz of [5, 22]) {
    scatter('cone', -2.1, dz, 0.65, 1.15, 0.65);
    scatter('cone', 2.2, dz + 1.4, 0.65, 1.15, 0.65);
  }
  // Source-model garlands suspend across the street at several depths.
  for (const dz of [-34, -14, 6, 21])
    scatter('lights', 0, dz, 27, 0.36, 0.28, 0,
      gridSample(island, centre.x, centre.z + dz * scale) + 14.2 * scale);
  // Skyline machinery is intentionally behind the roofs, not on the route.
  scatter('skylineCrane', 32, -48, 19, 22, 8, Math.PI / 2,
    gridSample(island, centre.x + 32 * scale, centre.z - 48 * scale) + 27 * scale,
    0xfec544);
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
    return { source, title: facade.title, background: facade.sign,
      ink: side === 0 && row === 3 ? 0xfff9ff : 0x543b3d };
  });
}

function signAtlas(signs: readonly DowntownSign[]): THREE.Mesh | null {
  if (!signs.length || typeof document === 'undefined') return null;
  const columns = 2, rows = Math.ceil(signs.length / columns);
  const cellWidth = 512, cellHeight = 116;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth; canvas.height = rows * cellHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const scale = 1; // positions and source descriptor sizes are already in metres
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
    const p = sign.source;
    const yaw = p.transform.rotationY;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const center = new THREE.Vector3(
      p.transform.position.x, p.transform.position.y - p.size.y / 2 + 4.8 * scale,
      p.transform.position.z).addScaledVector(forward, p.size.z / 2 + 0.93);
    const halfW = p.size.x * 0.42, halfH = Math.min(0.95, p.size.y * 0.085);
    for (const [u, v] of [[-1,-1],[1,-1],[1,1],[-1,1]] as const) {
      positions.push(center.x + right.x * u * halfW,
        center.y + v * halfH, center.z + right.z * u * halfW);
    }
    const left = col / columns, rightUv = (col + 1) / columns;
    const top = 1 - row / rows, bottom = 1 - (row + 1) / rows;
    uv.push(left,bottom, rightUv,bottom, rightUv,top, left,top);
    const start = i * 4;
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(geometry,
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  mesh.name = 'downtown-shop-signs';
  return mesh;
}

/** One vertex-coloured draw of alternating fabric panels and scalloped trim. */
export function stripedAwningGeometry(
  shops: readonly PropDescriptor[], island?: IslandData,
): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const pale = new THREE.Color(0xffefdc);
  const accents = [0xec799b, 0x70b5c0, 0xf4c756, 0x8773ba];
  function triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
    color: THREE.Color): void {
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    }
  }
  shops.forEach((shop, index) => {
    const yaw = shop.transform.rotationY;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const start = new THREE.Vector3(
      shop.transform.position.x,
      shop.transform.position.y - shop.size.y / 2 + 3.8,
      shop.transform.position.z).addScaledVector(forward, shop.size.z / 2 + 0.35);
    const stripe = shop.size.x * 0.85 / 12;
    const accent = new THREE.Color(accents[index % accents.length]!);
    function point(column: number, depth: number, height: number): THREE.Vector3 {
      return start.clone().addScaledVector(right,
        (column - 6) * stripe).addScaledVector(forward, depth)
        .add(new THREE.Vector3(0, height, 0));
    }
    for (let c = 0; c < 12; c++) {
      const color = c % 2 === 0 ? pale : accent;
      const a = point(c, 0, 0), b = point(c + 1, 0, 0);
      const d = point(c, 1.65, -0.55), e = point(c + 1, 1.65, -0.55);
      const f = point(c, 1.65, -0.83), g = point(c + 1, 1.65, -0.83);
      triangle(a, d, e, color); triangle(a, e, b, color);
      triangle(d, f, g, color); triangle(d, g, e, color);
    }
  });
  if (island) {
    const district = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const scale = island.size / 600;
    const flags = [0xf5c449, 0xf287a5, 0x6fc5df, 0x8ed17a, 0xb29de8];
    // Each imported lamp string carries a row of small painterly pennants.
    // They share the same single awning draw rather than N flag meshes.
    for (const dz of [-34, -14, 6, 21]) {
      const z = district.z + dz * scale;
      const y = gridSample(island, district.x, z) + 13.95 * scale;
      for (let i = 0; i < 22; i++) {
        const x = district.x + (i - 10.5) * 1.19 * scale;
        triangle(
          new THREE.Vector3(x - 0.52 * scale, y, z),
          new THREE.Vector3(x + 0.52 * scale, y, z),
          new THREE.Vector3(x, y - 0.85 * scale, z),
          new THREE.Color(flags[(i + Math.round(dz)) % flags.length < 0
            ? (i + Math.round(dz)) % flags.length + flags.length
            : (i + Math.round(dz)) % flags.length]!),
        );
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
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
        lanterns = lampModel ? createLanternLampInstances(
          visible.filter(p => p.model === 'lamp'), lampModel, island.size) : null;
        if (lanterns) group.add(lanterns.group);
        const ranges: BakedPlacement<DowntownModel>[] = [];
        const geometry = bakeLibraryGeometry(staticPlan, models,
          (placement, start, count) => ranges.push({ placement, start, count }));
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
        const stripes = stripedAwningGeometry(loadedShops.map(s => s.source), island);
        if (stripes.getAttribute('position').count) {
          const shade = new THREE.Mesh(stripes, new THREE.MeshToonMaterial({
            color: 0xffffff, vertexColors: true, gradientMap: TOON_RAMP,
            side: THREE.DoubleSide,
          }));
          shade.name = 'downtown-striped-awnings';
          shade.castShadow = false; shade.receiveShadow = true;
          group.add(shade);
        } else stripes.dispose();
        suppressOldArt(island, oldProps,
          lanterns ? visible : staticPlan, new Set(models.keys()),
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
