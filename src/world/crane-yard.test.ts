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
    // No giant solid tower cuboid blocking the interiors of all four floors.
    expect(props.filter(p => p.kind === 'tower')).toHaveLength(0);
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
    expect(girder.color).toBe(0xee4a31);
    expect(girder.transform.position.y + girder.size.y / 2)
      .toBeLessThan(jibs[0]!.transform.position.y - jibs[0]!.size.y / 2);
    expect(props.filter(p => p.kind === 'crane-cable').length).toBeGreaterThan(3);
    expect(props.filter(p => p.kind === 'crane-cable').every(p => !p.collidable))
      .toBe(true);
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
      'chain-fence', 'pipe-stack', 'site-barrier'] as const) {
      const visual = scene.group.getObjectByName('props-' + kind);
      expect(visual, kind).toBeInstanceOf(THREE.InstancedMesh);
      expect((visual as THREE.InstancedMesh).geometry.getAttribute('position').count)
        .toBeGreaterThan(24);
    }
    scene.dispose();
  });
});
