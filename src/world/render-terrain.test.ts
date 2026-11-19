import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland } from './index';
import { gridIndex } from './terrain';
import { groundGrain } from './ground-kit-grain';
import { terrainRockAtlas } from './terrain-paint';
import { TOON_RAMP } from './visual-props';
import { findBookmark } from './viewer/bookmarks';
import { BIOMES } from './types';
import { smoothstep } from './random';
import type { WorldScene } from './render';

const INDUSTRIAL = new THREE.Color('#9EAE90');
const SAND = new THREE.Color('#F7DB99');

function variationAt(x: number, z: number): number {
  return .98 + .15 * groundGrain(x / 4, z / 4, 3) + .065 * groundGrain(-z, x, 3);
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
    island.districtSets = [];
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
    island.districtSets = [];
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


  it('adds a soft ground contact at the original house footings in the same terrain draw', () => {
    const island = generateIsland();
    const view = createWorldScene(island);
    try {
      const material = view.chunks[0]!.material as THREE.MeshToonMaterial;
      const toon = THREE.ShaderLib.toon!;
      const shader = {
        vertexShader: toon.vertexShader,
        fragmentShader: toon.fragmentShader,
        uniforms: {} as Record<string, { value: unknown }>,
      };
      material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0],
        null as unknown as THREE.WebGLRenderer);
      expect(view.chunks.every(chunk => chunk.material === material)).toBe(true);
      expect(shader.fragmentShader).toContain('texture2D(uVillageGroundPaint, villagePaintUV).rg');
      expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, uStone, rock)');
      const atlas = shader.uniforms['uVillageGroundPaint']!.value as THREE.DataTexture;
      const bounds = shader.uniforms['uVillagePaintBounds']!.value as THREE.Vector3;
      expect(atlas.format).toBe(THREE.RGFormat);
      expect(atlas.generateMipmaps).toBe(true);
      const { width, height } = atlas.image;
      const data = atlas.image.data as Uint8Array;
      const field = (x: number, z: number, channel: number): number => {
        const col = Math.floor(((x - bounds.x) * bounds.z + .5) * width);
        const row = Math.floor(((z - bounds.y) * bounds.z + .5) * height);
        return data[(row * width + col) * 2 + channel]! / 255;
      };
      const houses = island.props.filter(p => p.poiId === 'hoofington' && p.kind === 'house');
      expect(houses.length).toBeGreaterThan(2);
      for (const { transform, size } of houses) {
        const { x, z } = transform.position;
        const sample = (extra: number): number => {
          const d = size.x * .46 + extra;
          return field(x + d * Math.cos(transform.rotationY), z - d * Math.sin(transform.rotationY), 0);
        };
        expect(field(x, z, 0)).toBeGreaterThan(.95);
        expect(sample(.25)).toBeGreaterThan(.62);
        expect(sample(.86)).toBeLessThan(sample(.25));
        expect(sample(2)).toBeLessThan(.1);
      }
      const colours = Array.from({ length: 20 }, (_, i) => field(bounds.x + i - 10, bounds.y + 6, 1));
      expect(Math.max(...colours) - Math.min(...colours)).toBeGreaterThan(.16);
    } finally {
      view.dispose();
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
      expect(material.gradientMap).toBeInstanceOf(THREE.DataTexture);
      expect((material.gradientMap as THREE.DataTexture).image.data).toEqual(TOON_RAMP.image.data);
      expect(material.gradientMap?.magFilter).toBe(THREE.LinearFilter);
      expect(material.gradientMap?.minFilter).toBe(THREE.LinearFilter);
      expect(TOON_RAMP.magFilter).toBe(THREE.NearestFilter);
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
      expect(shader.fragmentShader).toContain('smoothstep(0.14, 0.51, cliffPaint.r');
      expect(shader.fragmentShader).toContain('sin(bedding * 0.49)');
      expect(shader.fragmentShader).toContain('sin(bedding * 0.23 + 0.62)');
      expect(shader.fragmentShader).toContain('mix(vec3(1.0), footTint, cliffPaint.g)');
      expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, uStone, rock)');
      expect(shader.fragmentShader).toContain('length(terrainXZ)');
      expect(shader.fragmentShader).toContain('terrainXZ = vWorld.xz / uTerrainScale');
      expect(shader.fragmentShader).toContain('vWorld.y / uTerrainScale');
      const atlas = shader.uniforms['uTerrainRockMask']!.value as THREE.DataTexture;
      expect(atlas).toBeInstanceOf(THREE.DataTexture);
      expect(atlas.image.data).toBeInstanceOf(Uint8Array);
      expect(atlas.image.data).toHaveLength(island.heights.length * 2);
      expect(atlas.format).toBe(THREE.RGFormat);
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
    const rockAt = (exposure: number): number => smoothstep(.14, .51, exposure / 255);
    const exposureChannel = (): Uint8Array => terrainRockAtlas(island).filter((_, i) => i % 2 === 0);
    island.heights.fill(30);
    const flat = exposureChannel();
    expect(flat.every(exposure => rockAt(exposure) === 0)).toBe(true);

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        island.heights[gridIndex(n, x, z)] = 30 + (x - mid) * cell * Math.sqrt(3);
      }
    }
    const steep = exposureChannel();
    expect(steep.every(exposure => rockAt(exposure) > .9)).toBe(true);
    const meanRock = steep.reduce((sum, exposure) => sum + rockAt(exposure), 0) / steep.length;
    expect(meanRock).toBeGreaterThan(.98);

    island.heights.fill(30);
    island.heights[gridIndex(n, mid, mid)] = 30 + 7 * cell;
    const localPeak = exposureChannel();
    expect(rockAt(localPeak[gridIndex(n, mid - 1, mid)]!)).toBeLessThan(.8);
    expect(localPeak).toEqual(exposureChannel());
  });

  it('concentrates cliff-foot paint on the concave base of a wall', () => {
    const island = generateIsland({ seed: 'terrain-cliff-foot', resolution: 193 });
    const n = island.resolution, cell = island.size / (n - 1);
    const mid = Math.floor(n / 2);
    const toe = mid - 5, crest = mid + 5;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        island.heights[gridIndex(n, x, z)] = 30 +
          Math.min(Math.max(x - toe, 0), crest - toe) * cell * 2;
      }
    }
    const heights = island.heights.slice();
    const atlas = terrainRockAtlas(island);
    const footAt = (x: number): number => atlas[gridIndex(n, x, mid) * 2 + 1]! / 255;

    expect(footAt(toe)).toBeGreaterThan(0.7);
    expect(footAt(toe - 7)).toBe(0);
    expect(footAt(mid)).toBe(0);
    expect(footAt(crest)).toBe(0);
    expect(island.heights).toEqual(heights);
  });

  it('softens the reported mountain face and places cliff-foot paint above the trail', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const scene = createWorldScene(island, { chunkSegments: 32 });
    try {
      scene.group.updateMatrixWorld(true);
      const view = findBookmark('12')!;
      const width = 1542, height = 883;
      const camera = new THREE.PerspectiveCamera(view.fov, width / height, .2, 1000);
      camera.position.set(view.camera.x, view.camera.y, view.camera.z);
      camera.lookAt(view.target.x, view.target.y, view.target.z);
      camera.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const hitAt = (x: number, y: number): THREE.Intersection => {
        ray.setFromCamera(new THREE.Vector2(x * 2 / width - 1, 1 - y * 2 / height), camera);
        return ray.intersectObjects(scene.chunks, false)[0]!;
      };
      const atlas = terrainRockAtlas(island);
      const paintAt = (hit: THREE.Intersection, channel: number): number => {
        const { x, z } = hit.point;
        const n = island.resolution;
        const gx = (x / island.size + .5) * (n - 1);
        const gz = (z / island.size + .5) * (n - 1);
        const ix = Math.floor(gx), iz = Math.floor(gz);
        const texel = (dx: number, dz: number): number =>
          atlas[gridIndex(n, ix + dx, iz + dz) * 2 + channel]! / 255;
        const north = THREE.MathUtils.lerp(texel(0, 0), texel(1, 0), gx - ix);
        const south = THREE.MathUtils.lerp(texel(0, 1), texel(1, 1), gx - ix);
        return THREE.MathUtils.lerp(north, south, gz - iz);
      };
      const sunlight = scene.sun.position.clone().normalize();
      const ramp = (scene.chunks[0]!.material as THREE.MeshToonMaterial).gradientMap as THREE.DataTexture;
      const rampLevel = (angle: number, texture: THREE.DataTexture): number => {
        const coordinate = (angle * .5 + .5) * texture.image.width;
        const data = texture.image.data as Uint8Array;
        if (texture.magFilter === THREE.NearestFilter) return data[Math.floor(coordinate) * 4]!;
        const left = Math.floor(coordinate - .5);
        return THREE.MathUtils.lerp(data[left * 4]!, data[(left + 1) * 4]!,
          coordinate - .5 - left);
      };

      // Adjacent pixels from the report straddle the old hard noon lighting band
      // in otherwise solid rock. Measure the real terrain normals and ramp.
      const left = hitAt(731, 381), right = hitAt(732, 381);
      const leftDot = left.normal!.clone().normalize().dot(sunlight);
      const rightDot = right.normal!.clone().normalize().dot(sunlight);
      expect(leftDot).toBeLessThan(0);
      expect(rightDot).toBeGreaterThan(0);
      expect(Math.abs(rampLevel(rightDot, TOON_RAMP) - rampLevel(leftDot, TOON_RAMP)))
        .toBeGreaterThan(50);
      expect(Math.abs(rampLevel(rightDot, ramp) - rampLevel(leftDot, ramp))).toBeLessThan(3);
      expect(paintAt(left, 0)).toBeGreaterThan(.44);
      expect(paintAt(right, 0)).toBeGreaterThan(.44);

      const wallFoot = hitAt(750, 488), pathTread = hitAt(750, 800);
      expect(wallFoot.point.y).toBeCloseTo(66.72, 1);
      expect(pathTread.point.y).toBeCloseTo(28.98, 1);
      expect(paintAt(wallFoot, 1)).toBeGreaterThan(.7);
      expect(paintAt(pathTread, 1)).toBeLessThan(.03);
      expect(paintAt(pathTread, 0)).toBeLessThan(.14);
    } finally {
      scene.dispose();
    }
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
