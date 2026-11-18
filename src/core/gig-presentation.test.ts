import { describe, expect, it } from 'vitest';
import { V } from '../physics';
import { Game } from './Game';
import { hayHaulGuidance, hayHaulMapPoint } from './GigPresentation';

describe('Hay Haul wayfinding', () => {
  it('tracks moved bales, gives the pickup input, and switches to the barn only for a tagged bale', async () => {
    const game = await Game.create({ resolution: 97 });
    try {
      expect(hayHaulGuidance(game, null)).toBeNull();
      const { config } = game.gigs.director.startPractice('hay-haul', 'easy');
      if (config.kind !== 'hay-haul') throw new Error('Expected Hay Haul');
      const run = game.gigs.active!;
      const position = game.goat.torso.translation();
      const bodies = config.bales.map(bale => game.colliders.bodies.get(bale.id)!);
      expect(hayHaulGuidance(game, run)?.task).toBe('Find a bale on the map');
      const head = game.goat.head.translation();
      const target = V(head.x, head.y, head.z - 3);
      bodies[0]!.setTranslation(target, true);
      game.physics.raw.propagateModifiedBodyPositionsToColliders();
      game.physics.raw.step();
      const physicsPosition = bodies[0]!.translation();
      expect(hayHaulGuidance(game, run)).toEqual({
        kind: 'pickup',
        position: physicsPosition,
        task: 'Hold RMB / LT to lick',
      });
      expect(game.goat.interactions.attachTongue(V(
        target.x - game.goat.head.translation().x,
        target.y - game.goat.head.translation().y,
        target.z - game.goat.head.translation().z,
      ))).toBe(true);
      expect(game.goat.interactions.tongueBody?.handle).toBe(bodies[0]!.handle);
      expect(hayHaulGuidance(game, run)?.task).toBe('Release and re-lick');

      run.seenIds.push(config.bales[0]!.id);
      expect(hayHaulGuidance(game, run)).toEqual({
        kind: 'delivery',
        position: config.barn,
        task: 'Drag bale to barn',
      });

      run.finishedIds.push(config.bales[0]!.id);
      expect(hayHaulGuidance(game, run)?.kind).toBe('pickup');
      run.status = 'completed';
      expect(hayHaulGuidance(game, run)).toBeNull();
      expect(Math.hypot(physicsPosition.x - position.x, physicsPosition.z - position.z)).toBeLessThan(6);
    } finally {
      game.dispose();
    }
  });

  it('keeps positions within the map or at its rim along the correct bearing', () => {
    const origin = { x: 0, z: 0 };
    expect(hayHaulMapPoint(V(0, 0, 0), origin)).toEqual({ x: 140, y: 140 });
    expect(hayHaulMapPoint(V(10, 0, 0), origin)).toEqual({ x: 150.5, y: 140 });
    const rim = hayHaulMapPoint(V(0, 0, -400), origin);
    expect(rim.x).toBe(140);
    expect(rim.y).toBeCloseTo(32);
  });
});
