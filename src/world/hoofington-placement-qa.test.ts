import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { RAPIER, V } from '../physics';
import { HOOFINGTON_FIELD_ENTRANCES, HOOFINGTON_HAUL_CONNECTOR } from './hoofington-entrances';
import type { PropDescriptor, Vec3 } from './types';
import { generateIsland } from './island';
import { makeLocalStreets } from './roads';
import { gridSample } from './terrain';
import { makeHoofingtonPlacements } from './visual-hoofington';

interface Placed {
  id: string;
  kind: string;
  position: Vec3;
  size: Vec3;
  yaw: number;
}

function asPlaced(prop: PropDescriptor): Placed {
  return {
    id: prop.id, kind: prop.kind, position: prop.transform.position,
    size: prop.size, yaw: prop.transform.rotationY,
  };
}

const BUILDINGS = new Set(['house', 'cottage', 'barn', 'silo', 'windmill']);
const GARDEN = new Set(['fence', 'mailbox', 'lamp', 'flower', 'bush', 'planter']);

/** The four real corners, not an unrotated or circular approximation. */
function corners(item: Placed): Array<{ x: number; z: number }> {
  const c = Math.cos(item.yaw), s = Math.sin(item.yaw);
  const result: Array<{ x: number; z: number }> = [];
  for (const x of [-item.size.x / 2, item.size.x / 2]) {
    for (const z of [-item.size.z / 2, item.size.z / 2]) {
      result.push({
        x: item.position.x + c * x + s * z,
        z: item.position.z - s * x + c * z,
      });
    }
  }
  return result;
}

/** Separating axis theorem for yaw-rotated rectangular footprints. */
function overlaps(a: Placed, b: Placed): boolean {
  const aa = corners(a), bb = corners(b);
  for (const angle of [a.yaw, b.yaw]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const axis of [{ x: c, z: -s }, { x: s, z: c }]) {
      const project = (p: { x: number; z: number }): number =>
        p.x * axis.x + p.z * axis.z;
      const aValues = aa.map(project), bValues = bb.map(project);
      // Exactly touching faces are clear; disregard floating-point roundoff.
      if (Math.max(...aValues) <= Math.min(...bValues) + 1e-5 ||
          Math.max(...bValues) <= Math.min(...aValues) + 1e-5) return false;
    }
  }
  return true;
}

function label(p: Placed): string {
  const v = p.position;
  return p.kind + ' ' + p.id + ' @ (' +
    v.x.toFixed(2) + ', ' + v.y.toFixed(2) + ', ' + v.z.toFixed(2) + ')';
}

