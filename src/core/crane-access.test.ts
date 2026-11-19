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

  it('walks from the entry markers to the roof and back using all four ramps', async () => {
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
      const walkTo = ([dx, dz]: readonly [number, number]) => {
        let distance = Infinity;
        for (let tick = 0; tick < 420 && distance > .19; tick++) {
          const goat = game.goat.torso.translation();
          const mx = center.x + dx - goat.x, mz = center.z + dz - goat.z;
          distance = Math.hypot(mx, mz);
          game.step({ moveZ: Math.min(1, distance * 2), cameraYaw: Math.atan2(mx, -mz) });
        }
        expect(distance, JSON.stringify({ target: [dx, dz], actual: game.goat.torso.translation() }))
          .toBeLessThanOrEqual(.19);
      };
      for (const waypoint of roof) walkTo(waypoint);
      const roofGround = heightAt(game.island, center.x, center.z) + 24.25;
      walkTo([-11.07, 2.96]);
      let clings = 0;
      const unsubscribe = game.goat.events.on(event => {
        if (event.type === 'wallClingStart') clings++;
      });
      walkTo([-5.36, 4.95]);
      expect(game.goat.torso.translation().y).toBeCloseTo(roofGround + .59, 1);
      expect(clings).toBe(0);
      unsubscribe();
      for (const waypoint of [...roof].reverse()) walkTo(waypoint);
      walkTo([.15, 10]);
      expect(game.goat.torso.translation().y).toBeLessThan(roofGround - 20);
      expect(game.respawns).toBe(respawns);
    } finally {
      game.dispose();
    }
  });

  it('keeps the goat on the third flight when walking diagonally toward the opposite lane', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
    try {
      const center = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
      const deck = heightAt(game.island, center.x, center.z) + 11.85 - .02;
      const x = center.x + .14, z = center.z + 4.6;
      const yaw = Math.atan2(center.x + 4.55 - x, z - (center.z - 3.8));
      game.teleport({ x, y: deck, z }, yaw);
      for (let tick = 0; tick < 25; tick++) game.step();
      let longestFlight = 0;
      const unsubscribe = game.goat.events.on(event => {
        if (event.type === 'airtimeEnd') longestFlight = Math.max(longestFlight, event.duration);
      });
      let lowest = Infinity;
      for (let tick = 0; tick < 180; tick++) {
        game.step({ moveZ: 1, cameraYaw: yaw });
        lowest = Math.min(lowest, game.goat.torso.translation().y);
        expect(game.goat.isRagdoll).toBe(false);
      }
      unsubscribe();
      const at = game.goat.torso.translation();
      expect(at.z).toBeLessThan(center.z + 2);
      expect(at.x).toBeLessThan(center.x + 1.85);
      expect(lowest).toBeGreaterThan(deck + .35);
      expect(longestFlight).toBeLessThan(.12);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });

  it('blocks walking into the open gaps between the ramp mouths', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
    try {
      const center = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
      const pad = heightAt(game.island, center.x, center.z);
      for (const [dx, dz, height, yaw] of [
        [2.35, 5, 11.85, 0], [-2.5, 5, 11.85, 0],
        [2.35, -12.85, 18.05, Math.PI], [.15, 5, 24.25, 0],
      ] as const) {
        const deck = pad + height - .02;
        game.teleport({ x: center.x + dx, y: deck, z: center.z + dz }, -yaw);
        for (let tick = 0; tick < 25; tick++) game.step();
        let lowest = Infinity;
        let ungrounded = 0;
        for (let tick = 0; tick < 100; tick++) {
          game.step({ moveZ: 1, cameraYaw: yaw });
          lowest = Math.min(lowest, game.goat.torso.translation().y);
          if (!game.goat.locomotion.grounded) ungrounded++;
        }
        expect(lowest, JSON.stringify({ dx, dz })).toBeGreaterThan(deck + .4);
        expect(ungrounded).toBeLessThanOrEqual(12);
        for (let tick = 0; tick < 12; tick++) game.step();
        expect(game.goat.torso.translation().y).toBeLessThan(deck + .76);
        expect(game.goat.locomotion.grounded).toBe(true);
        expect(game.goat.locomotion.isClinging).toBe(false);
        expect(game.goat.isRagdoll).toBe(false);
      }
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });

  it('keeps repeated sprint impacts from bouncing the goat off the opposite roof edge', async () => {
    const game = await Game.create({ seed: 'billy-isle' });
    try {
      game.step();
      const center = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
      const pad = heightAt(game.island, center.x, center.z);
      const approaches = [
        [2.35, 5, 11.83, 0], [-2.5, 5, 11.83, 0], [.15, 5, 24.23, 0],
        [2.35, -12.85, 18.03, Math.PI], [2.68, 5, 24.23, 0], [-4.39, 5, 24.23, 0],
      ] as const;
      const driveIntoGuard = ([dx, dz, height, cameraYaw]: typeof approaches[number], sprint: boolean) => {
        game.teleport({ x: center.x + dx, y: pad + height, z: center.z + dz }, -cameraYaw);
        for (let tick = 0; tick < 150; tick++) game.step({ cameraYaw });
        let lowest = Infinity;
        for (let tick = 0; tick < (sprint ? 180 : 100); tick++) {
          game.step({ moveZ: 1, sprint, cameraYaw });
          lowest = Math.min(lowest, game.goat.torso.translation().y);
        }
        return lowest;
      };
      for (const approach of approaches) driveIntoGuard(approach, false);
      for (const approach of approaches.slice(0, 2)) driveIntoGuard(approach, true);
      expect(driveIntoGuard(approaches[2], true)).toBeGreaterThan(pad + 24.20);
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });

  it.each([1, 7, 25, 60])('stops a sprint at the closed roof mouth after %i settle ticks', async settle => {
    const game = await Game.create();
    try {
      const center = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
      const roof = heightAt(game.island, center.x, center.z) + 24.23;
      const x = center.x + .16274, z = center.z + 5.28628;
      game.step();
      game.teleport({ x, y: roof, z }, 0);
      for (let tick = 0; tick < settle; tick++) game.step();

      let rebound = 0, lift = 0, lowest = Infinity;
      let ragdolled = false;
      for (let tick = 0; tick < 215; tick++) {
        game.step(tick < 174 ? { moveZ: 1, sprint: true, cameraYaw: 0 } : {});
        const { y, z } = game.goat.torso.linvel();
        rebound = Math.max(rebound, z);
        lift = Math.max(lift, y);
        lowest = Math.min(lowest, game.goat.torso.translation().y);
        ragdolled ||= game.goat.isRagdoll;
      }
      const stopped = game.goat.torso.translation();
      expect(stopped.z).toBeLessThan(z - .75);
      expect(lowest).toBeGreaterThan(roof + .43);
      expect(rebound).toBeLessThan(.8);
      expect(lift).toBeLessThan(.8);
      expect(ragdolled).toBe(false);
      expect(game.goat.locomotion.grounded).toBe(true);

      for (let tick = 0; tick < 19; tick++) {
        game.step({ moveX: -.65, moveZ: 1, sprint: true, cameraYaw: 0 });
      }
      expect(game.goat.torso.translation().x).toBeLessThan(stopped.x - .3);
      expect(game.goat.locomotion.grounded).toBe(true);
      for (let tick = 0; tick < 24; tick++) game.step({ moveZ: -1, cameraYaw: 0 });
      expect(game.goat.torso.translation().z).toBeGreaterThan(stopped.z + .7);
      game.step({ jump: true });
      expect(game.goat.torso.linvel().y).toBeGreaterThan(2);
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });
});
