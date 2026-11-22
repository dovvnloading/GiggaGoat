import { describe, expect, it } from 'vitest';
import { Game, FIXED_DT } from './Game';
import { forward, V } from '../physics';
import { heightAt } from '../world';

async function settledGame(): Promise<Game> {
  const game = await Game.create({ seed: 'first-playable-test', resolution: 97 });
  for (let tick = 0; tick < 120; tick++) game.step();
  expect(game.goat.locomotion.grounded).toBe(true);
  expect(game.goat.isRagdoll).toBe(false);
  return game;
}

describe('render-frame input across physics ticks', () => {
  it.each([2, 3, 4])('preserves one-frame jump taps at %i render frames per tick', async frames => {
    const game = await settledGame();
    try {
      let jumps = 0;
      game.goat.events.on(event => { if (event.type === 'jumped') jumps++; });
      expect(game.advance(FIXED_DT / frames, { jump: true }).steps).toBe(0);
      for (let frame = 1; frame < frames; frame++) {
        game.advance(FIXED_DT / frames, { jump: false });
      }
      expect(jumps).toBe(1);
      for (let tick = 0; tick < 10; tick++) game.step();
      expect(jumps).toBe(1);
    } finally { game.dispose(); }
  });

  it.each(['bleat', 'flop'] as const)('preserves a brief %s press exactly once', async action => {
    const game = await settledGame();
    try {
      let uses = 0;
      game.rules.events.on('ability:used', event => { if (event.name === action) uses++; });
      game.advance(FIXED_DT / 2, { [action]: true });
      game.advance(FIXED_DT / 2, { [action]: false });
      expect(uses).toBe(1);
      for (let tick = 0; tick < 10; tick++) game.step();
      expect(uses).toBe(1);
    } finally { game.dispose(); }
  });

  it('preserves a release and a new press between ticks even if the button was held', async () => {
    const game = await settledGame();
    try {
      let bleats = 0;
      game.rules.events.on('ability:used', event => { if (event.name === 'bleat') bleats++; });
      for (let tick = 0; tick < 65; tick++) game.step({ bleat: true });
      expect(bleats).toBe(1);
      game.advance(FIXED_DT / 2, { bleat: false });
      game.advance(FIXED_DT / 2, { bleat: true });
      game.step({ bleat: true });
      expect(bleats).toBe(2);
      game.step({ bleat: true });
      expect(bleats).toBe(2);
    } finally { game.dispose(); }
  });

  it('does not repeat a held jump across multiple physics substeps', async () => {
    const game = await settledGame();
    try {
      let jumps = 0;
      game.goat.events.on(event => { if (event.type === 'jumped') jumps++; });
      expect(game.advance(FIXED_DT * 4, { jump: true, glide: true }).steps).toBe(4);
      expect(jumps).toBe(1);
      game.step({ jump: true, glide: true });
      expect(jumps).toBe(1);
    } finally { game.dispose(); }
  });

  it('flings a held object when fling and tongue are released before the tick', async () => {
    const game = await settledGame();
    try {
      const mouth = game.goat.head.translation();
      const aim = forward(game.goat.locomotion.heading);
      const crate = game.physics.createBox(V(mouth.x + aim.x * 2, mouth.y - .2,
        mouth.z + aim.z * 2), V(.48, .55, .48), 8);
      game.step();
      for (let i = 0; i < 3 && !game.goat.interactions.isTongueAttached; i++) game.step({ tongue: true });
      expect(game.goat.interactions.tongueBody?.handle).toBe(crate.handle);
      let flings = 0;
      game.rules.events.on('ability:used', event => { if (event.name === 'tongue-fling') flings++; });
      game.advance(FIXED_DT / 2, { tongue: true, flingTongue: true });
      game.advance(FIXED_DT / 2, { tongue: false, flingTongue: false });
      expect(flings).toBe(1);
      expect(game.goat.interactions.isTongueAttached).toBe(false);
      game.step();
      expect(flings).toBe(1);
    } finally { game.dispose(); }
  });

  it('keeps an airborne Space tap distinct from holding the unlocked glide', async () => {
    const game = await settledGame();
    try {
      game.rules.wallet.credit(30);
      expect(game.rules.unlocks.purchase('glide').ok).toBe(true);
      const { x, z } = game.goat.torso.translation();
      game.teleport(V(x, heightAt(game.island, x, z) + 20, z));
      for (let tick = 0; tick < 20; tick++) game.step();
      expect(game.goat.locomotion.airborneSeconds).toBeGreaterThan(.12);
      let flips = 0;
      game.rules.events.on('ability:used', event => { if (event.name === 'flip') flips++; });
      game.advance(FIXED_DT / 2, { jump: true, glide: true });
      game.advance(FIXED_DT / 2, { jump: false, glide: false });
      game.step();
      expect(flips).toBe(1);
      expect(game.goat.locomotion.isFlipping).toBe(true);
    } finally { game.dispose(); }
  });

  it('still deploys the unlocked glide when the button remains held', async () => {
    const game = await settledGame();
    try {
      game.rules.wallet.credit(30);
      expect(game.rules.unlocks.purchase('glide').ok).toBe(true);
      const { x, z } = game.goat.torso.translation();
      game.teleport(V(x, heightAt(game.island, x, z) + 20, z));
      for (let tick = 0; tick < 20; tick++) game.step();
      let flips = 0;
      game.rules.events.on('ability:used', event => { if (event.name === 'flip') flips++; });
      for (let tick = 0; tick < 20; tick++) game.step({ jump: true, glide: true });
      expect(flips).toBe(0);
      expect(game.goat.locomotion.isGliding).toBe(true);
    } finally { game.dispose(); }
  });
});
