import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { Q } from '../physics';
import { Game } from './Game';
import { goatOrbitOffset, PLAY_CAMERA_PITCH } from './GoatCamera';
import { sectionCenter } from '../world/access-path';
import { lighthouseAccess } from '../world/lighthouse-access';
import { damAccess, getDamPlacement } from '../world/the-dam';
import { heightAt } from '../world/island';
import type { Vec3 } from '../world/types';

function settle(game: Game, ticks: number, intent: Parameters<Game['step']>[0] = {}): void {
  for (let i = 0; i < ticks; i++) game.step(intent);
}

function walkTo(game: Game, target: Vec3, radius = .62, afterStep?: () => void): void {
  for (let i = 0; i < 850; i++) {
    const p = game.goat.torso.translation();
    const x = target.x - p.x, z = target.z - p.z;
    if (Math.hypot(x, z) < radius) return;
    game.step({ moveZ: 1, cameraYaw: Math.atan2(x, -z) });
    afterStep?.();
  }
  const actual = game.goat.torso.translation();
  throw new Error('Walk stopped at ' + JSON.stringify(actual) + ' toward ' + JSON.stringify(target));
}

function acceptAtBoard(game: Game, poi: 'old-lighthouse' | 'the-dam'): void {
  const board = game.gigs.boards.find(entry => entry.poiId === poi)!;
  game.teleport(board.position, 0);
  settle(game, 35);
  game.gigs.accept(game.gigs.board(poi)[0]!.id);
}

