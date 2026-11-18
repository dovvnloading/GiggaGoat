import type { IslandData, PropDescriptor, PropKind } from './types';
import { gridSample } from './terrain';

export function boardwalkPierDecks(island: IslandData): PropDescriptor[] {
  return island.props.filter(prop =>
    prop.poiId === 'baa-ardwalk' && prop.kind === 'pier' && prop.collidable);
}

interface Detail {
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
      id: 'baa-ardwalk-art-' + kind + '-' + serial++,
      kind, poiId: 'baa-ardwalk',
      transform: { position: { x, y, z }, rotationY: detail.yaw ?? 0 },
      size,
      body: detail.mass === undefined
        ? { type: 'static' } : { type: 'dynamic', mass: detail.mass },
      shape: detail.shape ?? 'cuboid',
      collidable: detail.collidable ?? true,
      breakable: detail.mass !== undefined,
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

  // Painted white two-rail balustrades are solid climbable edge protection.
  // Leave the landward entrance open; return around the widened wheel deck.
  for (let z = -33; z <= 39; z += 8) {
    for (const side of [-1, 1]) {
      place('pier-rail', side * 13.2, z, 8.0, 2.65, 0.5,
        { floor: deckY, yaw: Math.PI / 2, color: 0xffffff });
    }
  }
  for (let z = 48; z <= 64; z += 8) {
    for (const side of [-1, 1]) {
      place('pier-rail', side * 19.1, z, 8.1, 2.65, 0.5,
        { floor: headY, yaw: Math.PI / 2, color: 0xffffff });
    }
  }
  for (const x of [-15, -7.5, 0, 7.5, 15]) {
    place('pier-rail', x, 70.6, 7.6, 2.65, 0.5,
      { floor: headY, color: 0xffffff });
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
  const kioskSigns = [
    'kiosk-sign-icecream', 'kiosk-sign-popcorn', 'kiosk-sign-games',
    'kiosk-sign-prizes', 'kiosk-sign-candy',
  ] as const satisfies readonly PropKind[];
  for (let i = 0; i < 5; i++) {
    const z = -27 + i * 11;
    const side = i % 2 === 0 ? 1 : -1;
    const yaw = -side * Math.PI / 2;
    // Each GLB includes its own scalloped canopy, lanterns and counter goods.
    place(kioskKinds[i]!, side * 8.55, z, 5.0, 4.8, 4.5, {
      floor: deckY, yaw,
    });
    place(kioskSigns[i]!, side * 6.0, z, 4.6, 1.4, 0.3, {
      centreY: deckY + 4.2 * scale, yaw,
      color: 0xffe3a7, collidable: false,
    });
  }

  // Wheel feet rest on the broad terminal platform, not the beach or the sea.
  place('ferris-wheel', 0.5, 55, 29.5, 29, 4.6, {
    floor: headY, collidable: false, lickable: false, climbable: false,
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
  // Cargo occupies the gaps between stops, with two stacks on the west
  // and one between the games and the candy stall.
  for (const [x, z] of [[-6.5, -12], [7.2, 6], [-6.5, 27]] as const) {
    place('crate', x, z, 1.0, 1.0, 1.0, { floor: deckY });
    place('crate', x, z, 1.0, 1.0, 1.0, { floor: deckY + 1.0 * scale });
  }
  for (const z of [-11, 2, 23, 34]) {
    place('barrel', -9.6, z, 0.8, 1.0, 0.8, { floor: deckY });
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
