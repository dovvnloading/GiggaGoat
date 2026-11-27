import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateIsland, createWorldScene } from './index';
import { buildGroundStory, planGroundStory } from './visual-ground-story';
import { buildPollinators, planPollinators } from './visual-pollinators';
import { planPocketGardens } from './insect-habitats';
import { buildGardenSpinners } from './visual-garden-spinners';
import { capeSurface } from './lighthouse-access';
import { isPointInsideProps } from './layouts';
import { makeLocalStreets } from './roads';
import { segmentProjection } from './terrain';
import { triangleCount } from './lod';

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
    life.dispose();
  });

  it('seeds distinct insects above village blooms and woodland lily pools', () => {
    for (const [seed, size] of [['billy-isle', 600], [17, 400]] as const) {
      const island = generateIsland({ seed, size, resolution: 65 });
      const gardens = planPocketGardens(island);
      const plan = planPollinators(island, gardens);
      expect(gardens.length).toBeGreaterThan(1);
      expect(planPocketGardens(island, () => true)).toHaveLength(0);
      const spawn = island.spawns[0]!.position;
      expect(plan.some(flight => flight.district === 'hoofington' && flight.bloom &&
        gardens.some(garden => garden.position.x === flight.bloom!.x && garden.position.z === flight.bloom!.z) &&
        Math.hypot(spawn.x - flight.center.x, spawn.z - flight.center.z) < 15 * size / 600)).toBe(true);
      expect(new Set(plan.map(flight => flight.species))).toEqual(new Set(['bee', 'butterfly', 'dragonfly']));
      const lilyPads = island.props.filter(prop => prop.kind === 'lily-pads');
      for (const flight of plan.filter(f => f.species === 'dragonfly')) {
        expect(flight.district).toBe('whispering-pines');
        expect(lilyPads.some(pad => {
          const p = pad.transform.position;
          return p.x === flight.center.x && p.z === flight.center.z && p.y < flight.center.y;
        })).toBe(true);
      }
    }
  });

  it('scatters an insect and petals once per approach, then resumes its seeded flight', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const target = planPollinators(island)[0]!;
    const life = buildPollinators(island), idle = buildPollinators(island);
    try {
      const camera = new THREE.Vector3().copy(target.center);
      const frustum = new THREE.Frustum();
      for (const plane of frustum.planes) plane.setComponents(0, 0, 0, 1);
      const player = { ...target.center };
      const petals = life.group.getObjectByName('startled-flower-petals') as THREE.InstancedMesh;
      const bodyY = (scene: typeof life) => {
        const body = scene.group.getObjectByName('insect-bodies-' + target.species) as THREE.InstancedMesh;
        const matrix = new THREE.Matrix4();
        body.getMatrixAt(0, matrix);
        return matrix.elements[13]!;
      };
      life.update(1, island.seaLevel, 1, 0, camera, frustum, player);
      life.update(1.42, island.seaLevel, 1, 0, camera, frustum, player);
      idle.update(1.42, island.seaLevel, 1, 0, camera, frustum);
      expect(petals.count).toBe(4);
      expect(bodyY(life) - bodyY(idle)).toBeGreaterThan(.4);
      life.update(5, island.seaLevel, 1, 0, camera, frustum, player);
      idle.update(5, island.seaLevel, 1, 0, camera, frustum);
      expect(petals.count).toBe(0);
      expect(bodyY(life)).toBe(bodyY(idle));
      life.update(6, island.seaLevel, 1, 0, camera, frustum, { ...player, x: player.x + 4 });
      life.update(6.5, island.seaLevel, 1, 0, camera, frustum, player);
      life.update(6.92, island.seaLevel, 1, 0, camera, frustum, player);
      expect(petals.count).toBe(4);
    } finally {
      life.dispose();
      idle.dispose();
    }
  });

  it('grounds the garden stakes and limits both pinwheel batches to nearby sites', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const gardens = planPocketGardens(island);
    const spinners = buildGardenSpinners(island, gardens);
    try {
      const camera = new THREE.Vector3().copy(gardens[0]!.position);
      const frustum = new THREE.Frustum();
      for (const plane of frustum.planes) plane.setComponents(0, 0, 0, 1);
      const stakes = spinners.group.getObjectByName('pinwheel-stakes') as THREE.InstancedMesh;
      const rotors = spinners.group.getObjectByName('pinwheel-rotors') as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      spinners.update(1, island.seaLevel, 0, camera, frustum);
      expect(stakes.count).toBe(gardens.length);
      expect(rotors.count).toBe(stakes.count);
      stakes.getMatrixAt(0, matrix);
      const base = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(base.y).toBeCloseTo(capeSurface(island, base.x, base.z) - .045, 3);
      rotors.getMatrixAt(0, matrix);
      const before = [...matrix.elements];
      spinners.update(2, island.seaLevel, 0, camera, frustum);
      rotors.getMatrixAt(0, matrix);
      expect(matrix.elements.slice(0, 12)).not.toEqual(before.slice(0, 12));
      expect(matrix.elements.slice(12)).toEqual(before.slice(12));
      spinners.update(3, island.seaLevel, 0, new THREE.Vector3(4000, 4000, 4000), frustum);
      expect(rotors.count).toBe(0);
      expect(stakes.count).toBe(0);
    } finally { spinners.dispose(); }
  });

  it('installs the visual-only systems in the actual world scene', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const scene = createWorldScene(island);
    try {
      expect(scene.group.getObjectByName('lived-in-ground-story')).toBeDefined();
      expect(scene.group.getObjectByName('daytime-pollinators')).toBeDefined();
      expect(scene.group.getObjectByName('garden-spinners')).toBeDefined();
      const flowers = scene.group.getObjectByName('garden-flowers')!;
      expect(flowers).toBeDefined();
      const farm = island.pois.find(poi => poi.id === 'hoofington')!.center;
      const camera = new THREE.PerspectiveCamera(64, 16 / 9, .25, 4000);
      camera.position.set(farm.x, farm.y + 5, farm.z + 37);
      camera.lookAt(farm.x, farm.y, farm.z);
      scene.updateCulling(camera);
      const batches = flowers.children.filter((object): object is THREE.InstancedMesh =>
        object instanceof THREE.InstancedMesh && object.visible && object.count > 0);
      expect(batches.length).toBeGreaterThan(0);
      expect(batches.every(mesh => mesh.name.startsWith('environment-lod-far-'))).toBe(true);
      expect(batches.reduce((cost, batch) => cost + triangleCount(batch.geometry) * batch.count, 0))
        .toBeLessThan(4_000);
    } finally { scene.dispose(); }
  });
});
