import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import {
  buildWaterVisuals, CASCADE_NATIVE_SIZE, cascadePoolCentre, cascadeWaterLine,
  makeForestOutflowClearance, PINES_GLADE_CASCADE, waterfallSites,
} from './visual-water';
import { buildSkyVisuals, skyColorGLSL } from './visual-sky';
import { getDamHeadwater, isDamHeadwater } from './dam-landscape';
import { gridSample, segmentProjection } from './terrain';
import { findBookmark } from './viewer/bookmarks';

describe('island sea, shoreline and horizon', () => {
  it.each([400, 600, 900])('uses a round eight-island-width sea with 96x96 core grid at size %i', size => {
    const island = generateIsland({ seed: 'sea-horizon-qa', resolution: 65, size });
    const { sea, inland, update } = buildWaterVisuals(island);
    try {
      expect(sea.name).toBe('rising-sea');
      expect(sea.renderOrder).toBe(2);
      expect(sea.rotation.x).toBeCloseTo(-Math.PI / 2);
      expect(sea.position.y).toBe(island.seaLevel);
      const positions = sea.geometry.getAttribute('position');
      const halfCore = size * 2.15 / 2;
      const points: Array<{ x: number; y: number; radius: number }> = [];
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i);
        points.push({ x, y, radius: Math.hypot(x, y) });
        expect(positions.getZ(i)).toBe(0);
      }
      const radius = Math.max(...points.map(p => p.radius));
      expect(radius).toBeGreaterThanOrEqual(size * 4 - 0.005);
      // The outer circumference is a circle in all directions, not a square.
      const rim = points.filter(p => p.radius >= radius * 0.999);
      expect(rim.length).toBeGreaterThanOrEqual(384);
      const rimRadii = rim.map(p => p.radius);
      expect((Math.max(...rimRadii) - Math.min(...rimRadii)) / radius)
        .toBeLessThan(0.02);
      const cardinal = rim.reduce((best, p) =>
        Math.abs(p.y) < Math.abs(best.y) ? p : best);
      const diagonal = rim.reduce((best, p) =>
        Math.abs(Math.abs(p.x) - Math.abs(p.y)) <
          Math.abs(Math.abs(best.x) - Math.abs(best.y)) ? p : best);
      expect(Math.abs(cardinal.radius - diagonal.radius) / radius).toBeLessThan(0.02);

      // The unchanged 97x97 core vertices cover the original 2.15-size
      // square: 96 subdivisions/edge and the same near-shore spacing.
      const core = points.filter(p =>
        Math.abs(p.x) <= halfCore + 0.001 &&
        Math.abs(p.y) <= halfCore + 0.001);
      expect(core).toHaveLength(97 * 97);
      const midline = core.filter(p => Math.abs(p.y) < 0.001)
        .map(p => p.x).sort((a, b) => a - b);
      expect(midline).toHaveLength(97);
      for (let i = 1; i < midline.length; i++) {
        expect(midline[i]! - midline[i - 1]!)
          .toBeCloseTo(size * 2.15 / 96, 3);
      }

      const sky = buildSkyVisuals();
      // In Node the sky must not draw clouds without a loaded authored GLB.
      // The 3 GLB renderOrder values are checked once loaded by visual-sky.test.
      expect(sky.group.children.filter(o => o.name.startsWith('puffy-cloud-banks-')))
        .toHaveLength(0);
      update(4.5, island.seaLevel + 25);
      expect(sea.position.y).toBe(island.seaLevel + 25);
      expect((sea.material as THREE.ShaderMaterial).uniforms['uLevel']!.value)
        .toBe(island.seaLevel + 25);
    } finally {
      sea.geometry.dispose();
      (sea.material as THREE.Material).dispose();
      inland.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    }
  });

  it('uses teal shallow/deep colours and applies scene fog to the transparent sea shader', () => {
    const island = generateIsland({ seed: 'sea-teal-qa', resolution: 65 });
    const { sea } = buildWaterVisuals(island);
    const material = sea.material as THREE.ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(true);
    // Real Chrome used to throw in refreshFogUniforms when these were absent.
    for (const key of ['fogColor', 'fogNear', 'fogFar', 'fogDensity']) {
      expect(material.uniforms[key], key + ' missing for ShaderMaterial fog')
        .toHaveProperty('value');
    }
    expect(material.uniforms['uShallow']!.value.getHex()).toBe(0x48c9c9);
    expect(material.uniforms['uDeep']!.value.getHex()).toBe(0x2a8fc0);
    for (const chunk of ['fog_pars_vertex', 'fog_vertex']) {
      expect(material.vertexShader).toContain('#include <' + chunk + '>');
    }
    expect(material.fragmentShader).toContain('#include <fog_pars_fragment>');
    expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(material.fragmentShader).toContain('fogDensity * vFogDepth');
    expect(material.fragmentShader).toContain('smoothstep(fogNear, fogFar, vFogDepth)');
    expect(material.fragmentShader).toContain('smoothstep(2.0, 3.25, length(mapXZ))');
    expect(material.fragmentShader).toContain('smoothstep(1000.0, 1700.0, vFogDepth)');
    expect(material.fragmentShader).toContain('transmission * (1.0 - haze * (1.0 - atlasInterior))');
    expect(material.fragmentShader).toContain('vec3(0.88, 0.96, 0.92)');
    const shader = material.fragmentShader;
    // Distinct directions and wavelengths prevent one shared comb across the sea.
    const phases = [...shader.matchAll(/filteredRipple\(dot\(seaXZ, vec2\((-?[\d.]+), (-?[\d.]+)\)\)/g)]
      .map(match => new THREE.Vector2(Number(match[1]), Number(match[2])));
    expect(phases).toHaveLength(2);
    const [swell, cross] = phases;
    const alignment = swell!.dot(cross!) / (swell!.length() * cross!.length());
    expect(Math.abs(alignment)).toBeLessThan(.6);
    expect(cross!.length() / swell!.length()).toBeGreaterThan(1.2);
    expect(shader).toContain('fwidth(phase)');
    expect(shader).toContain('fwidth(depth)');
    expect(shader.match(/texture2D\(/g)).toHaveLength(1);
    sea.geometry.dispose();
    material.dispose();
  });

  it('shares the exact painted sky and sunlight with distant water at every phase', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const world = createWorldScene(island);
    try {
      const dome = world.group.getObjectByName('gradient-sky') as THREE.Mesh<
        THREE.BufferGeometry, THREE.ShaderMaterial>;
      const sea = world.group.getObjectByName('rising-sea') as THREE.Mesh<
        THREE.BufferGeometry, THREE.ShaderMaterial>;
      const sky = dome.material;
      const water = sea.material;
      for (const name of ['uDay', 'uGolden', 'uSun', 'uSunGlowStrength',
        'uHorizon', 'uSunsetHorizon', 'uSunsetMid', 'uSunsetZenith']) {
        expect(water.uniforms[name]).toBe(sky.uniforms[name]);
      }
      for (const material of [sky, water]) {
        expect(material.fragmentShader).toContain(skyColorGLSL);
        expect(material.fragmentShader).toContain('sRGBTransferEOTF');
        expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
      }
      expect(sky.fragmentShader).toContain('skyColor(vSkyWorld)');
      expect(water.fragmentShader).toContain('mix(litColor, skyColor(vWorld), haze)');
      for (const [preset, daylight, golden] of [
        ['night', 0.025, 0], ['golden-hour', 0.693, 1], ['day', 1, 0],
      ] as const) {
        world.setLightingPreset(preset);
        expect(water.uniforms['uDay']!.value).toBeCloseTo(daylight, 2);
        expect(water.uniforms['uGolden']!.value).toBe(golden);
      }
    } finally {
      world.dispose();
    }
  });

  it('preserves shallow shoreline contrast and extinguishes submerged blocks from the 49 m bookmark', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const water = buildWaterVisuals(island);
    try {
      const material = water.sea.material as THREE.ShaderMaterial;
      const shader = material.fragmentShader;
      const path = shader.match(/pathLength = max\(0\.0, submergedDepth - ([\d.]+)\) \/ max\(([\d.]+), viewAngle\)/);
      const decay = shader.match(/transmission = ([\d.]+) \* exp\(-([\d.]+) \* pathLength\)/);
      expect(path).not.toBeNull();
      expect(decay).not.toBeNull();
      expect(shader).toContain('abs(eye.y) / max(length(eye), 0.0001)');
      expect(shader).toContain('mix(36.0, 11.0 * scale, flood)');
      expect(shader).toContain('ripples * flood * atlasInterior');
      const transmission = (depth: number, cosine: number): number => {
        const distance = Math.max(0, depth - Number(path![1])) / Math.max(Number(path![2]), cosine);
        return Number(decay![1]) * Math.exp(-Number(decay![2]) * distance);
      };
      expect(transmission(0.5, 1)).toBeCloseTo(0.12);
      expect(transmission(0.5, 0.3)).toBeCloseTo(0.12);
      expect(transmission(4, 1)).toBeGreaterThan(0.07);
      expect(transmission(4, 0.3)).toBeLessThan(0.03);
      expect(transmission(24, 1)).toBeLessThan(0.005);

      const bookmark = findBookmark('16')!;
      const eye = new THREE.Vector3().copy(bookmark.camera);
      const tide = bookmark.tide;
      expect(tide).toBe(49);
      water.update(4.5, tide);
      expect(material.uniforms['uLevel']!.value).toBe(tide);
      expect(material.uniforms['uSeaDatum']!.value).toBe(island.seaLevel);
      const downtown = island.props.filter(prop => prop.poiId === 'downtown-bleatsville'
        && ['tower', 'shop'].includes(prop.kind));
      expect(downtown.length).toBeGreaterThan(10);

      for (const prop of downtown) {
        const roof = new THREE.Vector3().copy(prop.transform.position);
        roof.y += prop.size.y / 2;
        expect(roof.y, prop.id).toBeLessThan(tide);
        const surface = eye.clone().lerp(roof, (eye.y - tide) / (eye.y - roof.y));
        // The height atlas uses normalized texel coordinates, which shifts
        // this sample by up to half a texel relative to the mesh height grid.
        const atlasScale = island.resolution / (island.resolution - 1);
        const depth = tide - gridSample(island, surface.x * atlasScale, surface.z * atlasScale);
        const cosine = (eye.y - tide) / eye.distanceTo(surface);
        expect(transmission(depth, cosine), prop.id).toBeLessThan(0.001);
      }
    } finally {
      disposeWaterMeshes(water);
    }
  });
  it.each([400, 600, 900])('joins a coloured 128-angle seabed to the terrain edge at size %i', size => {
    const island = generateIsland({ seed: 'cape-skirt', size, resolution: 97 });
    const { sea, update } = buildWaterVisuals(island);
    const skirt = sea.getObjectByName('seabed-skirt') as THREE.Mesh;
    expect(skirt).toBeInstanceOf(THREE.Mesh);
    try {
      expect(skirt.parent).toBe(sea);
      expect(skirt.name).toBe('seabed-skirt');
      expect(skirt.renderOrder).toBe(1);
      expect(skirt.renderOrder).toBeLessThan(sea.renderOrder);
      expect(skirt.castShadow).toBe(false);
      expect(skirt.receiveShadow).toBe(false);
      const material = skirt.material as THREE.MeshLambertMaterial;
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(material.vertexColors).toBe(true);
      expect(material.fog).toBe(true);

      const points = skirt.geometry.getAttribute('position') as THREE.BufferAttribute;
      const colors = skirt.geometry.getAttribute('color') as THREE.BufferAttribute;
      expect(points.count).toBe(128 * 3);
      expect(colors.count).toBe(points.count);
      expect(skirt.geometry.index!.count).toBe(128 * 2 * 6);
      const colours = [0xd9c79a, 0x5fa9a8, 0x1d5f73];
      for (let ring = 0; ring < 3; ring++) {
        const tint = new THREE.Color(colours[ring]!);
        expect(colors.getX(ring)).toBeCloseTo(tint.r, 6);
        expect(colors.getY(ring)).toBeCloseTo(tint.g, 6);
        expect(colors.getZ(ring)).toBeCloseTo(tint.b, 6);
      }

      const s = island.size / 600, half = size / 2;
      for (let i = 0; i < 128; i++) {
        const index = i * 3;
        const x = points.getX(index), z = points.getZ(index);
        const innerRadius = Math.hypot(x, z);
        const middle = Math.hypot(points.getX(index + 1), points.getZ(index + 1));
        const outer = Math.hypot(points.getX(index + 2), points.getZ(index + 2));
        expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(half, 4);
        expect(middle).toBeCloseTo(innerRadius * 1.35, 4);
        expect(outer).toBeGreaterThanOrEqual(size * 3.9);
        expect(points.getY(index + 1)).toBeCloseTo(island.seaLevel - 10 * s, 5);
        expect(points.getY(index + 2)).toBeCloseTo(island.seaLevel - 40 * s, 5);
        if (i % 16 === 0) {
          expect(Math.abs(points.getY(index) -
            (gridSample(island, x, z) - 0.05 * s)))
            .toBeLessThan(0.1 * s);
        }
      }

      sea.updateMatrixWorld(true);
      const vertex = new THREE.Vector3(
        points.getX(0), points.getY(0), points.getZ(0));
      const before = vertex.clone().applyMatrix4(skirt.matrixWorld);
      expect(before.distanceTo(vertex)).toBeLessThan(0.0001);
      update(1.5, island.seaLevel + 40);
      sea.updateMatrixWorld(true);
      const after = vertex.clone().applyMatrix4(skirt.matrixWorld);
      expect(after.distanceTo(before)).toBeLessThan(0.0001);
      expect(sea.position.y).toBe(island.seaLevel + 40);
      // Unlike inland river surfaces, the seabed stays present at high tide.
      expect(skirt.visible).toBe(true);
    } finally {
      skirt.geometry.dispose();
      (skirt.material as THREE.Material).dispose();
      sea.geometry.dispose();
      (sea.material as THREE.Material).dispose();
    }
  });

});

