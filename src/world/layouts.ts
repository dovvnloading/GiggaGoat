import type { IslandData, PoiId, PropDescriptor, PropKind, Vec2, Vec3 } from './types';
import { SeededRandom } from './random';
import { gridSample, riverAt } from './terrain';

interface AddOptions {
  yaw?: number;
  lift?: number;
  /** World-space centre Y (for decks and structures over water). */
  absoluteY?: number;
  dynamicMass?: number;
  shape?: PropDescriptor['shape'];
  collidable?: boolean;
  breakable?: boolean;
  lickable?: boolean;
  climbable?: boolean;
  color?: number;
}
const STATIC: PropDescriptor['body'] = { type: 'static' };

export function populateProps(island: IslandData, rng: SeededRandom): PropDescriptor[] {
  const props: PropDescriptor[] = [];
  const byId = new Map(island.pois.map(p => [p.id, p]));
  const scale = island.size / 600;
  let number = 0;
  function add(
    poiId: PoiId | undefined, kind: PropKind, x: number, z: number,
    size: Vec3, options: AddOptions = {},
  ): PropDescriptor {
    const y = options.absoluteY ?? gridSample(island, x, z) + size.y / 2 + (options.lift ?? 0);
    const prop: PropDescriptor = {
      id: (poiId ?? 'scenery') + '-' + kind + '-' + number++,
      kind, ...(poiId ? { poiId } : {}),
      transform: { position: { x, y, z }, rotationY: options.yaw ?? 0 },
      size, shape: options.shape ?? 'cuboid',
      body: options.dynamicMass === undefined ? STATIC : { type: 'dynamic', mass: options.dynamicMass },
      collidable: options.collidable ?? true,
      breakable: options.breakable ?? (options.dynamicMass !== undefined),
      lickable: options.lickable ?? true,
      climbable: options.climbable ?? (options.dynamicMass === undefined),
      ...(options.color === undefined ? {} : { color: options.color }),
    };
    props.push(prop);
    return prop;
  }
  function at(id: PoiId, dx: number, dz: number): Vec2 {
    const p = byId.get(id)!.center;
    return { x: p.x + dx * scale, z: p.z + dz * scale };
  }
  function site(id: PoiId, kind: PropKind, dx: number, dz: number,
    sx: number, sy: number, sz: number, options: AddOptions = {}): PropDescriptor {
    const p = at(id, dx, dz);
    return add(id, kind, p.x, p.z,
      { x: sx * scale, y: sy * scale, z: sz * scale }, options);
  }

  // HOOFINGTON: a clear village square surrounded by a usable barn, homes and paddocks.
  const farm: PoiId = 'hoofington';
  site(farm, 'barn', -18, -13, 15, 12, 17, { color: 0xd9534f });
  site(farm, 'house', 15, -15, 10, 9, 10, { color: 0xf7db77 });
  site(farm, 'house', -20, 14, 9, 8, 9, { color: 0x84c6e8 });
  site(farm, 'windmill', 25, 17, 5, 23, 5, { shape: 'cylinder' });
  site(farm, 'platform', 9, -26, 15, 1, 12, { lift: 0.5 });
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const dx = Math.cos(a) * 32, dz = Math.sin(a) * 30;
    site(farm, 'fence', dx, dz, 6, 2.2, 0.35, { yaw: -a + Math.PI / 2, breakable: true });
  }
  for (let i = 0; i < 19; i++) {
    const x = rng.range(-28, -7), z = rng.range(7, 28);
    site(farm, 'hay-bale', x, z, 2.2, 1.5, 2.2,
      { dynamicMass: 12, yaw: rng.range(0, 6.28), shape: 'cylinder', climbable: false });
  }
  for (let i = 0; i < 7; i++) {
    site(farm, 'crate', rng.range(4, 27), rng.range(-27, -8), 1.8, 1.8, 1.8,
      { dynamicMass: 14, yaw: rng.range(0, 6.28) });
  }
  site(farm, 'ramp', -5, -18, 6, 2, 11, { yaw: 0.35 });
  site(farm, 'sign', 0, 11, 5, 3, 0.5, { breakable: true });

  // BAA-ARDWALK: a real walkable pier beyond the coastline and an open-frame wheel.
  const beach: PoiId = 'baa-ardwalk';
  site(beach, 'booth', -18, -10, 8, 6, 7, { color: 0xff888a });
  site(beach, 'booth', 17, -9, 8, 7, 8, { color: 0xffdc6d });
  site(beach, 'ferris-wheel', -23, 10, 23, 23, 3, { collidable: false, lickable: false });
  site(beach, 'scaffold', -30, 9, 2, 15, 2);
  site(beach, 'scaffold', -16, 9, 2, 15, 2);
  site(beach, 'platform', -23, 9, 17, 1.1, 5, { lift: 7.5 });
  // The start is inland; the end projects past the shoreline into the sea.
  const pierStart = at(beach, 0, 19), pierEnd = at(beach, 0, 87);
  const pierLevel = 5.0 * scale;
  add(beach, 'pier', (pierStart.x + pierEnd.x) / 2, (pierStart.z + pierEnd.z) / 2,
    { x: 13 * scale, y: 1 * scale, z: 68 * scale }, { absoluteY: pierLevel, color: 0xc68b54 });
  for (let i = 0; i < 9; i++) {
    const z = pierStart.z + (6 + i * 7.3) * scale;
    for (const side of [-1, 1]) {
      add(beach, 'scaffold', pierStart.x + side * 5.6 * scale, z,
        { x: 0.8 * scale, y: 9 * scale, z: 0.8 * scale },
        { absoluteY: pierLevel - 4 * scale });
    }
  }
  site(beach, 'ramp', 0, 13, 12, 2, 15);
  for (let i = 0; i < 7; i++) {
    site(beach, 'bumper', -18 + (i % 4) * 8, 30 + Math.floor(i / 4) * 8,
      4, 2.6, 4, { dynamicMass: 35, shape: 'cylinder', color: 0x9d7de7 });
  }
  for (let i = 0; i < 10; i++) {
    site(beach, 'bench', rng.range(-27, 26), rng.range(-21, 5), 3.5, 1.4, 1.1,
      { breakable: true, yaw: rng.range(0, 6.28) });
  }
  site(beach, 'flag', 0, 82, 0.6, 9, 0.6, { absoluteY: pierLevel + 4.5 * scale });

  // CRANE YARD: climbable framing, diagonally stacked cargo and movable barrels.
  const yard: PoiId = 'crane-yard';
  site(yard, 'tower', -16, -12, 14, 21, 12, { color: 0xaab4ba });
  site(yard, 'crane', 19, 12, 2.8, 33, 2.8, { color: 0xffd14c });
  site(yard, 'beam', 12, 12, 29, 2, 2, { lift: 29, color: 0xffd14c });
  site(yard, 'crane', -27, 22, 2.4, 25, 2.4);
  site(yard, 'beam', -16, 22, 23, 1.8, 1.8, { lift: 23 });
  for (let i = 0; i < 4; i++) {
    const dz = -4 + i * 10;
    site(yard, 'scaffold', 1, dz, 2, 18, 2);
    site(yard, 'scaffold', 17, dz, 2, 18, 2);
    site(yard, 'platform', 9, dz, 18, 0.9, 5, { lift: 7 + (i % 2) * 6 });
  }
  for (let i = 0; i < 23; i++) {
    site(yard, 'crate', rng.range(-29, 31), rng.range(-26, 27), 2.4, 2.4, 2.4,
      { dynamicMass: rng.range(18, 35), yaw: rng.range(0, 6.28) });
  }
  for (let i = 0; i < 9; i++) {
    site(yard, 'barrel', rng.range(-30, 29), rng.range(-29, 30), 1.8, 2.2, 1.8,
      { dynamicMass: 11, shape: 'cylinder', climbable: false });
  }
  site(yard, 'ramp', -4, -16, 7, 3, 15, { yaw: 0.9 });
  site(yard, 'ramp', 25, -10, 7, 4, 17, { yaw: -0.3 });

  // DOWNTOWN: narrow alleys and staggered, fully collidable roof heights.
  const city: PoiId = 'downtown-bleatsville';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = (col - 1.5) * 15, z = (row - 1) * 19;
      const height = 8 + ((row * 4 + col) % 4) * 2.5;
      site(city, (row + col) % 3 === 0 ? 'house' : 'shop', x, z,
        10.8, height, 12.4, {
          color: [0x91c9ed, 0xffa27e, 0xf2d47e, 0xb39adf][(row * 3 + col) % 4],
        });
      if ((row + col) % 2 === 0) {
        site(city, 'ramp', x + 7, z + 3, 4.5, 3, 9, { yaw: Math.PI / 2 });
      }
    }
  }
  site(city, 'tower', -33, 0, 8, 27, 8, { color: 0x95b4d8 });
  for (let i = 0; i < 12; i++) {
    const x = (i % 2 === 0 ? -1 : 1) * 35;
    site(city, 'lamp', x, -30 + Math.floor(i / 2) * 12, 0.6, 9, 0.6,
      { shape: 'cylinder', breakable: true });
  }
  for (let i = 0; i < 14; i++) {
    site(city, i % 2 === 0 ? 'crate' : 'barrel', rng.range(-39, 40), rng.range(-35, 37),
      1.5, 1.8, 1.5, { dynamicMass: 9, shape: i % 2 ? 'cylinder' : 'cuboid' });
  }

  // MT. GIGGA: giant cliffs remain terrain, with intermittent stone shelf landings.
  const peak: PoiId = 'mt-gigga';
  const summit = byId.get(peak)!.center;
  add(peak, 'satellite-dish', summit.x + 9 * scale, summit.z - 3 * scale,
    { x: 7 * scale, y: 10 * scale, z: 7 * scale }, { shape: 'cylinder', lift: 1 });
  site(peak, 'flag', -7, 4, 0.7, 9, 0.7);
  for (let i = 0; i < 21; i++) {
    const angle = i * 2.39996;
    const radius = (29 + (i % 4) * 12) * scale;
    const x = summit.x + Math.cos(angle) * radius;
    const z = summit.z + Math.sin(angle) * radius;
    add(peak, 'ledge', x, z,
      { x: (5 + i % 3) * scale, y: 1.2 * scale, z: 4.2 * scale },
      { yaw: angle, lift: 0.9 * scale, color: 0xc0b8a9 });
    if (i % 3 === 0) add(peak, 'rock', x + 4 * scale, z + 2 * scale,
      { x: 4 * scale, y: 3 * scale, z: 3.5 * scale }, { shape: 'convex' });
  }

  // WHISPERING PINES: thick woodland, log hop obstacles and a visible river corridor.
  const forest: PoiId = 'whispering-pines';
  const woods = byId.get(forest)!.center;
  let trees = 0;
  for (let attempt = 0; attempt < 220 && trees < 95; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = Math.sqrt(rng.next()) * 78 * scale;
    const x = woods.x + Math.cos(angle) * radius, z = woods.z + Math.sin(angle) * radius;
    const river = riverAt({ x, z }, island.river);
    if (river.distance < river.width / 2 + 6 * scale) continue;
    if (gridSample(island, x, z) < 3 * scale) continue;
    if (Math.hypot(x - woods.x, z - woods.z) < 10 * scale) continue;
    const h = rng.range(8, 17) * scale;
    add(forest, rng.next() < 0.83 ? 'tree-pine' : 'tree-oak',
      x, z, { x: h * 0.43, y: h, z: h * 0.43 },
      { shape: 'cylinder', lickable: true, climbable: true });
    trees++;
  }
  for (let i = 0; i < 17; i++) {
    const p = at(forest, rng.range(-43, 43), rng.range(-48, 48));
    add(forest, i % 3 === 0 ? 'rock' : 'log', p.x, p.z,
      { x: 3.5 * scale, y: 2.2 * scale, z: 7 * scale },
      { shape: i % 3 === 0 ? 'convex' : 'cylinder',
        dynamicMass: i % 3 === 0 ? undefined : 30, yaw: rng.range(0, Math.PI * 2) });
  }
  site(forest, 'platform', 12, -13, 9, 1.1, 8, { lift: 4.5 });
  site(forest, 'platform', 19, -17, 8, 1.1, 7, { lift: 8.5 });
  site(forest, 'sign', -4, 8, 4, 3, 0.5);

  // THE DAM: broad reservoir, conspicuous spillway and terraced access platforms.
  const dam: PoiId = 'the-dam';
  const lake = island.reservoir;
  const wallX = lake.center.x - 16 * scale, wallZ = lake.center.z - 22 * scale;
  add(dam, 'dam-wall', wallX, wallZ, { x: 31 * scale, y: 17 * scale, z: 4.5 * scale },
    { absoluteY: lake.level - 2 * scale, color: 0xaaaeb7 });
  add(dam, 'platform', wallX, wallZ,
    { x: 33 * scale, y: 1 * scale, z: 7 * scale },
    { absoluteY: lake.level + 6.6 * scale });
  site(dam, 'tower', -8, -13, 10, 14, 10, { color: 0xa2b8ce });
  site(dam, 'ramp', 2, -15, 6, 3, 14);
  for (let i = 0; i < 10; i++) {
    site(dam, i % 2 ? 'barrel' : 'crate', rng.range(-24, 20), rng.range(-18, 18),
      2, 2.2, 2, { dynamicMass: 12, shape: i % 2 ? 'cylinder' : 'cuboid' });
  }
  for (let i = 0; i < 5; i++) {
    site(dam, 'fence', -24 + i * 11, 24, 10, 2.3, 0.3, { breakable: true });
  }

  // OLD LIGHTHOUSE: a rocky cape with a climbable beacon and cliffside secrets.
  const cape: PoiId = 'old-lighthouse';
  site(cape, 'lighthouse', -2, 1, 9, 29, 9, { shape: 'cylinder', color: 0xf5f0db });
  site(cape, 'house', 15, -10, 9, 7, 9, { color: 0x9fd3d2 });
  site(cape, 'platform', -19, -9, 7, 1, 6, { lift: 4 });
  for (let i = 0; i < 20; i++) {
    const a = rng.range(0, 2 * Math.PI), r = rng.range(13, 40);
    const p = at(cape, Math.cos(a) * r, Math.sin(a) * r);
    if (gridSample(island, p.x, p.z) < 0.4 * scale) continue;
    add(cape, 'rock', p.x, p.z,
      { x: rng.range(2, 7) * scale, y: rng.range(2, 5) * scale, z: rng.range(2, 6) * scale },
      { yaw: a, shape: 'convex', lickable: false });
  }
  site(cape, 'flag', 4, 11, 0.6, 9, 0.6);

  // Roads have lamp posts / obstacles along the shoulders, not in driving lanes.
  for (const road of island.roads) {
    if (road.type === 'trail') continue;
    for (let i = 13; i < road.points.length - 5; i += 18) {
      const a = road.points[i - 1]!, b = road.points[i + 1]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      const p = road.points[i]!;
      const side = i % 2 === 0 ? -1 : 1;
      const x = p.x + side * (road.width * 0.5 + 3 * scale) * -dz / length;
      const z = p.z + side * (road.width * 0.5 + 3 * scale) * dx / length;
      if (gridSample(island, x, z) > 2 * scale) {
        add(undefined, 'lamp', x, z,
          { x: 0.55 * scale, y: 8.5 * scale, z: 0.55 * scale },
          { shape: 'cylinder', breakable: true });
      }
    }
  }
  return props;
}

