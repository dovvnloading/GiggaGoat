import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ambientFlightActivity, ambientInRange, sampleEnvironmentWind } from './environment-wind';
import { islandWeather } from './island-weather';
import { prepareWindGeometry } from './visual-wind';
import { buildPropVisuals } from './visual-props';
import { buildMeadowScatter } from './visual-meadow';
import { createWindUniforms } from './visual-wind';
import { generateIsland, hashIsland } from './index';
import { buildPollinators, planPollinators } from './visual-pollinators';
import { buildHarborLife } from './visual-harbor-life';

describe('shared environment wind (LW-201)', () => {
  it('is seeded, bounded, frame-rate independent and accepts a reusable output', () => {
    const at = (time: number) => sampleEnvironmentWind(time, 'billy-isle', islandWeather(time).rain, -48, 130);
    expect(at(120)).toEqual(at(120));
    expect(at(120)).not.toEqual(sampleEnvironmentWind(120, 'other-isle', islandWeather(120).rain, -48, 130));
    const reused = at(0);
    for (const hz of [24, 30, 60, 144]) {
      for (let frame = 0; frame <= hz * 12; frame++) {
        const time = frame / hz;
        expect(sampleEnvironmentWind(time, 'billy-isle', islandWeather(time).rain, -48, 130, reused)).toBe(reused);
        expect(Math.hypot(reused.directionX, reused.directionZ)).toBeCloseTo(1, 12);
        expect(reused.gust).toBeGreaterThanOrEqual(.24 - 1e-10);
        expect(reused.gust).toBeLessThanOrEqual(1);
        expect(Math.hypot(reused.x, reused.z)).toBeLessThanOrEqual(2.2);
      }
      expect(reused).toEqual(at(12));
    }
    expect(Object.values(sampleEnvironmentWind(NaN, 'billy-isle', Infinity)).every(Number.isFinite)).toBe(true);
  });

  it('does not reset across rain fronts, day rollover or adjacent districts', () => {
    for (const time of [39, 61, 80, 104, 179, 187, 374, 436.8, 480, 960, 3600]) {
      const a = sampleEnvironmentWind(time - .0001, 19, islandWeather(time - .0001).rain, 4, -7);
      const b = sampleEnvironmentWind(time + .0001, 19, islandWeather(time + .0001).rain, 4, -7);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(.001);
      const nearby = sampleEnvironmentWind(time, 19, islandWeather(time).rain, 4.01, -7.01);
      expect(Math.hypot(a.x - nearby.x, a.z - nearby.z)).toBeLessThan(.001);
    }
    const fair = sampleEnvironmentWind(75, 19, 0), wet = sampleEnvironmentWind(75, 19, 1);
    expect(wet.directionX).toBe(fair.directionX);
    expect(wet.directionZ).toBe(fair.directionZ);
    expect(wet.strength).toBeGreaterThan(fair.strength);
  });

  it('pins roots, rigid wood, the flag pole and both bunting fixings', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -.49, -.49, 0, .49, -.49, 0, 0, 0, 0, 0, .49, 0, .49, .49, 0,
    ], 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([
      .2, .1, .04, .2, .1, .04, .2, .1, .04, .1, .5, .1, .1, .5, .1,
    ], 3));
    prepareWindGeometry(geometry, 'tree-oak');
    let weight = geometry.getAttribute('windWeight');
    expect([weight.getX(0), weight.getX(1), weight.getX(2)]).toEqual([0, 0, 0]);
    expect(weight.getX(3)).toBeGreaterThan(0);
    prepareWindGeometry(geometry, 'flag');
    weight = geometry.getAttribute('windWeight');
    expect(weight.getX(0)).toBe(0);
    expect(weight.getX(4)).toBeGreaterThan(0);
    prepareWindGeometry(geometry, 'bunting');
    weight = geometry.getAttribute('windWeight');
    expect(Math.abs(weight.getX(0))).toBeLessThan(1e-10);
    expect(Math.abs(weight.getX(1))).toBeLessThan(1e-10);
    expect(weight.getX(2)).toBeGreaterThan(0);
    expect(weight.getX(3)).toBe(0);
    geometry.dispose();
  });

  it('shares the exact shader uniforms across meadow, prop colour and shadow passes without moving collider transforms', () => {
    const island = generateIsland({ seed: 'wind-integration', resolution: 65 });
    const before = hashIsland(island);
    const shared = createWindUniforms(island.seed);
    const props = buildPropVisuals(island.props, 96, island, undefined, undefined, shared);
    const meadow = buildMeadowScatter(island, undefined, undefined, shared);
    const tree = props.group.getObjectByName('props-tree-oak') as THREE.InstancedMesh;
    const initial = Array.from(tree.instanceMatrix.array);
    const grass = meadow.children[0] as THREE.InstancedMesh;
    const compile = (material: THREE.Material) => {
      const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '' };
      material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
      return shader as unknown as THREE.WebGLProgramParametersWithUniforms;
    };
    const shaders = [compile(tree.material as THREE.Material), compile(tree.customDepthMaterial!),
      compile(grass.material as THREE.Material)];
    props.update(84, .75);
    for (const shader of shaders) {
      expect(shader.uniforms['uWorldWind']).toBe(shared.uWorldWind);
      expect(shader.uniforms['uWindVelocity']).toBe(shared.uWindVelocity);
      expect(shader.uniforms['uWorldWind']!.value).toBe(84);
      expect(shader.vertexShader).toContain('windWeight');
      expect(shader.vertexShader).toContain('instanceMatrix[3].xz');
    }
    expect(tree.geometry.getAttribute('windWeight').count).toBe(tree.geometry.getAttribute('position').count);
    expect(grass.geometry.getAttribute('windWeight').count).toBe(grass.geometry.getAttribute('position').count);
    expect(Array.from(tree.instanceMatrix.array)).toEqual(initial);
    expect(hashIsland(island)).toBe(before);
    props.dispose();
    for (const group of [props.group, meadow]) group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of mats) material.dispose();
      }
    });
  });
});

