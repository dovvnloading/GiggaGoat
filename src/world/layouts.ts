import type { IslandData, PoiId, PropDescriptor, PropKind, Vec2, Vec3 } from './types';
import { SeededRandom } from './random';
import { gridSample, riverAt, segmentProjection } from './terrain';
import { downtownPublicSpaceAt, downtownPublicSpaces } from './downtown-public-space';
import { buildBaaardwalk } from './boardwalk';
import { buildCraneYard } from './crane-yard';
import { DOWNTOWN_BUILDING_SIZES, DOWNTOWN_INFILL, SHOP_FRONTS,
  downtownRearHouseModel } from './visual-downtown';
import { getDamPlacement } from './the-dam';
import { buildRooftopCourse } from './rooftop-course';
import { HOOFINGTON_HAUL_BALE_PREFIX, HOOFINGTON_HAUL_PARKING } from './hoofington-entrances';
import { PINES_LOG_ENTRY_LENGTH, pinesGladePlan } from './pines-log-access';

interface AddOptions {
  id?: string;
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
const DOWNTOWN_SERVICE_RAMP = /^downtown-bleatsville-ramp-\d+$/;

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
      id: options.id ?? ((poiId ?? 'scenery') + '-' + kind + '-' + number++),
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

  /** The authored stilts are only visual: deck collision/interaction stays on the plank. */
  function supportElevatedDeck(deck: PropDescriptor): void {
    const { x, z, y } = deck.transform.position;
    const ground = gridSample(island, x, z);
    const underside = y - deck.size.y / 2;
    const height = underside - ground;
    if (height <= 0) return;
    add(deck.poiId, 'deck-stilts', x, z,
      { x: deck.size.x, y: height, z: deck.size.z }, {
        absoluteY: ground + height / 2, yaw: deck.transform.rotationY,
        collidable: false, breakable: false, lickable: false, climbable: false,
      });
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
  // Short front panels and returns outline individual yards. Keep the
  // end panels at the established entrance to the mowing lawn.
  const pickets = [
    // x, z, length, yaw
    [-12.2, -34.5, 5.7, Math.PI / 2], [-13.7, -31.75, 3.2, 0],
    [-12.2, -12.9, 4.4, Math.PI / 2], [-13.6, -14.98, 3, 0],
    [-11.6, 6.2, 4, Math.PI / 2], [-12.25, 17.25, 4.2, Math.PI / 2],
    [-11.6, 33, 9.2, Math.PI / 2],
    [11.6, -34, 4, Math.PI / 2], [11.45, -21.7, 6.1, Math.PI / 2],
    [13, -24.63, 3.3, 0], [12.6, -3, 2.8, Math.PI / 2],
    [11.45, 8.6, 3.6, Math.PI / 2], [12.95, 6.92, 3.2, 0],
    [11.6, 33, 9.2, Math.PI / 2],
  ] as const;
  for (const [x, z, length, yaw] of pickets) {
    site(farm, 'fence', x, z, length, 1.85, .35, { yaw, breakable: true });
  }
  for (let i = 0; i < 19; i++) {
    site(farm, 'hay-bale', rng.range(-42, -31), rng.range(-26, 27), 2.2, 1.5, 2.2,
      { dynamicMass: 12, yaw: rng.range(0, 6.28), shape: 'cylinder', climbable: false });
  }
  // The seven removed garden crates used three draws each. Preserve all later
  // Downtown/Pines/Lighthouse placements and relic positions on every seed.
  for (let i = 0; i < 7 * 3; i++) rng.next();
  site(farm, 'sign', 7.5, 39, 5, 3, 0.5, { breakable: true });

  // Set the mill supplies and the farm's loading stop on the grass verges.
  // Named IDs leave the existing numeric IDs and seeded bales in place.
  site(farm, 'crate', 8.6, -32.7, 1.15, 1.1, 1.1, {
    id: 'hoofington-verge-north-crate', dynamicMass: 11, yaw: .17,
  });
  site(farm, 'barrel', 8.8, -34.5, 1, 1.35, 1, {
    id: 'hoofington-verge-north-barrel', dynamicMass: 14, shape: 'cylinder',
  });
  site(farm, 'bench', 9.1, -36.9, 2, .95, .75, {
    id: 'hoofington-verge-north-bench', yaw: Math.PI / 2,
  });
  site(farm, 'crate', -7.25, 30.15, 1.15, 1.1, 1.1, {
    id: 'hoofington-verge-south-crate', dynamicMass: 11, yaw: -.23,
  });
  site(farm, 'barrel', -8.55, 31.8, 1, 1.35, 1, {
    id: 'hoofington-verge-south-barrel', dynamicMass: 14, shape: 'cylinder',
  });
  site(farm, 'bench', -7.6, 34, 2, .95, .75, {
    id: 'hoofington-verge-south-bench', yaw: -Math.PI / 2,
  });

  // The contract loads from the inside of the field. Keep the original
  // paddock supply and its saved body IDs for Free Roam and older contracts.
  for (const [i, slot] of HOOFINGTON_HAUL_PARKING.entries()) {
    site(farm, 'hay-bale', slot.x, slot.z, 1.7, 1.3, 1.7, {
      id: HOOFINGTON_HAUL_BALE_PREFIX + (i + 1), dynamicMass: 8,
      shape: 'cylinder', climbable: false, yaw: i * .17,
    });
  }

  // BAA-ARDWALK: one cohesive shore-connected, walkable pier scene.
  props.push(...buildBaaardwalk(island));

  // CRANE YARD: one authored, physically traversable construction site.
  props.push(...buildCraneYard(island));

  // DOWNTOWN: five storefronts per side look into the paved main street.
  const city: PoiId = 'downtown-bleatsville';
  for (let row = 0; row < 5; row++) for (const side of [-1, 1]) {
    const z = (row - 2) * 19;
    const model = SHOP_FRONTS[side < 0 ? 0 : 1]![row]!.model;
    const size = DOWNTOWN_BUILDING_SIZES[model];
    // A y-rotated building's +Z facade faces the street. Keep its old
    // pavement plane at |X| = 20 - 11.4/2, moving only the back wall.
    const x = side * (20 + (size.z - 11.4) / 2);
    site(city, 'shop', x, z, size.x, size.y, size.z, {
      yaw: -side * Math.PI / 2,
      color: [0x91c9ed, 0xffa27e, 0xf2d47e, 0xb39adf][(row * 2 + (side + 1) / 2) % 4],
    });
    if (row === 0 || row === 4) {
      site(city, 'ramp', x + side * 9.6, z + 3, 4.5, 3, 9,
        { yaw: side * Math.PI / 2 });
    }
  }
  // Fill only the gaps between existing shops, not beyond the first or last.
  // Each infill is a static cuboid whose GLB faces the same pavement plane.
  for (const { side, z, model } of DOWNTOWN_INFILL) {
    const size = DOWNTOWN_BUILDING_SIZES[model];
    const x = side * (20 - 11.4 / 2 + size.z / 2);
    site(city, 'house', x, z, size.x, size.y, size.z,
      { yaw: -side * Math.PI / 2 });
  }
  // Rear houses enrich the skyline without obstructing main-street sightlines.
  for (const z of [-19, 0, 19]) for (const side of [-1, 1]) {
    const size = DOWNTOWN_BUILDING_SIZES[downtownRearHouseModel(z)];
    // Rear facades stay at the original |X| = 36 - 11.5/2 plane.
    const x = side * (36 + (size.z - 11.5) / 2);
    site(city, 'house', x, z, size.x, size.y, size.z, {
      yaw: -side * Math.PI / 2,
      color: z === 0 ? 0xe4b5a1 : 0xc3d0ed,
    });
  }
  props.push(...buildRooftopCourse(byId.get(city)!.center, scale, props));
  site(city, 'tower', 39, -38, 8, 27, 8, { color: 0x95b4d8 });
  // The two shop entrances have clear cross-street views of their marquees.
  for (const z of [-37, -22, -7, 3.5, 23, 43]) for (const side of [-1, 1]) {
    site(city, 'lamp', side * 10.8, z, 0.6, 8, 0.6,
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

  // Public corners use named props so all authored buildings and gig roofs
  // retain their previous IDs. The service lanes keep both old ramps open.
  for (const [key, x, z, yaw] of [
    ['produce', 23.3, 51.2, -Math.PI / 2], ['flowers', 30.3, 63.5, Math.PI],
  ] as const) {
    site(city, 'booth', x, z, 4.6, 3.5, 3.2, { id: 'downtown-market-stall-' + key, yaw });
  }
  site(city, 'crate', 25.9, 52.9, 1.15, 1.1, 1.15, {
    id: 'downtown-market-produce-crate', dynamicMass: 12, yaw: .25,
  });
  site(city, 'crate', 31.6, 58.6, 1.15, 1.1, 1.15, {
    id: 'downtown-market-flower-crate', dynamicMass: 11, yaw: -.2,
  });
  for (const [key, x, z, yaw] of [
    ['square-west', -26.4, -54.6, -Math.PI / 2],
    ['square-east', -11.9, -49.2, Math.PI / 2],
    ['market', 15.9, 59.0, 0],
  ] as const) {
    site(city, 'bench', x, z, 2, .95, .75, { id: 'downtown-' + key + '-bench', yaw });
  }
  for (const [key, x, z] of [
    ['square-west', -27.4, -47.7], ['square-east', -12.3, -57.8],
    ['market-north', 11.5, 48.4], ['market-south', 11.8, 58.5],
  ] as const) {
    site(city, 'planter', x, z, 1.6, 1.1, 1.6,
      { id: 'downtown-' + key + '-planter', shape: 'cylinder' });
  }

  // MT. GIGGA: giant cliffs remain terrain, with intermittent stone shelf landings.
  const peak: PoiId = 'mt-gigga';
  const summit = byId.get(peak)!.center;
  add(peak, 'satellite-dish', summit.x + 9 * scale, summit.z - 3 * scale,
    { x: 7 * scale, y: 10 * scale, z: 7 * scale }, { shape: 'cylinder', lift: 1 });
  // The new pennant's pole sits 1.25 m left of the model centre.
  site(peak, 'flag', -5.75, 4, 2.8, 9, 0.4);
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

  // WHISPERING PINES: keep the legacy RNG sequence, but clear the road
  // shoulders and group six small fallen pieces beside the water and trail.
  const forest: PoiId = 'whispering-pines';
  const woods = byId.get(forest)!.center;
  const nearRoad = (x: number, z: number, clearance: number): boolean =>
    island.roads.some(road => road.points.some(point =>
      Math.hypot(x - point.x, z - point.z) <= road.width / 2 + clearance));
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
    const kind: PropKind = rng.next() < 0.83 ? 'tree-pine' : 'tree-oak';
    const width = h * (kind === 'tree-pine' ? 0.35 : 0.72);
    // Count old-eligible attempts even when the road excludes a tree, so the
    // 95-tree cap consumes exactly the same random draws on every seed.
    trees++;
    const trunkRadius = Math.min(0.9, width * 0.2);
    if (nearRoad(x, z, 2 + trunkRadius)) continue;
    add(forest, kind, x, z, { x: width, y: h, z: width },
      { shape: 'cylinder', lickable: true, climbable: true });
  }

  // The 17 old scatter attempts each drew x, z and yaw. Discard the first
  // two draws and reuse the yaw only; later POIs and relics retain their RNG.
  const looseYaws: number[] = [];
  for (let i = 0; i < 17; i++) {
    rng.range(-43, 43);
    rng.range(-48, 48);
    looseYaws.push(rng.range(0, Math.PI * 2));
  }
  const looseKinds = ['rock', 'log', 'log', 'rock', 'rock', 'rock'] as const;
  type LooseKind = (typeof looseKinds)[number];
  interface LooseSpot { x: number; z: number; yaw: number }
  const chosen: Array<LooseSpot & { kind: LooseKind }> = [];
  const footprintRadius = (kind: LooseKind): number =>
    Math.hypot(kind === 'rock' ? 2.2 : 1.0, kind === 'rock' ? 2.5 : 4.5) * scale / 2;
  function clearFor(kind: LooseKind, x: number, z: number): boolean {
    if (Math.hypot(x - woods.x, z - woods.z) > 85 * scale ||
        gridSample(island, x, z) < 0.5 * scale ||
        nearRoad(x, z, 3.5 + footprintRadius(kind))) return false;
    return chosen.every(other =>
      Math.hypot(x - other.x, z - other.z) >
        footprintRadius(kind) + footprintRadius(other.kind) + 3 * scale);
  }
  function bankSpot(kind: LooseKind, slot: number): LooseSpot | undefined {
    const segments = [12, 13, 11] as const;
    for (let pass = 0; pass < segments.length; pass++) {
      const index = segments[(slot + pass) % segments.length]!;
      const a = island.river[index]!, b = island.river[index + 1]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      for (let step = 0; step < 18; step++) {
        const t = (step + 0.5) / 18;
        const halfWidth = (a.width + (b.width - a.width) * t) / 2;
        for (const side of (slot % 2 ? [1, -1] : [-1, 1])) {
          for (const setback of [5.5, 4.5, 3.5, 2.5]) {
            const offset = side * (halfWidth + setback);
            const x = a.x + dx * t - dz / length * offset;
            const z = a.z + dz * t + dx / length * offset;
            const river = riverAt({ x, z }, island.river);
            const fromEdge = river.distance - river.width / 2;
            if (fromEdge < 2 || fromEdge > 6 ||
                gridSample(island, x, z) < river.level + 0.05 * scale ||
                !clearFor(kind, x, z)) continue;
            return { x, z, yaw: Math.atan2(dx, dz) };
          }
        }
      }
    }
    return undefined;
  }
  function trailSpot(kind: LooseKind, slot: number): LooseSpot | undefined {
    const trail = island.roads.find(road => road.from === forest &&
      road.to === 'old-lighthouse');
    if (!trail) return undefined;
    for (let i = 3; i < trail.points.length - 3; i += 3) {
      const p = trail.points[i]!, a = trail.points[i - 1]!, b = trail.points[i + 1]!;
      const fromWoods = Math.hypot(p.x - woods.x, p.z - woods.z);
      if (fromWoods < 16 * scale || fromWoods > 70 * scale) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      for (const side of (slot % 2 ? [-1, 1] : [1, -1])) {
        const offset = side * (trail.width / 2 + 3.5 + footprintRadius(kind) + 1.1);
        const x = p.x - dz / length * offset, z = p.z + dx / length * offset;
        if (!clearFor(kind, x, z)) continue;
        return { x, z, yaw: Math.atan2(dx, dz) };
      }
    }
    return undefined;
  }
  for (const [slot, kind] of looseKinds.entries()) {
    const placement = slot < 4
      ? bankSpot(kind, slot) ?? trailSpot(kind, slot)
      : trailSpot(kind, slot) ?? bankSpot(kind, slot);
    if (!placement) continue; // Very small/eroded islands are best-effort.
    const size = kind === 'log'
      ? { x: 1.0 * scale, y: 0.9 * scale, z: 4.5 * scale }
      : { x: 2.2 * scale, y: 1.6 * scale, z: 2.5 * scale };
    add(forest, kind, placement.x, placement.z, size, {
      shape: kind === 'rock' ? 'convex' : 'cylinder',
      dynamicMass: kind === 'log' ? 30 : undefined,
      yaw: kind === 'log'
        ? placement.yaw + (looseYaws[slot]! - Math.PI) * 0.04 : looseYaws[slot]!,
    });
    chosen.push({ ...placement, kind });
  }
  // Keep both overlooks north of the gnome course and outside the full log crossing.
  const { crossing } = pinesGladePlan(island, woods);
  const logReach = Math.hypot(1.5 * scale, crossing.width / 2 + (3 + PINES_LOG_ENTRY_LENGTH) * scale);
  const deckOffsets = [0, 2, -2, 4, -4, 6, -6, -8].flatMap(dz =>
    [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10, 12, -12, 14, -14, 16, -16].map(dx => [dx, dz] as const));
  for (const [dx, dz, width, depth, lift] of [[22, -3, 6, 4.5, 1.2], [18, -8, 5, 4, 2.1]] as const) {
    const radius = Math.hypot(width, depth) * scale / 2;
    for (const [shiftX, shiftZ] of deckOffsets) {
      const x = dx + shiftX, z = dz + shiftZ;
      if (z >= 0) continue;
      const point = at(forest, x, z);
      const river = riverAt(point, island.river);
      if (nearRoad(point.x, point.z, radius + 2 * scale) ||
          Math.hypot(point.x - crossing.x, point.z - crossing.z) <= Math.max(14 * scale, logReach + radius) ||
          river.distance < river.width / 2 + radius + 2 * scale ||
          gridSample(island, point.x, point.z) < island.seaLevel + scale ||
          props.some(prop => {
            if (prop.poiId !== forest) return false;
            const deltaX = Math.abs(prop.transform.position.x - point.x);
            const deltaZ = Math.abs(prop.transform.position.z - point.z);
            if (prop.kind === 'platform') {
              return deltaX < (prop.size.x + width * scale) / 2 + .5 * scale &&
                deltaZ < (prop.size.z + depth * scale) / 2 + .5 * scale;
            }
            return Math.hypot(deltaX, deltaZ) < radius + scale;
          })) continue;
      supportElevatedDeck(site(forest, 'platform', x, z, width, .48, depth, { lift }));
      break;
    }
  }
  site(forest, 'sign', 3, 8, 4, 3, 0.5, { yaw: -Math.PI / 3 });

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
  site(cape, 'lighthouse', -2, 1, 9, 29, 9, {
    shape: 'cylinder', color: 0xf5f0db, climbable: false,
  });
  // The original house remains part of the cape beside the hero cottage.
  site(cape, 'house', 15, -10, 9, 7, 9, { color: 0xf4e6d4 });
  site(cape, 'cottage', 16, 9, 10, 8, 9,
    { yaw: -0.16, color: 0xf8ebd6 });
  // Keep the existing cliff lookout and its grounded timber supports.
  supportElevatedDeck(site(cape, 'platform', -19, -9, 7, 1, 6, { lift: 4 }));
  for (let i = 0; i < 20; i++) {
    const a = rng.range(0, 2 * Math.PI), r = rng.range(13, 40);
    const p = at(cape, Math.cos(a) * r, Math.sin(a) * r);
    if (gridSample(island, p.x, p.z) < 0.4 * scale ||
        Math.hypot(p.x - (byId.get(cape)!.center.x + 2 * scale),
          p.z - (byId.get(cape)!.center.z + 23 * scale)) < 8 * scale) continue;
    // Draw all three dimensions on every eligible iteration to preserve the seed stream.
    const size = {
      x: rng.range(2, 7) * scale,
      y: rng.range(2, 5) * scale,
      z: rng.range(2, 6) * scale,
    };
    if (i % 2 === 0) add(cape, 'rock', p.x, p.z,
      { x: size.x * 0.55, y: size.y * 0.55, z: size.z * 0.55 },
      { yaw: a, shape: 'convex', lickable: false });
  }
  // Preserve the cape pole's x=26 anchor with the new wider pennant model.
  site(cape, 'flag', 27.25, 11, 2.8, 9, 0.4);

  // Roads have lamp posts / obstacles along the shoulders, not in driving lanes.
  // Exclude both the Dam plot and the wider 60 × 7.4 m solid walkway.
  const damPlot = island.plots.find(plot => plot.poiId === 'the-dam');
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
      const insideDamPlot = damPlot !== undefined &&
        Math.hypot(x - damPlot.center.x, z - damPlot.center.z) <= damPlot.radius;
      // Include the roadside lamp's half-width at the physical deck edges.
      const onDamWalkway = Math.abs(x - dam.position.x) <= (30 + 0.275) * scale &&
        Math.abs(z - dam.position.z) <= (3.7 + 0.275) * scale;
      if (insideDamPlot || onDamWalkway) continue;
      if (gridSample(island, x, z) > 2 * scale) {
        add(undefined, 'lamp', x, z,
          { x: 0.55 * scale, y: 8.5 * scale, z: 0.55 * scale },
          { shape: 'cylinder', breakable: true });
      }
    }
  }
  return props;
}

