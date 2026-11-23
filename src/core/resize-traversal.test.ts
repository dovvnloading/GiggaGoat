import { expect, it } from 'vitest';
import { V } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';

it('keeps a real flip continuous when style growth rebuilds the goat', async () => {
  const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
  try {
    for (let tick = 0; tick < 120; tick++) game.step();
    const { x, z } = game.goat.torso.translation();
    game.teleport(V(x, heightAt(game.island, x, z) + 20, z));
    for (let tick = 0; tick < 20; tick++) game.step();
    game.step({ jump: true });
    expect(game.goat.locomotion.isFlipping).toBe(true);
    for (let tick = 0; tick < 12; tick++) game.step();
    const before = { ...game.goat.torso.rotation() };
    const angular = { ...game.goat.torso.angvel() };
    let flips = 0;
    game.goat.events.on(event => { if (event.type === 'flipped') flips++; });
    for (const type of ['flip', 'knockback', 'topple', 'tongue-swing'] as const) {
      game.rules.awardStyle({ type, quality: 1 });
    }
    expect(game.rules.style.tier).toBe('Billy');
    game.step();
    const after = game.goat.torso.rotation(), nextAngular = game.goat.torso.angvel();
    expect(game.goat.size).toBe(1);
    expect(Math.abs(before.x * after.x + before.y * after.y + before.z * after.z + before.w * after.w))
      .toBeGreaterThan(.95);
    expect(angular.x * nextAngular.x + angular.y * nextAngular.y + angular.z * nextAngular.z).toBeGreaterThan(1);
    for (let tick = 0; tick < 100 && flips === 0; tick++) game.step();
    expect(flips).toBe(1);
  } finally { game.dispose(); }
}, 30_000);
