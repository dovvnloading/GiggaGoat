import type { IslandData, PropDescriptor, PropKind } from './types';
import { gridSample } from './terrain';

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

  function place(kind: PropKind, dx: number, dz: number,
    sx: number, sy: number, sz: number, detail: Detail = {}): PropDescriptor {
    const x = centre.x + dx * scale, z = centre.z + dz * scale;
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

  // This threshold starts well inland even for the jittered seeds and scales.
  // Match the first plank to the actual beach height, not an arbitrary sea Y.
  const shore = -38;
  const beachY = gridSample(island, centre.x, centre.z + shore * scale);
  const deckY = Math.max(beachY + 0.42 * scale, 4.8 * scale);
  const headY = deckY + 0.04 * scale;
  const thickness = 0.92;
  const mainEnd = 45, headStart = 44, headEnd = 71;
  place('pier', 0, (shore + mainEnd) / 2, 27, thickness, mainEnd - shore,
    { floor: deckY - thickness * scale, color: 0xbd8353 });
  place('deck', 0, (headStart + headEnd) / 2, 39, thickness, headEnd - headStart,
    { floor: headY - thickness * scale, color: 0xc18c60 });

  // Rows of timber piles genuinely reach into the water beneath the deck.
  for (let z = -29; z <= 68; z += 11) {
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

  // Candy-coloured snack kiosks occupy the LEFT strip of the WALKABLE deck.
  // Their fronts, striped awnings and signs face the central promenade (+X).
  const paints = [0xf0757c, 0xffc567, 0x65c8cc, 0xd78abf, 0xff9469];
  for (let i = 0; i < 5; i++) {
    const z = -27 + i * 11;
    const shopHeight = 6.8;
    place('booth', -7.6, z, 7.2, shopHeight, 6.4, {
      floor: deckY, yaw: Math.PI / 2, color: paints[i],
    });
    place('awning', -3.3, z, 7.4, 1.0, 2.5, {
      centreY: deckY + 4.55 * scale, yaw: Math.PI / 2,
      color: i % 2 ? 0xffd365 : 0xf57e8d, collidable: false,
    });
    place('signboard', -4.1, z, 4.6, 1.4, 0.3, {
      centreY: deckY + 6.0 * scale, yaw: Math.PI / 2,
      color: 0xffe3a7, collidable: false,
    });
  }

  // Wheel feet rest on the broad terminal platform, not the beach or the sea.
  place('ferris-wheel', 0.5, 55, 29.5, 29, 4.6, {
    floor: headY, collidable: false, lickable: false, climbable: false,
  });
  for (const x of [-8.2, 8.2]) {
    place('scaffold', x, 55, 1.3, 8.0, 1.3,
      { floor: headY, color: 0xd9af91 });
  }

  // Lamps and strung triangular pennants echo the illuminated painting.
  for (const z of [-29, -11, 7, 25, 39]) {
    place('lamp', 11.3, z, 0.85, 8.4, 0.85,
      { floor: deckY, shape: 'cylinder', color: 0xffedc2 });
  }
  for (const x of [-16.2, 16.2]) {
    place('lamp', x, 65, 0.85, 8.4, 0.85,
      { floor: headY, shape: 'cylinder', color: 0xffedc2 });
  }
  for (const z of [-30, -19, -8, 3, 14, 25, 36]) {
    place('bunting', 0, z, 22.8, 2.4, 0.3, {
      centreY: deckY + 7.4 * scale, collidable: false,
      lickable: false, climbable: false,
    });
  }

  for (const z of [-21, -2, 17]) {
    place('bench', 8.2, z, 3.5, 1.5, 1.2,
      { floor: deckY, yaw: Math.PI / 2, color: 0xa77853 });
  }
  place('trampoline', 2, 33, 7, 1.1, 7,
    { floor: deckY, color: 0x5d8fe6 });
  place('bench', -15.5, 67, 3.5, 1.5, 1.2,
    { floor: headY, yaw: Math.PI / 2 });
  place('bench', 15.5, 67, 3.5, 1.5, 1.2,
    { floor: headY, yaw: Math.PI / 2 });

  // A real sandy forecourt remains in front of the shore entrance.
  for (const side of [-1, 1]) {
    place('bumper', side * 29, -28, 2.4, 2.3, 2.4,
      { mass: 10, shape: 'cylinder', color: side < 0 ? 0xffb76a : 0x75c4e0 });
    place('bench', side * 22, -32, 3.5, 1.5, 1.2,
      { yaw: Math.PI / 3, color: 0x9e7653 });
  }
  return result;
}
