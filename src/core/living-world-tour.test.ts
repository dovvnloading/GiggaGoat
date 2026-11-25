import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { V } from '../physics';
import { heightAt } from '../world';
import { DOWNTOWN_TOUR_ROUTE, DOWNTOWN_TOUR_START, LivingWorldTour,
  TourFixedClock, TourSteering } from './living-world-tour';

describe('living-world capture controller', () => {
  it('samples the same fixed input ticks with different render cadences and retains the production drop cap', () => {
    const run = (frames: number[]) => {
      const clock = new TourFixedClock(1 / 60, 5), ticks: number[] = [];
      for (const dt of frames) clock.advance(dt, () => ticks.push(ticks.length));
      return ticks;
    };
    expect(run(Array(60).fill(1 / 30))).toEqual(run(Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0 ? 1 / 60 : 3 / 60)));
    const clock = new TourFixedClock(1 / 60, 5);
    let calls = 0;
    const result = clock.advance(.5, () => calls++);
    expect(calls).toBe(5);
    expect(result.droppedSeconds).toBeCloseTo(.5 - 5 / 60, 9);
  });

  it('re-aims immediately on real arrival, attempts a bounded detour, and never credits a blocked waypoint', () => {
    const city = { x: 0, z: 0 };
    const controller = new TourSteering(city, 100, [[0, 10], [10, 10]]);
    controller.intent({ x: 0, z: 0 }, 8, 8, false);
    controller.intent({ x: 0, z: 0 }, 10, 10, false);
    expect(controller.recoveries).toHaveLength(1);
    expect(controller.reachedWaypoints).toHaveLength(0);
    const next = controller.intent({ x: 0, z: 10 }, 10.1, 10.1, false);
    expect(controller.reachedWaypoints.map(w => w.index)).toEqual([0]);
    expect(next.cameraYaw).toBeCloseTo(Math.PI / 2, 8);
    expect(controller.completedRoute).toBe(false);

    const blocked = new TourSteering(city, 100, [[0, 10]]);
    for (let i = 480; i < 1800; i++) blocked.intent(city, i / 60, i / 60, false);
    expect(blocked.recoveries).toHaveLength(4);
    expect(blocked.failure).toContain('blocked');
    expect(blocked.completedRoute).toBe(false);
    expect(blocked.reachedWaypoints).toHaveLength(0);
  });

  it('walks all eleven original Downtown waypoints through the production Game and Rapier world', async () => {
    const game = await Game.create({ seed: 'billy-isle' });
    let tour: LivingWorldTour | undefined;
    try {
      const city = game.island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
      const x = city.x + DOWNTOWN_TOUR_START[0], z = city.z + DOWNTOWN_TOUR_START[1];
      const start = V(x, heightAt(game.island, x, z), z);
      // Exact fixture pre-roll: 600 ticks, initial pose, four neutral 120-tick
      // render probes, then the recording's sole setup teleport and 30 ticks.
      for (let i = 0; i < 600; i++) game.step();
      game.teleport(start, Math.PI);
      for (let i = 0; i < 30 + 4 * 120; i++) game.step();
      game.teleport(start, Math.PI);
      for (let i = 0; i < 30; i++) game.step();
      const teleports = game.teleportVersion;
      tour = new LivingWorldTour(game, 100);
      for (let i = 0; i < 88 * 30 && !tour.completedRoute && !tour.steering.failure; i++)
        tour.advanceFrame(1 / 30, i / 30);
      expect(tour.steering.failure, JSON.stringify(tour.trace.slice(-4))).toBeNull();
      expect(tour.steering.reachedWaypoints.map(w => w.index),
        JSON.stringify(tour.trace.slice(-4))).toEqual(DOWNTOWN_TOUR_ROUTE.map((_, i) => i));
      expect(tour.steering.reachedWaypoints.every(w => w.distance < 1.2)).toBe(true);
      expect(game.teleportVersion).toBe(teleports);
    } finally { tour?.dispose(); game.dispose(); }
  });

  it('physically walks around an obstruction on the previously stalled market approach', async () => {
    const game = await Game.create({ seed: 'billy-isle' });
    let tour: LivingWorldTour | undefined;
    try {
      const city = game.island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
      const x = city.x + 8, z = city.z + 40;
      // Tall, fixed Rapier blocker: the controller must walk around it,
      // rather than rely on an incidental crate break or scripted teleport.
      const barrier = game.physics.createGround(V(.85, 1.35, .65),
        V(x, heightAt(game.island, x, z) + 1.35, z));
      const start = V(x, heightAt(game.island, x, z - 4), z - 4);
      game.teleport(start, Math.PI);
      for (let i = 0; i < 30; i++) game.step();
      const teleports = game.teleportVersion;
      tour = new LivingWorldTour(game, 100, [[8, 44]]);
      for (let i = 0; i < 45 * 30 && !tour.completedRoute && !tour.steering.failure; i++)
        tour.advanceFrame(1 / 30, i / 30);
      expect(tour.steering.recoveries.length).toBeGreaterThan(0);
      expect(tour.completedRoute, JSON.stringify(tour.trace.slice(-4))).toBe(true);
      expect(tour.steering.reachedWaypoints[0]?.distance).toBeLessThan(1.2);
      expect(game.teleportVersion).toBe(teleports);
      expect(barrier.isValid()).toBe(true);
    } finally { tour?.dispose(); game.dispose(); }
  });
});
