import type { IslandData, PoiId, PropDescriptor, PropKind } from './types';
import { SeededRandom } from './random';
import { gridSample, riverAt } from './terrain';

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
    const prop: PropDescriptor = {
      id: 'detail-' + (poiId ?? 'island') + '-' + kind + '-' + serial++,
      kind, ...(poiId ? { poiId } : {}),
      transform: { position: { x, y, z }, rotationY: options.yaw ?? 0 },
      size, body, shape: options.shape ?? 'cuboid',
      collidable: true, breakable: options.mass !== undefined,
      lickable: kind !== 'flower' && kind !== 'grass-tuft',
      climbable: options.mass === undefined && sy > 1.5,
      ...(options.color === undefined ? {} : { color: options.color }),
    };
    result.push(prop);
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

  // Hoofington: clustered farm buildings, garden gnomes and touchable village clutter.
  const farm: PoiId = 'hoofington';
  at(farm, 'silo', -31, -20, 7.5, 21, 7.5, { shape: 'cylinder', color: 0xe5d7ac });
  at(farm, 'house', 5, 27, 10, 8, 10, { color: 0xf8e3c5 });
  at(farm, 'cottage', 28, -2, 9, 8, 8, { color: 0xc0d8ef });
  at(farm, 'trampoline', 12, 4, 8, 1.1, 7, { color: 0x7960d9 });
  for (let i = 0; i < 9; i++) {
    const edge = i % 2 ? 20 : -8;
    at(farm, 'mailbox', edge + i * 1.2, 26 - (i % 3) * 3, 1.3, 2.2, 1,
      { yaw: -0.35, color: i % 2 ? 0xd84f3d : 0x79add7 });
  }
  for (let i = 0; i < 11; i++) {
    at(farm, 'gnome', rand(-28, 30), rand(-26, 29), 0.85, 1.6, 0.85,
      { yaw: turn(), color: i % 2 ? 0xff891e : 0x7a4cff });
  }
  for (let i = 0; i < 15; i++) {
    at(farm, 'fence', -34 + (i % 5) * 8, -37 + Math.floor(i / 5) * 37,
      7, 2.1, 0.3, { yaw: (i % 3 === 0 ? Math.PI / 2 : 0), color: 0xeac995 });
  }
  for (let i = 0; i < 16; i++) {
    at(farm, 'hay-bale', rand(-37, -6), rand(12, 36), 2.1, 1.5, 2.1,
      { shape: 'cylinder', mass: 8, yaw: turn() });
  }

  // Baa-ardwalk: colourful shops, fluttering pennants, pier furniture and sea buoys.
  const beach: PoiId = 'baa-ardwalk';
  for (let i = 0; i < 5; i++) {
    at(beach, 'booth', -28 + i * 14, -22, 7.5, 6.5, 6.2,
      { color: [0xe66e9e, 0xffbd62, 0x8dd6d3, 0xabc2f5, 0xf27e70][i] });
    at(beach, 'awning', -28 + i * 14, -17.8, 8, 1, 3.2,
      { lift: 5.2, color: i % 2 ? 0xffd833 : 0xff6889 });
    at(beach, 'signboard', -28 + i * 14, -26.2, 5, 2.6, 0.35,
      { lift: 3, color: 0xf7db99 });
  }
  for (let i = 0; i < 20; i++) {
    at(beach, 'bunting', -34 + i * 3.7, -8 + Math.sin(i * 0.7) * 1.5,
      2.6, 1.3, 0.28, { lift: 9.5, color: [0xff688a, 0xffd833, 0x5ed1cb][i % 3] });
  }
  const surf = sites.get(beach)!;
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const x = surf.x + Math.sin(a) * 35 * scale;
    const z = surf.z + (61 + Math.cos(a) * 27) * scale;
    place('buoy', x, z, 1.9, 2.1, 1.9, beach,
      { y: 0.55 * scale, mass: 4, shape: 'cylinder', color: i % 2 ? 0xff891e : 0xf6f2e8 });
  }
  for (let i = 0; i < 9; i++) {
    at(beach, 'bench', rand(-32, 32), rand(1, 17), 3.6, 1.5, 1.2,
      { yaw: turn(), color: 0xc28b58 });
  }

  // Crane Yard: stacked shipping containers, safety cones, decks and climbable steel.
  const yard: PoiId = 'crane-yard';
  for (let i = 0; i < 11; i++) {
    at(yard, 'container', -32 + (i % 4) * 15, -31 + Math.floor(i / 4) * 14,
      12, 4.7, 5.3, { yaw: i % 2 ? Math.PI / 2 : 0,
        color: [0xe76e50, 0x55a6bd, 0xebbf58, 0x85b184][i % 4] });
  }
  for (let i = 0; i < 30; i++) {
    at(yard, 'cone', rand(-38, 35), rand(-36, 39), 1.1, 1.75, 1.1,
      { shape: 'cylinder', mass: 2.5, color: 0xff891e });
  }
  for (let i = 0; i < 9; i++) {
    at(yard, 'beam', -17 + (i % 3) * 11, 32 + Math.floor(i / 3) * 2,
      9, 1.1, 1.1, { yaw: 0.1 + i * 0.14, color: 0xffd833 });
  }
  for (let i = 0; i < 12; i++) {
    at(yard, 'scaffold', 29, -32 + i * 6, 1.1, 12 + (i % 2) * 5, 1.1,
      { color: 0xc7a367 });
  }

  // Downtown: every facade has an awning, sign and parkour-worthy roof equipment.
  const city: PoiId = 'downtown-bleatsville';
  const buildings = island.props.filter(p => p.poiId === city &&
    (p.kind === 'house' || p.kind === 'shop'));
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i]!;
    const x = building.transform.position.x;
    const z = building.transform.position.z;
    const top = building.transform.position.y + building.size.y / 2;
    place('awning', x, z + 7.2 * scale, 10, 0.9, 2.7, city,
      { y: top - 3.1 * scale, color: [0xf2777f, 0xffd866, 0x69c6d8][i % 3] });
    place('signboard', x, z + 6.5 * scale, 7, 2.5, 0.45, city,
      { y: top - 1.65 * scale, color: 0xffe6a2 });
    place('ac-unit', x - 2 * scale, z - 2.2 * scale, 3.3, 2.1, 3.1, city,
      { y: top + 1.05 * scale, color: 0xc0cbd0 });
    if (i % 4 === 0) {
      place('water-tower', x + 2.5 * scale, z + 1 * scale,
        4.5, 7.6, 4.5, city, { y: top + 3.8 * scale, shape: 'cylinder' });
    }
  }
  at(city, 'fountain', -1, -3, 10, 2.3, 10, { shape: 'cylinder', color: 0x8bc5d4 });
  for (let i = 0; i < 22; i++) {
    const edge = (i % 2 ? 1 : -1) * 43;
    at(city, 'planter', edge, -38 + Math.floor(i / 2) * 7.4,
      2.8, 2.4, 2.8, { shape: 'cylinder', color: 0xc3916d });
  }
  for (let i = 0; i < 8; i++) {
    at(city, 'bench', (i % 2 ? -1 : 1) * 34, -27 + i * 7.8,
      4.3, 1.55, 1.3, { yaw: Math.PI / 2, color: 0x9d6f57 });
  }

  // Whispering Pines: logs and stones straddle the river; fungi guide the lookout.
  const forest: PoiId = 'whispering-pines';
  at(forest, 'lookout', 24, -19, 9, 24, 9, { color: 0x8c6648 });
  at(forest, 'platform', 24, -19, 11, 1.1, 11, { lift: 23, color: 0xad835d });
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = (-111 - t * 46 + (i % 2 ? 3 : -3)) * scale;
    const z = (-164 - t * 18 + (i % 3 - 1) * 3) * scale;
    place('stepping-stone', x, z, 3.1, 1.35, 3, forest,
      { shape: 'convex', color: 0x9a9c9d });
  }
  for (let i = 0; i < 46; i++) {
    const a = turn(), r = Math.sqrt(rng.next()) * 65;
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    const site = sites.get(forest)!;
    const x = site.x + dx * scale, z = site.z + dz * scale;
    const water = riverAt({ x, z }, island.river);
    if (water.distance < water.width * 0.5 + 2 * scale ||
        gridSample(island, x, z) < 2 * scale) continue;
    place('mushroom', x, z, rand(0.75, 1.7), rand(1.2, 2.3), 1.25, forest,
      { color: i % 3 ? 0xe77a63 : 0xffd269, yaw: turn() });
  }
  for (let i = 0; i < 14; i++) {
    at(forest, 'stump', rand(-50, 48), rand(-43, 48), 2.8, 2.2, 2.8,
      { shape: 'cylinder', color: 0x976744 });
  }

  // The Dam: accessible control hut, shoreline dock, handrails and loose equipment.
  const dam: PoiId = 'the-dam';
  at(dam, 'control-house', 21, -7, 11, 9, 11, { color: 0xd4e4d6 });
  const lake = island.reservoir;
  place('dock', lake.center.x + 18 * scale, lake.center.z + 5 * scale,
    17, 1.0, 6, dam, { y: (lake.level + 0.35 * scale), color: 0xac855c });
  for (let i = 0; i < 16; i++) {
    at(dam, 'fence', -38 + i * 5, -4, 4.6, 2.1, 0.34, { color: 0xcdd4d8 });
  }
  for (let i = 0; i < 14; i++) {
    at(dam, i % 2 ? 'barrel' : 'crate', rand(-34, 32), rand(-27, 16),
      1.8, 2, 1.8, { mass: 9, shape: i % 2 ? 'cylinder' : 'cuboid' });
  }

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
  at(peak, 'cave-mouth', 57, 2, 11, 8, 6, { color: 0x555b6a });
  for (let i = 0; i < 20; i++) {
    const a = turn(), r = rand(42, 97);
    at(peak, 'rock', Math.cos(a) * r, Math.sin(a) * r, rand(2, 5), rand(2, 4.5), rand(2, 5),
      { shape: 'convex', color: 0x8c919e });
  }

  // Old Lighthouse: lonely keeper's cottage, stranded ship, cave and rope crossing.
  const light: PoiId = 'old-lighthouse';
  at(light, 'cottage', 17, 10, 10, 8, 9, { color: 0xf5c8a5 });
  at(light, 'shipwreck', -12, -23, 21, 5.5, 7, { yaw: 0.5, color: 0x84634d });
  at(light, 'cave-mouth', -19, 13, 9, 5.5, 5, { color: 0x474956 });
  for (let i = 0; i < 13; i++) {
    const a = turn(), r = rand(12, 30);
    at(light, 'rock', Math.cos(a) * r, Math.sin(a) * r,
      rand(1.8, 4.4), rand(1.5, 4), rand(2, 4.6), { yaw: a, shape: 'convex' });
  }
  const bridge = island.roads.find(r => r.to === light || r.from === light);
  if (bridge) {
    for (let i = 0; i < bridge.points.length; i += 2) {
      const p = bridge.points[i]!;
      if (!p.bridge) continue;
      for (const offset of [-1, 1]) {
        place('rope-rail', p.x + offset * (bridge.width * 0.5 + 0.3),
          p.z, 0.35, 3, 0.35, light, { y: p.y + 1.1 * scale, color: 0x996b49 });
      }
    }
  }

  // Seeded hedges, trees, flowers and windblown grass: consistent density, clear paths.
  const vegetationCount = Math.max(160, Math.round(440 * scale));
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
    const width = kind.startsWith('tree-') ? height * 0.39
      : kind === 'bush' ? height * 1.25 : height * 0.55;
    place(kind, x, z, width, height, width, near?.id,
      { shape: 'cylinder', yaw: turn() });
    accepted++;
  }
  return result;
}
