import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { heightAt } from '../world';
import { RAPIER } from '../physics';

describe('Crane Yard public access', () => {
  it('tows a Stack-Up crate into its clear pad and topples the separate Demolition target with a Kid', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
    try {
      const board = game.gigs.boards.find(item => item.poiId === 'crane-yard')!.position;
      const accept = (id: string) => {
        game.teleport(board, 0);
        for (let tick = 0; tick < 45; tick++) game.step();
        expect(game.goat.locomotion.grounded).toBe(true);
        const at = game.goat.torso.translation();
        expect(Math.hypot(at.x - board.x, at.z - board.z)).toBeLessThan(.3);
        expect(at.y).toBeGreaterThan(board.y + .35);
        expect(game.gigs.nearBoard()).toBe('crane-yard');
        const offer = game.gigs.board('crane-yard').find(item => item.gigId === id)!;
        game.gigs.accept(offer.id);
        return game.gigs.active!.setup;
      };
      const approach = (target: { x: number; z: number }, range = .4) => {
        for (let tick = 0; tick < 940; tick++) {
          const p = game.goat.torso.translation();
          const dx = target.x - p.x, dz = target.z - p.z;
          if (Math.hypot(dx, dz) < range) return;
          game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
        }
        throw new Error('Blocked route: ' + JSON.stringify({ target, actual: game.goat.torso.translation() }));
      };

      const stack = accept('stack-up');
      if (stack.config.kind !== 'stack-up') throw new Error('Expected Stack-Up fixture');
      approach({ x: stack.start.x, z: stack.start.z });
      for (const crate of stack.spawns) {
        const { position, size } = crate;
        const gap = new RAPIER.Cuboid(size.x / 2 + .45, size.y / 2 - .05, size.z / 2 + .45);
        const propsInTheWay = [...game.colliders.props].filter(([, collider]) =>
          collider.intersectsShape(gap, position, { x: 0, y: 0, z: 0, w: 1 }));
        expect(propsInTheWay.map(([id]) => id), crate.id).toEqual([]);
      }
      const firstCrate = game.gigs.props.get(stack.spawns[0]!.id)!.body;
      approach({ x: stack.config.center.x, z: firstCrate.translation().z });
      approach(firstCrate.translation(), 2.3);
      for (let tick = 0; tick < 30 && !game.goat.interactions.isTongueAttached; tick++) {
        game.step({ tongue: true });
      }
      expect(game.goat.interactions.tongueBody?.handle).toBe(firstCrate.handle);
      const pad = stack.config.center;
      for (let tick = 0; tick < 420; tick++) {
        const load = firstCrate.translation();
        if (Math.hypot(load.x - pad.x, load.z - pad.z) < .55) break;
        const p = game.goat.torso.translation();
        const dx = pad.x - 1.55 - p.x, dz = pad.z - p.z;
        game.step({ tongue: true, reelTongue: (game.goat.interactions.tongueLength ?? 0) > 1.1,
          moveZ: Math.min(.55, Math.hypot(dx, dz) * 1.5), cameraYaw: Math.atan2(dx, -dz) });
      }
      for (let tick = 0; tick < 80; tick++) game.step();
      expect(game.gigs.active?.objective, JSON.stringify(firstCrate.translation()))
        .toMatchObject({ kind: 'stack', layers: 1 });
      game.gigs.abandon();

      const demolition = accept('demolition-contract');
      if (demolition.config.kind !== 'demolition-contract') throw new Error('Expected demolition fixture');
      const base = demolition.config.pieces[0]!.start;
      approach({ x: base.x, z: base.z - 3.4 });
      expect(game.gigs.active?.metrics.displacedMass).toBe(0);
      for (let tap = 0; tap < 7 && game.gigs.active?.status === 'running'; tap++) {
        const lowerPiece = demolition.config.pieces.find(piece =>
          game.gigs.props.get(piece.id) &&
          Math.hypot(game.gigs.props.get(piece.id)!.body.translation().x - piece.start.x,
            game.gigs.props.get(piece.id)!.body.translation().z - piece.start.z) < .7) ?? demolition.config.pieces[0]!;
        const target = game.gigs.props.get(lowerPiece.id)!.body.translation();
        approach(target, 1.38);
        const p = game.goat.torso.translation();
        const cameraYaw = Math.atan2(target.x - p.x, p.z - target.z);
        for (let tick = 0; tick < 72; tick++) game.step({ chargeHeadbutt: true, cameraYaw });
        game.step({ chargeHeadbutt: false, cameraYaw });
        for (let tick = 0; tick < 110; tick++) game.step({ cameraYaw });
      }
      const run = game.gigs.active!;
      expect(run.metrics.headbutts).toBeGreaterThan(0);
      expect(run.status, JSON.stringify(run.objective)).toBe('completed');
    } finally {
      game.dispose();
    }
  });

  it('walks from the entry markers to the roof using all four ramps', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
    try {
      const center = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
      const x = center.x + .15, z = center.z + 10;
      game.teleport({ x, y: heightAt(game.island, x, z), z });
      const roof = [
        [.15, -13.2], [4.55, -13.2], [4.55, 5.30], [.15, 5.30],
        [.15, -13.2], [4.55, -13.2], [4.55, 5.30], [-5.19, 5.30],
      ] as const;
      const respawns = game.respawns;
      for (const [dx, dz] of roof) {
        let distance = Infinity;
        for (let tick = 0; tick < 420 && distance > .19; tick++) {
          const goat = game.goat.torso.translation();
          const mx = center.x + dx - goat.x, mz = center.z + dz - goat.z;
          distance = Math.hypot(mx, mz);
          game.step({ moveZ: Math.min(1, distance * 2), cameraYaw: Math.atan2(mx, -mz) });
        }
        expect(distance, JSON.stringify({ target: [dx, dz], actual: game.goat.torso.translation() }))
          .toBeLessThanOrEqual(.19);
      }
      const roofGround = heightAt(game.island, center.x, center.z) + 24.25;
      expect(game.goat.torso.translation().y).toBeGreaterThan(roofGround + .3);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.respawns).toBe(respawns);
    } finally {
      game.dispose();
    }
  });
});
