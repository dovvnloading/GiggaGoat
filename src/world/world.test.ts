import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  IslandGenerator, POI_IDS, arePoisConnected, biomeAt, buildRapierColliders,
  createWorldScene, generateIsland, hashIsland, heightAt, isPointInsideProps,
  isSafeCollectiblePosition, landAreaAtTideLevel, zoneAt,
} from './index';

describe('Billy Isle deterministic world generation', () => {
  it('is byte-for-byte reproducible and changes with the seed', () => {
    const gen = new IslandGenerator({ resolution: 97 });
    const a = gen.generate({ seed: 'Hooves-17' });
    const b = gen.generate({ seed: 'Hooves-17' });
    const c = gen.generate({ seed: 'Hooves-18' });
    expect(hashIsland(a)).toBe(hashIsland(b));
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(a.props).toEqual(b.props);
    expect(a.roads).toEqual(b.roads);
    expect(a.relics).toEqual(b.relics);
    expect(hashIsland(a)).not.toBe(hashIsland(c));
    expect(a.heights.some((height, i) => height !== c.heights[i])).toBe(true);
    expect(a.heights.every(Number.isFinite)).toBe(true);
  });

  it('creates a real ocean coastline, mountain, river, reservoir and distinct biomes', () => {
    const island = generateIsland({ seed: 82, resolution: 97 });
    expect(island.size).toBe(600);
    expect(island.heights.length).toBe(97 * 97);
    expect(heightAt(island, 295, 295)).toBeLessThan(0);
    expect(heightAt(island, 0, 0)).toBeGreaterThan(90);
    expect(heightAt(island, 0, 0)).toBeGreaterThan(heightAt(island, 150, 150) + 60);
    expect(island.river[0]!.level).toBeGreaterThan(island.river[island.river.length - 1]!.level);
    expect(island.reservoir.level).toBeGreaterThan(0);
    const biomes = new Set(Array.from(island.biomeMap));
    expect(biomes.size).toBeGreaterThanOrEqual(6);
    expect(biomeAt(island, 298, 298)).toBe('ocean');
    expect(zoneAt(island, island.pois[0]!.center.x, island.pois[0]!.center.z))
      .toBe('hoofington');
  });

  it('places all eight named POIs on land without overlaps', () => {
    for (const seed of ['placement-A', 'placement-B', 'placement-C']) {
      const island = generateIsland({ seed, resolution: 97 });
      expect(island.pois.map(p => p.id)).toEqual([...POI_IDS]);
      for (let i = 0; i < island.pois.length; i++) {
        const a = island.pois[i]!;
        expect(heightAt(island, a.center.x, a.center.z)).toBeGreaterThan(0.25);
        for (let j = 0; j < i; j++) {
          const b = island.pois[j]!;
          expect(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z))
            .toBeGreaterThan(a.radius + b.radius);
        }
      }
    }
  });

  it('connects every district with graded spline roads and switchbacks', () => {
    const island = generateIsland({ seed: 'roads', resolution: 193 });
    expect(arePoisConnected(island.roads, POI_IDS)).toBe(true);
    expect(island.roads.some(road => road.type === 'trail' && road.from === 'mt-gigga' &&
      road.points.length > 150)).toBe(true);
    for (const road of island.roads) {
      const start = island.pois.find(p => p.id === road.from)!.center;
      const end = island.pois.find(p => p.id === road.to)!.center;
      expect(Math.hypot(road.points[0]!.x - start.x, road.points[0]!.z - start.z)).toBeLessThan(0.01);
      expect(Math.hypot(road.points[road.points.length - 1]!.x - end.x,
        road.points[road.points.length - 1]!.z - end.z)).toBeLessThan(0.01);
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!, b = road.points[i]!;
        const horizontal = Math.hypot(a.x - b.x, a.z - b.z);
        if (horizontal < 0.001) continue;
        expect(Math.abs(a.y - b.y) / horizontal).toBeLessThanOrEqual(0.27);
      }
    }
    expect(island.props.some(p => p.kind === 'bridge')).toBe(true);
    // Validate the actual COLLIDABLE heightfield, not just graded road metadata.
    const deviations: number[] = [];
    const terrainGrades: number[] = [];
    for (const road of island.roads) {
      for (let i = 0; i < road.points.length; i++) {
        const p = road.points[i]!;
        if (p.bridge) continue;
        const h = heightAt(island, p.x, p.z);
        deviations.push(Math.abs(h - p.y));
        if (i > 0 && !road.points[i - 1]!.bridge) {
          const prev = road.points[i - 1]!;
          const distance = Math.hypot(p.x - prev.x, p.z - prev.z);
          if (distance > 0.01) {
            terrainGrades.push(Math.abs(h - heightAt(island, prev.x, prev.z)) / distance);
          }
        }
      }
    }
    const p95 = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) * 0.95)]!;
    };
    console.info('physical road profile', { p95Deviation: p95(deviations), p95Grade: p95(terrainGrades) });
    expect(p95(deviations)).toBeLessThan(4);
    expect(p95(terrainGrades)).toBeLessThan(0.55);
  });

  it('keeps graded building pads flat and preserves solid, walkable roof geometry', () => {
    const island = generateIsland({ seed: 'plots', resolution: 193 });
    for (const plot of island.plots.filter(p => p.flat)) {
      const heights = [];
      for (const [dx, dz] of [[0, 0], [0.36, 0], [-0.36, 0], [0, 0.36], [0, -0.36]]) {
        heights.push(heightAt(island, plot.center.x + dx! * plot.radius,
          plot.center.z + dz! * plot.radius));
      }
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(3.5);
    }
    expect(island.props.filter(p => p.kind === 'shop').length).toBeGreaterThanOrEqual(7);
    expect(island.props.filter(p => p.kind === 'ramp').length).toBeGreaterThan(5);
    expect(island.colliders.some(p => p.shape === 'convex')).toBe(true);
    expect(island.props.filter(p => p.kind.startsWith('tree-')).length).toBeGreaterThan(70);
  });

  it('has eight safe starter spawns and exactly 50 distinct unburied Goat Relics', () => {
    const island = generateIsland({ seed: 'collect-them', resolution: 193 });
    expect(island.spawns.length).toBe(8);
    expect(island.relics.length).toBe(50);
    expect(new Set(island.relics.map(r => r.id)).size).toBe(50);
    for (const spawn of island.spawns) {
      expect(spawn.position.y).toBeGreaterThan(island.seaLevel);
      expect(isSafeCollectiblePosition(island, spawn.position)).toBe(true);
      expect(isPointInsideProps(spawn.position, island.props, 0.6)).toBe(false);
    }
    for (const relic of island.relics) {
      expect(relic.position.y).toBeGreaterThan(island.seaLevel);
      expect(isSafeCollectiblePosition(island, relic.position)).toBe(true);
    }
    expect(island.relics.some(r => r.category === 'under-pier')).toBe(true);
    expect(island.relics.some(r => r.category === 'rooftop')).toBe(true);
    expect(island.relics.some(r => r.category === 'cliff-ledge')).toBe(true);
    expect(new Set(island.relics.map(r => r.poiId)).size).toBe(8);
  });

  it('monotonically shrinks playable land as the tide rises to the summit', () => {
    const island = generateIsland({ seed: 'high-water', resolution: 97 });
    const area = island.tideLevels.map(t => landAreaAtTideLevel(island, t));
    expect(area[0]).toBeGreaterThan(180_000);
    expect(area[area.length - 1]).toBeLessThan(area[0]! * 0.04);
    for (let i = 1; i < area.length; i++) {
      expect(area[i]!).toBeLessThanOrEqual(area[i - 1]!);
      expect(island.tideLevels[i]!).toBeGreaterThan(island.tideLevels[i - 1]!);
    }
    expect(landAreaAtTideLevel(island, 10000)).toBe(0);
    expect(() => landAreaAtTideLevel(island, Number.NaN)).toThrow();
  });

  it('rejects nonfinite dimensions and unreasonable grid resolutions', () => {
    expect(() => generateIsland({ size: Infinity })).toThrow(RangeError);
    expect(() => generateIsland({ resolution: 4 })).toThrow(RangeError);
    expect(() => generateIsland({ resolution: 97.5 })).toThrow(RangeError);
  });
});