describe('DM-01 terrain-bound Dam reservoir', () => {
  it.each([[400, 97], [600, 97], [600, 193], [900, 97]])(
    'follows the banks and keeps the wall footing and rear road dry at %i m / %i samples', (size, resolution) => {
    const island = generateIsland({ seed: 'billy-isle', resolution, size });
    const previousLanding = structuredClone(island.reservoir);
    const { position, scale, level, front } = getDamHeadwater(island);
    const { sea, inland, update } = buildWaterVisuals(island);
    try {
      const water = inland.getObjectByName('dam-reservoir') as THREE.Mesh;
      const geometry = water.geometry;
      const points = geometry.getAttribute('position');
      const depth = geometry.getAttribute('depth');
      expect(points.count).toBeGreaterThan(100);
      expect(points.count).toBe(depth.count);
      expect(inland.getObjectByName('dam-reservoir-foam')).toBeUndefined();
      for (let i = 0; i < points.count; i++) {
        expect(points.getY(i)).toBeCloseTo(level, 4);
        expect(points.getZ(i)).toBeLessThanOrEqual(front + .0001);
      }

      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      const hitsSurface = (x: number, z: number) => {
        ray.ray.origin.set(x, level + 20, z);
        return ray.intersectObject(water).length > 0;
      };
      for (const [x, z] of [[-10, -42], [-18, -36]] as const) {
        expect(hitsSurface(position.x + x * scale, position.z + z * scale)).toBe(true);
      }
      for (const [x, z] of [[-40, -55], [28, -48], [-10, -71], [-10, 0],
        [-15, -6], [-10, -5], [-5, -4], [-2, -4]] as const) {
        expect(hitsSurface(position.x + x * scale, position.z + z * scale)).toBe(false);
      }

      // Compare the actual triangle surface to the physics footprint over the full basin.
      for (let z = -70.3; z < -3.5; z += 1.75) for (let x = -39.3; x < 31; x += 1.75) {
        const px = position.x + x * scale, pz = position.z + z * scale;
        expect(hitsSurface(px, pz), x + ',' + z).toBe(isDamHeadwater(island, px, pz));
      }

      const tunnel = island.roads.filter(road => road.from === 'the-dam' || road.to === 'the-dam');
      const joints = tunnel.map(road => road.from === 'the-dam' ? road.points[0]! : road.points.at(-1)!);
      expect(joints.every(point => point.y === joints[0]!.y)).toBe(true);
      for (const road of tunnel) {
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1]!, b = road.points[i]!;
          if (Math.hypot(a.x - position.x, a.z - position.z) > 70 * scale) continue;
          const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
          const run = Math.hypot(b.x - a.x, b.z - a.z);
          const leftX = -(b.z - a.z) / run, leftZ = (b.x - a.x) / run;
          expect(Math.abs(a.y - b.y) / run, road.id).toBeLessThan(road.type === 'road' ? .22 : .28);
          for (const sign of [-1, 0, 1]) {
            const offset = sign * road.width * .48;
            expect(hitsSurface(x + leftX * offset, z + leftZ * offset),
              road.id + ' at ' + x.toFixed(1) + ',' + z.toFixed(1) + '/' + sign).toBe(false);
          }
        }
      }

      const animated = water.material as THREE.ShaderMaterial;
      const river = inland.getObjectByName('rippling-river') as THREE.Mesh;
      const riverMat = river.material as THREE.ShaderMaterial;
      expect(animated.fragmentShader).toContain('smoothstep(0.0, 2.9, depth)');
      expect(animated.fragmentShader).toContain('fwidth(phase)');
      expect(animated.uniforms['uTime']).toBe(riverMat.uniforms['uTime']);
      expect(animated.uniforms['uLight']).toBe(riverMat.uniforms['uLight']);
      update(4.25, level);
      expect(animated.uniforms['uTime']!.value).toBe(4.25);
      expect(water.visible).toBe(false);
      expect(inland.visible).toBe(true);
      update(4.5, island.seaLevel);
      expect(water.visible).toBe(true);
      expect(island.reservoir).toEqual(previousLanding);
    } finally {
      sea.geometry.dispose();
      (sea.material as THREE.Material).dispose();
      inland.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      });
    }
  });
});

