import { afterEach, describe, expect, it, vi } from 'vitest';
import { rotate, V } from '../physics';
import { heightAt } from '../world';
import { FIXED_DT, Game } from './Game';
import { GameInput } from './GameInput';

afterEach(() => vi.unstubAllGlobals());

describe('air flips through the playable input path', () => {
  it.each([
    ['45-degree early press', Math.PI / 4, 10, true],
    ['90-degree near-apex press', Math.PI / 2, 16, true],
    ['120-degree descending press', -2.1, 22, true],
    ['late press', -2.1, 32, false],
  ] as const)('%s', async (_name, heading, secondPress, shouldFlip) => {
    const game = await Game.create();
    const win = Object.assign(new EventTarget(), { performance });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    const input = new GameInput(new EventTarget() as unknown as HTMLCanvasElement, 0);
    try {
      const goat = game.goat;
      const x = 143.6, z = 126.26;
      // Let the default spawn finish settling before staging the road fixture.
      for (let tick = 0; tick < 145; tick++) game.step();
      game.teleport({ x, y: heightAt(game.island, x, z), z }, -heading);
      input.yaw = heading;
      const step = () => game.step(input.sample(FIXED_DT, false));
      for (let tick = 0; tick < 140; tick++) game.step();
      expect(goat.locomotion.grounded).toBe(true);
      const start = goat.torso.translation().y;
      const completed: number[] = [];
      const scores: number[] = [];
      let knockdowns = 0;
      goat.events.on(event => {
        if (event.type === 'flipped') completed.push(event.rotations);
        if (event.type === 'ragdollStart') knockdowns++;
      });
      game.rules.events.on('style:scored', event => {
        if (event.trick === 'flip') scores.push(event.points);
      });

      let highest = start;
      let lowestUp = 1;
      let firstLanding: number | null = null;
      const key = (type: 'keydown' | 'keyup') => {
        win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code: 'Space' }));
      };
      for (let tick = 0; tick < 110; tick++) {
        if (tick === 0 || tick === secondPress) key('keydown');
        if (tick === 1 || tick === secondPress + 1) key('keyup');
        step();
        highest = Math.max(highest, goat.torso.translation().y);
        const up = rotate(goat.torso.rotation(), V(0, 1, 0)).y;
        lowestUp = Math.min(lowestUp, up);
        if (tick > secondPress && goat.locomotion.grounded && firstLanding === null) firstLanding = up;
      }

      expect(highest - start).toBeGreaterThan(.7);
      expect(knockdowns).toBe(0);
      expect(firstLanding).toBeGreaterThan(.8);
      expect(completed).toEqual(shouldFlip ? [1] : []);
      if (shouldFlip) {
        expect(lowestUp).toBeLessThan(-.9);
        expect(scores).toHaveLength(1);
        expect(scores[0]).toBeGreaterThan(0);
      } else {
        expect(lowestUp).toBeGreaterThan(.5);
        expect(scores).toHaveLength(0);
      }
    } finally {
      input.dispose();
      game.dispose();
    }
  }, 30_000);
});
