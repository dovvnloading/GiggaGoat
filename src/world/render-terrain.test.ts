import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland } from './index';
import { gridIndex } from './terrain';
import { terrainRockMask } from './terrain-paint';
import { BIOMES } from './types';
import { smoothstep } from './random';
import type { WorldScene } from './render';

const INDUSTRIAL = new THREE.Color('#9EAE90');
const SAND = new THREE.Color('#F7DB99');

function variationAt(x: number, z: number): number {
  const broad = Math.sin(x * 0.071 + Math.cos(z * 0.039) * 1.4) *
    Math.cos(z * 0.092 - Math.sin(x * 0.047));
  const fine = Math.sin(x * 0.36 + z * 0.17) *
    Math.cos(z * 0.29 - x * 0.21);
  return 0.968 + broad * 0.038 + fine * 0.022;
}

function nearestVertex(scene: WorldScene, targetX: number, targetZ: number): {
  x: number; z: number; height: number; normalY: number;
  color: THREE.Color; distance: number;
} {
  let best: ReturnType<typeof nearestVertex> | undefined;
  for (const chunk of scene.chunks) {
    const pos = chunk.geometry.getAttribute('position');
    const normal = chunk.geometry.getAttribute('normal');
    const colors = chunk.geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + chunk.position.x;
      const z = pos.getZ(i) + chunk.position.z;
      const distance = Math.hypot(x - targetX, z - targetZ);
      if (best && best.distance <= distance) continue;
      best = {
        x, z, distance, height: pos.getY(i), normalY: normal.getY(i),
        color: new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i)),
      };
    }
  }
  if (!best) throw new Error('Terrain has no vertices');
  return best;
}

function expectRgb(actual: THREE.Color, expected: THREE.Color): void {
  expect(actual.r).toBeCloseTo(expected.r, 5);
  expect(actual.g).toBeCloseTo(expected.g, 5);
  expect(actual.b).toBeCloseTo(expected.b, 5);
}