describe('modelled Mt. Gigga cascades (MG-12, DM-1)', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'waterfall-cliff-alt', size: 900, resolution: 97 },
  ])('bounds every model, clears six water samples and follows placed pools ($seed)',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const sites = waterfallSites(island);
      const before = island.river.map(point => ({ ...point }));
      expect(waterfallSites(island)).toEqual(sites);
      expect(island.river).toEqual(before);
      expect(sites.length).toBeGreaterThan(0);
      const placed = island.props.filter(prop => prop.id.startsWith('waterfall-cascade-'));
      const cascades = island.props.filter(prop => placed.includes(prop) ||
        prop.id === 'whispering-pines-glade-cascade');
      expect(placed.length).toBeLessThanOrEqual(sites.length);
      const scale = size / 600;
      const trails = island.roads.filter(road => road.type === 'trail')
        .flatMap(road => road.points);
      const visuals = buildWaterVisuals(island);
      try {
        const legacyFoam = cascades.filter(prop => prop.id === PINES_GLADE_CASCADE ||
          !visuals.replacedCascadeIds.has(prop.id));
        const foam = visuals.inland.getObjectByName('waterfall-foam-batch') as
          THREE.InstancedMesh | undefined;
        expect(foam?.count ?? 0).toBe(legacyFoam.length * 5);
        expect(visuals.inland.children.filter(object =>
          object.name.endsWith('-foam') && object.userData['instanceCount'] === 5))
          .toHaveLength(legacyFoam.length);
        for (const site of sites) {
          const prop = placed.find(p => p.id === 'waterfall-cascade-' + site.id);
          if (!prop) {
            expect(visuals.inland.getObjectByName(site.id)).toBeUndefined();
            expect(visuals.inland.getObjectByName(site.id + '-foam')).toBeUndefined();
            continue;
          }
          const dx = site.bottom.x - site.top.x, dz = site.bottom.z - site.top.z;
          const run = Math.hypot(dx, dz);
          const drop = site.top.y - gridSample(island, site.bottom.x, site.bottom.z);
          const kind = drop / run > 1.2 ? 'cascade-tall' : 'cascade';
          expect(prop.kind).toBe(kind);
          const native = CASCADE_NATIVE_SIZE[kind];
          const wanted = {
            x: site.width * 1.6,
            y: drop + 0.4 * scale,
            z: run + (kind === 'cascade' ? 2 : 4) * scale,
          };
          for (const axis of ['x', 'y', 'z'] as const) {
            const min = axis === 'y' && kind === 'cascade' ? 0.5 : 0.77;
            const expected = Math.max(min * native[axis] * scale,
              Math.min(1.3 * native[axis] * scale, wanted[axis]));
            expect(prop.size[axis], prop.id + ' ' + axis).toBeCloseTo(expected, 5);
          }
          const yaw = prop.transform.rotationY;
          const forwardX = dx / run, forwardZ = dz / run;
          expect(Math.sin(yaw) * forwardX + Math.cos(yaw) * forwardZ)
            .toBeGreaterThan(Math.cos(5 * Math.PI / 180));
          const shiftX = prop.transform.position.x - (site.top.x + site.bottom.x) / 2;
          const shiftZ = prop.transform.position.z - (site.top.z + site.bottom.z) / 2;
          const outward = shiftX * forwardX + shiftZ * forwardZ;
          expect(outward).toBeGreaterThanOrEqual(-1e-6);
          expect(outward).toBeLessThanOrEqual(4 * scale + 1e-6);
          expect(Math.abs(shiftX * forwardZ - shiftZ * forwardX)).toBeLessThan(1e-5);
        }
        for (const prop of cascades) {
          const native = CASCADE_NATIVE_SIZE[prop.kind as keyof typeof CASCADE_NATIVE_SIZE];
          expect(native, prop.id).toBeDefined();
          for (const axis of ['x', 'y', 'z'] as const) {
            const min = axis === 'y' && prop.kind === 'cascade' ? 0.5 : 0.77;
            expect(prop.size[axis] / (native[axis] * scale), prop.id + ' ' + axis)
              .toBeGreaterThanOrEqual(min - 1e-6);
            expect(prop.size[axis] / (native[axis] * scale), prop.id + ' ' + axis)
              .toBeLessThanOrEqual(1.3 + 1e-6);
          }
          expect(cascadeWaterLine(prop, scale)).toHaveLength(6);
          for (const point of cascadeWaterLine(prop, scale)) {
            expect(gridSample(island, point.x, point.z) - point.y,
              prop.id + ' buried water').toBeLessThanOrEqual(0.2 * scale + 1e-5);
          }
          const pool = cascadePoolCentre(prop, scale);
          expect(pool.y - (prop.transform.position.y - prop.size.y / 2))
            .toBeCloseTo(0.3 * scale, 6);
          expect(gridSample(island, pool.x, pool.z) - (prop.transform.position.y -
            prop.size.y / 2)).toBeCloseTo(0.2 * scale, 5);
          for (const point of trails) {
            expect(Math.hypot(pool.x - point.x, pool.z - point.z),
              prop.id + ' trail pool').toBeGreaterThanOrEqual(prop.size.x / 2 + scale - 1e-5);
          }
          expect(prop.body).toEqual({ type: 'static' });
          expect(prop.collidable).toBe(false);
          expect(prop.breakable).toBe(false);
          expect(prop.lickable).toBe(false);
          expect(prop.climbable).toBe(false);
          expect(island.colliders.some(c => c.shape !== 'heightfield' && c.id === prop.id))
            .toBe(false);

          const id = prop.id.startsWith('waterfall-cascade-')
            ? prop.id.slice('waterfall-cascade-'.length) : prop.id;
          if (!legacyFoam.includes(prop)) {
            expect(visuals.inland.getObjectByName(id + '-foam')).toBeUndefined();
            continue;
          }
          expect(visuals.inland.getObjectByName(id)).toBeInstanceOf(THREE.Group);
          const flecks = visuals.inland.getObjectByName(id + '-foam') as THREE.Group;
          expect(flecks).toBeInstanceOf(THREE.Group);
          expect(flecks.userData['instanceCount']).toBe(5);
          const index = (flecks.userData['instanceOffset'] as number) + 2;
          const matrix = new THREE.Matrix4();
          foam!.getMatrixAt(index, matrix);
          const actual = new THREE.Vector3().setFromMatrixPosition(matrix);
          expect(actual.distanceTo(new THREE.Vector3(pool.x, pool.y, pool.z)),
            prop.id + ' foam at pool').toBeLessThan(0.5);
        }
      } finally {
        disposeWaterMeshes(visuals);
      }
    });

  it('keeps the real 3 m cliff condition and the Dam exclusion', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const dam = island.plots.find(plot => plot.poiId === 'the-dam')!;
    const n = island.resolution;
    for (let iz = 0; iz < n; iz++) {
      const z = (iz / (n - 1) - 0.5) * island.size;
      for (let ix = 0; ix < n; ix++) island.heights[iz * n + ix] = 2 * z;
    }
    expect(waterfallSites(island).some(site => site.id === 'mountain-waterfall-0'))
      .toBe(true);
    dam.center.x = island.river[0]!.x;
    dam.center.z = island.river[0]!.z;
    expect(waterfallSites(island).some(site => site.id === 'mountain-waterfall-0'))
      .toBe(false);
    // Site discovery uses current terrain; foam instead follows the cascade
    // descriptor that was already placed on the original terrain.
    const prop = island.props.find(p => p.id === 'waterfall-cascade-mountain-waterfall-0');
    const visuals = buildWaterVisuals(island);
    try {
      expect(visuals.inland.getObjectByName('mountain-waterfall-0') instanceof THREE.Group)
        .toBe(Boolean(prop));
      expect(visuals.inland.getObjectByName('mountain-waterfall-0-foam') instanceof THREE.Group)
        .toBe(Boolean(prop));
    } finally {
      disposeWaterMeshes(visuals);
    }
    // Removing/skipping the descriptor must remove its foam even if the
    // original site search would still find a waterfall here.
    island.props = island.props.filter(p => p.id !== 'waterfall-cascade-mountain-waterfall-0');
    const skipped = buildWaterVisuals(island);
    try {
      expect(skipped.inland.getObjectByName('mountain-waterfall-0')).toBeUndefined();
      expect(skipped.inland.getObjectByName('mountain-waterfall-0-foam')).toBeUndefined();
    } finally {
      disposeWaterMeshes(skipped);
    }
  });
});

