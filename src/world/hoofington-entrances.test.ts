import { describe, expect, it } from 'vitest';
import { Game } from '../core/Game';
import { RAPIER, V } from '../physics';
import { heightAt } from './island';
import { HOOFINGTON_FIELD_ENTRANCES, HOOFINGTON_YARD_ENTRANCES } from './hoofington-entrances';

function station(game: Game, x: number, z: number) {
  const farm = game.island.pois.find(p => p.id === 'hoofington')!.center;
  return { x: farm.x + x, z: farm.z + z };
}

describe('Hoofington entrances', () => {
  it.each(['billy-isle', 'hoofington-geometry', 'full-loop-core-test'])(
    'keeps seeded foliage out of the field and yard approaches for %s', async seed => {
      const game = await Game.create({ seed });
      try {
        const vegetation = game.island.props.filter(p => ['tree-oak', 'tree-pine', 'bush',
          'grass-tuft', 'flower'].includes(p.kind));
        const rotation = { x: 0, y: 0, z: 0, w: 1 };
        for (const gate of [...HOOFINGTON_FIELD_ENTRANCES, ...HOOFINGTON_YARD_ENTRANCES]) {
          const width = 'towing' in gate && gate.towing ? 1.14 : .7;
          const cylinder = new RAPIER.Cylinder(.8, width);
          const centre = station(game, gate.x, gate.z);
          const nearby = vegetation.filter(p => Math.hypot(p.transform.position.x - centre.x,
            p.transform.position.z - centre.z) < gate.length);
          for (let dx = -gate.length / 2; dx <= gate.length / 2; dx += .3) {
            const x = centre.x + dx, z = centre.z;
            const p = { x, z, y: heightAt(game.island, x, z) + .85 };
            const hits = nearby.filter(({ id }) =>
              game.colliders.props.get(id)?.intersectsShape(cylinder, p, rotation));
            expect(hits.map(h => h.id), 'gate ' + gate.x + ', ' + gate.z).toEqual([]);
          }
        }
      } finally {
        game.dispose();
      }
    },
  );

  it.each(['Kid', 'Billy'] as const)(
    'walks both directions through the formerly blocked western gate as %s', async tier => {
    const game = await Game.create();
    try {
      const gate = HOOFINGTON_FIELD_ENTRANCES.find(p => p.towing)!;
      expect(gate.width).toBeCloseTo(4.75);
      const first = station(game, gate.x - gate.length / 2, gate.z);
      const last = station(game, gate.x + gate.length / 2, gate.z);
      const normal = { x: 0, y: 0, z: 0, w: 1 };
      const bale = new RAPIER.Cylinder(.8, 1.14);
      const permanent = game.island.props.filter(p => p.collidable && p.body.type === 'static' &&
        Math.abs(p.transform.position.x - (first.x + last.x) / 2) < 15 &&
        Math.abs(p.transform.position.z - first.z) < 10);
      for (let x = first.x; x <= last.x; x += .22) {
        const p = { x, y: heightAt(game.island, x, first.z) + .85, z: first.z };
        const blocked = permanent.filter(({ id }) =>
          game.colliders.props.get(id)?.intersectsShape(bale, p, normal)).map(p => p.id);
        expect(blocked, 'bale at ' + x.toFixed(2)).toEqual([]);
      }
      if (tier === 'Billy') {
        game.rules.style.ingest({ type: 'flip' });
        game.rules.style.ingest({ type: 'destruction', quality: 2 });
      }
      game.step();
      expect(game.goat.size).toBe(tier === 'Billy' ? 1 : .6);
      // Use the south half of the opening beside the existing movable bale.
      const walkZ = first.z + 1.62;
      const floor = game.physics.raycast(V(first.x, 60, walkZ), V(0, -1, 0), 70, {
        predicate: collider => !game.goat.ownsBody(collider.parent()),
      })!;
      game.teleport(V(first.x, floor.point.y, walkZ));
      for (let i = 0; i < 20; i++) game.step();
      for (const { x } of [last, first]) {
        const z = walkZ;
        for (let i = 0; i < 380; i++) {
          const p = game.goat.torso.translation();
          if (Math.hypot(x - p.x, z - p.z) < .6) break;
          game.step({ moveZ: 1, cameraYaw: Math.atan2(x - p.x, p.z - z) });
        }
        const pos = game.goat.torso.translation();
        expect(Math.hypot(x - pos.x, z - pos.z), 'walk to x ' + x.toFixed(2)).toBeLessThan(.6);
      }
    } finally {
      game.dispose();
    }
  });
});
