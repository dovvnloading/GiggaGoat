import { describe, expect, it } from 'vitest';
import { Game } from './Game';

describe('live party courses on Rapier', () => {
  it('lets the player claim summit points against the standard three bots', async () => {
    const game = await Game.create();
    try {
      const match = game.party.start('king-of-the-peak', 3, 'normal');
      for (let tick = 0; tick < match.view().config.countdownTicks; tick++) game.step();
      for (let tick = 0; tick < 88; tick++) game.step({ moveX: 1, moveZ: 1, cameraYaw: 0 });
      for (let tick = 0; tick < 630; tick++) game.step();
      expect(match.players.find(player => player.id === 'player')!.score).toBeGreaterThan(0);
      const earned = () => match.players.reduce((total, player) => total + player.score, 0);
      const openingScore = earned();
      for (let tick = 0; tick < 720; tick++) game.step();
      expect(earned()).toBeGreaterThan(openingScore);
    } finally { game.dispose(); }
  }, 90_000);

  it('lets a player steal and carry an enemy bale across the Crane Yard on one stamina bar', async () => {
    const game = await Game.create();
    try {
      const match = game.party.start('hay-heist', 3, 'normal');
      for (let tick = 0; tick < match.view().config.countdownTicks; tick++) game.step();
      const blue = match.view().arena.barns.find(barn => barn.teamId === 'blue')!;
      const take = match.bales.find(bale => bale.homeTeam === 'blue' && bale.position.x > blue.position.x)!;
      let carried: string | null = null;
      for (let tick = 0; tick < 620 && !carried; tick++) {
        const position = game.goat.torso.translation();
        const dx = take.position.x - position.x;
        game.step({ moveX: Math.max(-.65, Math.min(.65, dx)), moveZ: 1, sprint: true,
          cameraYaw: 0, tongue: position.z < blue.position.z + 4 });
        carried = match.getEffects('player').carryingBaleId;
      }
      expect(carried).toMatch(/^blue-hay-/);
      const red = match.view().arena.barns.find(barn => barn.teamId === 'red')!;
      for (let tick = 0; tick < 640 && match.getEffects('player').carryingBaleId; tick++) {
        const dx = red.position.x - game.goat.torso.translation().x;
        game.step({ moveX: Math.max(-.65, Math.min(.65, dx)), moveZ: -1,
          cameraYaw: 0, tongue: true });
      }
      expect(match.players.find(player => player.id === 'player')!.score).toBeGreaterThan(0);
    } finally { game.dispose(); }
  }, 90_000);
});