type RibbonQuad = { start: THREE.Vector3; end: THREE.Vector3 };

function renderedRibbonQuads(inland: THREE.Group): RibbonQuad[] {
  // Read the actual triangle indices; skipped quads may leave unreferenced
  // vertices, so vertex counts alone cannot prove what gets rendered.
  const river = inland.getObjectByName('rippling-river') as THREE.Mesh;
  expect(river).toBeInstanceOf(THREE.Mesh);
  const positions = river.geometry.getAttribute('position');
  const style = river.geometry.getAttribute('streamStyle');
  const index = river.geometry.getIndex()!;
  expect(index.count % 6).toBe(0);
  const centre = (left: number, right: number): THREE.Vector3 =>
    new THREE.Vector3(
      (positions.getX(left) + positions.getX(right)) / 2,
      (positions.getY(left) + positions.getY(right)) / 2,
      (positions.getZ(left) + positions.getZ(right)) / 2,
    );
  const quads: RibbonQuad[] = [];
  for (let i = 0; i < index.count; i += 6) {
    const a = index.getX(i), b = index.getX(i + 1);
    if (style.getX(a) >= 2) continue;
    const c = index.getX(i + 2), d = index.getX(i + 4);
    expect(index.getX(i + 3)).toBe(b);
    expect(index.getX(i + 5)).toBe(c);
    quads.push({ start: centre(a, b), end: centre(c, d) });
  }
  return quads;
}

