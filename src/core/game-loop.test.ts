import { describe, expect, it } from 'vitest';
import { Game, FIXED_DT } from './Game';
import { heightAt } from '../world';
import { GROUND_QUERY_GROUPS, V } from '../physics';
import { loadSave, saveGame, SAVE_KEY, type GameSave } from './Persistence';

const create = (): Promise<Game> => Game.create({ seed: 'full-loop-core-test', resolution: 97 });
function ticks(game: Game, n: number, input: Parameters<Game['step']>[0] = {}): void {
  for (let i = 0; i < n; i++) game.step(input);
}

describe('Core game loop — production adapters on real Rapier ticks', () => {
  it('accepts a rotating board offer, collects measured grazing facts and pays exactly once', async () => {
    const game = await create();
    try {
      const board = game.gigs.boards.find(b => b.poiId === 'hoofington')!;
      game.teleport({ x: board.position.x + 3,
        y: heightAt(game.island, board.position.x + 3, board.position.z + 2),
        z: board.position.z + 2 });
      const offered = game.gigs.board('hoofington').find(o => o.gigId === 'mow-down')!;
      expect(offered).toBeDefined();
      const coinsBefore = game.rules.wallet.coins;
      game.gigs.accept(offered.id);
      const run = game.gigs.active!;
      expect(run.status).toBe('running');
      expect(run.setup.config.kind).toBe('mow-down');
      if (run.setup.config.kind !== 'mow-down') throw new Error('wrong gig');
      // Airborne input never masquerades as a bite: core requires a real
      // ground ray / contact before passing the verb to the gig engine.
      game.teleport({ ...run.setup.config.patches[0]!,
        y: run.setup.config.patches[0]!.y + 35 });
      expect(game.canGraze()).toBe(false);
      game.step({ graze: true });
      expect(game.gigs.active?.objective.kind).toBe('coverage');
      for (const patch of run.setup.config.patches) {
        game.teleport(patch);
        const actual = game.goat.torso.translation();
        const terrainHit = game.physics.raycast(actual, V(0,-1,0), 10,
          { groups: GROUND_QUERY_GROUPS });
        expect(game.canGraze(), JSON.stringify({
          patch, actual, terrain: heightAt(game.island,patch.x,patch.z),
          ground: terrainHit ? { distance: terrainHit.distance,
            normal: terrainHit.normal, body: terrainHit.body?.handle } : null,
          locomotionGrounded: game.goat.locomotion.grounded,
        })).toBe(true);
        game.step({ graze: true });
        game.step({ graze: false });
      }
      const finished = game.gigs.active!;
      expect(finished.status).toBe('completed');
      expect(finished.rating).toMatch(/bronze|silver|gold/);
      expect(finished.payout).toBeGreaterThan(0);
      expect(game.rules.wallet.coins - coinsBefore).toBe(finished.payout);
      expect(game.gigs.director.pendingAwards).toHaveLength(0);
      expect(game.gigs.director.personalBests.some(b => b.gigId === 'mow-down')).toBe(true);
      ticks(game, 75);
      expect(game.rules.wallet.coins - coinsBefore).toBe(finished.payout);
    } finally { game.dispose(); }
  });

  it('runs Rising Tide through results with real moving seven-body bot ragdolls and a rising ocean', async () => {
    const game = await create();
    try {
      const match = game.party.start('rising-tide', 4, 'normal', {
        countdownTicks: 0, durationTicks: 360, overtimeTicks: 75,
        tideRiseEveryTicks: 25, tideWarningTicks: 8, submergeTicks: 75,
      });
      const start = match.tideLevel;
      const bot = game.party.bots.get('bot-1')!.goat;
      expect(bot.bodies).toHaveLength(7);
      expect(bot.joints).toHaveLength(6);
      const pos = { ...bot.torso.translation() };
      ticks(game, 105);
      const now = bot.torso.translation();
      expect(Math.hypot(now.x - pos.x, now.z - pos.z)).toBeGreaterThan(.1);
      expect(match.tideLevel).toBeGreaterThan(start);
      let remaining = 1100;
      while (match.phase !== 'results' && remaining-- > 0) game.step();
      expect(match.phase).toBe('results');
      expect(match.placements).toHaveLength(5);
      expect(new Set(match.placements.map(p => p.playerId)).size).toBe(5);
      expect(match.placements.every(p => p.rank >= 1 && p.rank <= 5 &&
        Number.isFinite(p.placementPoints))).toBe(true);
      expect(game.water.seaLevel).toBe(match.tideLevel);
      game.party.returnToFreeRoam();
      expect(game.party.bots.size).toBe(0);
      expect(game.water.seaLevel).toBe(game.island.seaLevel);
    } finally { game.dispose(); }
  });

  it('launches the other two playable party rules with shared physical bot inputs', async () => {
    const game = await create();
    try {
      for (const mode of ['king-of-the-peak', 'hay-heist'] as const) {
        const match = game.party.start(mode, 3, 'hard', {
          countdownTicks: 0, durationTicks: 90, overtimeTicks: 20,
        });
        expect(match.players).toHaveLength(4);
        if (mode === 'hay-heist') expect(match.bales.length).toBeGreaterThanOrEqual(6);
        ticks(game, 95);
        expect(['playing', 'overtime', 'results']).toContain(match.phase);
        game.party.returnToFreeRoam();
      }
    } finally { game.dispose(); }
  });

  it('saves and safely restores wallet, bests, unlocks and settings together', async () => {
    const game = await create();
    let raw = '';
    const storage = {
      setItem: (key: string, value: string): void => { expect(key).toBe(SAVE_KEY); raw = value; },
      getItem: (key: string): string | null => key === SAVE_KEY ? raw : null,
    };
    try {
      game.rules.wallet.credit(267, 'core-test');
      const settings = { mouseSensitivity: 1.75, invertY: true, fov: 81,
        graphics: 'medium' as const, volume: .35 };
      expect(saveGame(game, settings, storage)).toBe(true);
      const restored = loadSave(storage)!;
      expect(restored.settings).toEqual(settings);
      expect(restored.progress.gameplay.wallet.coins).toBe(267);
      const again = await Game.create({ seed: 'full-loop-core-test', resolution: 97,
        progress: restored.progress });
      try {
        expect(again.rules.wallet.coins).toBe(267);
        expect(again.rules.unlocks.toJSON()).toEqual(game.rules.unlocks.toJSON());
        expect(again.gigs.director.personalBests).toEqual(game.gigs.director.personalBests);
        expect(again.exportProgress().gameplay.wallet).toEqual(game.rules.wallet.toJSON());
      } finally { again.dispose(); }
      raw = JSON.stringify({ version: 999 } as unknown as GameSave);
      expect(loadSave(storage)).toBeNull();
      raw = '{bad json';
      expect(loadSave(storage)).toBeNull();
      expect(game.physics.time).toBeCloseTo(game.physics.stepCount * FIXED_DT);
    } finally { game.dispose(); }
  });
});
