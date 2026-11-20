import type { IslandData, PropColliderDescriptor, PropDescriptor, PropKind, Vec3 } from './types';
import { accessGuard, type AccessSection } from './access-path';
import { gridSample } from './terrain';

export const SPLASH_DIVE_BOARD_ID = 'baa-ardwalk-splash-dive-board';
export const BOARDWALK_SHORE_ID = 'baa-ardwalk-shore-entry-';
export const BOARDWALK_SHORE_GUARD_ID = BOARDWALK_SHORE_ID + 'guard-';
const FERRIS_END_RAIL_INSET = .4;

export function boardwalkPierDecks(island: IslandData): PropDescriptor[] {
  return island.props.filter(prop =>
    prop.poiId === 'baa-ardwalk' && (prop.kind === 'pier' || prop.id === SPLASH_DIVE_BOARD_ID) && prop.collidable);
}

/** Select only the seaward row across the end of the Ferris wheel deck. */
export function boardwalkFarEnd(island: IslandData) {
  const deck = boardwalkPierDecks(island).filter(prop => prop.kind === 'pier').at(-1);
  if (!deck) return null;
  const edgeZ = deck.transform.position.z + deck.size.z / 2;
  const railZ = edgeZ - FERRIS_END_RAIL_INSET * island.size / 600;
  const rails = island.props.filter(prop => prop.poiId === 'baa-ardwalk' &&
    prop.kind === 'pier-rail' && prop.collidable && !prop.climbable && prop.body.type === 'static' &&
    Math.abs(prop.transform.position.z - railZ) < .001);
  return { deck, edgeZ, rails };
}

// Bind the eight supports to the fitted white steel in ferris-wheel.glb.
const WHEEL_HEIGHT = 29;
const WHEEL_MODEL_MIN_Y = -.131678;
const WHEEL_MODEL_DEPTH = 5;
const WHEEL_MODEL_WIDTH = 29.5;
const WHEEL_MODEL_CENTER_Y = (WHEEL_HEIGHT + WHEEL_MODEL_MIN_Y) / 2;
const WHEEL_MODEL_SPAN_Y = WHEEL_HEIGHT - WHEEL_MODEL_MIN_Y;

// Lower ring of the +X/+Z diagonal beam. Its top ring is the same
// eight points translated towards the hub. The other beams mirror it.
const WHEEL_BRACE_BASE: readonly (readonly [number, number, number])[] = [
  [8.152895, -.131678, 2.050416], [8.225565, -.094289, 1.852308],
  [8.224977, -.091932, 2.248281], [8.400416, -.001666, 1.770005],
  [8.399584, .001666, 2.329995], [8.575024, .091932, 1.851719],
  [8.574435, .094289, 2.247692], [8.647104, .131678, 2.049584],
];

function wheelModelY(y: number, height: number): number {
  return (y - WHEEL_MODEL_CENTER_Y) * .98 * height / WHEEL_MODEL_SPAN_Y;
}