function ribbonGradient(quad: RibbonQuad): number {
  return (quad.start.y - quad.end.y) /
    Math.hypot(quad.end.x - quad.start.x, quad.end.z - quad.start.z);
}

function ribbonMidpoint(quad: RibbonQuad): THREE.Vector3 {
  return quad.start.clone().add(quad.end).multiplyScalar(0.5);
}

function disposeWaterMeshes(visuals: ReturnType<typeof buildWaterVisuals>): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const root of [visuals.sea, visuals.inland, visuals.mountain]) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const own = Array.isArray(object.material) ? object.material : [object.material];
      own.forEach(material => materials.add(material));
    });
  }
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function damBookmarkCamera(): THREE.PerspectiveCamera {
  const bookmark = findBookmark('14')!;
  const camera = new THREE.PerspectiveCamera(bookmark.fov, 16 / 9, 0.1, 2000);
  camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
  camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
  camera.updateMatrixWorld();
  return camera;
}

function onScreen(point: THREE.Vector3, camera: THREE.PerspectiveCamera): boolean {
  const clip = point.clone().project(camera);
  return Math.abs(clip.x) <= 1 && Math.abs(clip.y) <= 1 &&
    clip.z >= -1 && clip.z <= 1;
}

describe('terrain-draped river ribbons (IS-11 / DM-1 / WP-8)', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'dam-ribbon-alt', size: 900, resolution: 97 },
  ])('keeps the mountain banks draped and the forest banks inside the dry-tree clearance on $seed',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const riverBefore = island.river.map(p => ({ ...p }));
      const visuals = buildWaterVisuals(island);
      try {
        const river = visuals.inland.getObjectByName('rippling-river') as THREE.Mesh;
        expect(river).toBeInstanceOf(THREE.Mesh);
        expect(visuals.inland.getObjectByName('forest-river-after-dam'))
          .toBeUndefined(); // Both reaches still share one mesh and material.
        const position = river.geometry.getAttribute('position');
        const uv = river.geometry.getAttribute('uv');
        const style = river.geometry.getAttribute('streamStyle');
        const scale = size / 600;
        const reaches = [island.river.slice(0, 5), island.river.slice(11)];
        const expectedStations = reaches.map(points => 1 + points.slice(1).reduce(
          (sum, point, i) => sum + Math.max(1, Math.ceil(
            Math.hypot(point.x - points[i]!.x, point.z - points[i]!.z) /
              (2 * scale))), 0));
        const ribbonCount = 2 * expectedStations.reduce((a, b) => a + b, 0);
        const hasGlade = visuals.replacedCascadeIds.has(PINES_GLADE_CASCADE);
        expect(position.count).toBe(ribbonCount + (hasGlade ? 75 : 0));
        expect(uv.count).toBe(position.count);
        expect(style.count).toBe(position.count);
        const outsideForest = makeForestOutflowClearance(island);
        for (let v = 0; v < ribbonCount; v++) {
          const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
          const terrain = gridSample(island, x, z);
          expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
          const forest = v >= 2 * expectedStations[0]!;
          expect(style.getX(v)).toBe(forest ? 1 : 0);
          if (forest) {
            expect(y - terrain, 'no floating forest bank ' + v).toBeLessThan(0.20 * scale);
            expect(outsideForest(x, z, 0.05 * scale), 'unchanged bank clearance ' + v).toBe(false);
            expect(style.getY(v)).toBeGreaterThanOrEqual(0);
            expect(style.getY(v)).toBeLessThanOrEqual(1);
          } else {
            expect(y, 'unchanged mountain bank ' + v).toBeCloseTo(terrain + 0.15 * scale, 4);
          }
          expect(uv.getX(v)).toBe(v % 2);
          expect(Number.isFinite(uv.getY(v))).toBe(true);
        }
        let offset = 0;
        for (const count of expectedStations) {
          expect(uv.getY(offset * 2)).toBeCloseTo(0, 6);
          for (let row = offset + 1; row < offset + count; row++) {
            const centre = (k: number): { x: number; z: number } => ({
              x: (position.getX(2 * k) + position.getX(2 * k + 1)) / 2,
              z: (position.getZ(2 * k) + position.getZ(2 * k + 1)) / 2,
            });
            const a = centre(row - 1), b = centre(row);
            const run = Math.hypot(b.x - a.x, b.z - a.z);
            expect(run).toBeGreaterThan(0);
            const uvStep = uv.getY(2 * row) - uv.getY(2 * (row - 1));
            expect(uvStep).toBeGreaterThan(0);
            expect(uvStep).toBeLessThanOrEqual(0.2 * scale + 0.0001);
            if (!offset) expect(uvStep).toBeCloseTo(run / 10, 4);
          }
          offset += count;
        }
        expect(island.river).toEqual(riverBefore);
      } finally {
        disposeWaterMeshes(visuals);
      }
    });

  it.each(['billy-isle', 'dam-ribbon-alt'])(
    'omits steep indexed river quads near the Dam but retains both reaches on %s',
    seed => {
      const island = generateIsland({ seed, resolution: 97 });
      const dam = island.plots.find(plot => plot.poiId === 'the-dam')!;
      const camera = damBookmarkCamera();
      const visuals = buildWaterVisuals(island);
      try {
        const quads = renderedRibbonQuads(visuals.inland);
        expect(quads.length).toBeGreaterThan(8);
        const near = quads.filter(quad => {
          const mid = ribbonMidpoint(quad);
          return Math.hypot(mid.x - dam.center.x, mid.z - dam.center.z) <= 70;
        });

        expect(near.length).toBeGreaterThan(0);
        for (const quad of near) {
          expect(ribbonGradient(quad), 'Dam-adjacent indexed ribbon quad')
            .toBeLessThanOrEqual(0.25 + 0.0001);
        }
        const visible = near.filter(quad => onScreen(ribbonMidpoint(quad), camera));
        expect(visible.length).toBeGreaterThan(0);
        for (const quad of visible) {
          expect(ribbonGradient(quad), 'bookmark 14 visible Dam ribbon quad')
            .toBeLessThanOrEqual(0.25 + 0.0001);
        }
        // The upstream reach begins at point 0 and the downstream reach
        // ends at the final point; no indexed triangle crosses the pool gap.
        for (const quad of quads) {
          const inside = (v: THREE.Vector3, start: number, end: number): boolean =>
            island.river.slice(start, end + 1).some((p, i, points) => {
              if (i === points.length - 1) return false;
              const next = points[i + 1]!;
              const dx = next.x - p.x, dz = next.z - p.z;
              const t = ((v.x - p.x) * dx + (v.z - p.z) * dz) /
                (dx * dx + dz * dz);
              const tolerance = start === 0 ? 0.001 : 1.5 * island.size / 600;
              return t >= -0.02 && t <= 1.02 &&
                Math.hypot(v.x - p.x - t * dx, v.z - p.z - t * dz) < tolerance;
            });
          expect((inside(quad.start, 0, 4) && inside(quad.end, 0, 4)) ||
            (inside(quad.start, 11, island.river.length - 1) &&
              inside(quad.end, 11, island.river.length - 1))).toBe(true);
        }
      } finally {
        disposeWaterMeshes(visuals);
      }
    },
  );

  it('makes one low rocky glade step that flows directly onto the softened Pines river', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const source = island.props.find(prop => prop.id === PINES_GLADE_CASCADE)!;
    const safeBefore = structuredClone(island.colliders);
    const view = createWorldScene(island);
    try {
      const river = view.group.getObjectByName('rippling-river') as
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const position = river.geometry.getAttribute('position');
      const uv = river.geometry.getAttribute('uv');
      const style = river.geometry.getAttribute('streamStyle');
      const heights: number[] = [];
      const forestWidth: number[] = [];
      const builtVertices: number[] = [];
      for (let i = 0; i < position.count; i++) {
        if (style.getX(i) === 2) {
          heights.push(position.getY(i));
          builtVertices.push(i);
        }
        if (style.getX(i) === 1 && uv.getX(i) === 0) {
          forestWidth.push(Math.hypot(position.getX(i) - position.getX(i + 1),
            position.getZ(i) - position.getZ(i + 1)));
        }
      }
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2.14);
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1.95);
      expect(Math.max(...forestWidth) - Math.min(...forestWidth)).toBeGreaterThan(4);
      const localCentre = builtVertices.find(i => uv.getX(i) === 0.5 && uv.getY(i) === 1)!;
      const pool = cascadePoolCentre(source, 1);
      const y = position.getY(localCentre);
      expect(position.getX(localCentre)).toBeCloseTo(pool.x, 4);
      expect(position.getZ(localCentre)).toBeCloseTo(pool.z, 4);
      view.group.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(new THREE.Vector3(pool.x, y + 1, pool.z),
        new THREE.Vector3(0, -1, 0), 0, 2);
      const streamHit = ray.intersectObject(river).find(hit => style.getX(hit.face!.a) === 1);
      expect(streamHit).toBeDefined();
      expect(y - streamHit!.point.y).toBeCloseTo(0.06, 4);

      const bed = view.group.getObjectByName('whispering-pines-rock-step') as THREE.Mesh;
      const stone = bed.geometry.getAttribute('position');
      expect(bed).toBeInstanceOf(THREE.Mesh);
      for (let i = 0; i < stone.count; i++) {
        if (i % 5 !== 0 && i % 5 !== 4) continue;
        expect(stone.getY(i)).toBeLessThan(
          gridSample(island, stone.getX(i), stone.getZ(i)) - 0.24);
      }

      expect(river.material.fragmentShader).toContain('fwidth(phase)');
      expect(river.material.fragmentShader).toContain('vStreamStyle.y * (1.0 - bank)');
      expect(river.material.fragmentShader).toContain('0.94 * cover');
      const legacy = view.group.getObjectByName('props-cascade') as THREE.InstancedMesh;
      const index = island.props.filter(prop => prop.kind === 'cascade').indexOf(source);
      const transform = new THREE.Matrix4();
      legacy.getMatrixAt(index, transform);
      expect(new THREE.Vector3().setFromMatrixScale(transform).lengthSq()).toBe(0);
      expect(island.colliders).toEqual(safeBefore);
    } finally {
      view.dispose();
    }
  });

  it('keeps only real upstream cliff sites and their mesh-free names', () => {
    for (const [seed, size] of [['billy-isle', 600], ['waterfall-cliff-alt', 900]] as const) {
      const island = generateIsland({ seed, size, resolution: 193 });
      const dam = island.plots.find(plot => plot.poiId === 'the-dam')!;
      const sites = waterfallSites(island).filter(site =>
        site.id.startsWith('mountain-waterfall-'));
      const visuals = buildWaterVisuals(island);
      try {
        if (seed === 'billy-isle') {
          expect(sites.some(site => site.id === 'mountain-waterfall-1')).toBe(false);
        }
        for (const site of sites) {
          expect(Math.hypot(site.top.x - dam.center.x, site.top.z - dam.center.z))
            .toBeGreaterThan(70);
          expect(Math.hypot(site.bottom.x - site.top.x, site.bottom.z - site.top.z))
            .toBeCloseTo(4 * size / 600, 4);
          expect(gridSample(island, site.top.x, site.top.z) -
            gridSample(island, site.bottom.x, site.bottom.z))
            .toBeGreaterThanOrEqual(3 * size / 600 - 0.001);
          const placed = island.props.some(prop =>
            prop.id === 'waterfall-cascade-' + site.id);
          expect(visuals.inland.getObjectByName(site.id) instanceof THREE.Group).toBe(placed);
          expect(visuals.inland.getObjectByName(site.id + '-foam') instanceof THREE.Group)
            .toBe(placed);
        }
      } finally {
        disposeWaterMeshes(visuals);
      }
    }
  });

  it('drapes the front Mt. Gigga cascade into a connected pool outside the trail and landing props', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const id = 'waterfall-cascade-front-terrace-waterfall-2';
    const descriptor = island.props.find(prop => prop.id === id)!;
    const course = structuredClone(island.colliders);
    const view = createWorldScene(island);
    try {
      const river = view.group.getObjectByName('mountain-terrace-water') as
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const pos = river.geometry.getAttribute('position');
      const style = river.geometry.getAttribute('streamStyle');
      const indices = river.geometry.getIndex()!;
      const pieces: THREE.Vector3[] = [], pool: THREE.Vector3[] = [];
      const terraces = new Set<number>();
      for (let i = 0; i < pos.count; i++) {
        if (style.getX(i) !== 3) continue;
        const point = new THREE.Vector3().fromBufferAttribute(pos, i);
        terraces.add(i);
        if (style.getZ(i) === 0) pool.push(point);
        pieces.push(point);
      }
      expect(pieces).toHaveLength(125);
      expect(pool.length).toBeGreaterThan(10);
      expect(pool.every(point => point.y === pool[0]!.y)).toBe(true);
      expect(Math.max(...pieces.map(point => point.y)) - pool[0]!.y).toBeGreaterThan(16);
      const open = new Set([terraces.values().next().value!]);
      for (let pass = 0; pass < 25; pass++) {
        for (let i = 0; i < indices.count; i += 3) {
          const tri = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
          if (!tri.every(index => terraces.has(index)) || !tri.some(index => open.has(index))) continue;
          tri.forEach(index => open.add(index));
        }
      }
      expect(open.size).toBe(terraces.size);

      const trailEdges = island.roads.filter(road => road.type === 'trail')
        .flatMap(road => road.points.slice(1).map((point, i) =>
          ({ a: road.points[i]!, b: point, half: road.width / 2 })));
      const landings = island.props.filter(prop => prop.poiId === 'mt-gigga' &&
        ['ledge', 'ramp', 'platform', 'bridge'].includes(prop.kind));
      for (const point of pieces) {
        expect(Math.min(...trailEdges.map(({ a, b, half }) =>
          segmentProjection(point, a, b).distance - half))).toBeGreaterThan(0.18);
        for (const landing of landings) {
          const x = point.x - landing.transform.position.x, z = point.z - landing.transform.position.z;
          const angle = landing.transform.rotationY;
          const across = x * Math.cos(angle) - z * Math.sin(angle);
          const along = x * Math.sin(angle) + z * Math.cos(angle);
          expect(Math.abs(across) > landing.size.x / 2 || Math.abs(along) > landing.size.z / 2)
            .toBe(true);
        }
      }
      const classic = view.group.getObjectByName('props-cascade-tall') as THREE.InstancedMesh;
      const index = island.props.filter(prop => prop.kind === 'cascade-tall').indexOf(descriptor);
      const matrix = new THREE.Matrix4();
      classic.getMatrixAt(index, matrix);
      expect(new THREE.Vector3().setFromMatrixScale(matrix).lengthSq()).toBe(0);
      expect(view.group.getObjectByName('front-terrace-waterfall-2-foam')).toBeUndefined();
      expect(island.colliders).toEqual(course);
      view.setTideLevel(24);
      expect(river.parent!.visible).toBe(true);
      expect(view.group.getObjectByName('rivers-reservoir-and-falls')!.visible).toBe(false);
      expect(river.material.uniforms['uStreamTide']!.value).toBe(24);
      expect(river.material.fragmentShader).toContain('uStreamTide - vWorld.y');
      view.setTideLevel(49);
      expect(river.parent!.visible).toBe(false);
    } finally {
      view.dispose();
    }
  });

  it('does not turn authored level steps into falls on flat terrain', () => {
    const island = generateIsland({ seed: 'waterfall-flat-test', resolution: 65 });
    island.heights.fill(4);
    // Deliberately exaggerate the legacy elevation steps: terrain must win.
    island.river.forEach((p, i) => { p.level = (100 - i * 25); });
    const visuals = buildWaterVisuals(island);
    try {
      // Foam is descriptor-driven even if a caller edits terrain after dressing.
      const surviving = island.props.filter(prop => prop.id.startsWith(
        'waterfall-cascade-mountain-waterfall-'));
      expect(visuals.inland.children.filter(object =>
        /^mountain-waterfall-\d+$/.test(object.name))).toHaveLength(surviving.length);
      const ribbon = (visuals.inland.getObjectByName('rippling-river') as THREE.Mesh).geometry;
      const pos = ribbon.getAttribute('position');
      const style = ribbon.getAttribute('streamStyle');
      for (let i = 0; i < pos.count; i++) {
        if (style.getX(i) >= 2) continue; // Authored cascades, independent of river levels.
        expect(pos.getY(i)).toBeCloseTo(4 + (style.getX(i) === 1 ? 0.19 : 0.15), 4);
      }
    } finally {
      disposeWaterMeshes(visuals);
    }
  });
});

