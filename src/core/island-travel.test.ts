import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Game } from './Game';
import { rideIds } from './IslandTravel';
import { heightAt } from '../world';

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
});
