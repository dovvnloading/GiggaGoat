import type { IslandData, PoiId, PropDescriptor, PropKind, Vec2 } from './types';
import { SeededRandom } from './random';
import { downtownPublicSpaceAt, downtownPublicSpaces } from './downtown-public-space';
import { gridSample, MOUNTAIN_CAVE_ANCHOR, riverAt, segmentProjection, stampPlot } from './terrain';
import { getDamPlacement } from './the-dam';
import { HOOFINGTON_FIELD_ENTRANCES, HOOFINGTON_FIELD_RAILS,
  HOOFINGTON_HAUL_LANE, HOOFINGTON_YARD_ENTRANCES } from './hoofington-entrances';
import { roadSideOffset } from './roads';
import { damChannelAt } from './dam-landscape';
import { DOWNTOWN_ROOF_MOUNTS, downtownBuildingModel, isInsideDowntownInfillFootprint } from './visual-downtown';
import { CASCADE_NATIVE_SIZE, cascadePoolCentre, cascadeWaterLine, waterfallSites } from './visual-water';

// Extra art and physical scenery must not intersect the authored shop infills.
const INFILL_SCENERY_KINDS = new Set<PropKind>([
  'tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft',
  'planter', 'bench', 'sign', 'signboard',
]);

interface DetailOptions {
  yaw?: number;
  lift?: number;
  /** Absolute centre, useful for rooftop items and floating props. */
  y?: number;
  shape?: PropDescriptor['shape'];
  mass?: number;
  color?: number;
}

/**
 * Authored silhouettes and seeded clutter for the eight concept-art scenes.
 * Every entry, including small foliage, has a finite solid primitive collider.
 * Visual compound shapes are built from the same descriptors by the renderer.
 */