describe('ambient visibility continuity (LW-203)', () => {
  it('smoothly crosses the former daylight/rain thresholds with a separate culling margin', () => {
    for (const species of ['gull', 'pollinator'] as const) {
      for (const [day, rain] of [[.2, 0], [.42, 0], [1, .48], [1, .8]] as const) {
        const a = ambientFlightActivity(day - .0001, rain - .0001, species);
        const b = ambientFlightActivity(day + .0001, rain + .0001, species);
        expect(Math.abs(a - b)).toBeLessThan(.003);
      }
      expect(ambientFlightActivity(0, 0, species)).toBe(0);
      expect(ambientFlightActivity(1, 1, species)).toBe(0);
      expect(ambientFlightActivity(1, 0, species)).toBe(1);
    }
    expect(ambientInRange(56, true, 55, 4)).toBe(true);
    expect(ambientInRange(56, false, 55, 4)).toBe(false);
    expect(ambientInRange(60, true, 55, 4)).toBe(false);
  });

  it('keeps motion phase across culling and uses opaque fades for the existing bounded draws', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const flights = planPollinators(island), a = buildPollinators(island), b = buildPollinators(island);
    const harbor = buildHarborLife(island);
    const camera = new THREE.Vector3().copy(flights[0]!.center);
    const far = new THREE.Vector3(10000, 10000, 10000);
    const frustum = new THREE.Frustum();
    for (const plane of frustum.planes) plane.setComponents(0, 0, 0, 1);
    a.update(10, 0, 1, 0, camera, frustum);
    a.update(12, 0, 1, 0, far, frustum);
    a.update(18, 0, 1, 0, camera, frustum);
    b.update(18, 0, 1, 0, camera, frustum);
    expect(a.group.children.map(object => Array.from((object as THREE.InstancedMesh).instanceMatrix.array)))
      .toEqual(b.group.children.map(object => Array.from((object as THREE.InstancedMesh).instanceMatrix.array)));
    for (const object of a.group.children) {
      const material = (object as THREE.Mesh).material as THREE.Material;
      expect(material.alphaHash).toBe(true);
      expect(material.transparent).toBe(false);
    }
    harbor.update(18, 0, 1, .7, camera, frustum);
    const gull = harbor.group.getObjectByName('baa-ardwalk-gulls')!;
    const material = (gull.children[0] as THREE.Mesh).material as THREE.Material;
    expect(material.opacity).toBeGreaterThan(0);
    expect(material.opacity).toBeLessThan(1);
    a.dispose(); b.dispose(); harbor.dispose();
    for (const group of [a.group, b.group, harbor.group]) group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of mats) mat.dispose();
      }
    });
  });
});