export function boardwalkWheelSupports(wheel: PropDescriptor): PropColliderDescriptor[] {
  const { position, rotationY } = wheel.transform;
  const xScale = .98 * wheel.size.x / WHEEL_MODEL_WIDTH;
  const yScale = .98 * wheel.size.y / WHEEL_MODEL_SPAN_Y;
  const zScale = .98 * wheel.size.z / WHEEL_MODEL_DEPTH;
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  function worldPosition(x: number, y: number, z: number): Vec3 {
    const across = x * xScale, along = z * zScale;
    return {
      x: position.x + cos * across + sin * along,
      y: position.y + wheelModelY(y, wheel.size.y),
      z: position.z - sin * across + cos * along,
    };
  }
  const supports: PropColliderDescriptor[] = [];
  for (const [side, across] of [[-1, 'left'], [1, 'right']] as const) {
    for (const [row, along] of [[-1, 'shore'], [1, 'sea']] as const) {
      const id = wheel.id + '-' + across + '-' + along;
      supports.push({
        id: id + '-pad', shape: 'cuboid', body: wheel.body,
        transform: { position: worldPosition(side * 8.4, .15, row * 2.05), rotationY },
        size: { x: xScale, y: .30 * yScale, z: .90 * zScale },
      });
      const centreX = 4.35, centreY = 7.6, centreZ = 1.99875;
      const beam: number[] = [];
      for (const [dx, dy, dz] of [[0, 0, 0], [-8.10, 15.20, -.1025]] as const) {
        for (const [x, y, z] of WHEEL_BRACE_BASE) {
          beam.push(side * (x + dx - centreX) * xScale,
            (y + dy - centreY) * yScale, row * (z + dz - centreZ) * zScale);
        }
      }
      supports.push({
        id: id + '-brace', shape: 'convex', body: wheel.body,
        transform: { position: worldPosition(side * centreX, centreY, row * centreZ), rotationY },
        size: { x: 8.594209 * xScale, y: 15.463356 * yScale, z: .662490 * zScale },
        vertices: new Float32Array(beam),
      });
    }
  }
  return supports;
}

/** The same sloped tread, guard and pile positions drive art and collision. */
export function boardwalkShoreEntry(island: IslandData) {
  const pier = boardwalkPierDecks(island).find(prop => prop.kind === 'pier');
  if (!pier) return null;
  const scale = island.size / 600;
  const { x, y, z } = pier.transform.position;
  const shore = z - pier.size.z / 2;
  const halfWidth = 5 * scale;
  const start = shore - 7.5 * scale;
  const end = shore + 1.05 * scale;
  // Bury the leading sill where the beach is still firm across the entire mouth.
  const startY = Math.min(...[-halfWidth, 0, halfWidth].map(dx =>
    gridSample(island, x + dx, start))) - .045 * scale;
  const endY = y + pier.size.y / 2 - .02 * scale;
  const section = (at: number): AccessSection => {
    const height = startY + (endY - startY) * (at - start) / (end - start);
    return { outer: { x: x - halfWidth, y: height, z: at }, inner: { x: x + halfWidth, y: height, z: at } };
  };
  const sections = [section(start), section(end)] as const;
  const guarded = [section(shore - 4.1 * scale), sections[1]];
  const guards = [accessGuard(guarded, 'outer', scale), accessGuard(guarded, 'inner', scale)];
  const thickness = .26 * scale;
  const piles: PropColliderDescriptor[] = [-1, 1].map((side, index) => {
    const pileZ = shore - .9 * scale;
    const pileX = x + side * (halfWidth - .54 * scale);
    const top = section(pileZ).outer.y - thickness * .75;
    const bottom = Math.min(top - .08 * scale, gridSample(island, pileX, pileZ) - .23 * scale);
    return {
      id: BOARDWALK_SHORE_ID + 'pile-' + index,
      shape: 'cuboid', body: { type: 'static' },
      transform: { position: { x: pileX, y: (top + bottom) / 2, z: pileZ }, rotationY: 0 },
      size: { x: .38 * scale, y: top - bottom, z: .38 * scale },
    };
  });
  return { sections, guards, thickness, piles, scale };
}

interface Detail {
  id?: string;
  /** The ground or deck surface supporting the bottom of this object. */
  floor?: number;
  /** World-space centre for suspended decorations and underwater piles. */
  centreY?: number;
  yaw?: number;
  color?: number;
  shape?: PropDescriptor['shape'];
  mass?: number;
  collidable?: boolean;
  climbable?: boolean;
  lickable?: boolean;
}

/**
 * The Baa-ardwalk is assembled in one coordinate system. All offsets are in
 * unscaled metres relative to the seed-jittered POI centre, facing out to sea
 * (+Z). In particular, NOTHING on the pier uses the beach height as its floor.
 *
 * The shore end is on dry land; the wide far platform sits beyond the surf.
 * Decks overlap at one level so neither visuals nor physics have a gap.
 */
