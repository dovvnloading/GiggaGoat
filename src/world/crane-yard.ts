import type { IslandData, PropDescriptor, PropKind } from './types';
import { gridSample } from './terrain';

/** Metre-space plan shared by the layout and its regression tests.
 * +Z is the public approach; the road continues through the north gate.
 */
export const CRANE_YARD_PLAN = {
  halfWidth: 40,
  halfDepth: 36,
  tower: { x: -19, z: -7, width: 29, depth: 26, roof: 23.6 },
  crane: { x: 21, z: -12, height: 40.5, jibLength: 78 },
  frontGate: { min: 8, max: 32 },
  rearGate: { min: -16, max: 8 },
} as const;

interface YardOptions {
  /** Height of the bottom of the prop, in metres above the central paved pad. */
  bottom?: number;
  /** Upper storeys share the same datum instead of tilting with terrain. */
  fixedToPad?: boolean;
  yaw?: number;
  color?: number;
  dynamicMass?: number;
  collidable?: boolean;
  climbable?: boolean;
  shape?: PropDescriptor['shape'];
}

/**
 * A deliberately composed, walkable construction site, not randomly scattered
 * scaffold columns. Structural slabs, columns, mast, rails and cargo remain
 * individual physics props; cables are visual-only. All positions and sizes
 * scale together with the island and are seed-stable relative to its POI.
 */