describe('Hoofington backdrop waterfall (HF-10)', () => {
  const id = 'hoofington-backdrop-waterfall';

  it('keeps a single visible and steep site with no road or preexisting prop overlap', () => {
    const island = generateIsland();
    const sites = waterfallSites(island).filter(site => site.id === id);
    expect(sites).toHaveLength(1);
    const { top, bottom, width } = sites[0]!;
    expect(width).toBeCloseTo(6, 5);
    const bookmark = findBookmark('08')!;
    const camera = new THREE.PerspectiveCamera(bookmark.fov, 16 / 9, 0.1, 2000);
    camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
    camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
    camera.updateMatrixWorld();
    const clip = top.clone().project(camera);
    expect(Math.abs(clip.x)).toBeLessThan(0.7);
    expect(Math.abs(clip.y)).toBeLessThan(0.8);
    expect(clip.z).toBeGreaterThanOrEqual(-1);
    expect(clip.z).toBeLessThan(1);
    expect(gridSample(island, top.x, top.z) - gridSample(island, bottom.x, bottom.z))
      .toBeGreaterThanOrEqual(6 - 0.0001);
    expect(Math.hypot(bottom.x - top.x, bottom.z - top.z)).toBeCloseTo(10, 3);
    for (const road of island.roads) for (const point of road.points) {
      expect(Math.hypot(top.x - point.x, top.z - point.z)).toBeGreaterThanOrEqual(6 - 0.001);
    }
    for (const prop of island.props.filter(p =>
      p.kind !== 'cascade' && p.kind !== 'cascade-tall')) {
      expect(Math.hypot(top.x - prop.transform.position.x, top.z - prop.transform.position.z))
        .toBeGreaterThanOrEqual(6 - 0.001);
    }
    const visuals = buildWaterVisuals(island);
    try {
      const placed = island.props.some(prop => prop.id === 'waterfall-cascade-' + id);
      expect(visuals.inland.getObjectByName(id) instanceof THREE.Group).toBe(placed);
      expect(visuals.inland.getObjectByName(id + '-foam') instanceof THREE.Group)
        .toBe(placed);
    } finally {
      disposeWaterMeshes(visuals);
    }
  });

  it('is repeatable and can be absent for a seed/size or missing mountain', () => {
    const island = generateIsland({ seed: 'hoofington-waterfall-alt', size: 900, resolution: 97 });
    expect(waterfallSites(island)).toEqual(waterfallSites(island));
    expect(island.props.filter(p => p.id === 'waterfall-cascade-' + id).length)
      .toBeLessThanOrEqual(waterfallSites(island).filter(site => site.id === id).length);
    island.pois = island.pois.filter(poi => poi.id !== 'mt-gigga');
    expect(waterfallSites(island).some(site => site.id === id)).toBe(false);
    const visuals = buildWaterVisuals(island);
    try {
      const placed = island.props.some(prop => prop.id === 'waterfall-cascade-' + id);
      expect(visuals.inland.getObjectByName(id) instanceof THREE.Group).toBe(placed);
      expect(visuals.inland.getObjectByName(id + '-foam') instanceof THREE.Group)
        .toBe(placed);
    } finally {
      disposeWaterMeshes(visuals);
    }
  });
});

