import { describe, expect, it } from 'vitest';
import { GigCatalog, GigDirector, type Point } from '../gigs';
import { PhysicsWorld, RAPIER, V } from '../physics';
import { buildRapierColliders, generateIsland, heightAt } from '../world';
import { Game } from './Game';

const seeds = [
  { seed: 'billy-isle', size: 600, resolution: 193 },
  { seed: 'mow-small', size: 400, resolution: 97 },
  { seed: 'mow-large', size: 900, resolution: 97 },
  { seed: 'garden-check', size: 600, resolution: 65 },
];

describe('Mow-Down lawn course', () => {
  it.each(seeds)('keeps the entire course clear of physical scenery on $seed ($size m)', async (options) => {
    const island = generateIsland(options);
    const catalog = new GigCatalog(island);
    const physics = await PhysicsWorld.create();
    try {
      const colliders = buildRapierColliders(physics.raw, island);
      const obstacles = island.props.filter(prop => prop.collidable && prop.kind !== 'grass-tuft');
      const rotation = { x: 0, y: 0, z: 0, w: 1 };
      for (const [difficulty, count] of [['easy', 12], ['medium', 15], ['hard', 24]] as const) {
        const config = catalog.build(catalog.makeOffer('mow-down', difficulty, 1)).config;
        if (config.kind !== 'mow-down') throw new Error('Expected a mowing course');
        const { patches } = config;
        expect(patches).toHaveLength(count);
        const xs = patches.map(patch => patch.x), zs = patches.map(patch => patch.z);
        const left = Math.min(...xs) - 1.3, right = Math.max(...xs) + 1.3;
        const near = Math.min(...zs) - 1.3, far = Math.max(...zs) + 1.3;
        const ground = patches.map(({ x, z }) => heightAt(island, x, z));
        const minY = Math.min(...ground) - .35, maxY = Math.max(...ground) + 1.5;
        const volume = new RAPIER.Cuboid((right - left) / 2, (maxY - minY) / 2, (far - near) / 2);
        const center = V((left + right) / 2, (minY + maxY) / 2, (near + far) / 2);
        const overlaps = obstacles.filter(({ id }) =>
          colliders.props.get(id)?.intersectsShape(volume, center, rotation)).map(prop => prop.id);
        expect(overlaps, difficulty).toEqual([]);
        expect(colliders.paths.some(path => path.intersectsShape(volume, center, rotation))).toBe(false);
        for (const patch of patches) {
          for (let side = 0; side < 16; side++) {
            const angle = side * Math.PI / 8;
            expect(heightAt(island, patch.x + Math.cos(angle) * .93, patch.z + Math.sin(angle) * .93))
              .toBeLessThan(patch.y);
          }
        }
      }
    } finally {
      physics.dispose();
    }
  });

  it('walks from the job board and grazes all 24 Hard patches at Gold pace', async () => {
    const game = await Game.create();
    try {
      const board = game.gigs.boards.find(b => b.poiId === 'hoofington')!.position;
      game.teleport(board);
      const setup = game.gigs.director.startPractice('mow-down', 'hard');
      if (setup.config.kind !== 'mow-down') throw new Error('Expected a mowing course');
      const { patches } = setup.config;
      const startCoins = game.rules.wallet.coins;
      const walkTo = (target: Pick<Point, 'x' | 'z'>) => {
        for (let tick = 0; tick < 950; tick++) {
          const { x, z } = game.goat.torso.translation();
          const dx = target.x - x, dz = target.z - z, distance = Math.hypot(dx, dz);
          if (distance < .19) return;
          const scale = Math.max(.64, distance);
          game.step({ moveX: dx / scale, moveZ: -dz / scale, cameraYaw: 0 });
        }
        throw new Error('Could not walk to ' + JSON.stringify({ target, actual: game.goat.torso.translation() }));
      };
      const centerZ = patches.reduce((sum, point) => sum + point.z, 0) / patches.length;
      const centerX = patches.reduce((sum, point) => sum + point.x, 0) / patches.length;
      walkTo({ x: board.x, z: centerZ });
      walkTo({ x: centerX, z: centerZ });
      for (let row = 0; row < 4; row++) {
        const pairs = row % 2 ? [2, 1, 0] : [0, 1, 2];
        for (const pair of pairs) {
          const a = patches[row * 6 + pair * 2]!, b = patches[row * 6 + pair * 2 + 1]!;
          walkTo({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
          for (let settle = 0; settle < 45 && !game.canGraze(); settle++) game.step();
          const position = game.goat.torso.translation();
          expect(game.canGraze(), JSON.stringify({ row, pair, position,
            ground: heightAt(game.island, position.x, position.z), elapsed: game.gigs.active?.elapsedTicks,
          })).toBe(true);
          game.step({ graze: true });
        }
      }
      const result = game.gigs.active!;
      expect(result).toMatchObject({ status: 'completed', rating: 'gold',
        objective: { kind: 'coverage', eaten: 24, total: 24, bites: 12 } });
      expect(game.respawns).toBe(0);
      expect(game.rules.wallet.coins - startCoins).toBe(result.payout);
    } finally {
      game.dispose();
    }
  }, 75_000);

  it('restores an old active run by unchanged patch IDs and keeps its progress and timing', () => {
    const island = generateIsland(seeds[0]);
    const catalog = new GigCatalog(island);
    const director = new GigDirector(catalog);
    const setup = director.startPractice('mow-down', 'hard');
    if (setup.config.kind !== 'mow-down') throw new Error('Expected a mowing course');
    director.step({ goat: { position: setup.config.patches[0]!, size: .6 },
      abilities: [{ type: 'eat' }], style: [{ type: 'flip', points: 17 }] });
    const snapshot = director.toJSON();
    const run = snapshot.run!;
    const legacy = run.setup;
    if (legacy.config.kind !== 'mow-down') throw new Error('Expected a historical mowing course');
    const farm = island.pois.find(poi => poi.id === 'hoofington')!.center;
    let randomState = legacy.offer.variantSeed || 0x6d2b79f5;
    const oldRoll = () => {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return Math.floor((randomState >>> 0) / 4294967296 * 3);
    };
    const x = farm.x + (13 + oldRoll()), z = farm.z + (8 + oldRoll());
    const oldPatches = legacy.config.patches.map((_, index) => {
      const px = x + (index % 6 - 2.5) * 2.1, pz = z + (Math.floor(index / 6) - 1.5) * 2.1;
      // The v1 catalog used this bilinear expression for exact serialized heights.
      const { size, heights, resolution: n } = island;
      const gx = (px / size + .5) * (n - 1), gz = (pz / size + .5) * (n - 1);
      const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
      const base = iz * n + ix;
      const y = (heights[base]! + (heights[base + 1]! - heights[base]!) * u) * (1 - v) +
        (heights[base + n]! + (heights[base + n + 1]! - heights[base + n]!) * u) * v;
      return { x: px, y: y + .15, z: pz };
    });
    legacy.config.patches = oldPatches;
    legacy.start = { ...oldPatches[0]! };
    legacy.markers.forEach((marker, index) => { marker.position = { ...oldPatches[index]! }; });
    legacy.info.instruction = 'Eat every glowing grass patch. Plan an efficient bite path.';
    expect(legacy.start).not.toEqual(setup.start);

    const restored = GigDirector.fromJSON(snapshot, catalog);
    expect(restored.active).toMatchObject({ setup, finishedIds: ['0'], elapsedTicks: 1,
      metrics: { bites: 1, stylePoints: 17 }, objective: { eaten: 1, total: 24 } });
    restored.step({ goat: { position: setup.config.patches[1]!, size: .6 }, abilities: [{ type: 'eat' }] });
    expect(restored.active?.objective).toMatchObject({ eaten: 2, total: 24, bites: 2 });

    legacy.config.patches[1]!.x += 1;
    expect(() => GigDirector.fromJSON(snapshot, catalog)).toThrow('Malformed active gig snapshot');
  });
});