export function dressIsland(island: IslandData, rng: SeededRandom): PropDescriptor[] {
  const result: PropDescriptor[] = [];
  const scale = island.size / 600;
  const sites = new Map(island.pois.map(p => [p.id, p.center]));
  let serial = 0;
  function place(
    kind: PropKind, x: number, z: number, sx: number, sy: number, sz: number,
    poiId?: PoiId, options: DetailOptions = {},
  ): PropDescriptor {
    const size = { x: sx * scale, y: sy * scale, z: sz * scale };
    const base = gridSample(island, x, z);
    const y = options.y ?? base + size.y / 2 + (options.lift ?? 0) * scale;
    const body: PropDescriptor['body'] = options.mass === undefined
      ? { type: 'static' } : { type: 'dynamic', mass: options.mass };
    const nonInteractive = kind === 'fern' || kind === 'lily-pads' ||
      kind === 'cascade' || kind === 'cascade-tall';
    const prop: PropDescriptor = {
      id: 'detail-' + (poiId ?? 'island') + '-' + kind + '-' + serial++,
      kind, ...(poiId ? { poiId } : {}),
      transform: { position: { x, y, z }, rotationY: options.yaw ?? 0 },
      size, body, shape: options.shape ?? 'cuboid',
      collidable: !nonInteractive, breakable: options.mass !== undefined,
      lickable: !nonInteractive && kind !== 'flower' && kind !== 'grass-tuft',
      climbable: !nonInteractive && options.mass === undefined && sy > 1.5,
      ...(options.color === undefined ? {} : { color: options.color }),
    };
    if (!(INFILL_SCENERY_KINDS.has(kind) &&
      isInsideDowntownInfillFootprint(island, x, z))) result.push(prop);
    return prop;
  }
  function at(
    poiId: PoiId, kind: PropKind, dx: number, dz: number,
    sx: number, sy: number, sz: number, options: DetailOptions = {},
  ): PropDescriptor {
    const site = sites.get(poiId)!;
    return place(kind, site.x + dx * scale, site.z + dz * scale,
      sx, sy, sz, poiId, options);
  }
  const rand = (lo: number, hi: number): number => rng.range(lo, hi);
  const turn = (): number => rand(0, Math.PI * 2);

  // Hoofington: two sided village street, with front gardens and mailboxes.
  const farm: PoiId = 'hoofington';
  at(farm, 'silo', -32, -19.2, 7.5, 21, 7.5,
    { shape: 'cylinder', color: 0xe5d7ac });
  at(farm, 'house', 22, 29, 10, 8, 10,
    { yaw: -Math.PI / 2, color: 0xffecdb });
  at(farm, 'cottage', 29, -2, 9, 8, 8,
    { yaw: -Math.PI / 2, color: 0xc0d8ef });
  // Leave an aisle between the east pasture rails and the outdoor play pad.
  at(farm, 'trampoline', 41, 30, 8, 1.1, 7, { color: 0x7960d9 });
  // Street-level lamps frame the narrow roadway but do not encroach on it.
  // Their integral pennants also give Hoofington the orange farm banners.
  for (const side of [-1, 1]) for (const z of [-30, 0, 30]) {
    // In the middle east row, use the grass strip between the sidewalk and
    // the yard trampoline so its south corner stays open.
    const x = side > 0 && z === 0 ? 7.2 : side * 9.8;
    at(farm, 'lamp', x, z, 0.72, 7.8, 0.72,
      { shape: 'cylinder', yaw: side < 0 ? 0 : Math.PI });
  }
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -26 + Math.floor(i / 2) * 17.5;
    at(farm, 'mailbox', side * 8.1, z, 1.3, 2.2, 1,
      { yaw: -side * Math.PI / 2, color: i % 3 ? 0xd84f3d : 0x79add7 });
  }
  for (let i = 0; i < 13; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    at(farm, 'gnome', side * rand(16, 34), rand(-31, 34),
      0.5, 0.9, 0.5, { yaw: turn(), color: i % 2 ? 0xff891e : 0x7a4cff });
  }
  // The outer west rails clear the barn and silo foundations, and the shape
  // of the east run leaves room around the custom windmill.
  for (const rails of HOOFINGTON_FIELD_RAILS) for (const rail of rails) {
    at(farm, 'fence', rail.x, rail.z, rail.length, 1.85, .34,
      { yaw: Math.PI / 2, color: 0xeac995 });
  }

  for (let i = 0; i < 16; i++) {
    at(farm, 'hay-bale', rand(-45, -33), rand(4, 36), 2.1, 1.5, 2.1,
      { shape: 'cylinder', mass: 8, yaw: turn() });
  }
  // Dense planted borders occupy the lawn strips, not the paved roadway.
  for (const side of [-1, 1]) for (let i = 0; i < 13; i++) {
    const z = -34 + i * 5.5;
    const flowerX = side * 14.5 + rand(-0.6, 0.6) +
      (side < 0 ? i === 4 ? 0.12 : i === 8 ? 0.28 : 0 : 0);
    at(farm, 'flower', flowerX, z,
      0.9, 1.0 + rand(0, 0.45), 0.9,
      { yaw: turn(), color: i % 2 ? 0xffd833 : 0xf2777f });
    if (i % 2 === 0) {
      // Nudge only garden shrubs that would sit inside a nearby house.
      const bushX = side * 17 + (side < 0
        ? i === 4 ? 2.9 : i === 8 ? 2.4 : 0
        : i === 2 ? -1.9 : i === 8 ? -0.45 : i === 12 ? -0.9 : 0);
      at(farm, 'bush', bushX, z + 2,
        1.7, 1.4, 1.8, { color: 0x79b958 });
    }
  }
  for (const side of [-1, 1]) for (const z of [-25, 9, 30]) {
    at(farm, 'planter', side * 12.7, z, 1.8, 1.4, 1.8,
      { shape: 'cylinder' });
  }
  at(farm, 'bench', -14, 34, 2.0, 0.95, 0.75,
    { yaw: Math.PI / 2, color: 0x9d6f57 });

  // The main road is 6.8 m wide and the POI access roads bend around the
  // farm. Procedural foliage must not be allowed to grow through either road
  // or the village buildings. Find the first clear nearby spot, without
  // switching sides of the street or consuming additional RNG draws.
  interface Footprint { x: number; z: number; sx: number; sz: number; yaw: number }
  function footprintOverlaps(a: Footprint, b: Footprint): boolean {
    const corners = (f: Footprint): Array<{ x: number; z: number }> => {
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
      const points: Array<{ x: number; z: number }> = [];
      for (const x of [-f.sx / 2, f.sx / 2])
        for (const z of [-f.sz / 2, f.sz / 2])
          points.push({ x: f.x + c * x + s * z, z: f.z - s * x + c * z });
      return points;
    };
    const ac = corners(a), bc = corners(b);
    for (const angle of [a.yaw, b.yaw]) {
      const c = Math.cos(angle), s = Math.sin(angle);
      for (const axis of [{ x: c, z: -s }, { x: s, z: c }]) {
        const project = (p: { x: number; z: number }): number =>
          p.x * axis.x + p.z * axis.z;
        const av = ac.map(project), bv = bc.map(project);
        if (Math.max(...av) <= Math.min(...bv) + 1e-5 ||
            Math.max(...bv) <= Math.min(...av) + 1e-5) return false;
      }
    }
    return true;
  }
  const farmCenter = sites.get(farm)!;
  const farmEntrances: Footprint[] = [...HOOFINGTON_FIELD_ENTRANCES, ...HOOFINGTON_YARD_ENTRANCES, HOOFINGTON_HAUL_LANE]
    .map(p => ({ x: farmCenter.x + p.x * scale, z: farmCenter.z + p.z * scale,
      sx: (p.length + ('towing' in p && p.towing ? 2.3 : 1.5)) * scale,
      sz: p.width * scale, yaw: 0 }));
  const inFarmEntrance = (x: number, z: number, width: number, yaw: number): boolean =>
    farmEntrances.some(gate => Math.abs(x - gate.x) < gate.sx / 2 + width &&
      Math.abs(z - gate.z) < gate.sz / 2 + width &&
      footprintOverlaps({ x, z, sx: width, sz: width, yaw }, gate));
  const hoofRoads: Footprint[] = [{
    x: farmCenter.x, z: farmCenter.z, sx: 6.8 * scale, sz: 84 * scale, yaw: 0,
  }];
  for (const road of island.roads) {
    if (road.type !== 'road' || (road.from !== farm && road.to !== farm)) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
      if (distance < 1e-6) continue;
      hoofRoads.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
        sx: road.width, sz: distance, yaw: Math.atan2(dx, dz) });
    }
  }
  function clearHoofingtonFoliage(
    x: number, z: number, width: number, yaw: number, source?: PropDescriptor,
  ): { x: number; z: number } {
    const blocksEntrance = inFarmEntrance(x, z, width, yaw);
    const occupied = [...island.props, ...result]
      .filter(p => p !== source && p.poiId === farm &&
        (['barn', 'house', 'cottage', 'silo', 'windmill'].includes(p.kind) ||
          p.id.startsWith('hoofington-verge-') || (blocksEntrance &&
            ['fence', 'flower', 'bush', 'tree-pine', 'tree-oak'].includes(p.kind))))
      .map(p => ({ x: p.transform.position.x, z: p.transform.position.z,
        sx: p.size.x, sz: p.size.z, yaw: p.transform.rotationY }));
    const free = (px: number, pz: number): boolean => {
      const f = { x: px, z: pz, sx: width, sz: width, yaw };
      return !inFarmEntrance(px, pz, width, yaw) &&
        !occupied.some(b => footprintOverlaps(f, b)) &&
        !hoofRoads.some(r => footprintOverlaps(f, r));
    };
    if (free(x, z)) return { x, z };
    const side = Math.sign(x - farmCenter.x);
    for (let step = 1; step <= 100; step++) {
      const radius = step * 0.12 * scale;
      for (let j = 0; j < 36; j++) {
        const angle = j * Math.PI / 18;
        const nx = x + Math.cos(angle) * radius;
        const nz = z + Math.sin(angle) * radius;
        if (side && Math.sign(nx - farmCenter.x) !== side) continue;
        if (Math.hypot(nx - farmCenter.x, nz - farmCenter.z) > 55 * scale) continue;
        if (free(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x, z }; // An unresolvable layout must fail the regression test.
  }

  // Garden groups were placed before the two fence runs were available.
  // Pull back only planting that closes an intended gap.
  for (const prop of result) {
    if (prop.poiId !== farm || (prop.kind !== 'flower' && prop.kind !== 'bush')) continue;
    const { position, rotationY } = prop.transform;
    const width = Math.max(prop.size.x, prop.size.z);
    if (!inFarmEntrance(position.x, position.z, width, rotationY)) continue;
    const next = clearHoofingtonFoliage(position.x, position.z, width, rotationY, prop);
    position.x = next.x;
    position.z = next.z;
    position.y = gridSample(island, next.x, next.z) + prop.size.y / 2;
  }

  // Floating buoys outline the pier and the surf. The kiosks, pennants and
  // benches are built by buildBaaardwalk at deck height, never on sand.
  const beach: PoiId = 'baa-ardwalk';
  const surf = sites.get(beach)!;
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const x = surf.x + Math.sin(a) * 35 * scale;
    const z = surf.z + (61 + Math.cos(a) * 27) * scale;
    place('buoy', x, z, 1.0, 1.8, 1.0, beach,
      { y: 0.55 * scale, mass: 4, shape: 'cylinder', color: i % 2 ? 0xff891e : 0xf6f2e8 });
  }

  // Downtown: storefront trim and signs follow each building's facade normal
  // (local +Z), not a fixed world +Z direction. The +/- X-facing rows now
  // display their shop fronts to pedestrians in the central street.
  const city: PoiId = 'downtown-bleatsville';
  const cityCenter = sites.get(city)!;
  // The five infills already carry shop windows/signs in their authored GLBs.
  // Keep the original 10 shops + 6 rear houses as the only facade decorators.
  const buildings = island.props.filter(p => p.poiId === city &&
    (p.kind === 'shop' || (p.kind === 'house' &&
      Math.abs(p.transform.position.x - cityCenter.x) >= 30 * scale)));
  const placeRoofEquipment = (roof: PropDescriptor, kind: 'ac-unit' | 'water-tower',
    mount: PropDescriptor['transform']['position']): void => {
    const { position, rotationY } = roof.transform;
    const width = kind === 'water-tower' ? 3.5 : 1.2;
    const depth = kind === 'water-tower' ? width : 1;
    const height = kind === 'water-tower' ? 5.6 : 1;
    const c = Math.cos(rotationY), s = Math.sin(rotationY);
    place(kind, position.x + (c * mount.x + s * mount.z) * scale,
      position.z + (-s * mount.x + c * mount.z) * scale, width, height, depth, city, {
        // Authored props are fitted to 98% vertically about the descriptor centre.
        yaw: rotationY, y: position.y + (mount.y + height * .49) * scale,
        ...(kind === 'water-tower' ? { shape: 'cylinder' as const } : { color: 0xc0cbd0 }),
      });
  };
  const rearLavenderRoofs = buildings.filter(building => building.kind === 'house' &&
    downtownBuildingModel(building, cityCenter, scale) === 'kayHouse');
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i]!;
    const x = building.transform.position.x;
    const z = building.transform.position.z;
    const yaw = building.transform.rotationY;
    const frontX = Math.sin(yaw), frontZ = Math.cos(yaw);
    const top = building.transform.position.y + building.size.y / 2;
    const facade = building.size.z / 2;
    place('awning', x + frontX * (facade + 1.0 * scale),
      z + frontZ * (facade + 1.0 * scale),
      10, 0.9, 2.6, city, {
        yaw, y: top - 3.0 * scale,
        color: [0xf2777f, 0xffd866, 0x69c6d8][i % 3],
      });
    // Rear houses have no parapet advertising; retain shop name boards only.
    if (building.kind === 'shop') {
      place('signboard', x + frontX * (facade + 0.35 * scale),
        z + frontZ * (facade + 0.35 * scale),
        7, 2.5, 0.45, city, {
          yaw, y: top - 1.6 * scale, color: 0xffe6a2,
        });
    }
    const roofModel = downtownBuildingModel(building, cityCenter, scale);
    if (roofModel === 'highrise') continue;
    const roofMounts = DOWNTOWN_ROOF_MOUNTS[roofModel];
    placeRoofEquipment(building, 'ac-unit', roofMounts.ac);
    if (i % 4 === 0) {
      // The tall pink house's stepped roof cannot support all four tank feet.
      // Its nearest rear neighbour on the same side has a flat timber-tank site.
      const tankRoof = roofModel === 'brickHouse'
        ? rearLavenderRoofs.find(roof =>
          (roof.transform.position.x < cityCenter.x) === (x < cityCenter.x))!
        : building;
      const tankMount = roofModel === 'brickHouse' ? DOWNTOWN_ROOF_MOUNTS.kayHouse.tank! : roofMounts.tank!;
      placeRoofEquipment(tankRoof, 'water-tower', tankMount);
    }
  }
  // The original fountain now anchors a corner court beside the north approach.
  at(city, 'fountain', -19.2, -52, 10, 2.3, 10,
    { shape: 'cylinder', color: 0x8bc5d4 });
  for (let i = 0; i < 20; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -36 + Math.floor(i / 2) * 8;
    at(city, 'planter', side * 12.1, z, 1.6, 1.1, 1.6,
      { shape: 'cylinder', color: 0xc3916d });
    if (i % 2 === 0) {
      at(city, 'flower', side * 13.1, z + 3, 0.8, 1.1, 0.8,
        { color: 0xf2777f });
    }
  }
  // Between the 8 m planter rows: keep benches on their existing pavement side.
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? -1 : 1;
    at(city, 'bench', side * 12.7, -32 + i * 8,
      2.0, 0.95, 0.75, { yaw: Math.PI / 2, color: 0x9d6f57 });
  }
  for (const dz of [-12, 8]) for (const dx of [-46, -32]) {
    at(city, 'planter', dx, dz, 1.6, 1.1, 1.6,
      { shape: 'cylinder', color: 0xc3916d });
  }

  // Whispering Pines: logs and stones straddle the river; fungi guide the lookout.
  const forest: PoiId = 'whispering-pines';
  const woods = sites.get(forest)!;
  const lookoutZ = woods.z - 19 * scale;
  const clearOfRiver = (dx: number): boolean => {
    const x = woods.x + dx * scale;
    const river = riverAt({ x, z: lookoutZ }, island.river);
    return river.distance > river.width / 2 + 8 * scale &&
      gridSample(island, x, lookoutZ) > island.seaLevel;
  };
  // First search the requested 24..54 m corridor, at 2 m intervals.
  const requested = Array.from({ length: 16 }, (_, i) => 24 + i * 2);
  // At several seed sites even 54 m is still within the river margin.
  // Continue east only if none of the requested offsets is dry and clear.
  const additional = Array.from({ length: 8 }, (_, i) => 56 + i * 2);
  // Rare terrain seeds can exhaust the dry search corridor. Keep dressing
  // best-effort rather than failing the whole island.
  const lookoutDx = requested.find(clearOfRiver) ?? additional.find(clearOfRiver) ?? 70;
  const lookout = at(forest, 'lookout', lookoutDx, -19, 9, 24, 9,
    { color: 0x8c6648 });
  // The 24 m authored lookout GLB already has four supporting legs, X braces
  // and a ladder under its 17.5 m deck. Do not overlap them with deck-stilts.
  at(forest, 'platform', lookoutDx, -19, 11, 1.1, 11,
    { lift: 16.4, color: 0xad835d });

  // Bridge the closest river waypoint clear of the lookout by 15 metres.
  // Local +Z is perpendicular to the flow and spans the two banks.
  const riverCrossing = island.river
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => Math.hypot(
      point.x - lookout.transform.position.x,
      point.z - lookout.transform.position.z) >= 15 * scale)
    .sort((a, b) => Math.hypot(a.point.x - woods.x, a.point.z - woods.z) -
      Math.hypot(b.point.x - woods.x, b.point.z - woods.z))[0]!;
  const { point: crossing, index: crossingIndex } = riverCrossing;
  const upstream = island.river[Math.max(0, crossingIndex - 1)]!;
  const downstream = island.river[Math.min(island.river.length - 1, crossingIndex + 1)]!;
  const directionX = downstream.x - upstream.x;
  const directionZ = downstream.z - upstream.z;
  const length = Math.hypot(directionX, directionZ);
  const acrossX = -directionZ / length, acrossZ = directionX / length;
  const bankOffset = crossing.width / 2 + 2 * scale;
  const bankA = gridSample(island, crossing.x + acrossX * bankOffset,
    crossing.z + acrossZ * bankOffset);
  const bankB = gridSample(island, crossing.x - acrossX * bankOffset,
    crossing.z - acrossZ * bankOffset);
  const bridgeHeight = 2.6 * scale;
  place('log-bridge', crossing.x, crossing.z,
    3, 2.6, crossing.width / scale + 6, forest, {
      yaw: Math.atan2(acrossX, acrossZ), shape: 'cuboid',
      y: Math.min(bankA, bankB) - 0.3 * scale + bridgeHeight / 2,
    });
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = (-111 - t * 46 + (i % 2 ? 3 : -3)) * scale;
    const z = (-164 - t * 18 + (i % 3 - 1) * 3) * scale;
    place('stepping-stone', x, z, 3.1, 1.35, 3, forest,
      { shape: 'convex', color: 0x9a9c9d });
  }
  let heroMushroomPlaced = false;
  for (let i = 0; i < 46; i++) {
    const a = turn(), r = Math.sqrt(rng.next()) * 65;
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    const site = sites.get(forest)!;
    const x = site.x + dx * scale, z = site.z + dz * scale;
    const water = riverAt({ x, z }, island.river);
    if (water.distance < water.width * 0.5 + 2 * scale ||
        gridSample(island, x, z) < 2 * scale) continue;
    // Keep the two historical RNG draws so all later authored detail stays put.
    rng.next();
    const sampledHeight = rand(0.4, 0.9);
    const height = heroMushroomPlaced ? sampledHeight : 1.4;
    // Native Kenney mushroom_red is 0.17 x 0.20 x 0.20 metres.
    place('mushroom', x, z, height * 0.85 / scale,
      height / scale, height / scale, forest,
      { color: heroMushroomPlaced ? 0xe77a63 : 0xffd269, yaw: turn() });
    heroMushroomPlaced = true;
  }
  if (!heroMushroomPlaced) {
    // Degenerate seeds still get exactly one hero without an exception.
    const fallback = new SeededRandom(String(island.seed) + ':pines-hero-mushroom');
    let x = woods.x, z = woods.z;
    for (let attempt = 0; attempt < 512; attempt++) {
      const angle = fallback.range(0, Math.PI * 2);
      const radius = Math.sqrt(fallback.next()) * 60;
      const px = woods.x + Math.cos(angle) * radius;
      const pz = woods.z + Math.sin(angle) * radius;
      const water = riverAt({ x: px, z: pz }, island.river);
      if (gridSample(island, px, pz) <= island.seaLevel ||
          water.distance <= water.width / 2 + 2) continue;
      x = px; z = pz; break;
    }
    place('mushroom', x, z, 1.4 * 0.85 / scale, 1.4 / scale,
      1.4 / scale, forest, { color: 0xffd269, yaw: fallback.range(0, Math.PI * 2) });
  }
  for (let i = 0; i < 14; i++) {
    at(forest, 'stump', rand(-50, 48), rand(-43, 48), 2.8, 2.2, 2.8,
      { shape: 'cylinder', color: 0x976744 });
  }

  // The authored log bridge needs an unobstructed walkable corridor. Re-home
  // only random logs/rocks and forest-detail stones/fungi which overlap its
  // footprint, without removing any prop, changing its dimensions or using RNG.
  // The crane/pier/other-district descriptors remain completely untouched.
  const logBridge = result.find(p => p.poiId === forest && p.kind === 'log-bridge')!;
  const forestProps = [...island.props, ...result].filter(p =>
    p.poiId === forest && p !== logBridge && p.collidable);
  const aabbHalf = (p: PropDescriptor): { x: number; z: number } => {
    const c = Math.abs(Math.cos(p.transform.rotationY));
    const s = Math.abs(Math.sin(p.transform.rotationY));
    return { x: (c * p.size.x + s * p.size.z) / 2,
      z: (s * p.size.x + c * p.size.z) / 2 };
  };
  const overlaps = (a: PropDescriptor, b: PropDescriptor): boolean => {
    const aa = aabbHalf(a), bb = aabbHalf(b);
    return Math.abs(a.transform.position.x - b.transform.position.x) <
        aa.x + bb.x - 1e-5 &&
      Math.abs(a.transform.position.z - b.transform.position.z) <
        aa.z + bb.z - 1e-5;
  };
  for (const prop of forestProps) {
    if (!overlaps(logBridge, prop)) continue;
    const original = { ...prop.transform.position };
    let cleared = false;
    // Slide along the river (perpendicular to the bridge), alternating banks.
    // Require dry terrain and another empty footprint for each relocated prop.
    for (let step = 1; step <= 48 && !cleared; step++) {
      for (const side of [1, -1]) {
        const offset = side * step * 2 * scale;
        const x = original.x + directionX / length * offset;
        const z = original.z + directionZ / length * offset;
        const h = gridSample(island, x, z);
        if (h <= crossing.level + 0.3 * scale) continue;
        prop.transform.position.x = x;
        prop.transform.position.z = z;
        if (overlaps(logBridge, prop) ||
          forestProps.some(other => other !== prop && overlaps(prop, other))) continue;
        prop.transform.position.y = original.y + h -
          gridSample(island, original.x, original.z);
        cleared = true;
        break;
      }
    }
    if (!cleared) {
      prop.transform.position.x = original.x;
      prop.transform.position.z = original.z;
      // Preserve the original descriptor if no safe bank site exists: never
      // abort an otherwise valid seeded island over optional scenery.
    }
  }

  // The hero GLB handles the Dam itself. Keep its landscaped riverbanks
  // physically meaningful: low wildflowers, bushes, grass and climbable
  // stones use the same collidable prop descriptors as other districts.
  // A separate RNG leaves subsequent lighthouse/relic layouts untouched.
  const damOrigin = getDamPlacement(island).position;
  const damRng = new SeededRandom(String(island.seed) + ':dam-bank-details');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 27; i++) {
      const z = 13 + i * 3.25 + damRng.range(-0.7, 0.7);
      const section = damChannelAt(z);
      const x = section.x + side * (section.halfWidth + damRng.range(10, 18));
      const kind: PropKind = i % 7 === 0 ? 'rock' :
        i % 5 === 0 ? 'bush' : i % 3 === 0 ? 'grass-tuft' : 'flower';
      const sx = kind === 'rock' ? damRng.range(1.8, 3.7) :
        kind === 'bush' ? 1.8 : 0.9;
      const sy = kind === 'rock' ? damRng.range(1.4, 3.0) :
        kind === 'bush' ? 1.5 : 1.1;
      place(kind, damOrigin.x + x * scale, damOrigin.z + z * scale,
        sx, sy, sx, 'the-dam', {
          shape: kind === 'rock' ? 'convex' : 'cuboid',
          yaw: damRng.range(0, Math.PI * 2),
          color: kind === 'rock' ? 0x9da6a5 : kind === 'bush' ? 0x6fa75b :
            i % 2 ? 0xffda65 : 0xdca5ee,
        });
    }
  }
  // The retired fourteen crates/barrels consumed two main RNG samples each.
  for (let i = 0; i < 28; i++) rng.next();

  // Mt. Gigga: alternating green landings, a cave recess and climbable boulder stacks.
  const peak: PoiId = 'mt-gigga';
  for (let tier = 0; tier < 4; tier++) {
    const radius = 29 + tier * 18;
    for (let j = 0; j < 7; j++) {
      const a = (j + tier * 0.46) * Math.PI * 2 / 7;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      at(peak, 'ledge', x, z, 6.5, 1.3, 6.5, { yaw: a, color: 0x77b754 });
    }
  }
  // The fitted cave mesh spans 98% of its box. Align its floor with the landing.
  at(peak, 'cave-mouth', MOUNTAIN_CAVE_ANCHOR.x, MOUNTAIN_CAVE_ANCHOR.z,
    11, 8, 6, { lift: -.06, color: 0x555b6a });
  for (let i = 0; i < 20; i++) {
    const a = turn(), r = rand(42, 97);
    at(peak, 'rock', Math.cos(a) * r, Math.sin(a) * r, rand(2, 5), rand(2, 4.5), rand(2, 5),
      { shape: 'convex', color: 0x8c919e });
  }

  // Old Lighthouse: a beached hull in the left foreground, a cut-back
  // sea-cave entrance, and a walkable timber jetty reaching out on the right.
  const light: PoiId = 'old-lighthouse';
  at(light, 'shipwreck', -36, 7, 22, 8, 8.5,
    { yaw: 0.28, color: 0x936943 });
  at(light, 'cave-mouth', 2, 23, 9, 5.5, 5,
    { yaw: -0.9, color: 0x8e9299 });
  for (const [dx, dz] of [[19, 24], [25, 29], [31, 34]] as const) {
    // Descriptors are the real planked deck collision surfaces; custom meshes
    // and a library GLB provide the visible boards, piles and lanterns.
    at(light, 'dock', dx, dz, 8, 1.6, 8,
      { y: 2.1 * scale, color: 0xa17654 });
  }
  at(light, 'crate', 33, 33, 1.8, 1.8, 1.8,
    { y: 3.6 * scale, color: 0xb88b58 });
  at(light, 'barrel', 27, 29, 1.6, 2, 1.6,
    { y: 3.7 * scale, color: 0xc08a55 });
  for (let i = 0; i < 13; i++) {
    const a = turn(), r = rand(12, 30);
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    if (Math.hypot(dx - 2, dz - 23) < 8) continue;
    // Keep every size draw, including odd slots that no longer place a rock.
    const sx = rand(1.8, 4.4), sy = rand(1.5, 4), sz = rand(2, 4.6);
    if (i % 2 === 0) at(light, 'rock', dx, dz,
      sx * 0.6, sy * 0.6, sz * 0.6, { yaw: a, shape: 'convex' });
  }
  const bridge = island.roads.find(r => r.to === light || r.from === light);
  if (bridge) {
    for (let i = 0; i < bridge.points.length; i += 2) {
      const p = bridge.points[i]!;
      if (!p.bridge) continue;
      const side = roadSideOffset(bridge, i, bridge.width * 0.5 + 0.3 * scale);
      for (const sign of [-1, 1]) {
        place('rope-rail', p.x + sign * side.x, p.z + sign * side.z,
          0.35, 3, 0.35, light, { y: p.y + 1.1 * scale, color: 0x996b49 });
      }
    }
  }

  // Keep scenery scatter off the physical Baa-ardwalk pier and terminal deck.
  // Check rotated descriptor footprints; no collision sizes or deck data change.
  const boardwalkDecks = island.props.filter(p => p.poiId === beach &&
    (p.kind === 'pier' || p.kind === 'deck'));
  const onBoardwalkDeck = (x: number, z: number): boolean =>
    boardwalkDecks.some(deck => {
      const dx = x - deck.transform.position.x;
      const dz = z - deck.transform.position.z;
      const c = Math.cos(deck.transform.rotationY);
      const s = Math.sin(deck.transform.rotationY);
      return Math.abs(dx * c - dz * s) <= deck.size.x / 2 &&
        Math.abs(dx * s + dz * c) <= deck.size.z / 2;
    });

  // One metre beyond the authored Crane Yard fence on all four sides.
  // This is a scenery-only exclusion; the yard layout is not modified.
  const craneYard = sites.get('crane-yard')!;
  const inCraneYard = (x: number, z: number): boolean =>
    Math.abs(x - craneYard.x) <= 41 * scale &&
    Math.abs(z - craneYard.z) <= 37 * scale;

  // Seeded hedges, trees, flowers and windblown grass: consistent density, clear paths.
  const vegetationCount = Math.max(160, Math.round(440 * scale));
  const publicGround = downtownPublicSpaces(island);
  for (let attempt = 0, accepted = 0; attempt < vegetationCount * 8 &&
      accepted < vegetationCount; attempt++) {
    const angle = turn();
    const radius = Math.sqrt(rng.next()) * 273 * scale;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const h = gridSample(island, x, z);
    if (h < 3.4 * scale || h > 35 * scale || radius < 103 * scale) continue;
    const water = riverAt({ x, z }, island.river);
    if (water.distance < water.width * 0.5 + 4 * scale) continue;
    if (island.roads.some(road => road.points.some((p, i) =>
      i % 4 === 0 && Math.hypot(x - p.x, z - p.z) < road.width * 0.6 + 4 * scale))) continue;
    const near = island.pois.find(p =>
      Math.hypot(x - p.center.x, z - p.center.z) < p.radius * 1.25);
    const denseWoods = Math.hypot(x + 147 * scale, z + 143 * scale) < 100 * scale;
    const chance = rng.next();
    const kind: PropKind = denseWoods && chance < 0.5 ? 'tree-pine'
      : chance < 0.18 ? 'tree-oak' : chance < 0.42 ? 'bush'
      : chance < 0.69 ? 'flower' : 'grass-tuft';
    const height = kind === 'tree-pine' ? rand(9, 19)
      : kind === 'tree-oak' ? rand(8, 14)
      : kind === 'bush' ? rand(1.8, 4)
      : kind === 'flower' ? rand(0.8, 1.5) : rand(0.7, 1.35);
    const width = kind === 'tree-oak' ? height * 0.72
      : kind === 'tree-pine' ? height * 0.35
      : kind === 'bush' ? height * 1.25
      : kind === 'flower' ? height * 0.9 : height * 0.55;
    const yaw = turn();
    const foliageWidth = width * scale;
    const blocksEntrance = inFarmEntrance(x, z, foliageWidth, yaw);
    const position = blocksEntrance || (near?.id === farm &&
      (kind === 'flower' || kind === 'bush' || kind.startsWith('tree-')))
      ? clearHoofingtonFoliage(x, z, foliageWidth, yaw) : { x, z };
    if (onBoardwalkDeck(position.x, position.z) ||
        inCraneYard(position.x, position.z) ||
        isInsideDowntownInfillFootprint(island, position.x, position.z)) continue;
    const detail = place(kind, position.x, position.z, width, height, width, near?.id,
      { shape: 'cylinder', yaw });
    // Keep public paths open while preserving seeded foliage draws and prop IDs.
    if (result.at(-1) === detail &&
        (downtownPublicSpaceAt(publicGround, position.x, position.z, foliageWidth * .55) ||
          inFarmEntrance(position.x, position.z, foliageWidth, yaw))) result.pop();
    accepted++;
  }
  const nearbyFoliageSpot = (origin: Vec2, clear: (x: number, z: number) => boolean,
    limit = 24): Vec2 | undefined => {
    for (let distance = 1; distance <= limit; distance++) {
      for (let side = 0; side < 16; side++) {
        const angle = side * Math.PI / 8;
        const x = origin.x + Math.cos(angle) * distance * scale;
        const z = origin.z + Math.sin(angle) * distance * scale;
        if (clear(x, z)) return { x, z };
      }
    }
    return undefined;
  };

  // The authored control-house pier extends beyond the basic Dam wall
  // collider. Its foliage-free footprint keeps full oak crowns off the face.
  const damPier: Footprint = {
    x: damOrigin.x + 36 * scale, z: damOrigin.z - 1.5 * scale,
    sx: 11 * scale, sz: 8 * scale, yaw: 0,
  };
  const damBankProps = [...island.props, ...result];
  for (const tree of result.filter(prop =>
    prop.kind === 'tree-oak' || prop.kind === 'tree-pine' || prop.kind === 'bush')) {
    const { position, rotationY } = tree.transform;
    const footprint = { x: position.x, z: position.z, sx: tree.size.x, sz: tree.size.z, yaw: rotationY };
    if (!footprintOverlaps(footprint, damPier)) continue;
    const bank = nearbyFoliageSpot(position, (x, z) => {
      if (x < damOrigin.x + 45 * scale || z < damOrigin.z + 11 * scale ||
          gridSample(island, x, z) <= island.seaLevel + 1.2 * scale) return false;
      if (island.roads.some(road => road.points.some((b, i) => i > 0 &&
        segmentProjection({ x, z }, road.points[i - 1]!, b).distance <
          road.width / 2 + tree.size.x / 2))) return false;
      return !damBankProps.some(prop => prop !== tree && prop.collidable &&
        footprintOverlaps({ ...footprint, x, z }, {
          x: prop.transform.position.x, z: prop.transform.position.z,
          sx: prop.size.x, sz: prop.size.z, yaw: prop.transform.rotationY,
        }));
    }, 40);
    if (bank) {
      Object.assign(position, bank, { y: gridSample(island, bank.x, bank.z) + tree.size.y / 2 });
    } else {
      result.splice(result.indexOf(tree), 1);
    }
  }

  // MG-7: Populate the grassy mountain tiers with the same low-poly foliage
  // family used in Whispering Pines. Run after island-wide scenery so that
  // existing authored placements and their RNG sequence stay unchanged.
  const summit = sites.get(peak)!;
  const slopeStep = 1.5 * scale;
  const mountainSlope = (x: number, z: number): number => Math.hypot(
    (gridSample(island, x + slopeStep, z) -
      gridSample(island, x - slopeStep, z)) / (2 * slopeStep),
    (gridSample(island, x, z + slopeStep) -
      gridSample(island, x, z - slopeStep)) / (2 * slopeStep),
  );
  const mountainRoadPoints = island.roads.flatMap(road => road.points.filter(point =>
    Math.hypot(point.x - summit.x, point.z - summit.z) < 110 * scale));
  // Snapshot only the pre-existing mountain props; don't impose the same
  // five-metre exclusion between the 100 newly planted foliage descriptors.
  const mountainProps = [...island.props, ...result]
    .filter(prop => prop.poiId === peak).map(prop => prop.transform.position);
  const clearance = 5 * scale;
  // These radial ranges cover the flat summit-side benches between risers.
  const tierBands = [[22, 38], [45, 56], [63, 74], [81, 100]] as const;
  for (const [kind, wanted] of [['tree-pine', 70], ['bush', 30]] as const) {
    let accepted = 0;
    for (let attempt = 0; attempt < 30_000 && accepted < wanted; attempt++) {
      const [inner, outer] = tierBands[attempt % tierBands.length]!;
      const radius = Math.sqrt(rand(inner * inner, outer * outer)) * scale;
      const angle = turn();
      const x = summit.x + Math.cos(angle) * radius;
      const z = summit.z + Math.sin(angle) * radius;
      if (mountainSlope(x, z) >= 0.5) continue;
      if (mountainRoadPoints.some(p => Math.hypot(x - p.x, z - p.z) < clearance))
        continue;
      if (mountainProps.some(p => Math.hypot(x - p.x, z - p.z) < clearance))
        continue;
      const height = kind === 'tree-pine' ? rand(6, 10) : rand(1.6, 2.4);
      const width = height * (kind === 'tree-pine' ? 0.35 : 1.25);
      place(kind, x, z, width, height, width, peak,
        { shape: 'cylinder', yaw: turn() });
      accepted++;
    }
    // On unusually dense seeds, retain every safe candidate rather than throw.
  }

  // Shift tier pines off the upstream ribbon visible from the Pines glade.
  // Fit a dry bank after sampling so subsequent seeded placements stay stable.
  const upstreamWater = island.river.slice(0, 5);
  const tierPines = result.filter(prop => prop.poiId === peak && prop.kind === 'tree-pine');
  for (const tree of tierPines) {
    const { position } = tree.transform;
    const trunkRadius = Math.min(.9, tree.size.x * .2);
    const offStream = (x: number, z: number): boolean => {
      const water = riverAt({ x, z }, upstreamWater);
      return water.distance >= water.width / 2 + trunkRadius + .75 * scale;
    };
    if (offStream(position.x, position.z)) continue;
    const dryBank = nearbyFoliageSpot(position, (x, z) => {
      const radius = Math.hypot(x - summit.x, z - summit.z) / scale;
      return tierBands.some(([inner, outer]) => radius >= inner && radius <= outer) &&
        offStream(x, z) && gridSample(island, x, z) > island.seaLevel &&
        mountainSlope(x, z) < .5 &&
        !mountainRoadPoints.some(point => Math.hypot(x - point.x, z - point.z) < clearance) &&
        !mountainProps.some(point => Math.hypot(x - point.x, z - point.z) < clearance) &&
        !tierPines.some(other => other !== tree &&
          Math.hypot(x - other.transform.position.x, z - other.transform.position.z) < 2 * scale);
    }, 48);
    if (dryBank) {
      Object.assign(position, dryBank, { y: gridSample(island, dryBank.x, dryBank.z) + tree.size.y / 2 });
    } else {
      result.splice(result.indexOf(tree), 1);
    }
  }

  // Whispering Pines glade: independent seeded streams keep all legacy
  // districts, relics and hero descriptor positions unchanged.
  const gladeBridge = result.find(p => p.poiId === forest && p.kind === 'log-bridge');
  const gladeAnchor = gladeBridge?.transform.position ?? woods;
  const lilyRng = new SeededRandom(String(island.seed) + ':pines-lily-pads');
  const riverSegments = island.river.slice(0, -1)
    .map((start, i) => ({ start, end: island.river[i + 1]! }))
    .filter(({ start, end }) =>
      segmentProjection(gladeAnchor, start, end).distance <= 25);
  const lilyPads: PropDescriptor[] = [];
  for (let attempt = 0; attempt < 2000 && lilyPads.length < 10 &&
      riverSegments.length > 0; attempt++) {
    const { start, end } = riverSegments[lilyRng.int(0, riverSegments.length)]!;
    const t = lilyRng.next();
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const cx = start.x + dx * t, cz = start.z + dz * t;
    const halfWidth = (start.width + (end.width - start.width) * t) / 2;
    const side = lilyRng.next() < 0.5 ? -1 : 1;
    const offset = side * halfWidth * lilyRng.range(0.25, 0.45);
    const x = cx - dz / length * offset;
    const z = cz + dx / length * offset;
    const fromBridge = Math.hypot(x - gladeAnchor.x, z - gladeAnchor.z);
    if (fromBridge > 25 || (gladeBridge && fromBridge < 3.5)) continue;
    const water = riverAt({ x, z }, island.river);
    const fraction = water.distance / (water.width / 2);
    if (fraction < 0.25 || fraction > 0.45) continue;
    if (lilyPads.some(p => Math.hypot(x - p.transform.position.x,
      z - p.transform.position.z) < 1.4)) continue;
    const width = lilyRng.range(1.2, 1.6);
    lilyPads.push(place('lily-pads', x, z, width / scale, 0.08 / scale,
      width / scale, forest, { y: water.level + 0.02,
        yaw: lilyRng.range(0, Math.PI * 2) }));
  }

  const fernRng = new SeededRandom(String(island.seed) + ':pines-ferns');
  const bridgeIndex = island.river.findIndex(p =>
    Math.hypot(p.x - gladeAnchor.x, p.z - gladeAnchor.z) < 1e-5);
  const gladeUpstream = island.river[Math.max(0, bridgeIndex - 1)];
  const gladeDownstream = island.river[Math.min(island.river.length - 1, bridgeIndex + 1)];
  const run = gladeUpstream && gladeDownstream ?
    Math.hypot(gladeUpstream.x - gladeDownstream.x,
      gladeUpstream.z - gladeDownstream.z) : 0;
  const upstreamX = run > 1e-6 ? (gladeUpstream!.x - gladeDownstream!.x) / run : 0;
  const upstreamZ = run > 1e-6 ? (gladeUpstream!.z - gladeDownstream!.z) / run : 0;
  const otherProps = [...island.props, ...result];
  let fernCount = 0;
  for (let attempt = 0; attempt < 5000 && fernCount < 40; attempt++) {
    let x: number, z: number;
    if (gladeBridge && run > 1e-6 && attempt < 2500) {
      // First try the dry banks in the log-bridge view, then the full POI.
      const along = fernRng.range(-5, 30);
      const cx = gladeAnchor.x + upstreamX * along;
      const cz = gladeAnchor.z + upstreamZ * along;
      const water = riverAt({ x: cx, z: cz }, island.river);
      const side = fernRng.next() < 0.5 ? -1 : 1;
      const offset = side * (water.width / 2 + fernRng.range(2, 14));
      x = cx - upstreamZ * offset;
      z = cz + upstreamX * offset;
    } else {
      const angle = fernRng.range(0, Math.PI * 2);
      const radius = Math.sqrt(fernRng.next()) * 60;
      x = woods.x + Math.cos(angle) * radius;
      z = woods.z + Math.sin(angle) * radius;
    }
    if (Math.hypot(x - woods.x, z - woods.z) > 60 ||
        gridSample(island, x, z) <= island.seaLevel) continue;
    const water = riverAt({ x, z }, island.river);
    if (water.distance <= water.width / 2 + 1.5) continue;
    if (otherProps.some(p => Math.hypot(x - p.transform.position.x,
      z - p.transform.position.z) < 1.5)) continue;
    const width = fernRng.range(1.2, 1.9);
    const fern = place('fern', x, z, width / scale, width * 0.55 / scale,
      width / scale, forest, { yaw: fernRng.range(0, Math.PI * 2) });
    otherProps.push(fern);
    fernCount++;
  }

  // Move intersecting low Pines foliage onto dry shoulders while keeping its
  // original dimensions, colors and seeded IDs.
  const pinesPavement = island.roads.filter(road => road.type === 'road' &&
    (road.from === forest || road.to === forest));
  const clearsPinesPavement = (x: number, z: number, radius: number): boolean =>
    !pinesPavement.some(road => road.points.some((b, i) => i > 0 &&
      segmentProjection({ x, z }, road.points[i - 1]!, b).distance <
        road.width / 2 + radius + .35 * scale));
  const lowPinesDetails = new Set<PropKind>(['mushroom', 'stump', 'fern', 'bush', 'flower', 'grass-tuft']);
  const pinesObstacles = [...island.props, ...result];
  for (const prop of result.filter(prop => prop.poiId === forest && lowPinesDetails.has(prop.kind))) {
    const { position, rotationY } = prop.transform;
    const { x: sx, z: sz } = prop.size;
    const radius = Math.hypot(sx, sz) / 2;
    if (clearsPinesPavement(position.x, position.z, radius)) continue;
    const shoulder = nearbyFoliageSpot(position, (x, z) => {
      if (!clearsPinesPavement(x, z, radius)) return false;
      const river = riverAt({ x, z }, island.river);
      if (gridSample(island, x, z) <= island.seaLevel ||
        river.distance < river.width / 2 + radius + .5 * scale) return false;
      return !pinesObstacles.some(other => {
        if (other === prop) return false;
        const { x: ox, z: oz } = other.transform.position;
        const distance = Math.hypot(x - ox, z - oz);
        if ((other.kind === 'fern' || prop.kind === 'fern') && distance < 1.5) return true;
        return other.collidable && distance < radius + Math.hypot(other.size.x, other.size.z) / 2 &&
          footprintOverlaps({ x, z, sx, sz, yaw: rotationY }, {
            x: ox, z: oz, sx: other.size.x, sz: other.size.z, yaw: other.transform.rotationY,
          });
      });
    });
    if (shoulder) {
      position.y += gridSample(island, shoulder.x, shoulder.z) -
        gridSample(island, position.x, position.z);
      Object.assign(position, shoulder);
    } else {
      result.splice(result.indexOf(prop), 1);
    }
  }

  // MG-12: Profile the *chosen* model rather than forcing a long, flat
  // stepped mesh into a convex cliff. Reject buried water or a trail-side pool.
  // Site selection retains the complete pre-waterfall dressing snapshot.
  const trailPoints = island.roads.filter(road => road.type === 'trail')
    .flatMap(road => road.points);
  type CascadePlacement = Pick<PropDescriptor, 'size' | 'transform'>;
  const poolOffTrail = (placement: CascadePlacement): boolean => {
    const pool = cascadePoolCentre(placement, scale);
    return trailPoints.every(point => Math.hypot(pool.x - point.x, pool.z - point.z) >=
      placement.size.x / 2 + 1 * scale);
  };
  const exposedWater = (placement: CascadePlacement): boolean =>
    cascadeWaterLine(placement, scale).every(point =>
      gridSample(island, point.x, point.z) <= point.y + 0.2 * scale + 1e-6);

  for (const site of waterfallSites({ ...island, props: [...island.props, ...result] })) {
    const dx = site.bottom.x - site.top.x;
    const dz = site.bottom.z - site.top.z;
    const run = Math.hypot(dx, dz);
    if (run < 1e-6) continue;
    const drop = site.top.y - gridSample(island, site.bottom.x, site.bottom.z);
    const kind = drop / run > 1.2 ? 'cascade-tall' : 'cascade';
    const native = CASCADE_NATIVE_SIZE[kind];
    const clamp = (wanted: number, axis: 'x' | 'y' | 'z', minimum = 0.77): number =>
      Math.max(native[axis] * scale * minimum,
        Math.min(native[axis] * scale * 1.3, wanted));
    const size = {
      x: clamp(site.width * 1.6, 'x'),
      y: clamp(drop + 0.4 * scale, 'y', kind === 'cascade' ? 0.5 : 0.77),
      z: clamp(run + (kind === 'cascade-tall' ? 4 : 2) * scale, 'z'),
    };
    const yaw = Math.atan2(dx, dz);
    const forwardX = dx / run, forwardZ = dz / run;
    const initialX = (site.top.x + site.bottom.x) / 2;
    const initialZ = (site.top.z + site.bottom.z) / 2;
    for (let step = 0; step <= 8; step++) {
      const x = initialX + forwardX * step * 0.5 * scale;
      const z = initialZ + forwardZ * step * 0.5 * scale;
      // Place the base at the actual *model pool*, not the site's old
      // bottom or the centre of the descriptor box.
      const horizontal: CascadePlacement = {
        size, transform: { position: { x, y: 0, z }, rotationY: yaw },
      };
      const pool = cascadePoolCentre(horizontal, scale);
      const base = gridSample(island, pool.x, pool.z) - 0.2 * scale;
      horizontal.transform.position.y = base + size.y / 2;
      if (!exposedWater(horizontal)) continue;
      if (!poolOffTrail(horizontal)) break;
      const nearby = island.pois.reduce<{ id: PoiId; distance: number; radius: number } | undefined>(
        (best, poi) => {
          const distance = Math.hypot(x - poi.center.x, z - poi.center.z);
          return !best || distance < best.distance ?
            { id: poi.id, distance, radius: poi.radius } : best;
        }, undefined);
      const prop = place(kind, x, z, size.x / scale, size.y / scale, size.z / scale,
        nearby && nearby.distance <= nearby.radius * 1.8 ? nearby.id : undefined,
        { yaw, y: base + size.y / 2 });
      prop.id = 'waterfall-cascade-' + site.id;
      break;
    }
    // If no shift (up to 4 m scaled) clears all six points, do not create
    // either a buried cascade or stray foam on the trail.
  }

  // WP-4: Search a true six-metre terrain drop, not authored river water
  // levels. The bridge is a river waypoint; distance is measured upstream
  // along the polyline and interpolated across segment boundaries.
  // All clearances are footprint tests against *every* collidable descriptor.
  if (gladeBridge && crossingIndex > 0) {
    interface RiverSample { x: number; z: number; width: number }
    const upstreamAt = (distance: number): RiverSample | undefined => {
      let remaining = distance;
      for (let i = crossingIndex; i > 0; i--) {
        const from = island.river[i]!, to = island.river[i - 1]!;
        const run = Math.hypot(to.x - from.x, to.z - from.z);
        if (run < 1e-6) continue;
        if (remaining <= run) {
          const t = remaining / run;
          return {
            x: from.x + (to.x - from.x) * t,
            z: from.z + (to.z - from.z) * t,
            width: from.width + (to.width - from.width) * t,
          };
        }
        remaining -= run;
      }
      return undefined;
    };
    const bridgeFootprint: Footprint = {
      x: gladeBridge.transform.position.x, z: gladeBridge.transform.position.z,
      sx: gladeBridge.size.x + 16, sz: gladeBridge.size.z + 16,
      yaw: gladeBridge.transform.rotationY,
    };
    const occupied = [...island.props, ...result].filter(p => p.collidable);
    const free = (f: Footprint): boolean =>
      !footprintOverlaps(f, bridgeFootprint) &&
      !occupied.some(prop => footprintOverlaps(f, {
        x: prop.transform.position.x, z: prop.transform.position.z,
        sx: prop.size.x, sz: prop.size.z, yaw: prop.transform.rotationY,
      }));
    const size = {
      x: CASCADE_NATIVE_SIZE.cascade.x * scale,
      y: CASCADE_NATIVE_SIZE.cascade.y * scale,
      z: CASCADE_NATIVE_SIZE.cascade.z * scale,
    };
    type GladeRock = { id: string; x: number; z: number;
      sx: number; sy: number; sz: number; yaw: number };
    type GladeSite = { placement: CascadePlacement; drop: number;
      rocks: GladeRock[] };
    let best: GladeSite | undefined;
    // Search the same first 60 m and six-metre river reach as WP-4, but
    // anchor the *native* pool at the found downstream point. Its lip is
    // then approximately six metres upstream, over the built rock step.
    for (let fromBridge = 8; fromBridge + 6 <= 60; fromBridge += 0.5) {
      const bottom = upstreamAt(fromBridge);
      const top = upstreamAt(fromBridge + 6);
      if (!bottom || !top) break;
      const dx = bottom.x - top.x, dz = bottom.z - top.z;
      const run = Math.hypot(dx, dz);
      if (run < 1e-6) continue;
      const drop = gridSample(island, top.x, top.z) -
        gridSample(island, bottom.x, bottom.z);
      if (drop <= 0 || (best && drop <= best.drop)) continue;
      const yaw = Math.atan2(dx, dz);
      const forwardX = dx / run, forwardZ = dz / run;
      const acrossX = forwardZ, acrossZ = -forwardX;
      const x = bottom.x - forwardX * size.z * 0.25;
      const z = bottom.z - forwardZ * size.z * 0.25;
      const falls: Footprint = { x, z, sx: size.x, sz: size.z, yaw };
      if (!free(falls)) continue;
      const base = gridSample(island, bottom.x, bottom.z) - 0.2 * scale;
      const placement: CascadePlacement = {
        size, transform: { position: { x, y: base + size.y / 2, z }, rotationY: yaw },
      };
      if (!poolOffTrail(placement) || !exposedWater(placement)) continue;

      const rockSpecs = [
        { id: 'back', lx: 0, lz: -size.z / 2 - 1.5 * scale,
          sx: 6 * scale, sy: 7 * scale, sz: 5 * scale },
        { id: 'left', lx: -(size.x / 2 + 1.5 * scale), lz: -size.z / 4,
          sx: 5 * scale, sy: 6 * scale, sz: 5 * scale },
        { id: 'right', lx: size.x / 2 + 1.5 * scale, lz: -size.z / 4,
          sx: 5 * scale, sy: 6 * scale, sz: 4 * scale },
      ] as const;
      const rocks: GladeRock[] = [];
      for (const rock of rockSpecs) {
        const rx = x + acrossX * rock.lx + forwardX * rock.lz;
        const rz = z + acrossZ * rock.lx + forwardZ * rock.lz;
        const footprint: Footprint = {
          x: rx, z: rz, sx: rock.sx, sz: rock.sz, yaw,
        };
        // Existing colliders, the bridge/lookout, and earlier accepted rocks
        // always take precedence over this optional sculpted riser.
        if (!free(footprint) || rocks.some(other => footprintOverlaps(footprint, {
          x: other.x, z: other.z, sx: other.sx, sz: other.sz, yaw,
        }))) continue;
        rocks.push({ id: rock.id, x: rx, z: rz,
          sx: rock.sx, sy: rock.sy, sz: rock.sz, yaw });
      }
      best = { placement, drop, rocks };
    }
    if (best) {
      const { position, rotationY } = best.placement.transform;
      const fall = place('cascade', position.x, position.z,
        size.x / scale, size.y / scale, size.z / scale, forest,
        { yaw: rotationY, y: position.y });
      fall.id = 'whispering-pines-glade-cascade';
      for (const rock of best.rocks) {
        const step = place('rock', rock.x, rock.z,
          rock.sx / scale, rock.sy / scale, rock.sz / scale, forest,
          { yaw: rock.yaw, shape: 'convex' });
        step.id = 'whispering-pines-glade-lip-' + rock.id;
      }
    }
  }

  // generateIsland makes one more grading pass for the dressed farmhouse and
  // cottage *after* this function returns. Preview that pass on a height copy,
  // then anchor the Hoofington colliders to the final ground. This is only a
  // placement-Y correction: it neither changes terrain nor collider dimensions.
  const finalGround = {
    size: island.size, resolution: island.resolution, heights: island.heights.slice(),
  };
  for (const prop of result) {
    if (prop.poiId !== farm || prop.body.type !== 'static' ||
        !['barn', 'house', 'shop', 'booth', 'cottage', 'control-house'].includes(prop.kind))
      continue;
    stampPlot(finalGround, {
      poiId: farm,
      center: { x: prop.transform.position.x, z: prop.transform.position.z },
      elevation: prop.transform.position.y - prop.size.y / 2,
      radius: Math.hypot(prop.size.x, prop.size.z) / 2 + 5 * scale,
      flat: true,
    });
  }
  for (const prop of [...island.props, ...result]) {
    if (prop.poiId !== farm) continue;
    const p = prop.transform.position;
    const ground = gridSample(finalGround, p.x, p.z);
    const delta = p.y - prop.size.y / 2 - ground;
    if (delta > 0.05 || delta < -0.15) p.y = ground + prop.size.y / 2;
  }
  return result;
}