it('keeps all Hoofington buildings and garden art grounded, separate and off the carriageway', () => {
  const island = generateIsland({ seed: 'billy-isle' });
  const visual = makeHoofingtonPlacements(island);

  // Physical sources appear in the art plan by reference. Check each only once,
  // while retaining art-only scatter and physical props without library art.
  const represented = new Set(visual.flatMap(p => p.source ? [p.source.id] : []));
  const placed: Placed[] = visual.map((p, index) => ({
    id: p.source?.id ?? 'art-' + p.model + '-' + index,
    kind: p.source?.kind ?? (p.model.startsWith('oak') ? 'tree-oak' :
      p.model === 'pine' ? 'tree-pine' :
      p.model.startsWith('flower') ? 'flower' :
      p.model.startsWith('bush') ? 'bush' : p.model),
    position: p.position, size: p.size, yaw: p.yaw,
  }));
  for (const p of island.props) {
    if (p.poiId !== 'hoofington' || represented.has(p.id)) continue;
    placed.push(asPlaced(p));
  }

  // Physical asphalt follows the actual road segments (including the bends
  // of the two POI approach roads), not an infinitely long axis-aligned slab.
  const streets = [
    ...makeLocalStreets(island).filter(r => r.from === 'hoofington'),
    ...island.roads.filter(r => r.type === 'road' &&
      (r.from === 'hoofington' || r.to === 'hoofington')),
  ];
  const carriageway: Placed[] = [];
  for (const street of streets) {
    for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1]!, b = street.points[i]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      carriageway.push({
        id: street.id, kind: 'carriageway',
        position: { x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2 },
        size: { x: street.width, y: 0, z: length },
        yaw: Math.atan2(dx, dz),
      });
    }
  }

  const buildings = placed.filter(p => BUILDINGS.has(p.kind));
  const garden = placed.filter(p => GARDEN.has(p.kind) || p.kind.startsWith('tree-') ||
    p.id.startsWith('hoofington-verge-'));
  expect(buildings.length).toBeGreaterThan(5);
  expect(garden.length).toBeGreaterThan(20);
  const failures: string[] = [];

  for (const p of placed) {
    const base = p.position.y - p.size.y / 2;
    const ground = gridSample(island, p.position.x, p.position.z);
    const delta = base - ground;
    if (delta > 0.05 + 1e-5 || delta < -0.15 - 1e-5) {
      failures.push(label(p) + ' vs terrain: base ' + delta.toFixed(3) +
        ' m relative to ground (' + ground.toFixed(3) + ' m)');
    }
  }
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      if (overlaps(buildings[i]!, buildings[j]!)) {
        failures.push(label(buildings[i]!) + ' overlaps ' + label(buildings[j]!));
      }
    }
  }
  for (const p of garden) {
    for (const building of buildings) {
      if (overlaps(p, building))
        failures.push(label(p) + ' overlaps ' + label(building));
    }
  }
  for (const p of [...buildings, ...garden]) {
    // One report per carriageway, not one per tessellated road segment.
    for (const street of streets) {
      const segments = carriageway.filter(r => r.id === street.id && overlaps(p, r));
      if (segments.length) {
        failures.push(label(p) + ' overlaps carriageway ' + street.id +
          ' at segment(s) ' + segments.map(r =>
            '(' + r.position.x.toFixed(2) + ',' + r.position.z.toFixed(2) +
            ', length ' + r.size.z.toFixed(2) + ')').join(', '));
      }
    }
  }

  if (failures.length) {
    throw new Error('Hoofington geometry QA found ' + failures.length +
      ' placement issue(s):\n' + failures.join('\n'));
  }
});

it('preserves the fence IDs across distinct yard openings and stages usable props on both verges', () => {
  for (const seed of ['billy-isle', 'hoofington-geometry', 'full-loop-core-test']) {
    const island = generateIsland({ seed });
    const farm = island.pois.find(p => p.id === 'hoofington')!.center;
    const yard = island.props.filter(p => p.poiId === 'hoofington');
    const fences = yard.filter(p => p.kind === 'fence');
    const front = fences.filter(p => p.id.startsWith('hoofington-fence-'));
    expect(front.map(p => p.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => 'hoofington-fence-' + (index + 6)),
    );
    expect(front.filter(p => p.size.x < 6.5)).toHaveLength(12);
    expect(front.filter(p => p.transform.rotationY === 0)).toHaveLength(4);
    expect(fences).toHaveLength(30);
    const corridor = (x: number, z: number, length: number, width: number): Placed => ({
      id: 'yard-opening', kind: 'gate', position: { x: farm.x + x, y: farm.y, z: farm.z + z },
      size: { x: length, y: 1, z: width }, yaw: 0,
    });
    // A goat can turn into the north farmhouse, the central play yard and
    // both south yards through openings wider than a KID goat.
    for (const [x, z] of [[-12, -20], [12, -27.7], [12, 2], [-12, 23.5], [12, 24]] as const) {
      const passage = corridor(x, z, 8, 2.4);
      expect(front.filter(p => overlaps(passage, asPlaced(p))).map(p => p.id),
        seed + ' opening at ' + x + ',' + z).toEqual([]);
    }
    // The gate between the third and fourth paddock rails also accommodates
    // the round Hay Haul bale that spawns at this crossing.
    const pasture = corridor(-35, -11.6, 8, 2.6);
    expect(fences.filter(p => overlaps(pasture, asPlaced(p))).map(p => p.id), seed).toEqual([]);

    const plan = makeHoofingtonPlacements(island);
    for (const approach of ['north', 'south'] as const) {
      const prefix = 'hoofington-verge-' + approach + '-';
      const stop = yard.filter(p => p.id.startsWith(prefix));
      expect(stop.map(p => p.kind)).toEqual(['crate', 'barrel', 'bench']);
      expect(stop.slice(0, 2).every(p => p.body.type === 'dynamic' &&
        p.breakable && p.lickable && p.collidable)).toBe(true);
      expect(plan.some(p => p.model === 'bench' && p.source?.id === prefix + 'bench')).toBe(true);
      for (const prop of stop) {
        const position = prop.transform.position;
        expect(Math.abs(position.x - farm.x)).toBeLessThan(10);
        expect(Math.abs(position.z - farm.z)).toBeGreaterThan(29);
        const neighbours = yard.filter(p => p !== prop && p.collidable &&
          p.kind !== 'grass-tuft' && overlaps(asPlaced(prop), asPlaced(p)));
        expect(neighbours.map(p => p.id), prop.id + ' on ' + seed).toEqual([]);
      }
    }
  }
});