/** Meet the finished service-yard grade at the ramp mouth and keep the launch lip. */
export function fitDowntownServiceRamps(island: IslandData): void {
  const scale = island.size / 600;
  const ramps = island.props.filter(ramp => DOWNTOWN_SERVICE_RAMP.test(ramp.id));
  for (const ramp of ramps) {
    const { position, rotationY } = ramp.transform;
    const sin = Math.sin(rotationY), cos = Math.cos(rotationY);
    const halfWidth = ramp.size.x / 2, halfLength = ramp.size.z / 2;
    const groundAcross = (along: number) => Math.min(...[-halfWidth, 0, halfWidth].map(across =>
      gridSample(island, position.x + cos * across + sin * along,
        position.z - sin * across + cos * along)));
    const crown = position.y + ramp.size.y / 2;
    const mouth = Math.min(crown - .5 * scale, groundAcross(-halfLength) - .035 * scale);
    ramp.size.y = crown - mouth;
    position.y = (crown + mouth) / 2;

    // The lower side of the yard can fall away beyond the ramp's toe.
    // Fill a visible gap only where the existing ramp footprint needs support.
    const lowest = Math.min(...[-1, -.5, 0, .5, 1].map(factor => groundAcross(halfLength * factor)));
    const clearance = mouth - lowest;
    if (clearance <= .12 * scale) continue;
    const depth = clearance + .08 * scale;
    island.props.push({
      id: ramp.id + '-footing', kind: 'concrete-slab', poiId: 'downtown-bleatsville',
      transform: { position: { ...position, y: mouth - depth / 2 + .01 * scale }, rotationY },
      size: { ...ramp.size, y: depth }, shape: 'cuboid', body: STATIC,
      collidable: true, breakable: false, lickable: false, climbable: false,
    });
  }
}

