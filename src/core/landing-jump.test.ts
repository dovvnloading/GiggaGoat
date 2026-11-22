import { describe, expect, it } from 'vitest';
import { heightAt } from '../world';
import { Game, FIXED_DT } from './Game';

async function stagedGame(jumpFirst = false): Promise<{ game: Game; ground: number }> {
  const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
  const x = 143.6, z = 126.26, ground = heightAt(game.island, x, z);
  for (let tick = 0; tick < 120; tick++) game.step();
  game.teleport({ x, y: ground + (jumpFirst ? 0 : 5), z }, 0);
  if (jumpFirst) {
    for (let tick = 0; tick < 120; tick++) game.step();
    expect(game.goat.locomotion.grounded).toBe(true);
    game.step({ jump: true });
    game.step({ jump: false });
  }
  return { game, ground };
}

function estimateFallTime(game: Game, ground: number): number {
  const goat = game.goat;
  const v = goat.torso.linvel().y;
  const drop = Math.max(0, goat.torso.translation().y - ground -
    (goat.balance.tuning.rideHeight + .16) * goat.size);
  return (v + Math.sqrt(v * v + 2 * 9.81 * drop)) / 9.81;
}

describe('pre-landing jump input', () => {
  it.each([
    { ticks: 1, frames: 2, hold: false, glide: false, jumpFirst: false },
    { ticks: 3, frames: 1, hold: true, glide: false, jumpFirst: false },
    { ticks: 6, frames: 1, hold: true, glide: true, jumpFirst: false },
    { ticks: 3, frames: 2, hold: false, glide: false, jumpFirst: true },
  ])('buffers a press $ticks ticks before landing (frames=$frames, prior jump=$jumpFirst)',
    async ({ ticks, frames, hold, glide, jumpFirst }) => {
      const { game, ground } = await stagedGame(jumpFirst);
      try {
        if (glide) {
          game.rules.wallet.credit(30);
          expect(game.rules.unlocks.purchase('glide').ok).toBe(true);
        }
        let jumps = 0, flips = 0, pressedAt = -1, jumpedAt = -1, tick = 0;
        game.goat.events.on(event => { if (event.type === 'jumped') { jumps++; jumpedAt = tick; } });
        game.rules.events.on('ability:used', event => { if (event.name === 'flip') flips++; });
        for (; tick < 180 && jumps === 0; tick++) {
          const goat = game.goat;
          const ready = goat.locomotion.airborneSeconds > .15 && goat.torso.linvel().y < 0 &&
            (jumpFirst ? goat.torso.translation().y - ground < .9 :
              estimateFallTime(game, ground) <= (ticks + .5) * FIXED_DT);
          if (pressedAt < 0 && ready) {
            pressedAt = tick;
            if (frames === 2) {
              expect(game.advance(FIXED_DT / 2, { jump: true, glide }).steps).toBe(0);
              expect(game.advance(FIXED_DT / 2, { jump: false }).steps).toBe(1);
            } else game.step({ jump: true, glide });
          } else game.step({ jump: pressedAt >= 0 && hold, glide: pressedAt >= 0 && hold && glide });
          if (pressedAt >= 0 && jumps === 0) expect(goat.locomotion.isGliding).toBe(false);
        }
        expect(pressedAt).toBeGreaterThanOrEqual(0);
        expect(jumps).toBe(1);
        expect(jumpedAt - pressedAt).toBeGreaterThanOrEqual(0);
        expect(jumpedAt - pressedAt).toBeLessThanOrEqual(6);
        expect(flips).toBe(0);
        expect(game.goat.locomotion.isFlipping).toBe(false);
        for (let i = 0; i < 25; i++) game.step({ jump: hold, glide: hold && glide });
        expect(jumps).toBe(1);
      } finally { game.dispose(); }
    }, 30_000);

  it('expires a buffered press that arrives too early', async () => {
    const { game, ground } = await stagedGame();
    try {
      let jumps = 0, flips = 0, pressed = false;
      game.goat.events.on(event => { if (event.type === 'jumped') jumps++; });
      game.rules.events.on('ability:used', event => { if (event.name === 'flip') flips++; });
      for (let tick = 0; tick < 130; tick++) {
        if (!pressed && game.goat.locomotion.airborneSeconds > .15 &&
            game.goat.torso.linvel().y < 0 && estimateFallTime(game, ground) <= .3) pressed = true;
        game.step({ jump: pressed });
      }
      expect(pressed).toBe(true);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(jumps).toBe(0);
      expect(flips).toBe(0);
    } finally { game.dispose(); }
  }, 30_000);
});
