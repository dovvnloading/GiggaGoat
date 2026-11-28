import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { generateIsland } from '../world/island';
import { roadRibbonData } from '../world/road-ribbons';
import { terrainFaceHeight } from '../world/terrain';
import { meshSurfaceHeight } from '../world/visual-tide-routes';
import { IslandTraffic } from './IslandTraffic';
import { PhysicsWorld, RAPIER } from '../physics';
import { buildRapierColliders } from '../world/colliders';

const clear = {
  enabled: true,
  player: { position: { x: 0, y: 100, z: 0 }, radius: 0.65, height: 1.2 },
  obstacles: [],
  residents: [],
  seaLevel: 0,
  wet: 0,
};
const island = generateIsland({ seed: 'billy-isle', resolution: 193 });

describe('island road traffic', () => {
  it.each([
    ['billy-isle', 600],
    ['pine-run', 320],
    ['pier-run', 900],
  ] as const)('keeps both lanes and all four tire footprints on the physical asphalt for %s', (seed, size) => {
    const world = seed === 'billy-isle' ? island : generateIsland({ seed, size, resolution: 97 });
    const unit = size / 600,
      network = new IslandTraffic(world, []);
    const top = roadRibbonData(world, 'road'),
      mesh = new BufferGeometry();
    mesh.setAttribute('position', new Float32BufferAttribute(top.positions, 3));
    mesh.setIndex(top.supportIndices);
    const asphalt = meshSurfaceHeight([{ geometry: mesh, x: 0, z: 0 }], unit);
    mesh.dispose();
    expect(network.lanes).toHaveLength(2);
    for (const lane of network.lanes) {
      expect(lane.length / unit).toBeGreaterThan(1400);
      const missing: number[][] = [];
      for (const p of lane.poses) {
        const sin = Math.sin(p.yaw),
          cos = Math.cos(p.yaw);
        for (const side of [-1, 1])
          for (const axle of [-1, 1]) {
            const x = p.x + unit * (0.84 * side * cos + 1.26 * axle * sin),
              z = p.z + unit * (-0.84 * side * sin + 1.26 * axle * cos);
            const surface = asphalt(x, z);
            if (!Number.isFinite(surface) || terrainFaceHeight(world, x, z) > surface + 0.012)
              missing.push([x, z, terrainFaceHeight(world, x, z) - surface]);
          }
      }
      expect(missing.slice(0, 5)).toEqual([]);
    }
  });
  it('services every scheduled stop on repeated laps, preserving headway across the loop seam', () => {
    const traffic = new IslandTraffic(island, []);
    let closest = Infinity;
    for (let i = 0; i < 5000; i++) {
      traffic.step(0.1, clear);
      for (const car of traffic.vehicles)
        for (const other of traffic.vehicles) {
          if (car === other || car.lane !== other.lane) continue;
          closest = Math.min(
            closest,
            car.lane.ahead(car.distance, other.distance) - (car.length + other.length) * 0.5
          );
        }
    }
    expect(traffic.vehicles).toHaveLength(16);
    expect(new Set(traffic.vehicles.map((c) => c.service.model)).size).toBe(11);
    expect(closest).toBeGreaterThan(2.6);
    for (const car of traffic.vehicles) {
      expect(car.odometer, car.service.name).toBeGreaterThan(2 * car.lane.length);
      expect(car.serviceCount, car.service.name).toBeGreaterThanOrEqual(2 * car.stops.length);
    }
  });
  it('fits a chassis past the physical dam stairs, bridge furniture and roadside scenery in both directions', async () => {
    const physics = await PhysicsWorld.create();
    try {
      const collision = buildRapierColliders(physics.raw, island);
      physics.raw.step();
      const names = new Map([...collision.props].map(([id, collider]) => [collider.handle, id]));
      const shape = new RAPIER.Cuboid(0.81, 0.68, 1.68),
        hits = new Set<string>();
      for (const lane of new IslandTraffic(island, []).lanes)
        for (const p of lane.poses) {
          const rotation = { x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) };
          physics.raw.intersectionsWithShape({ x: p.x, y: p.y + 1.03, z: p.z }, rotation, shape, (other) => {
            const name = names.get(other.handle);
            if (name) hits.add(name);
            return true;
          });
        }
      expect([...hits]).toEqual([]);
    } finally {
      physics.dispose();
    }
  });
  it('keeps unavailable vehicles silent and non-solid until their model appears', async () => {
    const physics = await PhysicsWorld.create();
    try {
      const traffic = new IslandTraffic(island, [], physics);
      const car = traffic.vehicles[0]!;
      const player = { ...clear.player, position: { ...car.pose, x: car.pose.x + 4 } };
      for (const vehicle of traffic.vehicles) vehicle.available = false;
      traffic.step(1 / 60, { ...clear, player });
      expect(car.body).toBeUndefined();
      expect(traffic.hail(car.pose)).toBe(false);
      expect(traffic.sounds(car.pose).emitters).toEqual([]);
      car.available = true;
      traffic.step(1 / 60, { ...clear, player });
      expect(car.body?.isEnabled()).toBe(true);
      expect(traffic.hail(car.pose)).toBe(true);
      expect(traffic.sounds(car.pose).emitters).toHaveLength(1);
    } finally {
      physics.dispose();
    }
  });
  it('halts for the player and a street obstruction, resumes on clearance, and ignores an overhead rider', () => {
    const traffic = new IslandTraffic(island, []);
    const car = traffic.vehicles[0]!;
    const ahead = car.lane.sample(car.distance + 14, { ...car.pose });
    const player = { position: { x: ahead.x, y: ahead.y + 0.85, z: ahead.z }, radius: 0.65, height: 1.2 };
    for (let i = 0; i < 360; i++) traffic.step(1 / 60, { ...clear, player });
    const gap = Math.hypot(car.pose.x - ahead.x, car.pose.z - ahead.z);
    expect(car.speed).toBeLessThan(0.02);
    expect(gap).toBeGreaterThan(car.length * 0.48 + player.radius);
    const at = car.odometer;
    for (let i = 0; i < 60; i++)
      traffic.step(1 / 60, {
        ...clear,
        obstacles: [player],
        player: { ...player, position: { ...player.position, y: 30 } },
      });
    expect(car.odometer - at).toBeLessThan(0.1);
    for (let i = 0; i < 150; i++)
      traffic.step(1 / 60, { ...clear, player: { ...player, position: { ...player.position, y: 30 } } });
    expect(car.odometer - at).toBeGreaterThan(3);
    expect(traffic.hail(car.pose)).toBe(true);
    const acknowledged = car.answeredAt;
    traffic.hail(car.pose);
    expect(car.answeredAt).toBe(acknowledged);
    for (let i = 0; i < 120; i++) traffic.step(1 / 60, clear);
    expect(car.speed).toBe(0);
    const stopped = car.odometer;
    for (let i = 0; i < 120; i++) traffic.step(1 / 60, { ...clear, enabled: false });
    expect(car.odometer).toBe(stopped);
    expect(traffic.hail(car.pose)).toBe(false);
  });
});