/** Exact point-in-solid query (yaw-aware) for safe spawns and collectible placement. */
export function isPointInsideProps(point: Vec3, props: readonly PropDescriptor[], margin = 0): boolean {
  for (const prop of props) {
    if (!prop.collidable) continue;
    const center = prop.transform.position;
    if (Math.abs(point.y - center.y) >= prop.size.y / 2 + margin) continue;
    const dx = point.x - center.x, dz = point.z - center.z;
    const c = Math.cos(prop.transform.rotationY), s = Math.sin(prop.transform.rotationY);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (prop.kind === 'cave-mouth') {
      // Match the recessed Rapier back-wall collider; the front of the arch is walkable.
      if (Math.abs(lx) < prop.size.x * 0.325 + margin &&
          Math.abs(lz + prop.size.z * 0.40) < prop.size.z * 0.06 + margin) return true;
      continue;
    }
    if (prop.shape === 'cylinder') {
      const radius = prop.kind.startsWith('tree-') ? Math.min(0.9, prop.size.x * 0.2)
        : prop.kind === 'lamp' ? 0.38 : prop.size.x / 2;
      if (lx * lx + lz * lz < (radius + margin) ** 2) return true;
    } else if (Math.abs(lx) < prop.size.x / 2 + margin &&
               Math.abs(lz) < prop.size.z / 2 + margin) {
      return true;
    }
  }
  return false;
}