describe('IS-22 shared water and foam lighting', () => {
  it('tints every unlit water surface and foam fleck without accumulating colour changes', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const visuals = buildWaterVisuals(island);
    const sky = buildSkyVisuals();
    try {
      const seaMaterial = visuals.sea.material as THREE.ShaderMaterial;
      const uLight = seaMaterial.uniforms['uLight']!;
      expect(uLight.value).toBeInstanceOf(THREE.Vector3);
      expect((uLight.value as THREE.Vector3).toArray()).toEqual([1, 1, 1]);
      const shaders = new Set<THREE.ShaderMaterial>();
      const foam = new Map<THREE.MeshBasicMaterial, THREE.Color>();
      for (const root of [visuals.sea, visuals.inland]) {
        root.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          if (object.material instanceof THREE.ShaderMaterial) {
            shaders.add(object.material);
            expect(object.material.uniforms['uLight'], object.name).toBe(uLight);
            expect(object.material.fragmentShader, object.name).toContain('* uLight');
          } else if (object.material instanceof THREE.MeshBasicMaterial) {
            foam.set(object.material, object.material.color.clone());
          } else {
            expect(['seabed-skirt', 'whispering-pines-rock-step']).toContain(object.name);
            expect(object.material).toBeInstanceOf(THREE.MeshLambertMaterial);
          }
        });
      }
      expect(shaders.size).toBe(3); // Sea, joined river/stream, and reservoir.
      expect(foam.size).toBe(Number(island.props.some(prop =>
        prop.id.startsWith('waterfall-cascade-') ||
        prop.id === 'whispering-pines-glade-cascade')));
      for (const phase of [0.5, 0.285, 0.025, 0.5]) {
        const { daylight, golden } = sky.update(phase);
        visuals.setLighting(daylight, golden);
        const light = uLight.value as THREE.Vector3;
        const expected = phase === 0.025 ? [0.16, 0.20, 0.34] :
          phase === 0.285 ? [1, 0.86, 0.74] : [1, 1, 1];
        for (const [component, target] of light.toArray()
          .map((value, index) => [value, expected[index]!] as const)) {
          expect(Math.abs(component - target)).toBeLessThan(phase === 0.025 ? 0.02 : 1e-6);
        }
        for (const [material, base] of foam) {
          expect(material.color.r).toBeCloseTo(base.r * light.x, 6);
          expect(material.color.g).toBeCloseTo(base.g * light.y, 6);
          expect(material.color.b).toBeCloseTo(base.b * light.z, 6);
          if (phase === 0.025) expect(material.color.r).toBeLessThan(base.r * 0.2);
        }
      }
    } finally {
      disposeWaterMeshes(visuals);
    }
  });

  it.each(['water-night-alt-A', 'water-night-alt-B'])('never throws on seed %s', seed => {
    const island = generateIsland({ seed, resolution: 65 });
    const visuals = buildWaterVisuals(island);
    try {
      expect(() => {
        visuals.setLighting(0.025, 0);
        visuals.update(0, island.seaLevel);
        visuals.setLighting(1, 0);
      }).not.toThrow();
    } finally {
      disposeWaterMeshes(visuals);
    }
  });
});
