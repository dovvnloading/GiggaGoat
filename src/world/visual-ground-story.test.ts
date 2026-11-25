import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateIsland, createWorldScene } from './index';
import { buildGroundStory, planGroundStory } from './visual-ground-story';
import { buildPollinators, planPollinators } from './visual-pollinators';
import { capeSurface } from './lighthouse-access';
import { isPointInsideProps } from './layouts';
import { makeLocalStreets } from './roads';
import { segmentProjection } from './terrain';

describe('district micro-dressing and daytime life', () => {
  it('places bounded, deterministic detail outside traffic and physical props', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const before = island.colliders.length, scale = island.size / 600;
    const first = planGroundStory(island);
    expect(first).toEqual(planGroundStory(island));
    expect(first.length).toBeGreaterThan(100);
    expect(first.length).toBeLessThanOrEqual(1200);
    expect(new Set(first.map(d => d.district)).size).toBeGreaterThanOrEqual(4);
    const roads = [...island.roads, ...makeLocalStreets(island)];
    for (const { position: at, length } of first) {
      expect(at.y).toBeCloseTo(capeSurface(island, at.x, at.z), 5);
      expect(at.y).toBeGreaterThan(island.seaLevel);
      expect(length).toBeLessThanOrEqual(.72 * scale);
      expect(isPointInsideProps({ ...at, y: at.y + .09 * scale }, island.props, .24 * scale)).toBe(false);
      expect(roads.some(road => road.points.slice(1).some((b, i) =>
        segmentProjection(at, road.points[i]!, b).distance < road.width / 2 + .9 * scale))).toBe(false);
    }
    expect(planGroundStory(island, () => true)).toHaveLength(0);
    expect(island.colliders.length).toBe(before);
  });
  it('batches low-profile geometry into district draws and clips them by camera', () => {
    const island = generateIsland({ seed: 17, resolution: 65, size: 400 });
    const story = buildGroundStory(island, () => false);
    expect(story.group.children.length).toBeGreaterThan(0);
    expect(story.group.children.length).toBeLessThanOrEqual(8);
    for (const o of story.group.children) {
      const mesh = o as THREE.Mesh;
      const p = mesh.geometry.getAttribute('position');
      expect(p.count).toBeLessThan(15000);
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
      expect(mesh.castShadow).toBe(false);
      for (let i = 0; i < p.count; i++) {
        const lift = p.getY(i) - capeSurface(island, p.getX(i), p.getZ(i));
        expect(lift).toBeGreaterThan(-.001);
        expect(lift).toBeLessThan(.34 * island.size / 600);
      }
      mesh.geometry.dispose();
    }
    story.update(new THREE.Vector3(4000, 4000, 4000), new THREE.Frustum());
    expect(story.group.children.every(o => !o.visible)).toBe(true);
    (story.group.children[0] as THREE.Mesh).material instanceof THREE.Material &&
      ((story.group.children[0] as THREE.Mesh).material as THREE.Material).dispose();
  });
  it('animates only nearby dry, daytime flights and preserves their world placement', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const plan = planPollinators(island);
    expect(plan).toEqual(planPollinators(island));
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.length).toBeLessThanOrEqual(20);
    const life = buildPollinators(island);
    const camera = new THREE.Vector3().copy(plan[0]!.center);
    const frustum = new THREE.Frustum();
    // An intentionally unrestricted frustum for the animation test. The
    // default Three.js planes are not an all-space camera frustum.
    for (const plane of frustum.planes) plane.setComponents(0, 0, 0, 1);
    life.update(1, island.seaLevel, 1, 0, camera, frustum);
    const visible = life.group.children.find(o => o.visible) as THREE.InstancedMesh;
    expect(visible).toBeDefined();
    const a = new THREE.Matrix4(), b = new THREE.Matrix4();
    visible.getMatrixAt(0, a);
    life.update(1.13, island.seaLevel, 1, 0, camera, frustum);
    visible.getMatrixAt(0, b);
    expect(b.elements).not.toEqual(a.elements);
    for (const [tide, day, rain] of [[island.seaLevel, 0, 0], [island.seaLevel, 1, 1], [1000, 1, 0]] as const) {
      life.update(2, tide, day, rain, camera, frustum);
      expect(life.group.children.every(o => !o.visible)).toBe(true);
    }
    const meshes = life.group.children as THREE.InstancedMesh[];
    for (const mesh of meshes) mesh.dispose();
    meshes[0]?.geometry.dispose();
    (meshes[0]?.material as THREE.Material | undefined)?.dispose();
  });
  it('installs both visual-only systems in the actual world scene', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const scene = createWorldScene(island);
    try {
      expect(scene.group.getObjectByName('lived-in-ground-story')).toBeDefined();
      expect(scene.group.getObjectByName('daytime-pollinators')).toBeDefined();
    } finally { scene.dispose(); }
  });
});