export function buildBaaardwalk(island: IslandData): PropDescriptor[] {
  const scale = island.size / 600;
  const centre = island.pois.find(p => p.id === 'baa-ardwalk')!.center;
  const result: PropDescriptor[] = [];
  let serial = 0;

  // Sample along the shore axis for the first waterline crossing, keeping
  // 6 m of decking on dry sand and never shifting the pier landward.
  const originalShore = -38;
  let shore = originalShore;
  for (let dz = -60; dz <= 40; dz++) {
    if (gridSample(island, centre.x, centre.z + dz * scale) <
      island.seaLevel + 0.3 * scale) {
      shore = Math.max(originalShore, dz - 6);
      break;
    }
  }
  const shoreShift = shore - originalShore;

  function place(kind: PropKind, dx: number, dz: number,
    sx: number, sy: number, sz: number, detail: Detail = {}): PropDescriptor {
    const x = centre.x + dx * scale, z = centre.z + (dz + shoreShift) * scale;
    const size = { x: sx * scale, y: sy * scale, z: sz * scale };
    const floor = detail.floor ?? gridSample(island, x, z);
    const y = detail.centreY ?? floor + size.y / 2;
    const prop: PropDescriptor = {
      id: detail.id ?? 'baa-ardwalk-art-' + kind + '-' + serial++,
      kind, poiId: 'baa-ardwalk',
      transform: { position: { x, y, z }, rotationY: detail.yaw ?? 0 },
      size,
      body: detail.mass === undefined
        ? { type: 'static' } : { type: 'dynamic', mass: detail.mass },
      shape: detail.shape ?? 'cuboid',
      collidable: detail.collidable ?? true,
      breakable: detail.mass !== undefined && kind !== 'bumper',
      lickable: detail.lickable ?? true,
      climbable: detail.climbable ?? (detail.mass === undefined && detail.collidable !== false),
      ...(detail.color === undefined ? {} : { color: detail.color }),
    };
    result.push(prop);
    return prop;
  }

  // Anchor the deck top to the sand height at the new shore.
  const beachY = gridSample(island, centre.x, centre.z + shore * scale);
  const deckY = Math.max(beachY + 0.42 * scale, 4.8 * scale);
  const headY = deckY + 0.04 * scale;
  const thickness = 0.92;
  const mainEnd = 45, headStart = 44, headEnd = 71;
  place('pier', 0, (originalShore + mainEnd) / 2, 27, thickness, mainEnd - originalShore,
    { floor: deckY - thickness * scale, color: 0xbd8353 });
  place('pier', 0, (headStart + headEnd) / 2, 39, thickness, headEnd - headStart,
    { floor: headY - thickness * scale, color: 0xc18c60 });

  // Rows of timber piles genuinely reach into the water beneath the deck.
  for (let z = -29; z <= 70; z += 11) {
    for (const side of [-1, 1]) {
      const isHead = z > 44;
      const x = side * (isHead ? 17 : 11.8);
      const top = (isHead ? headY : deckY) - thickness * scale;
      const bottom = -3.4 * scale;
      const pileHeight = top - bottom;
      place('scaffold', x, z, 0.92, pileHeight / scale, 0.92, {
        centreY: (top + bottom) / 2, color: 0x946641,
      });
    }
  }

  // Painted white two-rail balustrades keep ordinary walking on the deck.
  // Leave the landward entrance open; return around the widened wheel deck.
  for (let z = -33; z <= 39; z += 8) {
    for (const side of [-1, 1]) {
      if (side === 1 && z === 23) {
        // Leave a wide doorway to the diving board between the promenade rails.
        place('pier-rail', 13.2, z - 3.1, 1.8, 2.65, 0.5,
          { floor: deckY, yaw: Math.PI / 2, color: 0xffffff, climbable: false });
        place('pier-rail', 13.2, z + 3.1, 1.8, 2.65, 0.5,
          { id: 'baa-ardwalk-splash-dive-rail', floor: deckY, yaw: Math.PI / 2,
            color: 0xffffff, climbable: false });
        continue;
      }
      place('pier-rail', side * 13.2, z, 8.0, 2.65, 0.5,
        { floor: deckY, yaw: Math.PI / 2, color: 0xffffff, climbable: false });
    }
  }
  place('platform', 15.25, 23, 4.1, .42, 3.8,
    { id: SPLASH_DIVE_BOARD_ID, floor: deckY - .42 * scale, color: 0x57a9b2 });
  for (let z = 48; z <= 64; z += 8) {
    for (const side of [-1, 1]) {
      place('pier-rail', side * 19.1, z, 8.1, 2.65, 0.5,
        { floor: headY, yaw: Math.PI / 2, color: 0xffffff, climbable: false });
    }
  }
  for (const x of [-15, -7.5, 0, 7.5, 15]) {
    place('pier-rail', x, headEnd - FERRIS_END_RAIL_INSET, 7.6, 2.65, 0.5,
      { floor: headY, color: 0xffffff, climbable: false });
  }

  // Painted life rings face out along their local +Z on both main-pier rails.
  // The pier/rail remains the supporting collider; the rings are decorative.
  for (const side of [-1, 1]) for (const z of [-25, 7, 39]) {
    place('life-ring', side * 13.45, z, 0.9, 0.9, 0.2, {
      centreY: deckY + 0.9 * scale, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2,
      collidable: false, lickable: false, climbable: false,
    });
  }

  // Alternate the kiosks across the promenade. The glTF +Z front always
  // faces the walking lane, regardless of which rail the stall backs onto.
  const kioskKinds = [
    'kiosk-icecream', 'kiosk-popcorn', 'kiosk-games',
    'kiosk-prizes', 'kiosk-candy',
  ] as const satisfies readonly PropKind[];
  for (let i = 0; i < 5; i++) {
    const z = -27 + i * 11;
    const side = i % 2 === 0 ? 1 : -1;
    const yaw = -side * Math.PI / 2;
    // Each GLB includes its own scalloped canopy, lanterns and counter goods.
    place(kioskKinds[i]!, side * 8.55, z, 5.0, 4.8, 4.5, {
      floor: deckY, yaw,
    });
    serial++; // Retired roof sign slot. Keep the original stock and fixture IDs.
  }

  // The centred fit leaves the actual pads above the box floor. Set
  // their baked bottom on the terminal deck, including on scaled islands.
  const padLift = (WHEEL_HEIGHT / 2 + wheelModelY(0, WHEEL_HEIGHT)) * scale;
  place('ferris-wheel', 0.5, 55, WHEEL_MODEL_WIDTH, WHEEL_HEIGHT, 4.6, {
    floor: headY - padLift, collidable: false, lickable: false, climbable: false,
  });
  // Lamps and strung triangular pennants echo the illuminated painting.
  for (const z of [-29, -11, 7, 25, 39]) {
    place('lamp', -11.3, z, 0.72, 7.8, 0.72,
      { floor: deckY, shape: 'cylinder', color: 0xffedc2 });
  }
  for (const x of [-16.2, 16.2]) {
    place('lamp', x, 65, 0.72, 7.8, 0.72,
      { floor: headY, shape: 'cylinder', color: 0xffedc2 });
  }
  const pennants = { yaw: Math.PI / 2, collidable: false, lickable: false, climbable: false };
  // Keep the strings attached to the west-side lamps and rail posts so
  // the approach opens onto the wheel and the full width of the promenade.
  place('bunting', -11.3, -20, 18.0, 1.5, 0.22, {
    ...pennants, centreY: deckY + 6.2 * scale,
  });
  for (const z of [-25, -9]) {
    place('bunting', -13.08, z, 7.6, 1.0, 0.16, {
      ...pennants, centreY: deckY + 1.9 * scale,
    });
  }

  for (const z of [-21, -2, 17]) {
    place('bench', -8.2, z, 2.0, 0.95, 0.75,
      { floor: deckY, yaw: -Math.PI / 2, color: 0xa77853 });
  }
  // Seating bays sit between the kiosks. Keep the dive board and trampoline
  // approaches open, and turn the benches in toward the walking lane.
  for (const [side, z] of [[-1, -32], [1, -18], [1, 1], [-1, 30], [1, 40]] as const) {
    place('bench', 9.9 * side, z, 2, .95, .75,
      { id: 'baa-ardwalk-promenade-bench-' + z, floor: deckY, yaw: -side * Math.PI / 2 });
    for (const end of [-1, 1]) {
      place('planter', 10.1 * side, z + end * 1.92, 1.42, .98, 1.42, {
        id: 'baa-ardwalk-promenade-planter-' + z + '-' + end, floor: deckY,
      });
    }
  }
  // Cargo occupies the gaps between stops, with two stacks on the west
  // and one between the games and the candy stall.
  for (const [x, z] of [[-6.5, -12], [7.2, 6], [-6.5, 27]] as const) {
    place('crate', x, z, 1.0, 1.0, 1.0, { floor: deckY, mass: 8 });
    place('crate', x, z, 1.0, 1.0, 1.0, { floor: deckY + 1.0 * scale, mass: 8 });
  }
  for (const z of [-11, 2, 23, 34]) {
    place('barrel', -9.6, z, 0.8, 1.0, 0.8, { floor: deckY, mass: 7, shape: 'cylinder' });
  }
  // Game registers the spring surface at this art's bounds.
  place('trampoline', 7.8, 33, 3.6, 0.8, 3.6, {
    floor: deckY, color: 0x5d8fe6, collidable: false, lickable: false, climbable: false,
  });
  place('bench', -15.5, 67, 2.0, 0.95, 0.75,
    { floor: headY, yaw: Math.PI / 2 });
  place('bench', 15.5, 67, 2.0, 0.95, 0.75,
    { floor: headY, yaw: Math.PI / 2 });

  // The sandy forecourt is landward of the shore entrance; skip any
  // independently sampled piece if this seed's coastline reaches it.
  function placeDryForecourt(kind: 'bumper' | 'bench', dx: number, dz: number,
    sx: number, sy: number, sz: number, detail: Detail): void {
    const x = centre.x + dx * scale;
    const z = centre.z + (dz + shoreShift) * scale;
    if (gridSample(island, x, z) < 1.0) return;
    place(kind, dx, dz, sx, sy, sz, detail);
  }
  for (const side of [-1, 1]) {
    placeDryForecourt('bumper', side * 10, -42, 1.0, 1.0, 1.0,
      { mass: 10, shape: 'cylinder', color: side < 0 ? 0xffb76a : 0x75c4e0 });
    placeDryForecourt('bench', side * 15, -46, 2.0, 0.95, 0.75,
      { yaw: Math.PI / 3, color: 0x9e7653 });
  }
  // Four coastal palms; never plant the model below the actual shifted
  // waterline. Use place() so positions follow the same shoreShift as the pier.
  for (const [dx, dz, height, yaw] of [
    [-24, -44, 9.5, 0.4], [-31, -52, 10.5, 2.1],
    [26, -48, 10, 3.6], [34, -41, 9, 5.2],
  ] as const) {
    const x = centre.x + dx * scale;
    const z = centre.z + (dz + shoreShift) * scale;
    if (gridSample(island, x, z) < island.seaLevel + 0.3 * scale) continue;
    place('palm-tree', dx, dz, height * 0.5, height, height * 0.5,
      { yaw });
  }
  place('bench', -7.8, 33.5, 2.0, 0.95, 0.75,
    { floor: deckY, yaw: -Math.PI / 2, color: 0xa77853 });
  return result;
}