it('walks the coast road shoulder without sustained airtime on sloping turf', async () => {
  const game = await Game.create({ seed: 'billy-isle' });
  try {
    const cameraYaw = 2.69;
    game.teleport({ x: 91.039, y: 5.205, z: 213.618 }, -cameraYaw);
    settle(game, 80, { cameraYaw });
    expect(game.goat.locomotion.grounded).toBe(true);
    const start = game.goat.torso.translation();
    const score = game.rules.style.score;
    const landings: number[] = [];
    game.goat.events.on(event => { if (event.type === 'landed') landings.push(event.airtime); });
    let slopeSteps = 0;
    for (let tick = 0; tick < 131; tick++) {
      game.step({ moveZ: 1, cameraYaw });
      const { z } = game.goat.torso.translation();
      if (z > 219.1 && z < 221) {
        expect(game.goat.locomotion.groundHit?.collider.handle).toBe(game.colliders.terrain.handle);
        expect(game.goat.locomotion.grounded).toBe(true);
        expect(game.goat.pose).toBe('walk');
        slopeSteps++;
      }
    }
    settle(game, 79, { cameraYaw });
    const end = game.goat.torso.translation();
    expect(slopeSteps).toBeGreaterThan(24);
    expect(end.z).toBeGreaterThan(221);
    expect(end.y).toBeLessThan(start.y - .9);
    expect(Math.max(0, ...landings)).toBeLessThan(.4);
    expect(game.rules.style.score).toBe(score);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});

describe('Beacon and Dam access from their playable boards', () => {
  it('reaches the beacon from the board and retreats from the north tower wall', async () => {
    const game = await Game.create();
    try {
      acceptAtBoard(game, 'old-lighthouse');
      const tower = game.island.props.find(prop => prop.kind === 'lighthouse')!;
      const shell = game.island.colliders.find(c => 'id' in c && c.id === tower.id)!;
      if (shell.shape !== 'cylinder') throw new Error('Expected cylindrical tower shell');
      // The old capsule could enter near the lower edge when climbing, before the
      // cliff terrain supported all of its linked bodies.
      expect(shell.transform.position.y - shell.size.y / 2).toBeLessThan(
        tower.transform.position.y - tower.size.y / 2 - 1.2);
      expect(tower.climbable).toBe(false);
      const path = lighthouseAccess(tower, (x, z) => heightAt(game.island, x, z));
      for (const section of path.slice(0, -1)) walkTo(game, sectionCenter(section));
      const run = game.gigs.active!;
      expect(run.status).toBe('running');
      expect(run.checkpointIndex).toBe(run.setup.markers.length);
      game.step({ bleat: true });
      settle(game, 10);
      expect(game.gigs.active?.status).toBe('completed');

      const center = tower.transform.position;
      const north = { x: center.x + .12, z: center.z - 6.7 };
      game.teleport({ ...north, y: heightAt(game.island, north.x, north.z) }, -Math.PI);
      settle(game, 35);
      settle(game, 175, { moveZ: 1, cameraYaw: Math.PI, climb: true });
      const contact = game.goat.torso.translation();
      expect(Math.hypot(contact.x - center.x, contact.z - center.z))
        .toBeGreaterThan(tower.size.x / 2 - .12);
      settle(game, 90, { moveZ: -1, cameraYaw: Math.PI });
      const retreated = game.goat.torso.translation();
      expect(retreated.z).toBeLessThan(contact.z - 1.7);
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });

  it('walks the mountain trail from the Dam board and back without entering water', async () => {
    const game = await Game.create({ seed: 'billy-isle' });
    try {
      const board = game.gigs.boards.find(entry => entry.poiId === 'the-dam')!;
      const trail = game.island.roads.find(road => road.id === 'mt-gigga--the-dam')!;
      const { position, scale } = getDamPlacement(game.island);
      // Start beyond the former waterlogged approach, at the original foothills.
      const fromBoard = [...trail.points].reverse();
      const foothill = fromBoard.findIndex(point => point.z > position.z + 71 * scale);
      expect(foothill).toBeGreaterThan(0);
      const waypoints = fromBoard.slice(0, foothill + 1);
      game.teleport(board.position, 0);
      settle(game, 35);
      expect(game.gigs.nearBoard()).toBe('the-dam');

      let steps = 0;
      let greatestGroundDistance = 0;
      const check = () => {
        steps++;
        const point = game.goat.torso.translation();
        const immersion = game.water.sample(game.goat.torso);
        if (immersion.fraction > 0)
          throw new Error('Goat entered ' + immersion.volumeId + ' at ' + JSON.stringify(point));
        if (game.goat.isRagdoll || game.goat.locomotion.isClinging || game.respawns)
          throw new Error('Goat lost control on the trail at ' + JSON.stringify(point));
        greatestGroundDistance = Math.max(greatestGroundDistance,
          game.goat.locomotion.groundHit?.distance ?? Infinity);
      };
      for (const point of waypoints.slice(1)) walkTo(game, point, .60, check);
      for (const point of waypoints.slice(0, -1).reverse()) walkTo(game, point, .60, check);

      expect(steps).toBeGreaterThan(1000);
      expect(greatestGroundDistance).toBeLessThan(1.15);
      expect(game.gigs.nearBoard()).toBe('the-dam');
    } finally {
      game.dispose();
    }
  });

  it('walks from the lower Dam board, completes a flop dive, and reaches dry ground again', async () => {
    const game = await Game.create();
    try {
      acceptAtBoard(game, 'the-dam');
      const [ramp, landing] = damAccess(game.island);
      for (const section of ramp.slice(0, 2)) walkTo(game, sectionCenter(section));
      const { position, scale } = getDamPlacement(game.island);
      const formerEdge = { ...sectionCenter(ramp[2]!), x: position.x - 12.65 * scale };
      walkTo(game, formerEdge, .35);
      settle(game, 100, { moveZ: 1, cameraYaw: -Math.PI / 2 });
      const railContact = game.goat.torso.translation();
      expect(railContact.x).toBeLessThan(formerEdge.x - .25 * scale);
      expect(railContact.y).toBeGreaterThan(formerEdge.y);
      settle(game, 135, { moveZ: 1, cameraYaw: Math.PI });
      const transfer = game.goat.torso.translation();
      expect(transfer.y).toBeGreaterThan(formerEdge.y);
      expect(transfer.z).toBeGreaterThan(landing[0]!.outer.z);

      // This pivot entered the tapered guard while turning onto the deck.
      const turnPivot = {
        x: position.x - 12.629 * scale,
        y: position.y + 19.5 * scale,
        z: position.z - 3.542 * scale,
      };
      const cameraSpace = new RAPIER.Ball(.25);
      for (const pitchOffset of [-.30, 0, .30]) {
        const direction = goatOrbitOffset(game.goat.size, Math.PI, PLAY_CAMERA_PITCH + pitchOffset);
        const hit = game.physics.shapeCast(turnPivot, Q(), direction, cameraSpace, 2, {
          predicate: collider => !game.goat.ownsBody(collider.parent()),
        });
        expect(hit, 'clear view around the deck turn').toBeNull();
      }

      const approach = sectionCenter(landing[1]!);
      walkTo(game, { ...approach, z: position.z }, .4);
      const config = game.gigs.active?.setup.config;
      if (config?.kind !== 'splash-dive') throw new Error('Expected Dam Bomb dive configuration');
      walkTo(game, { ...config.jumpPoint, z: position.z });
      walkTo(game, config.jumpPoint, .35);
      const launch = { moveZ: 1, cameraYaw: Math.PI, sprint: true };
      settle(game, 8, launch);
      game.step({ ...launch, flop: true });
      settle(game, 150, { ...launch, sprint: false });
      expect(game.gigs.active?.status).toBe('completed');

      settle(game, 180, { moveZ: 1, cameraYaw: Math.PI });
      settle(game, 360, { moveZ: 1, cameraYaw: Math.PI / 2 });
      const bank = game.goat.torso.translation();
      expect(bank.x).toBeGreaterThan(position.x + 33 * scale);
      expect(bank.y).toBeLessThan(position.y + 8.35 * scale);
      expect(game.water.sample(game.goat.torso).fraction).toBe(0);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });
});


it('keeps the goat grounded through a long walk down the Hoofington summit trail', async () => {
  const game = await Game.create();
  try {
    const summit = game.gigs.boards.find(entry => entry.poiId === 'mt-gigga')!;
    const trail = game.island.roads.find(road => road.id === 'mt-gigga--hoofington')!;
    game.teleport(summit.position, 0);
    settle(game, 45);

    // Enter the trail from the board before measuring the sustained descent.
    for (const target of trail.points.slice(17, 21)) walkTo(game, target, .62);
    let airborneTicks = 0;
    let longestGap = 0;
    for (const target of trail.points.slice(21, 118)) {
      walkTo(game, target, .62, () => {
        airborneTicks = game.goat.locomotion.grounded ? 0 : airborneTicks + 1;
        longestGap = Math.max(longestGap, airborneTicks);
      });
    }
    expect(longestGap).toBeLessThan(24);
    expect(game.goat.locomotion.grounded).toBe(true);
    expect(game.goat.pose).toBe('walk');
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