/** Seat the seeded alley stock once the surrounding scenery and grades are final. */
export function seatDowntownStock(island: IslandData): void {
  const city = island.pois.find(poi => poi.id === 'downtown-bleatsville')!.center;
  const scale = island.size / 600;
  const stock = island.props.filter(prop => /^downtown-bleatsville-(crate|barrel)-\d+$/.test(prop.id));
  const nearby = (point: Vec2) => Math.abs(point.x - city.x) <= 65 * scale &&
    Math.abs(point.z - city.z) <= 65 * scale;
  const blockers = island.props.filter(prop => prop.collidable && nearby(prop.transform.position))
    .map(prop => DOWNTOWN_SERVICE_RAMP.test(prop.id)
      // Keep room on both shoulders, including the approach beyond each end.
      ? { ...prop, size: { ...prop.size, x: prop.size.x + scale, z: prop.size.z + 4 * scale } }
      : prop);
  const roads = island.roads.flatMap(road => road.points.slice(1).flatMap((end, index) => {
    const start = road.points[index]!;
    return nearby(start) || nearby(end) ? [{ start, end, halfWidth: road.width / 2 }] : [];
  }));
  const publicSpaces = downtownPublicSpaces(island);
  const relics = island.relics.filter(relic => nearby(relic.position));

  for (const prop of stock) {
    const { position } = prop.transform;
    const halfWidth = prop.size.x / 2, halfDepth = prop.size.z / 2;
    const radius = Math.hypot(halfWidth, halfDepth) + .15 * scale;
    const others = blockers.filter(other => other !== prop);
    const seated = (x: number, z: number): Vec3 => ({
      x, z, y: gridSample(island, x, z) + prop.size.y / 2,
    });
    const stableGround = ({ x, y, z }: Vec3): boolean => {
      // A steep slope can tip stock onto a corner hard enough to break it on load.
      const levels = [y - prop.size.y / 2,
        gridSample(island, x - halfWidth, z - halfDepth),
        gridSample(island, x - halfWidth, z + halfDepth),
        gridSample(island, x + halfWidth, z - halfDepth),
        gridSample(island, x + halfWidth, z + halfDepth)];
      return Math.min(...levels) > island.seaLevel && Math.max(...levels) - Math.min(...levels) <= .24 * scale;
    };
    const clear = (point: Vec3) => stableGround(point) &&
      !isPointInsideProps(point, others, radius) &&
      !downtownPublicSpaceAt(publicSpaces, point.x, point.z, radius) &&
      !roads.some(({ start, end, halfWidth }) =>
        segmentProjection(point, start, end).distance < halfWidth + radius + scale) &&
      !relics.some(({ position }) => Math.abs(point.y - position.y) < prop.size.y &&
        Math.hypot(point.x - position.x, point.z - position.z) < radius + .6 * scale);
    const originalSite = seated(position.x, position.z);
    if (clear(originalSite)) {
      position.y = originalSite.y;
      continue;
    }

    // Keep each original RNG roll, ID and side of town. Search nearby unoccupied
    // patches of the back verge when the original roll lands inside scenery.
    const side = Math.sign(position.x - city.x);
    const candidates: Vec3[] = [];
    for (let dx = 31; dx <= 49; dx += 2) for (let dz = -42; dz <= 42; dz += 2) {
      const x = city.x + side * dx * scale, z = city.z + dz * scale;
      candidates.push(seated(x, z));
    }
    const distance = (point: Vec2) => Math.hypot(point.x - position.x, point.z - position.z);
    candidates.sort((a, b) => distance(a) - distance(b));
    // Keep generation usable even if an unusually crowded verge has no open patch.
    Object.assign(position, candidates.find(clear) ?? originalSite);
  }
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