it('keeps the seeded garden gnomes outside the west loading turn and lets a Kid walk or sprint through', async () => {
  const game = await Game.create();
  try {
    const farm = game.island.pois.find(p => p.id === 'hoofington')!.center;
    const yard = game.island.props.filter(p => p.poiId === 'hoofington' && p.collidable);
    const gnomes = yard.filter(p => p.kind === 'gnome').map(asPlaced);
    const { x, z, length, width } = HOOFINGTON_HAUL_CONNECTOR;
    const connector: Placed = {
      id: 'hoofington-haul-connector', kind: 'passage',
      position: { x: farm.x + x, y: farm.y, z: farm.z + z },
      size: { x: length, y: 1, z: width }, yaw: 0,
    };
    expect(gnomes).toHaveLength(13);
    for (const id of ['detail-hoofington-gnome-18', 'detail-hoofington-gnome-22']) {
      const gnome = gnomes.find(p => p.id === id)!;
      expect(game.colliders.props.get(id)?.isEnabled(), id).toBe(true);
      expect(yard.map(asPlaced).filter(p => p.id !== id && overlaps(p, gnome)).map(label), id).toEqual([]);
    }
    expect(gnomes.filter(gnome => overlaps(connector, gnome)).map(label)).toEqual([]);

    // Reproduce the live input from where the two static gnomes trapped the goat.
    const start = { x: farm.x - 21.89, z: farm.z - 18.75 };
    const cameraYaw = -2.05352;
    for (const sprint of [false, true]) {
      game.teleport({ ...start, y: gridSample(game.island, start.x, start.z) }, -cameraYaw);
      for (let tick = 0; tick < 30; tick++) game.step({ cameraYaw });
      for (let tick = 0; tick < 80; tick++) game.step({ moveZ: 1, cameraYaw, sprint });
      expect(game.goat.torso.translation().x).toBeLessThan(farm.x - 25.8);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.respawns).toBe(0);
    }
  } finally {
    game.dispose();
  }
});

it.each(['billy-isle', 'hoofington-geometry', 'full-loop-core-test'])(
  'keeps bushes clear of pickets and mailboxes in %s', seed => {
    const yard = generateIsland({ seed }).props.filter(p => p.poiId === 'hoofington');
    const fixtures = yard.filter(p => p.kind === 'fence' || p.kind === 'mailbox').map(asPlaced);
    const bushes = yard.filter(p => p.kind === 'bush').map(asPlaced);

    if (seed === 'billy-isle') {
      // These live regressions must remain present and clear after relocation.
      expect(fixtures.map(p => p.id)).toEqual(expect.arrayContaining([
        'hoofington-fence-6', 'detail-hoofington-mailbox-16',
      ]));
      expect(bushes.map(p => p.id)).toEqual(expect.arrayContaining([
        'detail-hoofington-bush-586', 'detail-hoofington-bush-681',
      ]));
    }
    for (const fixture of fixtures) {
      const intersects = bushes.filter(bush => overlaps(fixture, bush));
      expect(intersects.map(label), label(fixture)).toEqual([]);
    }
  },
);

