import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { generateIsland } from './island';
import { createWorldScene } from './render';
import { gridSample } from './terrain';
import { downtownPublicSpaceAt, downtownPublicSpaces } from './downtown-public-space';
import { roadRibbonData } from './road-ribbons';
import { makeDowntownPlacements } from './visual-downtown';
import type { PropDescriptor, Vec2 } from './types';

function clearance(prop: PropDescriptor, point: Vec2): number {
  const { transform, size } = prop;
  const dx = point.x - transform.position.x, dz = point.z - transform.position.z;
  const c = Math.cos(transform.rotationY), s = Math.sin(transform.rotationY);
  const x = Math.abs(c * dx - s * dz) - size.x / 2;
  const z = Math.abs(s * dx + c * dz) - size.z / 2;
  return Math.hypot(Math.max(0, x), Math.max(0, z));
}

describe('Downtown paved corners and service lanes', () => {
  it.each(['billy-isle', 'downtown-geometry', 'alternate-district'])(
    'keeps the paved areas accessible and away from driving and ramp approaches for seed %s', seed => {
      const island = generateIsland({ seed });
      const spaces = downtownPublicSpaces(island);
      const local = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
      const nearby = island.props.filter(p => Math.abs(p.transform.position.x - local.x) < 70 &&
        Math.abs(p.transform.position.z - local.z) < 70 && p.collidable);
      const road = roadRibbonData(island, 'road');
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(road.positions, 3));
      geometry.setIndex(road.supportIndices);
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      const ramps = nearby.filter(prop => prop.kind === 'ramp');
      for (const space of spaces) {
        for (let x = space.left + .25; x < space.right; x += 1)
          for (let z = space.near + .25; z < space.far; z += 1) {
            if (!downtownPublicSpaceAt([space], x, z)) continue;
            ray.ray.origin.set(x, 50, z);
            expect(ray.intersectObject(mesh), space.id + ' at ' + x + ', ' + z).toHaveLength(0);
            expect(ramps.every(ramp =>
              clearance(ramp, { x, z }) > 0), space.id).toBe(true);
          }
      }
      geometry.dispose();
      material.dispose();

      function blockers(point: Vec2): string[] {
        const feet = gridSample(island, point.x, point.z);
        return nearby.filter(p => p.transform.position.y - p.size.y / 2 < feet + 2 &&
          p.transform.position.y + p.size.y / 2 > feet && clearance(p, point) < .55).map(p => p.id);
      }

      for (const space of spaces.filter(s => s.id.endsWith('lane'))) {
        for (let z = space.near + 1; z < space.far - 1; z += .65) {
          const x = (space.left + space.right) / 2;
          expect(blockers({ x, z }), space.id).toEqual([]);
        }
      }
      for (const [startX, endX, dz] of [[-8.6, -12.8, -51.8], [7.8, 20.2, 54.7]] as const) {
        const steps = Math.ceil(Math.abs(endX - startX) / .3);
        for (let i = 0; i <= steps; i++) {
          const dx = startX + (endX - startX) * i / steps;
          const point = { x: local.x + dx, z: local.z + dz };
          expect(blockers(point), 'court entrance ' + dx + ' ' + dz).toEqual([]);
        }
      }
      for (const prop of nearby.filter(p => p.id.startsWith('downtown-market-') ||
        p.id.startsWith('downtown-square-'))) {
        const { position, rotationY } = prop.transform;
        const ground = position.y - prop.size.y / 2;
        expect(ground, prop.id).toBeCloseTo(gridSample(island, position.x, position.z), 5);
        if (prop.kind !== 'booth') continue;
        for (const side of [-1, 1]) for (const edge of [-1, 1]) {
          const x = prop.size.x * side / 2, z = prop.size.z * edge / 2;
          const cornerX = position.x + x * Math.cos(rotationY) + z * Math.sin(rotationY);
          const cornerZ = position.z - x * Math.sin(rotationY) + z * Math.cos(rotationY);
          expect(Math.abs(ground - gridSample(island, cornerX, cornerZ)), prop.id).toBeLessThan(.09);
        }
      }
      const placements = makeDowntownPlacements(island);
      for (const [area, model] of [['fountain-square', 'fountain'], ['market-court', 'produceStall'],
        ['market-court', 'flowerStall']] as const) {
        const space = spaces.find(s => s.id === area)!;
        const sites = placements.filter(p => p.model === model);
        expect(sites).toHaveLength(1);
        const { source, position } = sites[0]!;
        expect(downtownPublicSpaceAt([space], position.x, position.z)).toBe(true);
        expect(island.colliders.some(c => c.shape !== 'heightfield' && c.id === source?.id)).toBe(true);
      }
    },
  );

  it('binds the same chamfered footprints to the material that both terrain LODs use', () => {
    const island = generateIsland({ size: 850, resolution: 97 });
    const scale = island.size / 600;
    const scene = createWorldScene(island);
    const terrain = scene.chunks[0]!.material as THREE.MeshToonMaterial;
    const toon = THREE.ShaderLib.toon!;
    const shader = {
      uniforms: {}, vertexShader: toon.vertexShader, fragmentShader: toon.fragmentShader,
    } as WebGLProgramParametersWithUniforms;
    terrain.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    scene.dispose();
    // Both surface passes run after the cliff branch even when the rock mask is zero.
    const rockPaint = shader.fragmentShader.indexOf('mix(diffuseColor.rgb, uStone, rock)');
    const grain = shader.fragmentShader.indexOf('dot(grain, vGroundWeights)');
    const publicPaving = shader.fragmentShader.indexOf('diffuseColor.rgb = downtownGround(');
    expect(rockPaint).toBeGreaterThan(0);
    expect(grain).toBeGreaterThan(rockPaint);
    expect(publicPaving).toBeGreaterThan(grain);
    expect(shader.fragmentShader).toContain('downtownGround(diffuseColor.rgb, (vWorld.xz - uDowntownOrigin) / uTerrainScale)');
    expect(shader.fragmentShader).toMatch(/uTerrainScale\);\s*diffuseColor\.rgb = roadsideGravel\(/);
    expect((shader.uniforms['uDowntownServiceCourt']!.value as THREE.Vector3).toArray())
      .toEqual([-40, -35, 14.8]);
    expect(shader.fragmentShader).toContain('length(point - uDowntownServiceCourt.xy)');
    const origin = shader.uniforms['uDowntownOrigin']!.value as THREE.Vector2;
    const bounds = shader.uniforms['uDowntownBounds']!.value as THREE.Vector4[];
    const corners = shader.uniforms['uDowntownCorners']!.value as number[];
    for (const [index, space] of downtownPublicSpaces(island).entries()) {
      const rect = bounds[index]!;
      expect(origin.x + rect.x * scale).toBeCloseTo(space.left, 8);
      expect(origin.y + rect.y * scale).toBeCloseTo(space.near, 8);
      expect(origin.x + rect.z * scale).toBeCloseTo(space.right, 8);
      expect(origin.y + rect.w * scale).toBeCloseTo(space.far, 8);
      expect(corners[index]! * scale).toBeCloseTo(space.corner, 8);
    }
  });
});