describe('IS-24 narrow beach tint and IS-15 per-fragment cliffs', () => {
  it('keeps Hoofington-height ground free of sand, and makes the 1 m beach fully sand', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    island.roads = [];
    // Isolate the sand band from meadow mottling and authored trail colours.
    island.biomeMap.fill(BIOMES.indexOf('industrial'));
    const hoofington = island.pois.find(p => p.id === 'hoofington')!.center;

    island.heights.fill(6);
    const town = createWorldScene(island, { chunkSegments: 16 });
    try {
      const vertex = nearestVertex(town, hoofington.x, hoofington.z);
      expect(vertex.distance).toBeLessThan(8);
      expect(vertex.height).toBe(6);
      expect(vertex.normalY).toBeCloseTo(1, 6);
      // The only modifier on a flat industrial biome at this height is
      // the existing fine/broad colour variation, not any beach sand.
      expectRgb(vertex.color, INDUSTRIAL.clone().multiplyScalar(
        variationAt(vertex.x, vertex.z)));
    } finally {
      town.dispose();
    }

    island.heights.fill(1);
    const beach = createWorldScene(island, { chunkSegments: 16 });
    try {
      // x=0 eliminates the requested sine edge jitter; this point is far
      // from Mt Gigga and the lighthouse cape.
      const vertex = nearestVertex(beach, 0, 225);
      expect(vertex.distance).toBeLessThan(0.001);
      expect(vertex.height).toBe(1);
      expect(vertex.normalY).toBeCloseTo(1, 6);
      expectRgb(vertex.color, SAND.clone().multiplyScalar(
        variationAt(vertex.x, vertex.z)));
    } finally {
      beach.dispose();
    }
  });

  it('leaves a 45-degree off-mountain cliff in its biome vertex colour', () => {
    const island = generateIsland({ seed: 'terrain-rock-buffer', resolution: 65 });
    island.roads = [];
    island.biomeMap.fill(BIOMES.indexOf('industrial'));
    island.heights.fill(5);
    const n = island.resolution;
    const cell = island.size / (n - 1);
    // A symmetric rise across x gives a 45-degree centre normal and no
    // contact-darkening contribution at the sampled vertex.
    island.heights[gridIndex(n, 47, 48)] = 5 - cell;
    island.heights[gridIndex(n, 49, 48)] = 5 + cell;
    const scene = createWorldScene(island, { chunkSegments: 16 });
    try {
      const vertex = nearestVertex(scene, 150, 150);
      expect(vertex.distance).toBeLessThan(0.001);
      expect(vertex.height).toBe(5);
      expect(vertex.normalY).toBeCloseTo(Math.SQRT1_2, 5);
      expectRgb(vertex.color, INDUSTRIAL.clone().multiplyScalar(
        variationAt(vertex.x, vertex.z)));
    } finally {
      scene.dispose();
    }
  });

  it('injects a filtered world-space rock atlas into the existing toon material', () => {
    const island = generateIsland({ seed: 'terrain-rock-shader', resolution: 33 });
    const scene = createWorldScene(island, { chunkSegments: 16 });
    let textureDisposed = false;
    try {
      const material = scene.chunks[0]!.material as THREE.MeshToonMaterial;
      expect(material).toBeInstanceOf(THREE.MeshToonMaterial);
      expect(material.vertexColors).toBe(true);
      const shader = {
        vertexShader: '#include <common>\n#include <begin_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>',
        uniforms: {} as Record<string, { value: unknown }>,
      };
      material.onBeforeCompile(
        shader as unknown as Parameters<typeof material.onBeforeCompile>[0],
        null as unknown as Parameters<typeof material.onBeforeCompile>[1],
      );
      expect(shader.vertexShader).toContain('varying vec3 vWorld;');
      expect(shader.vertexShader).toContain('modelMatrix * vec4(transformed, 1.0)');
      expect(shader.fragmentShader).not.toContain('vWorldNormal');
      expect(shader.fragmentShader).toContain('texture2D(uTerrainRockMask, vWorld.xz * uRockUvScale + 0.5)');
      expect(shader.fragmentShader).toContain('smoothstep(0.19, 0.48, exposure');
      expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, uStone, rock)');
      expect(shader.fragmentShader).toContain('length(vWorld.xz) / uTerrainScale');
      expect(shader.fragmentShader).toContain('vWorld.y / uTerrainScale');
      const atlas = shader.uniforms['uTerrainRockMask']!.value as THREE.DataTexture;
      expect(atlas).toBeInstanceOf(THREE.DataTexture);
      expect(atlas.image.data).toBeInstanceOf(Uint8Array);
      expect(atlas.image.width).toBe(island.resolution);
      expect(atlas.image.height).toBe(island.resolution);
      expect(atlas.magFilter).toBe(THREE.LinearFilter);
      expect(atlas.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(atlas.generateMipmaps).toBe(true);
      atlas.addEventListener('dispose', () => { textureDisposed = true; });
      expect(shader.uniforms['uRockUvScale']!.value)
        .toBe((island.resolution - 1) / (island.resolution * island.size));
      expect((shader.uniforms['uRockStone']!.value as THREE.Color).getHex())
        .toBe(0x8c919e);
      expect((shader.uniforms['uMountainStone']!.value as THREE.Color).getHex())
        .toBe(0xa39a96);
      expect(shader.uniforms['uTerrainScale']!.value).toBe(1);
    } finally {
      scene.dispose();
    }
    expect(textureDisposed).toBe(true);
  });

  it('keeps flat turf and continuous steep walls distinct while smoothing local slope peaks', () => {
    const island = generateIsland({ seed: 'terrain-atlas-contrast', resolution: 65 });
    const n = island.resolution, cell = island.size / (n - 1);
    const mid = Math.floor(n / 2);
    const rockAt = (exposure: number): number => smoothstep(.19, .48, exposure / 255);
    island.heights.fill(30);
    const flat = terrainRockMask(island);
    expect(flat.every(exposure => rockAt(exposure) === 0)).toBe(true);

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        island.heights[gridIndex(n, x, z)] = 30 + (x - mid) * cell * Math.sqrt(3);
      }
    }
    const steep = terrainRockMask(island);
    expect(steep.every(exposure => rockAt(exposure) > .9)).toBe(true);
    const meanRock = steep.reduce((sum, exposure) => sum + rockAt(exposure), 0) / steep.length;
    expect(meanRock).toBeGreaterThan(.98);

    island.heights.fill(30);
    island.heights[gridIndex(n, mid, mid)] = 30 + 7 * cell;
    const localPeak = terrainRockMask(island);
    expect(rockAt(localPeak[gridIndex(n, mid - 1, mid)]!)).toBeLessThan(.8);
    expect(localPeak).toEqual(terrainRockMask(island));
  });

  it.each(['billy-isle', 'forest-low-1', 'terrain-rock-shader-alt'])(
    'builds and disposes shader-backed terrain for seed %s without throwing', seed => {
      const island = generateIsland({ seed, resolution: 33 });
      const scene = createWorldScene(island, { chunkSegments: 16 });
      expect(scene.chunks.length).toBeGreaterThan(0);
      expect(() => scene.dispose()).not.toThrow();
    },
  );
});
