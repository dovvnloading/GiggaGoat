import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Game } from './Game';
import { rideIds } from './IslandTravel';
import { heightAt } from '../world';
import { TravelTrials, trialTime } from './TravelTrials';

describe('Billy Isle passenger travel', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.create();
  });
  afterEach(() => {
    if (game.travel.active) game.leaveRide(true);
  });
  afterAll(() => game.dispose());
  it('boards every physical station and restores the linked goat at its stop', () => {
    for (const id of rideIds) {
      const c = game.travel.craft[id];
      game.teleport(c.stop);
      expect(game.boardRide(id, true), id).toBe(true);
      game.step();
      expect(game.goat.bodies.every((b) => !b.isEnabled())).toBe(true);
      expect(game.leaveRide(true)).toBe(true);
      expect(game.goat.bodies.every((b) => b.isEnabled())).toBe(true);
      expect(game.goat.torso.translation().x).toBeCloseTo(c.stop.x, 3);
    }
  });
  it('accelerates on open sea, steers and stays afloat beyond the on-foot rescue line', () => {
    game.boardRide('boat');
    const c = game.travel.craft.boat,
      rescues = game.respawns;
    for (let i = 0; i < 800; i++) game.step({ moveZ: 1, moveX: i > 180 && i < 250 ? -0.5 : 0 });
    expect(c.position.z).toBeGreaterThan(game.island.size * 0.57);
    expect(c.speed).toBeGreaterThan(12);
    expect(Math.hypot(c.position.x - c.home.x, c.position.z - c.home.z)).toBeGreaterThan(40);
    expect(c.heading).not.toBe(c.homeHeading);
    expect(c.position.y).toBeCloseTo(game.water.seaLevel);
    expect(game.respawns).toBe(rescues);
    expect(game.leaveRide()).toBe(false);
    game.leaveRide(true);
  });
  it('takes off under power, banks and lands back on water', () => {
    game.boardRide('plane');
    const c = game.travel.craft.plane;
    for (let i = 0; i < 300; i++) game.step({ moveZ: 1, glide: true });
    expect(c.position.y).toBeGreaterThan(game.water.seaLevel + 14);
    const height = c.position.y;
    for (let i = 0; i < 40; i++) game.step({ moveX: 1 });
    expect(c.bank).toBeGreaterThan(0.3);
    for (let i = 0; i < 900; i++) game.step({ sprint: true, moveZ: -1 });
    expect(c.position.y).toBeLessThan(height - 8);
    expect(c.position.y).toBeCloseTo(game.water.seaLevel);
    game.leaveRide(true);
  });
  it('burns, vents, and lets the goat step out on dry ground', () => {
    game.boardRide('balloon');
    const c = game.travel.craft.balloon;
    for (let i = 0; i < 180; i++) game.step({ glide: true });
    expect(c.position.y).toBeGreaterThan(c.home.y + 7);
    expect(game.leaveRide()).toBe(false);
    for (let i = 0; i < 540; i++) game.step({ sprint: true, moveX: 0.3 });
    expect(c.position.y).toBeCloseTo(heightAt(game.island, c.position.x, c.position.z), 1);
    expect(game.leaveRide()).toBe(true);
  });
  it('delivers passengers to both ends of the summit line', () => {
    const t = game.travel;
    expect(t.cableLift).toBeLessThan(100);
    for (const end of [1, 0]) {
      const station = end ? t.craft.tram.stop : t.summit;
      game.teleport(station);
      expect(game.boardRide('tram', true)).toBe(true);
      t.tick(0.2, {}, game.water.seaLevel, 0);
      expect(game.leaveRide()).toBe(false);
      for (let i = 0; i < 1500 && t.cableT !== end; i++) t.tick(1 / 60, {}, game.water.seaLevel, i / 60);
      expect(t.cableT).toBe(end);
      expect(game.leaveRide()).toBe(true);
    }
  });

  it('keeps the rider aboard a runabout passing the berth at speed', () => {
    game.boardRide('boat');
    const c = game.travel.craft.boat;
    while (c.speed <= 8.1) game.step({ moveZ: 1 });
    expect(Math.hypot(c.position.x - c.home.x, c.position.z - c.home.z)).toBeLessThan(11);
    expect(game.travel.canDisembark(game.water.seaLevel)).toBe(false);
    expect(game.leaveRide()).toBe(false);
    expect(game.travel.active).toBe('boat');
  });

  it('recovers on the voyage and only acts on a fresh press after returning', () => {
    for (let i = 0; i < 320; i++) game.step();
    const actions: string[] = [];
    const done = game.rules.events.on('ability:used', event => actions.push(event.name));
    try {
      game.step({ bleat: true, chargeHeadbutt: true });
      for (let i = 0; i < 20; i++) game.step({ chargeHeadbutt: true });
      expect(game.rules.abilities.headbuttCharge).toBeGreaterThan(0);
      expect(game.rules.abilities.toJSON().bleatCooldown).toBeGreaterThan(0);
      expect(game.boardRide('boat')).toBe(true);
      for (let i = 0; i < 360; i++) game.step({ moveZ: 1, bleat: true });
      expect(game.rules.abilities.toJSON().bleatTimes).toEqual([]);
      expect(game.rules.abilities.headbuttCharge).toBe(0);
      expect(game.leaveRide(true)).toBe(true);
      game.step({ bleat: true });
      expect(actions).toEqual(['bleat']);
      game.step();
      game.step({ bleat: true });
      expect(actions).toEqual(['bleat', 'bleat']);
    } finally { done(); }
  });

  it('earns a harbour ticket by sailing out, turning and idling at the berth', () => {
    const coins = game.rules.wallet.coins;
    expect(game.startTravelTrial('boat')).toBe(true);
    const boat = game.travel.craft.boat, trials = game.travel.trials;
    for (let i = 0; i < 3000 && !trials.result; i++) {
      const stage = trials.active?.stage;
      if (stage === 0) game.step({ moveZ: 1 });
      else if (stage === 1) game.step({ moveZ: .55, moveX: -1 });
      else {
        const dx = boat.home.x - boat.position.x, dz = boat.home.z - boat.position.z;
        const aim = Math.atan2(dx, -dz) - boat.heading;
        const turn = Math.atan2(Math.sin(aim), Math.cos(aim));
        const dist = Math.hypot(dx, dz);
        game.step({ moveX: Math.max(-1, Math.min(1, turn * 2)), moveZ: dist > 10 ? .4 : 0 });
      }
    }
    expect(trials.result?.id).toBe('boat');
    expect(game.rules.wallet.coins).toBe(coins + 60);
    expect(trials.message('')?.detail).toMatch(/FIRST FINISH/);
    for (let i = 0; i < 150; i++) game.step();
    expect(game.rules.wallet.coins).toBe(coins + 60);
    expect(new TravelTrials(game.exportProgress().trialBests).best.boat).toBe(trials.best.boat);
  });

  it('requires a powered takeoff, banked turn and splashdown, and preserves the best on replay', () => {
    const trials = game.travel.trials, coins = game.rules.wallet.coins;
    for (const attempt of [1, 2]) {
      expect(game.startTravelTrial('plane')).toBe(true);
      for (let i = 0; i < 300 && trials.active?.stage === 0; i++) game.step({ moveZ: 1, glide: true });
      expect(trials.active?.stage).toBe(1);
      for (let i = 0; i < 200 && trials.active?.stage === 1; i++) game.step({ moveX: 1 });
      expect(trials.active?.stage).toBe(2);
      if (attempt === 2) for (let i = 0; i < 60; i++) game.step({moveX: .5});
      for (let i = 0; i < 750 && trials.active; i++) game.step({ sprint: true, moveZ: -1 });
      expect(trials.result?.first).toBe(attempt === 1);
      expect(trials.best.plane).toBeLessThanOrEqual(trials.result!.seconds);
      expect(game.rules.wallet.coins).toBe(coins + 60);
      expect(game.leaveRide(true)).toBe(true);
    }
  });

  it('takes a steady weather reading and lands, while an abandoned launch awards nothing', () => {
    const trials = game.travel.trials, coins = game.rules.wallet.coins;
    game.startTravelTrial('balloon');
    for (let i = 0; i < 250; i++) game.step({ glide: true });
    expect(trials.active?.stage).toBe(1);
    expect(game.leaveRide()).toBe(false);
    expect(trials.active?.stage).toBe(1);
    game.leaveRide(true);
    expect(trials.active).toBeUndefined();
    expect(trials.best.balloon).toBeUndefined();
    expect(game.rules.wallet.coins).toBe(coins);
    game.startTravelTrial('balloon');
    for (let i = 0; i < 250; i++) game.step({ glide: true });
    for (let i = 0; i < 400 && trials.active?.stage === 1; i++) game.step();
    expect(trials.active?.stage).toBe(2);
    for (let i = 0; i < 600 && trials.active; i++) game.step({ sprint: true });
    expect(trials.result?.id).toBe('balloon');
    expect(game.rules.wallet.coins).toBe(coins + 60);
    expect(trialTime(59.97)).toBe('1:00.0');
    expect(new TravelTrials({ boat: -1, plane: NaN, balloon: 17 }).best).toEqual({balloon: 17});
  });
});
