import { describe, expect, it } from 'vitest';
import { POI_IDS, arePoisConnected, generateIsland, heightAt } from './index';
import { CRANE_YARD_PLAN } from './crane-yard';
import { makeBridgeDecks, makeLocalStreets } from './roads';
import type { IslandData, Vec2 } from './types';

const BYPASS_ID = 'downtown-bleatsville--the-dam';
const SPUR_ID = 'crane-yard-gate-spur';
const cases = [
  { seed: 'billy-isle', size: 600 },
  { seed: 'cy-12-west-approach', size: 450 },
  { seed: 9137, size: 900 },
] as const;

function yardBounds(island: IslandData): {
  centre: Vec2; halfWidth: number; halfDepth: number;
} {
  const centre = island.pois.find(p => p.id === 'crane-yard')!.center;
  const scale = island.size / 600;
  return {
    centre, halfWidth: CRANE_YARD_PLAN.halfWidth * scale + 4,
    halfDepth: CRANE_YARD_PLAN.halfDepth * scale + 4,
  };
}

describe('CY-12 Crane Yard ring-road bypass', () => {
  it.each(cases)('keeps every ring and local asphalt point outside the padded fence ($seed, $size m)',
    ({ seed, size }) => {
      const island = generateIsland({ seed, size, resolution: 97 });
      const { centre, halfWidth, halfDepth } = yardBounds(island);
      const inFenceBuffer = (p: Vec2): boolean =>
        Math.abs(p.x - centre.x) <= halfWidth &&
        Math.abs(p.z - centre.z) <= halfDepth;
      const ring = island.roads.find(road => road.id === BYPASS_ID)!;
      expect(ring.type).toBe('road');
      expect(ring.points.length).toBeGreaterThan(60);

      // Only the explicitly gated spur may enter this margin; every other
      // asphalt centreline (including city streets) must stay outside.
      for (const road of [...island.roads, ...makeLocalStreets(island)]) {
        if (road.type !== 'road' || road.id === SPUR_ID) continue;
        for (const p of road.points) {
          expect(inFenceBuffer(p), String(seed) + ': ' + road.id + ' point').toBe(false);
        }
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1]!, b = road.points[i]!;
          // Also guard against an undersampled segment cutting the box.
          for (const t of [0.25, 0.5, 0.75]) {
            expect(inFenceBuffer({
              x: a.x + (b.x - a.x) * t,
              z: a.z + (b.z - a.z) * t,
            }), String(seed) + ': ' + road.id + ' segment').toBe(false);
          }
        }
      }

      // Adjacent to the yard's latitude, the bypass runs on the inland WEST
      // side, not round the exposed coastline to the east.
      const westLeg = ring.points.filter(p => Math.abs(p.z - centre.z) <= halfDepth);
      expect(westLeg.length).toBeGreaterThan(5);
      for (const point of westLeg) {
        expect(point.x).toBeLessThan(centre.x - halfWidth);
        expect(heightAt(island, point.x, point.z)).toBeGreaterThan(0);
      }
    });

  it.each(cases)('joins one same-width short spur to the open front gate ($seed, $size m)',
    ({ seed, size }) => {
      const island = generateIsland({ seed, size, resolution: 97 });
      expect(arePoisConnected(island.roads, POI_IDS)).toBe(true);
      const bypass = island.roads.find(road => road.id === BYPASS_ID)!;
      const yardRoads = island.roads.filter(r =>
        r.from === 'crane-yard' || r.to === 'crane-yard');
      expect(yardRoads).toHaveLength(1);
      const spur = yardRoads[0]!;
      expect(spur.id).toBe(SPUR_ID);
      expect(spur.type).toBe('road');
      expect(spur.width).toBe(bypass.width);

      const yard = island.pois.find(p => p.id === 'crane-yard')!.center;
      const scale = size / 600;
      const gate: Vec2 = {
        x: yard.x + (CRANE_YARD_PLAN.frontGate.min +
          CRANE_YARD_PLAN.frontGate.max) / 2 * scale,
        z: yard.z + CRANE_YARD_PLAN.halfDepth * scale,
      };
      const first = spur.points[0]!;
      const last = spur.points[spur.points.length - 1]!;
      expect(Math.hypot(last.x - gate.x, last.z - gate.z)).toBeLessThan(3);
      expect(first.z).toBeGreaterThan(last.z);
      const length = spur.points.slice(1).reduce((sum, p, i) =>
        sum + Math.hypot(p.x - spur.points[i]!.x, p.z - spur.points[i]!.z), 0);
      expect(length).toBeLessThan(22 * scale + 6);
      const shared = bypass.points.find(p =>
        Math.hypot(p.x - first.x, p.z - first.z) < 0.001);
      expect(shared).toBeDefined();
      expect(first.y).toBeCloseTo(shared!.y, 4);
      for (let i = 1; i < spur.points.length; i++) {
        const a = spur.points[i - 1]!, b = spur.points[i]!;
        const run = Math.hypot(a.x - b.x, a.z - b.z);
        expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(run * 0.17 + 0.0001);
      }
    });

  it.each(cases)('retains bridge flags, collidable decks and terrain grading ($seed, $size m)',
    ({ seed, size }) => {
      const island = generateIsland({ seed, size, resolution: 97 });
      const decks = island.props.filter(prop => prop.kind === 'bridge' &&
        prop.id.startsWith('bridge-'));
      expect(decks).toEqual(makeBridgeDecks(island));
      let bridgeSegments = 0;
      for (const road of island.roads) {
        for (const p of road.points) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y) &&
            Number.isFinite(p.z)).toBe(true);
        }
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1]!, b = road.points[i]!;
          const distance = Math.hypot(a.x - b.x, a.z - b.z);
          if (!a.bridge && !b.bridge || distance < 0.05) continue;
          bridgeSegments++;
          const deck = decks.find(prop => prop.id === 'bridge-' + road.id + '-' + (i - 1));
          expect(deck).toBeDefined();
          expect(deck!.collidable).toBe(true);
          expect(deck!.body.type).toBe('static');
          expect(deck!.size.x).toBeCloseTo(road.width + 1);
          expect(deck!.size.z).toBeCloseTo(distance + 1.25);
          expect(deck!.transform.position.x).toBeCloseTo((a.x + b.x) / 2);
          expect(deck!.transform.position.z).toBeCloseTo((a.z + b.z) / 2);
        }
      }
      expect(bridgeSegments).toBeGreaterThan(0);
      expect(decks).toHaveLength(bridgeSegments);
    });
});