it('gives the farm shade oaks and field bales live collision without blocking the towing gate', async () => {
  const game = await Game.create();
  try {
    const farm = game.island.pois.find(poi => poi.id === 'hoofington')!.center;
    const oaks = game.island.props.filter(prop => prop.id.startsWith('hoofington-shade-oak-'));
    const bales = game.island.props.filter(prop => prop.id.startsWith('hoofington-field-art-bale-'));
    const art = makeHoofingtonPlacements(game.island);
    expect(oaks).toHaveLength(3);
    expect(bales).toHaveLength(5);
    expect(art.some(placement => placement.model === 'hay' && !placement.source)).toBe(false);
    for (const tree of oaks) {
      expect(art.filter(placement => placement.source === tree)).toHaveLength(1);
      const trunk = game.colliders.props.get(tree.id)!;
      expect(trunk.shapeType()).toBe(RAPIER.ShapeType.Cylinder);
      expect(trunk.radius()).toBeCloseTo(.9);
      expect(trunk.translation().x).toBeCloseTo(tree.transform.position.x, 4);
      expect(trunk.translation().y).toBeCloseTo(tree.transform.position.y, 4);
      expect(trunk.translation().z).toBeCloseTo(tree.transform.position.z, 4);
    }

    const gate = HOOFINGTON_FIELD_ENTRANCES.find(entrance => entrance.towing)!;
    const lane: Placed = {
      id: 'west-towing-gate', kind: 'gate',
      position: V(farm.x + gate.x, farm.y, farm.z + gate.z),
      size: V(gate.length + 2.3, 1, gate.width), yaw: 0,
    };
    for (const bale of bales) {
      expect(overlaps(asPlaced(bale), lane), bale.id).toBe(false);
      expect(game.colliders.bodies.get(bale.id)?.isDynamic(), bale.id).toBe(true);
      expect(game.colliders.props.get(bale.id)?.isSensor(), bale.id).toBe(false);
    }

    const oak = oaks.find(prop => prop.id === 'hoofington-shade-oak-south-east')!;
    const trunk = game.colliders.props.get(oak.id)!;
    const tree = oak.transform.position;
    const start = { x: tree.x, z: tree.z + 3.8 };
    game.teleport(V(start.x, gridSample(game.island, start.x, start.z), start.z), 0);
    let trunkContact = false;
    const stop = game.physics.onContact(event => {
      if ((event.colliderA === trunk.handle && game.goat.ownsBody(event.bodyB)) ||
        (event.colliderB === trunk.handle && game.goat.ownsBody(event.bodyA))) trunkContact = true;
    });
    try {
      for (let tick = 0; tick < 30; tick++) game.step();
      for (let tick = 0; tick < 100; tick++) game.step({ moveZ: 1, cameraYaw: 0 });
    } finally { stop(); }
    expect(trunkContact).toBe(true);

    const bale = game.colliders.bodies.get('hoofington-field-art-bale-4')!;
    const spot = bale.translation();
    const x = spot.x - 2.2;
    const yaw = Math.PI / 2;
    game.teleport(V(x, gridSample(game.island, x, spot.z), spot.z), -yaw);
    for (let tick = 0; tick < 30; tick++) game.step({ cameraYaw: yaw });
    for (let tick = 0; tick < 8; tick++) game.step({ cameraYaw: yaw, tongue: true });
    expect(game.goat.interactions.tongueBody?.handle).toBe(bale.handle);
    const before = bale.translation();
    for (let tick = 0; tick < 40; tick++) game.step({ cameraYaw: yaw, moveZ: -1, tongue: true, reelTongue: true });
    const after = bale.translation();
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(.2);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
