import { describe, expect, it } from 'vitest';
import { GOAT_SIZES, RAPIER, V, add, rotate, sub, type GoatRagdoll } from '../physics';
import { conjugate, multiplyRotation } from '../physics/math';
import { heightAt } from '../world';
import { Game } from './Game';

function expectClearBodies(game: Game, goats: GoatRagdoll[]): void {
  game.physics.raw.propagateModifiedBodyPositionsToColliders();
  for (const goat of goats) {
    const own = new Set(goat.bodies.map(body => body.handle));
    const torso = goat.torso.translation();
    game.physics.raw.forEachCollider(other => {
      if (other.isSensor() || !other.isEnabled() || own.has(other.parent()?.handle ?? -1)) return;
      const near = other.projectPoint(torso, true)?.point;
      if (near && Math.hypot(near.x - torso.x, near.y - torso.y, near.z - torso.z) > 3 * goat.size) return;
      for (const body of goat.bodies) {
        for (let i = 0; i < body.numColliders(); i++) {
          const contact = other.contactCollider(body.collider(i), 0);
          if (contact) expect(contact.distance, goat.id + ' scenery or opponent contact').toBeGreaterThan(-.02);
        }
      }
    });
  }
}

describe('party match spawns', () => {
  it('gives each opponent room to turn at kickoff, including beside a GIGGA player', async () => {
    const game = await Game.create();
    try {
      for (const size of GOAT_SIZES) {
        game.goat.resize(size);
        for (const mode of ['hay-heist', 'king-of-the-peak', 'rising-tide'] as const) {
          game.party.start(mode, 7, 'normal');
          const goats = [game.goat, ...Array.from(game.party.bots.values(), bot => bot.goat)];
          expectClearBodies(game, goats);
          const spawns = goats.map(goat => {
            const { x, z } = goat.torso.translation();
            const head = goat.head.translation();
            const reach = Math.hypot(head.x - x, head.z - z) + goat.head.collider(0).radius();
            return { id: goat.id, x, z, reach };
          });
          for (const [i, a] of spawns.entries()) {
            for (const b of spawns.slice(i + 1)) {
              expect(Math.hypot(a.x - b.x, a.z - b.z), `${mode} size ${size}: ${a.id}, ${b.id}`)
                .toBeGreaterThan(a.reach + b.reach);
            }
          }
          game.party.returnToFreeRoam();
        }
      }
    } finally { game.dispose(); }
  });

  it('seats an upside-down player with folded joints in each arena', async () => {
    const game = await Game.create();
    try {
      game.step({ flop: true });
      for (let tick = 0; tick < 30; tick++) game.step();
      expect(game.goat.isRagdoll).toBe(true);
      const torso = game.goat.torso;
      const pivot = torso.translation();
      const turn = multiplyRotation({ x: 1, y: 0, z: 0, w: 0 }, conjugate(torso.rotation()));
      for (const body of game.goat.bodies) {
        body.setTranslation(add(pivot, rotate(turn, sub(body.translation(), pivot))), true);
        body.setRotation(multiplyRotation(turn, body.rotation()), true);
      }
      for (const mode of ['king-of-the-peak', 'rising-tide', 'hay-heist'] as const) {
        game.party.start(mode, 7, 'normal');
        if (mode !== 'hay-heist') expect(rotate(torso.rotation(), V(0, 1, 0)).y).toBeLessThan(-.99);
        expectClearBodies(game, [game.goat]);
        game.party.returnToFreeRoam();
      }
    } finally { game.dispose(); }
  });

  it('keeps the game and player in place when a team cannot fit at kickoff', async () => {
    const game = await Game.create();
    try {
      const yard = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
      const blocker = game.physics.raw.createCollider(RAPIER.ColliderDesc.cuboid(20, 30, 15)
        .setTranslation(yard.x + 14.5, yard.y, yard.z - 20));
      const before = game.goat.torso.translation();
      const version = game.teleportVersion;
      expect(() => game.party.start('hay-heist', 7, 'normal')).toThrow('No clear party spawn');
      expect(game.party.match).toBeNull();
      expect(game.party.bots.size).toBe(0);
      expect(game.goat.torso.translation()).toEqual(before);
      expect(game.teleportVersion).toBe(version);
      game.physics.raw.removeCollider(blocker, false);
      expect(game.party.start('hay-heist', 7, 'normal')).toBe(game.party.match);
    } finally { game.dispose(); }
  });

  it('finds a raised road even before the first physics step', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
    try {
      expect(game.physics.stepCount).toBe(0);
      game.party.start('rising-tide', 7, 'normal');
      const goat = game.party.bots.get('bot-3')!.goat;
      const { x, y, z } = goat.torso.translation();
      const terrain = heightAt(game.island, x, z);
      expect(y - .92 * goat.size - terrain).toBeGreaterThan(.15);
      const ray = new RAPIER.Ray(V(x, y + 2, z), V(0, -1, 0));
      const hits = game.colliders.paths.map(surface => surface.castRay(ray, 4, false))
        .filter(hit => hit >= 0);
      expect(y - .92 * goat.size).toBeCloseTo(y + 2 - Math.min(...hits), 4);
    } finally { game.dispose(); }
  });

  it.each((['billy-isle', 'party-spawn-alt'] as const).flatMap(seed =>
    (['rising-tide', 'king-of-the-peak', 'hay-heist'] as const).map(mode => ({ seed, mode }))))(
    'starts the player and bots on walkable support in $mode ($seed)', async ({ mode, seed }) => {
      const game = await Game.create({ seed, resolution: 193 });
      try {
        game.step();
        game.party.start(mode, 7, 'normal');
        const goats = [game.goat, ...[...game.party.bots.values()].map(bot => bot.goat)];
        for (const goat of goats) {
          const { x, y, z } = goat.torso.translation();
          expect(Math.abs(y - .92 * goat.size - heightAt(game.island, x, z)), `${mode} ${goat.id}`)
            .toBeLessThan(1.25);
          const ray = new RAPIER.Ray(V(x, y + 5, z), V(0, -1, 0));
          const surfaces = [game.colliders.terrain, ...game.colliders.paths];
          const hits = surfaces.map(surface => surface.castRay(ray, 10, false)).filter(hit => hit >= 0);
          const surfaceY = y + 5 - Math.min(...hits);
          expect(Math.abs(y - .92 * goat.size - surfaceY), `${mode} ${goat.id} support surface`)
            .toBeLessThan(.08);
        }
        const knockdowns: string[] = [];
        for (const goat of goats) goat.events.on(event => {
          if (event.type === 'ragdollStart') knockdowns.push(goat.id);
        });
        game.step();
        for (const goat of goats) {
          expect(goat.locomotion.grounded, `${mode} ${goat.id} at first tick`).toBe(true);
        }
        for (let tick = 1; tick < 30; tick++) game.step();
        expect(knockdowns, mode).toEqual([]);
        for (const goat of goats) {
          expect(goat.isRagdoll, `${mode} ${goat.id}`).toBe(false);
        }
      } finally { game.dispose(); }
    },
  );
});
