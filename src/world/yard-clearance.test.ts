import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { RAPIER, V } from '../physics';
import { heightAt } from './island';

const placements = [
  { id: 'detail-hoofington-trampoline-3', neighbor: 'detail-hoofington-fence-46',
    district: 'hoofington', oldX: 36, oldZ: 34 },
  { id: 'crane-yard-container-91', neighbor: 'crane-yard-chain-fence-88',
    district: 'crane-yard', oldX: -17, oldZ: -31 },
  { id: 'crane-yard-barrel-109', neighbor: 'crane-yard-container-93',
    district: 'crane-yard', oldX: 31, oldZ: 12 },
  { id: 'detail-hoofington-lamp-8', neighbor: null,
    district: 'hoofington', oldX: 9.8, oldZ: 0 },
] as const;

it.each(['billy-isle', 'hoofington-geometry', 'full-loop-core-test'])(
  'keeps play, freight and yard fixtures clear after generating %s', async seed => {
    const game = await Game.create({ seed, resolution: 193 });
    try {
      for (const site of placements) {
        const prop = game.island.props.find(entry => entry.id === site.id)!;
        const collider = game.colliders.props.get(site.id)!;
        const center = game.island.pois.find(poi => poi.id === site.district)!.center;
        const { x, y, z } = prop.size;
        const playArea = prop.shape === 'cylinder'
          ? new RAPIER.Cylinder(y / 2, x / 2 + .5)
          : new RAPIER.Cuboid(x / 2 + .5, y / 2, z / 2 + .5);
        const oldX = center.x + site.oldX, oldZ = center.z + site.oldZ;
        const old = V(oldX, heightAt(game.island, oldX, oldZ) + y / 2, oldZ);
        if (site.neighbor) {
          const previous = game.colliders.props.get(site.neighbor)!;
          expect(previous.intersectsShape(collider.shape, old, collider.rotation()), site.id).toBe(true);
        }
        const position = collider.translation();
        const touching = [...game.colliders.props].filter(([id, other]) => {
          if (id === site.id) return false;
          const p = other.translation();
          return Math.hypot(p.x - position.x, p.z - position.z) < 20 &&
            other.intersectsShape(playArea, position, collider.rotation());
        }).map(([id]) => id);
        expect(touching, site.id).toEqual([]);
      }

      const farm = game.island.pois.find(poi => poi.id === 'hoofington')!.center;
      const markers = game.surfaceMarkers.filter(marker =>
        Math.hypot(marker.position.x - farm.x, marker.position.z - farm.z) < 20);
      expect(markers).toHaveLength(0);
    } finally {
      game.dispose();
    }
  });

it('bounces the goat on the authored play-yard trampoline with a single solid support', async () => {
  const game = await Game.create();
  try {
    const yard = game.surfaceMarkers.find(marker => marker.id === 'detail-hoofington-trampoline-3')!;
    expect(yard).toMatchObject({ kind: 'trampoline', hasWorldArt: true });
    const launcher = game.surfaceMarkers.find(marker => marker.farmSpringboard)!;
    expect(launcher.position.z).toBeCloseTo(yard.position.z);
    expect(launcher.position.x - yard.position.x).toBeGreaterThan(yard.halfExtents.x + launcher.halfExtents.x);

    const support = game.colliders.props.get(yard.id)!;
    const coincidentSolids: number[] = [];
    game.physics.raw.forEachCollider(collider => {
      if (collider.isSensor() || collider.shapeType() !== RAPIER.ShapeType.Cuboid) return;
      const p = collider.translation();
      if (Math.hypot(p.x - yard.position.x, p.y - yard.position.y, p.z - yard.position.z) < .01) {
        coincidentSolids.push(collider.handle);
      }
    });
    expect(coincidentSolids).toEqual([support.handle]);

    const { position, halfExtents } = yard;
    game.teleport(V(position.x, position.y + halfExtents.y + 1.1, position.z));
    const hits: number[] = [];
    const stop = game.surfaces.events.on(event => {
      if (event.type === 'bounce' && event.surfaceId === yard.id &&
        game.goat.ownsBody(event.bodyHandle)) {
        expect(event.bodyHandle).toBe(game.goat.torso.handle);
        hits.push(event.time);
      }
    });
    let peak = 0;
    try {
      for (let tick = 0; tick < 80; tick++) {
        game.step();
        peak = Math.max(peak, game.goat.torso.linvel().y);
      }
    } finally { stop(); }
    expect(hits, yard.id).toHaveLength(1);
    expect(peak, yard.id).toBeGreaterThan(11);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});

it('walks the Crane Yard rear gate both ways with the relocated container', async () => {
  const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
  try {
    const { x, z } = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
    const start = { x: x - 4, z: z - 40 }, inside = { x: x - 4, z: z - 23 };
    game.step();
    const ground = game.physics.raycast(V(start.x, 50, start.z), V(0, -1, 0), 90,
      { predicate: collider => !game.goat.ownsBody(collider.parent()) })!;
    game.teleport(V(start.x, ground.point.y, start.z), 0);
    for (let i = 0; i < 24; i++) game.step();
    for (const target of [inside, start]) {
      for (let i = 0; i < 360; i++) {
        const p = game.goat.torso.translation();
        const dx = target.x - p.x, dz = target.z - p.z;
        if (Math.hypot(dx, dz) < .65) break;
        game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
      }
      const p = game.goat.torso.translation();
      expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThan(.65);
      for (let i = 0; i < 75; i++) game.step();
      expect(game.goat.locomotion.grounded).toBe(true);
    }
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
