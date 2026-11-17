import type { IslandData, PoiId, PropDescriptor, PropKind } from './types';
import { SeededRandom } from './random';
import { gridSample, riverAt, stampPlot } from './terrain';
import { getDamPlacement } from './the-dam';
import { damChannelAt } from './dam-landscape';

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

  // Hoofington: two sided village street, with front gardens and mailboxes.
  const farm: PoiId = 'hoofington';
  at(farm, 'silo', -32, -19.2, 7.5, 21, 7.5,
    { shape: 'cylinder', color: 0xe5d7ac });
  at(farm, 'house', 22, 29, 10, 8, 10,
    { yaw: -Math.PI / 2, color: 0xffecdb });
  at(farm, 'cottage', 29, -2, 9, 8, 8,
    { yaw: -Math.PI / 2, color: 0xc0d8ef });
  at(farm, 'trampoline', 36, 34, 8, 1.1, 7, { color: 0x7960d9 });
  // Street-level lamps frame the narrow roadway but do not encroach on it.
  // Their integral pennants also give Hoofington the orange farm banners.
  for (const side of [-1, 1]) for (const z of [-30, 0, 30]) {
    at(farm, 'lamp', side * 9.8, z, 0.72, 7.8, 0.72,
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
      0.85, 1.6, 0.85, { yaw: turn(), color: i % 2 ? 0xff891e : 0x7a4cff });
  }
  for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
    // The outer west fence runs behind both barn and silo foundations.
    const x = side === -1 && i < 2 ? -36.8
      : side === -1 && i === 2 ? -36.0 : side * 34.5;
    at(farm, 'fence', x, -36 + i * 10,
      9, 1.85, 0.34, { yaw: Math.PI / 2, color: 0xeac995 });
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
  at(farm, 'bench', -14, 34, 3.6, 1.55, 1.3,
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
    x: number, z: number, width: number, yaw: number,
  ): { x: number; z: number } {
    const buildings = [...island.props, ...result]
      .filter(p => p.poiId === farm &&
        ['barn', 'house', 'cottage', 'silo', 'windmill'].includes(p.kind))
      .map(p => ({ x: p.transform.position.x, z: p.transform.position.z,
        sx: p.size.x, sz: p.size.z, yaw: p.transform.rotationY }));
    const free = (px: number, pz: number): boolean => {
      const f = { x: px, z: pz, sx: width, sz: width, yaw };
      return !buildings.some(b => footprintOverlaps(f, b)) &&
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

  // Floating buoys outline the pier and the surf. The kiosks, pennants and
  // benches are built by buildBaaardwalk at deck height, never on sand.
  const beach: PoiId = 'baa-ardwalk';
  const surf = sites.get(beach)!;
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const x = surf.x + Math.sin(a) * 35 * scale;
    const z = surf.z + (61 + Math.cos(a) * 27) * scale;
    place('buoy', x, z, 1.9, 2.1, 1.9, beach,
      { y: 0.55 * scale, mass: 4, shape: 'cylinder', color: i % 2 ? 0xff891e : 0xf6f2e8 });
  }

  // Downtown: storefront trim and signs follow each building's facade normal
  // (local +Z), not a fixed world +Z direction. The +/- X-facing rows now
  // display their shop fronts to pedestrians in the central street.
  const city: PoiId = 'downtown-bleatsville';
  const buildings = island.props.filter(p => p.poiId === city &&
    (p.kind === 'house' || p.kind === 'shop'));
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
    place('signboard', x + frontX * (facade + 0.35 * scale),
      z + frontZ * (facade + 0.35 * scale),
      7, 2.5, 0.45, city, {
        yaw, y: top - 1.6 * scale, color: 0xffe6a2,
      });
    place('ac-unit', x - frontX * 1.8 * scale,
      z - frontZ * 1.8 * scale, 3.3, 2.1, 3.1, city,
      { yaw, y: top + 1.05 * scale, color: 0xc0cbd0 });
    if (i % 4 === 0) {
      place('water-tower', x - frontX * 1.7 * scale,
        z - frontZ * 1.7 * scale, 4.5, 7.6, 4.5, city,
        { y: top + 3.8 * scale, shape: 'cylinder' });
    }
  }
  // Fountain square is a side plaza, not an obstacle in the street.
  at(city, 'fountain', -40, -35, 10, 2.3, 10,
    { shape: 'cylinder', color: 0x8bc5d4 });
  for (let i = 0; i < 20; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -36 + Math.floor(i / 2) * 8;
    at(city, 'planter', side * 12.1, z, 2.6, 2.2, 2.6,
      { shape: 'cylinder', color: 0xc3916d });
    if (i % 2 === 0) {
      at(city, 'flower', side * 13.1, z + 3, 0.8, 1.1, 0.8,
        { color: 0xf2777f });
    }
  }
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? -1 : 1;
    at(city, 'bench', side * 12.7, -27 + i * 7.8,
      4.3, 1.55, 1.3, { yaw: Math.PI / 2, color: 0x9d6f57 });
  }
  for (const dz of [-12, 8]) for (const dx of [-46, -32]) {
    at(city, 'planter', dx, dz, 3.2, 2.8, 3.2,
      { shape: 'cylinder', color: 0xc3916d });
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
  at(peak, 'cave-mouth', 57, 2, 11, 8, 6, { color: 0x555b6a });
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
    at(light, 'rock', dx, dz,
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
    const width = kind === 'tree-oak' ? height * 0.72
      : kind === 'tree-pine' ? height * 0.25
      : kind === 'bush' ? height * 1.25
      : kind === 'flower' ? height * 0.9 : height * 0.55;
    const yaw = turn();
    const position = near?.id === farm &&
      (kind === 'flower' || kind === 'bush' || kind.startsWith('tree-'))
      ? clearHoofingtonFoliage(x, z, width * scale, yaw) : { x, z };
    place(kind, position.x, position.z, width, height, width, near?.id,
      { shape: 'cylinder', yaw });
    accepted++;
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
