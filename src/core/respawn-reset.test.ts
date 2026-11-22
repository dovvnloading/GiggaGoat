import { describe, expect, it } from 'vitest';
import { dot, forward, rotate, sub, V } from '../physics';
import { heightAt } from '../world';
import { Game, FIXED_DT } from './Game';

async function settledGame(): Promise<Game> {
  const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
  for (let tick = 0; tick < 90; tick++) game.step();
  expect(game.goat.locomotion.grounded).toBe(true);
  return game;
}

describe('respawn state reset', () => {
  it.each(['physics', 'ability'] as const)(
    'restores control and balance after a settled %s flop', async source => {
      const game = await settledGame();
      try {
        if (source === 'physics') game.goat.flop();
        else game.step({ flop: true });
        for (let tick = 0; tick < 35; tick++) game.step();
        expect(game.goat.isRagdoll).toBe(true);
        if (source === 'ability') expect(game.rules.abilities.knockedDown).toBe(true);
        game.respawn();
        expect(game.goat.isRagdoll).toBe(false);
        expect(game.rules.abilities.knockedDown).toBe(false);
        const start = { ...game.goat.torso.translation() };
        for (let tick = 0; tick < 60; tick++) game.step();
        expect(game.goat.isRagdoll).toBe(false);
        expect(game.goat.locomotion.grounded).toBe(true);
        expect(rotate(game.goat.torso.rotation(), V(0, 1, 0)).y).toBeGreaterThan(.85);
        expect(Math.hypot(game.goat.torso.translation().x - start.x,
          game.goat.torso.translation().z - start.z)).toBeLessThan(1);
        let jumps = 0;
        game.goat.events.on(event => { if (event.type === 'jumped') jumps++; });
        game.step({ jump: true });
        expect(jumps).toBe(1);
      } finally { game.dispose(); }
    },
  );

  it('discards pending input and does not repeat a held flop after rescue', async () => {
    const game = await settledGame();
    try {
      let jumps = 0, flops = 0;
      game.goat.events.on(event => { if (event.type === 'jumped') jumps++; });
      game.rules.events.on('ability:used', event => { if (event.name === 'flop') flops++; });
      game.advance(FIXED_DT / 2, { jump: true, flop: true });
      game.respawn();
      game.advance(FIXED_DT / 2, { jump: false, flop: false });
      expect(jumps).toBe(0);
      expect(flops).toBe(0);
      game.step({ flop: true });
      expect(flops).toBe(1);
      game.respawn();
      game.step({ flop: true });
      expect(flops).toBe(1);
      expect(game.goat.isRagdoll).toBe(false);
    } finally { game.dispose(); }
  });

  it('responds to movement immediately after rescuing a folded flop', async () => {
    const game = await settledGame();
    try {
      game.step({ flop: true });
      for (let tick = 0; tick < 35; tick++) game.step();
      game.respawn();
      const start = { ...game.goat.torso.translation() };
      const heading = game.goat.locomotion.heading;
      for (let tick = 0; tick < 30; tick++) game.step({ moveZ: 1, cameraYaw: heading });
      expect(dot(sub(game.goat.torso.translation(), start), forward(heading))).toBeGreaterThan(.3);
      expect(game.goat.isRagdoll).toBe(false);
      expect(rotate(game.goat.torso.rotation(), V(0, 1, 0)).y).toBeGreaterThan(.8);
    } finally { game.dispose(); }
  });

  it.each([1.6, 3] as const)('keeps a size %s goat stable after rescuing a flop', async size => {
    const game = await settledGame();
    try {
      game.water.untrack(game.goat.torso);
      game.goat.resize(size);
      game.water.track(game.goat.torso, { buoyancyScale: .7, paddleSpeed: 2.6 });
      game.respawn();
      for (let tick = 0; tick < 120; tick++) game.step();
      game.goat.flop();
      for (let tick = 0; tick < 35; tick++) game.step();
      expect(game.goat.isRagdoll).toBe(true);
      game.respawn();
      const start = { ...game.goat.torso.translation() };
      let maxRise = 0;
      for (let tick = 0; tick < 120; tick++) {
        game.step();
        maxRise = Math.max(maxRise, game.goat.torso.translation().y - start.y);
        expect(game.goat.isRagdoll, `tick ${tick}`).toBe(false);
      }
      expect(maxRise).toBeLessThan(size * .3);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(rotate(game.goat.torso.rotation(), V(0, 1, 0)).y).toBeGreaterThan(.85);
    } finally { game.dispose(); }
  });

  it('clears a queued physics jump and a partially charged headbutt', async () => {
    const game = await settledGame();
    try {
      for (let tick = 0; tick < 20; tick++) game.step({ chargeHeadbutt: true });
      expect(game.rules.abilities.headbuttCharge).toBeGreaterThan(0);
      game.goat.locomotion.requestJump();
      let jumps = 0, headbutts = 0;
      game.goat.events.on(event => { if (event.type === 'jumped') jumps++; });
      game.rules.events.on('ability:used', event => { if (event.name === 'headbutt') headbutts++; });
      game.respawn();
      game.step();
      expect(jumps).toBe(0);
      expect(headbutts).toBe(0);
      expect(game.rules.abilities.headbuttCharge).toBe(0);
    } finally { game.dispose(); }
  });

  it('does not turn a rescued fall into a landing or airtime award', async () => {
    const game = await settledGame();
    try {
      const { x, z } = game.goat.torso.translation();
      game.teleport(V(x, heightAt(game.island, x, z) + 35, z));
      for (let tick = 0; tick < 75; tick++) game.step();
      expect(game.goat.locomotion.airborneSeconds).toBeGreaterThan(.48);
      const tricks: string[] = [];
      let landings = 0;
      game.rules.events.on('style:scored', event => tricks.push(event.trick));
      game.goat.events.on(event => { if (event.type === 'landed') landings++; });
      game.respawn();
      for (let tick = 0; tick < 30; tick++) game.step();
      expect(landings).toBe(0);
      expect(tricks).not.toContain('airtime');
    } finally { game.dispose(); }
  });

  it('clears wall-support history when rescuing a climbing goat', async () => {
    const game = await settledGame();
    try {
      const spawn = game.goat.torso.translation();
      const floorY = spawn.y + 25;
      game.physics.createGround(V(20, .5, 20), V(spawn.x, floorY - .5, spawn.z));
      game.physics.createGround(V(5, 4, 1), V(spawn.x, floorY + 4, spawn.z - 5));
      game.teleport(V(spawn.x, floorY, spawn.z), 0);
      for (let tick = 0; tick < 50; tick++) game.step();
      for (let tick = 0; tick < 150 && !game.goat.locomotion.isClinging; tick++) {
        game.step({ moveZ: 1, cameraYaw: 0, climb: true });
      }
      expect(game.goat.locomotion.isClinging).toBe(true);
      game.respawn();
      let airborneStarts = 0;
      game.goat.events.on(event => { if (event.type === 'airtimeStart') airborneStarts++; });
      const { x, z } = game.goat.torso.translation();
      game.teleport(V(x, heightAt(game.island, x, z) + 20, z));
      game.step();
      expect(airborneStarts).toBe(0);
      game.respawn();
      for (let tick = 0; tick < 30; tick++) game.step();
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(airborneStarts).toBe(0);
    } finally { game.dispose(); }
  }, 30_000);
});
