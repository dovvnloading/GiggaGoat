import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland, heightAt } from './index';
import { CRANE_YARD_PLAN } from './crane-yard';
import type { IslandData, PropDescriptor } from './types';

function yardProps(island: IslandData): PropDescriptor[] {
  return island.props.filter(prop => prop.poiId === 'crane-yard');
}
function rel(island: IslandData, prop: PropDescriptor): { x: number; z: number } {
  const centre = island.pois.find(poi => poi.id === 'crane-yard')!.center;
  const scale = island.size / 600;
  return {
    x: (prop.transform.position.x - centre.x) / scale,
    z: (prop.transform.position.z - centre.z) / scale,
  };
}

describe('Crane Yard concept-art construction site', () => {
  it('has four climbable open concrete levels supported by a real column grid', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 129 });
    const props = yardProps(island);
    const slabs = props.filter(p => p.kind === 'concrete-slab' &&
      p.size.x > 20 * island.size / 600);
    const columns = props.filter(p => p.kind === 'concrete-column');
    expect(slabs).toHaveLength(4);
    expect(columns).toHaveLength(9);
    expect(slabs.every(p => p.collidable && p.climbable && p.body.type === 'static'))
      .toBe(true);
    expect(columns.every(p => p.collidable && p.body.type === 'static')).toBe(true);
    expect(new Set(slabs.map(p => Math.round(p.transform.position.y * 100))).size)
      .toBe(4);
    expect(Math.max(...columns.map(p => p.transform.position.y + p.size.y / 2)))
      .toBeGreaterThan(Math.max(...slabs.map(p => p.transform.position.y + p.size.y / 2)));
    // The pre-existing demolition gig still uses a tiny, invisible-to-camera
    // kind='tower' marker. It must never create a solid tower-sized collider.
    const compatTower = props.filter(p => p.kind === 'tower');
    expect(compatTower).toHaveLength(1);
    expect(compatTower[0]!.collidable).toBe(false);
    expect(compatTower[0]!.size.x).toBeLessThan(island.size / 600 * 0.1);
    expect(props.filter(p => p.kind === 'yard-scaffold')).toHaveLength(2);
    const towerCentre = rel(island, slabs[0]!);
    expect(towerCentre.x).toBeCloseTo(CRANE_YARD_PLAN.tower.x);
    expect(towerCentre.z).toBeCloseTo(CRANE_YARD_PLAN.tower.z);
  });

  it('hangs a red girder from a dominant yellow lattice crane, with a second behind', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 129 });
    const props = yardProps(island);
    const masts = props.filter(p => p.kind === 'crane')
      .sort((a, b) => b.size.y - a.size.y);
    const jibs = props.filter(p => p.kind === 'crane-jib')
      .sort((a, b) => b.size.x - a.size.x);
    const girder = props.find(p => p.kind === 'red-girder')!;
    expect(masts).toHaveLength(2);
    expect(jibs).toHaveLength(2);
    expect(masts[0]!.size.y / (island.size / 600)).toBeCloseTo(CRANE_YARD_PLAN.crane.height);
    expect(jibs[0]!.size.x / (island.size / 600)).toBeCloseTo(CRANE_YARD_PLAN.crane.jibLength);
    expect(girder.color).toBe(0xffffff);
    expect(girder.transform.position.y + girder.size.y / 2)
      .toBeLessThan(jibs[0]!.transform.position.y - jibs[0]!.size.y / 2);
    expect(props.filter(p => p.kind === 'crane-cable').length).toBeGreaterThan(3);
    expect(props.filter(p => p.kind === 'crane-cable').every(p => !p.collidable))
      .toBe(true);
    for (const kind of ['crane', 'crane-jib', 'crane-cab', 'crane-cable',
      'red-girder'] as const) {
      const matches = props.filter(prop => prop.kind === kind);
      expect(matches.length, kind).toBeGreaterThan(0);
      expect(matches.every(prop => prop.color === 0xffffff), kind).toBe(true);
    }
  });

  it('fences all four sides of the paved rectangle, keeping only two gated road entries', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 129 });
    const props = yardProps(island);
    const fences = props.filter(p => p.kind === 'chain-fence');
    const segments = (z: number): number[] => fences.filter(p =>
      Math.abs(rel(island, p).z - z) < 0.001 &&
      p.transform.rotationY === 0).map(p => rel(island, p).x).sort((a, b) => a - b);
    const front = segments(CRANE_YARD_PLAN.halfDepth);
    const rear = segments(-CRANE_YARD_PLAN.halfDepth);
    expect(front).toEqual([-36, -28, -20, -12, -4, 4, 36]);
    expect(rear).toEqual([-36, -28, -20, 12, 20, 28, 36]);
    for (const x of [-CRANE_YARD_PLAN.halfWidth, CRANE_YARD_PLAN.halfWidth]) {
      const side = fences.filter(p =>
        Math.abs(rel(island, p).x - x) < 0.001 &&
        p.transform.rotationY === Math.PI / 2);
      expect(side).toHaveLength(9);
      expect(Math.min(...side.map(p => rel(island, p).z - 4))).toBeCloseTo(-36);
      expect(Math.max(...side.map(p => rel(island, p).z + 4))).toBeCloseTo(36);
    }
    expect(front.some(x => x > CRANE_YARD_PLAN.frontGate.min &&
      x < CRANE_YARD_PLAN.frontGate.max)).toBe(false);
    expect(rear.some(x => x > CRANE_YARD_PLAN.rearGate.min &&
      x < CRANE_YARD_PLAN.rearGate.max)).toBe(false);
    expect(fences.every(p => p.collidable && p.body.type === 'static')).toBe(true);
  });

  it('contains grouped containers, pipes, cones, crates and barriers on dry paved land', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const props = yardProps(island);
    for (const kind of ['container', 'pipe-stack', 'crate', 'cone', 'site-barrier'] as const) {
      expect(props.some(p => p.kind === kind)).toBe(true);
    }
    expect(props.filter(p => p.kind === 'container').length).toBeGreaterThanOrEqual(5);
    expect(props.filter(p => p.kind === 'cone').length).toBeGreaterThan(12);
    const centre = island.pois.find(p => p.id === 'crane-yard')!.center;
    expect(heightAt(island, centre.x, centre.z)).toBeGreaterThan(0);
    expect(props.length).toBeGreaterThan(85);
  });

  it('sets breakable ground-level freight outside a clear gate-to-yard lane', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const props = yardProps(island);
    const crates = props.filter(prop => prop.kind === 'crate');
    const breakables = crates.filter(prop => prop.breakable);
    expect(breakables).toHaveLength(8);
    expect(crates.filter(prop => prop.body.type === 'static')).toHaveLength(3);
    for (const prop of breakables) {
      const { x, y, z } = prop.transform.position;
      const local = rel(island, prop);
      expect(prop.body.type).toBe('dynamic');
      expect(prop.lickable).toBe(true);
      expect(Math.max(prop.size.x, prop.size.y, prop.size.z)).toBeLessThan(1.4);
      expect(y - prop.size.y / 2).toBeCloseTo(heightAt(island, x, z), 6);
      const cornerRadius = Math.hypot(prop.size.x, prop.size.z) / 2;
      expect(Math.abs(local.x - 20) - cornerRadius).toBeGreaterThan(5);
      for (const other of breakables) {
        if (other === prop) continue;
        const point = other.transform.position;
        const otherRadius = Math.hypot(other.size.x, other.size.z) / 2;
        expect(Math.hypot(x - point.x, z - point.z)).toBeGreaterThan(cornerRadius + otherRadius);
      }
    }
  });

  it('anchors the authored site banner without replacing the peak or cape flags', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 129 });
    const banners = yardProps(island).filter(p => p.kind === 'site-banner');
    expect(banners).toHaveLength(1);
    const banner = banners[0]!;
    expect(rel(island, banner).x).toBeCloseTo(-12.5, 6);
    expect(rel(island, banner).z).toBeCloseTo(7.15, 6);
    expect(banner.size).toEqual({ x: 4, y: 3.2, z: 0.15 });
    const pad = island.pois.find(p => p.id === 'crane-yard')!.center;
    const padHeight = heightAt(island, pad.x, pad.z);
    expect(banner.transform.position.y - banner.size.y / 2)
      .toBeCloseTo(padHeight + 12.4, 6);
    expect(banner.color).toBe(0xf47a46);
    expect(banner.collidable).toBe(false);
    expect(yardProps(island).filter(p => p.kind === 'flag')).toHaveLength(0);
    expect(island.props.filter(p => p.kind === 'flag' &&
      (p.poiId === 'mt-gigga' || p.poiId === 'old-lighthouse'))).toHaveLength(2);
  });

  it('keeps all container and cone coordinates with the corrected collider sizes', () => {
    const containers = [
      [-31, -28, 0, 0x4589ba], [-17, -31, 0, 0x367da7],
      [33, 24, Math.PI / 2, 0xc95241], [33, 7, Math.PI / 2, 0xda6844],
      [33, -26, Math.PI / 2, 0x4c98ad],
    ] as const;
    const conePositions = [
      [-25, 18], [-19, 18], [-13, 18], [-7, 18], [0, 18], [7, 18],
      [10, 27], [29, 28], [35, 28], [-31, 11], [-29, 3],
      [13, -20], [28, -20], [12, 3], [30, -4],
    ] as const;
    for (const size of [600, 900]) {
      const island = generateIsland({ seed: 'billy-isle', size, resolution: 129 });
      const scale = size / 600;
      const props = yardProps(island);
      const cargo = props.filter(p => p.kind === 'container');
      const cones = props.filter(p => p.kind === 'cone');
      expect(cargo).toHaveLength(containers.length);
      expect(cones).toHaveLength(conePositions.length);
      for (const [i, [x, z, yaw, color]] of containers.entries()) {
        const prop = cargo[i]!;
        expect(rel(island, prop).x).toBeCloseTo(x, 6);
        expect(rel(island, prop).z).toBeCloseTo(z, 6);
        expect(prop.transform.rotationY).toBeCloseTo(yaw, 6);
        expect(prop.color).toBe(color);
        expect(prop.size.x / scale).toBeCloseTo(12.2, 6);
        expect(prop.size.y / scale).toBeCloseTo(3.2, 6);
        expect(prop.size.z / scale).toBeCloseTo(3.0, 6);
      }
      for (const [i, [x, z]] of conePositions.entries()) {
        const prop = cones[i]!;
        expect(rel(island, prop).x).toBeCloseTo(x, 6);
        expect(rel(island, prop).z).toBeCloseTo(z, 6);
        expect(prop.size.x / scale).toBeCloseTo(0.5, 6);
        expect(prop.size.y / scale).toBeCloseTo(0.75, 6);
        expect(prop.size.z / scale).toBeCloseTo(0.5, 6);
        expect(prop.body).toEqual({ type: 'dynamic', mass: 2 });
        expect(prop.shape).toBe('cylinder');
        expect(prop.climbable).toBe(false);
        expect(prop.color).toBe(0xff8e21);
      }
    }
  });

  it('renders the authored compound construction models and keeps positions scaled', () => {
    for (const size of [450, 900]) {
      const island = generateIsland({ seed: 'other-world', size, resolution: 97 });
      const roof = yardProps(island).find(p =>
        p.kind === 'concrete-slab' && p.size.x > 20 * size / 600)!;
      expect(rel(island, roof).x).toBeCloseTo(CRANE_YARD_PLAN.tower.x);
      expect(rel(island, roof).z).toBeCloseTo(CRANE_YARD_PLAN.tower.z);
    }
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const scene = createWorldScene(island);
    for (const kind of ['concrete-slab', 'concrete-column', 'yard-scaffold',
      'safety-rail', 'crane-jib', 'crane-cab', 'red-girder',
      'chain-fence', 'pipe-stack', 'site-barrier', 'site-banner', 'bunting',
      'container'] as const) {
      const visual = scene.group.getObjectByName('props-' + kind);
      expect(visual, kind).toBeInstanceOf(THREE.InstancedMesh);
      expect((visual as THREE.InstancedMesh).geometry.getAttribute('position').count)
        .toBeGreaterThan(24);
    }
    scene.dispose();
  });
});