export function buildCraneYard(island: IslandData): PropDescriptor[] {
  const poi = island.pois.find(p => p.id === 'crane-yard');
  if (!poi) throw new Error('Crane Yard POI is required');
  const centre = poi.center;
  const scale = island.size / 600;
  const padY = gridSample(island, centre.x, centre.z);
  const props: PropDescriptor[] = [];
  let serial = 0;

  function put(kind: PropKind, dx: number, dz: number,
    width: number, height: number, depth: number, options: YardOptions = {}): PropDescriptor {
    const x = centre.x + dx * scale;
    const z = centre.z + dz * scale;
    const size = { x: width * scale, y: height * scale, z: depth * scale };
    const ground = options.fixedToPad ? padY : gridSample(island, x, z);
    const prop: PropDescriptor = {
      id: 'crane-yard-' + kind + '-' + serial++,
      kind, poiId: 'crane-yard',
      transform: {
        position: { x, y: ground + ((options.bottom ?? 0) + height / 2) * scale, z },
        rotationY: options.yaw ?? 0,
      },
      size, shape: options.shape ?? 'cuboid',
      body: options.dynamicMass === undefined
        ? { type: 'static' } : { type: 'dynamic', mass: options.dynamicMass },
      collidable: options.collidable ?? true,
      breakable: options.dynamicMass !== undefined,
      lickable: options.collidable !== false,
      climbable: options.climbable ?? (options.dynamicMass === undefined && options.collidable !== false),
      ...(options.color === undefined ? {} : { color: options.color }),
    };
    props.push(prop);
    return prop;
  }

  // Compatibility marker for the existing demolition gig, which still
  // locates its spawn via kind='tower'. Keep its footprint negligible and
  // non-colliding so it cannot fill or block our genuinely open concrete bays.
  put('tower', -12, 13, 0.07, 0.07, 0.07,
    { fixedToPad: true, collidable: false, climbable: false });

  // Four genuine concrete floors with open bays; their horizontal colliders
  // let goats land on each level rather than a fake solid tower-sized box.
  const { tower, crane } = CRANE_YARD_PLAN;
  for (const x of [-32, -19, -6]) for (const z of [-18, -7, 4]) {
    put('concrete-column', x, z, 1.65, 27.5, 1.65,
      { fixedToPad: true, color: 0xd3d6d7 });
  }
  for (const bottom of [4.5, 10.7, 16.9, 23.1]) {
    put('concrete-slab', tower.x, tower.z, tower.width, 1.15, tower.depth,
      { bottom, fixedToPad: true, color: 0xcdd0d1 });
    const railBottom = bottom + 1.15;
    // Two front runs leave a break beside the yellow access scaffold.
    for (const x of [-26, -12]) {
      put('safety-rail', x, 6.4, 13.1, 1.25, 0.18,
        { bottom: railBottom, fixedToPad: true });
    }
    put('safety-rail', -19, -20.4, 28, 1.25, 0.18,
      { bottom: railBottom, fixedToPad: true });
    for (const x of [-33.9, -4.1]) {
      put('safety-rail', x, -7, 24.8, 1.25, 0.18,
        { bottom: railBottom, fixedToPad: true, yaw: Math.PI / 2 });
    }
  }
  // Distinct yellow tube scaffolding at the camera-facing left/front face,
  // with cross braces, ladder rungs and real intermediate platform decks.
  put('yard-scaffold', -35.7, 3.4, 4.6, 22.7, 9.3,
    { fixedToPad: true, color: 0xffcb35 });
  put('yard-scaffold', -28.2, 8.6, 10.5, 17.6, 3.2,
    { fixedToPad: true, color: 0xf6c22e });
  for (const level of [5.8, 11.9, 18.0]) {
    put('concrete-slab', -28.2, 8.8, 9.5, 0.55, 3,
      { bottom: level, fixedToPad: true, color: 0xa0a4a6 });
  }
  put('bunting', -18.7, 6.9, 20, 1.4, 0.12,
    { bottom: 16, fixedToPad: true, collidable: false });
  put('flag', -12.5, 7.15, 4, 3.2, 0.15,
    { bottom: 12.4, fixedToPad: true, color: 0xf47a46, collidable: false });

  // Main yellow tower crane: a tall solid-footprint lattice mast, horizontal
  // triangular truss, glazed operator cabin and a visibly *hanging* red beam.
  put('crane', crane.x, crane.z, 3.35, crane.height, 3.35,
    { fixedToPad: true, color: 0xffc824 });
  put('crane-jib', 13, crane.z, crane.jibLength, 3.1, 3.25,
    { bottom: 38.2, fixedToPad: true, color: 0xffcd2d });
  put('crane-cab', 24.5, crane.z + 3.0, 5.2, 3.7, 4.1,
    { bottom: 34.9, fixedToPad: true });
  put('beam', -19, crane.z, 6.3, 3.5, 3.4,
    { bottom: 37.8, fixedToPad: true, color: 0x555964 });
  put('crane-cable', 43, crane.z, 0.17, 11.65, 0.17,
    { bottom: 26.65, fixedToPad: true, collidable: false });
  put('red-girder', 43, crane.z, 21.5, 1.5, 1.65,
    { bottom: 25.15, fixedToPad: true, color: 0xee4a31 });
  // Short V-shaped lifting slings, one on each end of the suspended girder.
  for (const x of [35.3, 50.7]) {
    put('crane-cable', x, crane.z, 0.12, 2.4, 0.12,
      { bottom: 26.65, fixedToPad: true, collidable: false });
  }
  put('concrete-slab', crane.x, crane.z, 5.8, 1.1, 5.8,
    { fixedToPad: true, color: 0x999da2 });

  // A second, smaller tower crane behind the main building adds the art's
  // overlapping depth without a forest of unsupported scaffold poles.
  put('crane', -1.8, -30, 2.5, 29.5, 2.5,
    { fixedToPad: true, color: 0xffd439 });
  put('crane-jib', -12, -30, 43, 2.2, 2.5,
    { bottom: 27.4, fixedToPad: true, color: 0xffd438 });
  put('crane-cable', -30, -30, 0.12, 7.1, 0.12,
    { bottom: 20.3, fixedToPad: true, collidable: false });
  put('crate', -30, -30, 3.1, 2.7, 3,
    { bottom: 17.6, fixedToPad: true, color: 0x9d744a });

  // Perimeter chain-link fence, not Hoofington's solid white pickets.
  // Two gated breaks align with the through-road and are left traversable.
  for (let i = 0; i < 10; i++) {
    const x = -36 + i * 8;
    if (x !== 12 && x !== 20 && x !== 28) {
      put('chain-fence', x, CRANE_YARD_PLAN.halfDepth, 8, 2.85, 0.18);
    }
    if (x !== -12 && x !== -4 && x !== 4) {
      put('chain-fence', x, -CRANE_YARD_PLAN.halfDepth, 8, 2.85, 0.18);
    }
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      put('chain-fence', side * CRANE_YARD_PLAN.halfWidth,
        -32 + i * 8, 8, 2.85, 0.18, { yaw: Math.PI / 2 });
    }
  }
  // Gates swung back into the yard so they read as real construction entrances.
  put('chain-fence', 9.0, 33.3, 5.7, 2.85, 0.18, { yaw: 1.10 });
  put('chain-fence', 31.0, 33.3, 5.7, 2.85, 0.18, { yaw: -1.10 });
  put('chain-fence', -15.5, -33.1, 4.3, 2.85, 0.18, { yaw: -1.15 });
  put('chain-fence', 7.5, -33.1, 4.3, 2.85, 0.18, { yaw: 1.15 });

  // Containers hug the rear and side fence instead of covering the building.
  for (const [x, z, yaw, color] of [
    [-31, -28, 0, 0x4589ba], [-17, -31, 0, 0x367da7],
    [33, 24, Math.PI / 2, 0xc95241], [33, 7, Math.PI / 2, 0xda6844],
    [33, -26, Math.PI / 2, 0x4c98ad],
  ] as const) {
    put('container', x, z, 12.2, 4.6, 5.3, { yaw, color });
  }

  // Deliberate cargo stacks, pipe pyramids, worksite cones and striped blocks.
  for (const [x, z, count] of [
    [17, 23, 3], [24, 23, 2], [17, 28, 2], [-15, 22, 2], [-21, 22, 1],
  ] as const) {
    for (let level = 0; level < count; level++) {
      put('crate', x, z, 3.6, 3.0, 3.6,
        { bottom: level * 3, fixedToPad: true, color: level % 2 ? 0xae7d4e : 0xc39159 });
    }
  }
  for (const [x, z] of [[-29, 25], [-20, 27], [28, -24]] as const) {
    put('pipe-stack', x, z, 6, 4.2, 6.2,
      { color: 0xb3b7b9 });
  }
  for (const [x, z] of [[29, 16], [31, 12], [26, 17], [-29, 15]] as const) {
    put('barrel', x, z, 1.9, 2.3, 1.9,
      { color: 0xdd9c35, dynamicMass: 12, climbable: false, shape: 'cylinder' });
  }
  for (const [x, z, yaw] of [
    [-35, 28, 0], [-28, 31, 0], [-18, 31, 0], [2, 31, 0],
    [10, 31, 0], [33, 33, Math.PI / 2], [34, -1, Math.PI / 2],
    [-34, -13, Math.PI / 2],
  ] as const) {
    put('site-barrier', x, z, 4.3, 1.65, 0.9,
      { yaw, color: 0xf8efdf });
  }
  for (const [x, z] of [
    [-25, 18], [-19, 18], [-13, 18], [-7, 18], [0, 18], [7, 18],
    [10, 27], [29, 28], [35, 28], [-31, 11], [-29, 3],
    [13, -20], [28, -20], [12, 3], [30, -4],
  ] as const) {
    put('cone', x, z, 1.0, 1.65, 1.0,
      { color: 0xff8e21, dynamicMass: 2, climbable: false, shape: 'cylinder' });
  }
  return props;
}
