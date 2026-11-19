import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { sectionCenter } from '../world/access-path';
import { lighthouseAccess } from '../world/lighthouse-access';
import { damAccess, getDamPlacement } from '../world/the-dam';
import { heightAt } from '../world/island';
import type { Vec3 } from '../world/types';

function settle(game: Game, ticks: number, intent: Parameters<Game['step']>[0] = {}): void {
  for (let i = 0; i < ticks; i++) game.step(intent);
}

function walkTo(game: Game, target: Vec3, radius = .62): void {
  for (let i = 0; i < 850; i++) {
    const p = game.goat.torso.translation();
    const x = target.x - p.x, z = target.z - p.z;
    if (Math.hypot(x, z) < radius) return;
    game.step({ moveZ: 1, cameraYaw: Math.atan2(x, -z) });
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

  it('walks from the lower Dam board to the spillway gap and completes a flop dive', async () => {
    const game = await Game.create();
    try {
      acceptAtBoard(game, 'the-dam');
      const [ramp, landing] = damAccess(game.island);
      for (const section of [...ramp!, landing![1]!]) walkTo(game, sectionCenter(section));
      const { position } = getDamPlacement(game.island);
      const approach = sectionCenter(landing![1]!);
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
    } finally {
      game.dispose();
    }
  });
});
