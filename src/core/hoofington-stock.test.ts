import { expect, it } from 'vitest';
import { generateIsland, hashIsland } from '../world';
import { HOOFINGTON_HAUL_BALE_PREFIX } from '../world/hoofington-entrances';
import { Game } from './Game';
import { isLegacyStockBale } from './HoofingtonStock';

it.each(['billy-isle', 'hoofington-geometry', 'full-loop-core-test'])(
  'seats the legacy field stock without destroying it or changing descriptors on %s', async seed => {
    const options = { seed, resolution: 193 };
    const game = await Game.create(options);
    try {
      expect(game.physics.stepCount).toBe(0);
      expect(hashIsland(game.island)).toBe(hashIsland(generateIsland(options)));
      const bales = game.island.props.filter(isLegacyStockBale);
      expect(bales).toHaveLength(35);
      const bodies = bales.map(bale => game.colliders.bodies.get(bale.id)!);
      const field = bales.map(bale => game.colliders.props.get(bale.id)!);
      const solidProps = game.island.props.filter(prop => prop.poiId === 'hoofington' &&
        prop.collidable && !isLegacyStockBale(prop));
      const starts = bales.map(({ transform, id }, index) => {
        const { x, z } = bodies[index]!.translation();
        return { id, distance: Math.hypot(x - transform.position.x, z - transform.position.z) };
      });
      expect(starts.filter(({ distance }) => distance > .1).length).toBeGreaterThan(8);
      expect(Math.max(...starts.map(p => p.distance))).toBeLessThanOrEqual(8.01);

      for (const [i, collider] of field.entries()) {
        const { x, z } = collider.translation();
        expect(game.colliders.terrain.contactCollider(collider, .02)?.distance ?? 0)
          .toBeGreaterThan(-.006);
        for (const other of [...field.slice(i + 1), ...solidProps.flatMap(prop => {
          const p = prop.transform.position, fixed = game.colliders.props.get(prop.id);
          return fixed && Math.hypot(p.x - x, p.z - z) < 12 ? [fixed] : [];
        })]) {
          const contact = collider.contactCollider(other, 0);
          expect(contact?.distance ?? 0).toBeGreaterThan(-.006);
        }
      }

      const loadLine = solidProps.filter(prop => prop.id.startsWith(HOOFINGTON_HAUL_BALE_PREFIX));
      expect(loadLine).toHaveLength(7);
      for (const prop of loadLine) {
        const { x, y, z } = game.colliders.bodies.get(prop.id)!.translation();
        const at = prop.transform.position;
        expect(x).toBeCloseTo(at.x, 4);
        expect(y).toBeCloseTo(at.y, 4);
        expect(z).toBeCloseTo(at.z, 4);
      }
      for (let i = 1; i <= 120; i++) {
        game.step();
        if (i === 1 || i === 120) for (const [index, prop] of bales.entries()) {
          expect(game.destroyedProps.has(prop.id)).toBe(false);
          expect(game.colliders.bodies.get(prop.id)).toBe(bodies[index]);
        }
      }
    } finally {
      game.dispose();
    }
  });
