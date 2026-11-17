import type { IslandData, PoiId, PropDescriptor, PropKind, Vec2, Vec3 } from './types';
import { SeededRandom } from './random';
import { gridSample, riverAt } from './terrain';
import { buildBaaardwalk } from './boardwalk';
import { buildCraneYard } from './crane-yard';
import { getDamPlacement } from './the-dam';

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

  // HOOFINGTON: a true north/south village street with homes facing inward.
  // The road remains clear for third-person traversal, with garden strips
  // between the house fronts and the carriageway.
  const farm: PoiId = 'hoofington';
  site(farm, 'barn', -28, -30.7, 15, 12, 17, { yaw: Math.PI / 2, color: 0xd9534f });
  site(farm, 'house', 21, -19, 10, 9, 10,
    { yaw: -Math.PI / 2, color: 0xf7db77 });
  site(farm, 'house', -20, 11, 9, 8, 9,
    { yaw: Math.PI / 2, color: 0xf28fb5 });
  site(farm, 'house', -20, -9, 10, 9, 10,
    { yaw: Math.PI / 2, color: 0xde5343 });
  site(farm, 'house', 22, 12, 10, 8, 9,
    { yaw: -Math.PI / 2, color: 0xffecdb });
  site(farm, 'windmill', 30, -38, 12.5, 18, 7.9, { shape: 'cuboid' });
  site(farm, 'platform', 35, 26, 15, 1, 12);
  for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
    site(farm, 'fence', side * 11.6, -33 + i * 11,
      9.2, 1.85, 0.35, { yaw: Math.PI / 2, breakable: true });
  }
  for (let i = 0; i < 19; i++) {
    site(farm, 'hay-bale', rng.range(-42, -31), rng.range(-26, 27), 2.2, 1.5, 2.2,
      { dynamicMass: 12, yaw: rng.range(0, 6.28), shape: 'cylinder', climbable: false });
  }
  for (let i = 0; i < 7; i++) {
    site(farm, 'crate', rng.range(30, 40), rng.range(-27, 15), 1.8, 1.8, 1.8,
      { dynamicMass: 14, yaw: rng.range(0, 6.28) });
  }
  site(farm, 'ramp', -35, 6, 6, 2, 11, { yaw: 0.35 });
  site(farm, 'sign', 7.5, 39, 5, 3, 0.5, { breakable: true });

  // BAA-ARDWALK: one cohesive shore-connected, walkable pier scene.
  props.push(...buildBaaardwalk(island));

  // CRANE YARD: one authored, physically traversable construction site.
  props.push(...buildCraneYard(island));

  // DOWNTOWN: five storefronts per side look into the paved main street.
  // Three four-roof cross-street rows remain intact for Rooftop Express gigs
  // (the mission selects y-rotated roofs at z = -19, 0 and +19).
  const city: PoiId = 'downtown-bleatsville';
  for (let row = 0; row < 5; row++) for (const side of [-1, 1]) {
    const x = side * 20, z = (row - 2) * 19;
    const height = 9 + ((row * 2 + (side + 1) / 2) % 4) * 2.3;
    site(city, 'shop', x, z, 11.0, height, 11.4, {
      yaw: -side * Math.PI / 2,
      color: [0x91c9ed, 0xffa27e, 0xf2d47e, 0xb39adf][(row * 2 + (side + 1) / 2) % 4],
    });
    if (row === 0 || row === 4) {
      site(city, 'ramp', x + side * 9.6, z + 3, 4.5, 3, 9,
        { yaw: side * Math.PI / 2 });
    }
  }
  // Rooftop rows need four physical roofs each: one taller rear
  // townhouse behind each near-side shop in rows -19, 0 and +19.
  // Rear houses enrich the skyline without obstructing main-street sightlines.
  for (const z of [-19, 0, 19]) for (const side of [-1, 1]) {
    site(city, 'house', side * 36, z, 10, 15 + (z === 0 ? 3 : 0), 11.5, {
      yaw: -side * Math.PI / 2,
      color: z === 0 ? 0xe4b5a1 : 0xc3d0ed,
    });
  }
  site(city, 'tower', 39, -38, 8, 27, 8, { color: 0x95b4d8 });
  for (let row = 0; row < 6; row++) for (const side of [-1, 1]) {
    site(city, 'lamp', side * 10.8, -37 + row * 15, 0.6, 8, 0.6,
      { shape: 'cylinder', breakable: true });
  }
  for (let i = 0; i < 14; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    site(city, i % 2 === 0 ? 'crate' : 'barrel',
      side * rng.range(31, 42), rng.range(-39, 39),
      1.5, 1.8, 1.5, {
        dynamicMass: 9, shape: i % 2 ? 'cylinder' : 'cuboid',
      });
  }

  // MT. GIGGA: giant cliffs remain terrain, with intermittent stone shelf landings.
  const peak: PoiId = 'mt-gigga';
  const summit = byId.get(peak)!.center;
  add(peak, 'satellite-dish', summit.x + 9 * scale, summit.z - 3 * scale,
    { x: 7 * scale, y: 10 * scale, z: 7 * scale }, { shape: 'cylinder', lift: 1 });
  site(peak, 'flag', -7, 4, 0.7, 9, 0.7);
  for (let i = 0; i < 21; i++) {
    const angle = i * 2.39996;
    // Position shelves on the FLAT, grassy tier bands, never midway down a
    // steep cliff where a rectangular prop protrudes as a floating dark cube.
    const radius = [29, 49, 68, 85][i % 4]! * scale;
    const x = summit.x + Math.cos(angle) * radius;
    const z = summit.z + Math.sin(angle) * radius;
    add(peak, 'ledge', x, z,
      { x: (5 + i % 3) * scale, y: 1.2 * scale, z: 4.2 * scale },
      { yaw: angle, lift: 0.15 * scale, color: 0xffffff });
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

  // THE DAM: one non-rendered marker preserves the Dam Bomb gig's walkway
  // contract. Its upper surface matches the custom GLB deck; the actual
  // geometry and Rapier boxes are assembled by the world adapters.
  const dam = getDamPlacement(island);
  props.push({
    id: 'the-dam-compat-walkway',
    kind: 'platform', poiId: 'the-dam',
    transform: {
      position: { x: dam.position.x, y: dam.position.y + 18.3 * scale,
        z: dam.position.z },
      rotationY: 0,
    },
    size: { x: 33 * scale, y: 1 * scale, z: 7 * scale },
    shape: 'cuboid', body: STATIC, collidable: false,
    breakable: false, lickable: false, climbable: true,
  });
  // The ten removed loose props previously consumed twenty RNG samples.
  // Keep later POIs' seeded landmarks and collectible positions unchanged.
  for (let i = 0; i < 20; i++) rng.next();

  // OLD LIGHTHOUSE: a rocky cape with a climbable beacon and cliffside secrets.
  const cape: PoiId = 'old-lighthouse';
  site(cape, 'lighthouse', -2, 1, 9, 29, 9, { shape: 'cylinder', color: 0xf5f0db });
  // Beacon Bleat contracts require this original house descriptor, even
  // though the hero cottage is the more prominent painted building.
  site(cape, 'house', 15, -10, 9, 7, 9, { color: 0xf4e6d4 });
  site(cape, 'cottage', 16, 9, 10, 8, 9,
    { yaw: -0.16, color: 0xf8ebd6 });
  site(cape, 'platform', -19, -9, 7, 1, 6, { lift: 4 });
  for (let i = 0; i < 20; i++) {
    const a = rng.range(0, 2 * Math.PI), r = rng.range(13, 40);
    const p = at(cape, Math.cos(a) * r, Math.sin(a) * r);
    if (gridSample(island, p.x, p.z) < 0.4 * scale ||
        Math.hypot(p.x - (byId.get(cape)!.center.x + 2 * scale),
          p.z - (byId.get(cape)!.center.z + 23 * scale)) < 8 * scale) continue;
    add(cape, 'rock', p.x, p.z,
      { x: rng.range(2, 7) * scale, y: rng.range(2, 5) * scale, z: rng.range(2, 6) * scale },
      { yaw: a, shape: 'convex', lickable: false });
  }
  site(cape, 'flag', 26, 11, 0.6, 9, 0.6);

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