describe('rendering and Rapier integration', () => {
  it('builds chunks, instanced props, water and adjustable lighting without a DOM', () => {
    const island = generateIsland({ seed: 'render', resolution: 65 });
    const view = createWorldScene(island, { chunkSegments: 16 });
    expect(view.chunks.length).toBe(16);
    expect(view.group.getObjectByName('props-tree-pine')).toBeInstanceOf(THREE.InstancedMesh);
    expect(view.group.getObjectByName('paths-road')).toBeInstanceOf(THREE.InstancedMesh);
    view.setDayNight(0.02);
    const nightLight = view.sun.intensity;
    view.setDayNight(0.5);
    expect(view.sun.intensity).toBeGreaterThan(nightLight);
    view.setTideLevel(14);
    expect(view.water.position.y).toBe(14);
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 1500);
    camera.position.set(0, 200, 380);
    camera.lookAt(0, 0, 0);
    view.updateCulling(camera);
    expect(view.chunks.some(chunk => chunk.visible)).toBe(true);
    view.dispose();
  });

  it('instantiates all descriptor shapes in headless Rapier; a dropped ball lands at terrain height', async () => {
    await RAPIER.init();
    const island = generateIsland({ seed: 'physics', resolution: 97 });
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const built = buildRapierColliders(world, island);
    expect(built.terrain).toBeDefined();
    expect(built.props.size).toBe(island.colliders.length - 1);
    expect(built.bodies.size).toBeGreaterThan(30);
    expect(['heightfield', 'cuboid', 'cylinder', 'convex']
      .every(shape => island.colliders.some(c => c.shape === shape))).toBe(true);
    const farm = island.pois.find(p => p.id === 'hoofington')!.center;
    const x = farm.x + 4, z = farm.z + 3, ground = heightAt(island, farm.x + 4, farm.z + 3);
    const ball = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, ground + 13, z));
    world.createCollider(RAPIER.ColliderDesc.ball(0.52).setRestitution(0), ball);
    for (let i = 0; i < 250; i++) world.step();
    const landing = ball.translation();
    const landed = landing.y;
    const finalGround = heightAt(island, landing.x, landing.z);
    expect(Math.hypot(landing.x - x, landing.z - z)).toBeLessThan(5);
    expect(landed).toBeGreaterThan(finalGround + 0.35);
    expect(landed).toBeLessThan(finalGround + 1.1);
    expect(Math.abs(finalGround - ground)).toBeLessThan(0.6);
    world.free();
  });
});
