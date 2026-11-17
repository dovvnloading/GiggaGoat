import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateIsland } from './index';
import { buildWaterVisuals } from './visual-water';
import { buildSkyVisuals } from './visual-sky';
import { gridSample } from './terrain';
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
      const clouds = sky.group.getObjectByName('puffy-cloud-banks') as THREE.InstancedMesh;
      expect(clouds.renderOrder).toBeGreaterThan(sea.renderOrder);
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
    for (const chunk of ['fog_pars_fragment', 'fog_fragment']) {
      expect(material.fragmentShader).toContain('#include <' + chunk + '>');
    }
    expect(material.fragmentShader).toContain('vec3(0.88, 0.96, 0.92)');
    sea.geometry.dispose();
    material.dispose();
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

describe('Dam reservoir gradient, shoreline and visual-only level (DM-3 / DM-6)', () => {
  it.each([400, 600, 900])('tints the animated disc radially and keeps water physics unchanged at %i m',
    size => {
      const island = generateIsland({ seed: 'billy-isle', resolution: 97, size });
      const lake = island.reservoir;
      const originalLevel = lake.level;
      const originalLake = { ...lake, center: { ...lake.center } };
      const scale = size / 600;
      const { sea, inland, update } = buildWaterVisuals(island);
      try {
        const water = inland.getObjectByName('dam-reservoir') as THREE.Mesh;
        const foam = inland.getObjectByName('dam-reservoir-foam') as THREE.Mesh;
        expect(water).toBeInstanceOf(THREE.Mesh);
        expect(foam).toBeInstanceOf(THREE.Mesh);
        expect(water.geometry).toBeInstanceOf(THREE.CircleGeometry);
        expect(water.position.x).toBe(lake.center.x);
        expect(water.position.z).toBe(lake.center.z);
        expect(water.position.y).toBeCloseTo(originalLevel - 1.5 * scale, 6);
        expect(water.scale.x).toBe(lake.radiusX);
        expect(water.scale.y).toBe(lake.radiusZ);
        expect(water.rotation.x).toBeCloseTo(-Math.PI / 2, 6);

        const positions = water.geometry.getAttribute('position');
        const colors = water.geometry.getAttribute('color');
        expect(colors).toBeDefined();
        expect(colors.count).toBe(positions.count);
        expect(positions.count).toBeGreaterThan(60);
        const deep = new THREE.Color(0x2a8fc0);
        const shore = new THREE.Color(0x48c9c9);
        const expectColour = (index: number, desired: THREE.Color): void => {
          expect(colors.getX(index)).toBeCloseTo(desired.r, 6);
          expect(colors.getY(index)).toBeCloseTo(desired.g, 6);
          expect(colors.getZ(index)).toBeCloseTo(desired.b, 6);
        };
        expect(Math.hypot(positions.getX(0), positions.getY(0))).toBeCloseTo(0, 6);
        expectColour(0, deep);
        for (const i of [1, 16, 32, 48, 64]) {
          expect(Math.hypot(positions.getX(i), positions.getY(i)))
            .toBeCloseTo(1, 6);
          expectColour(i, shore);
        }

        const animated = water.material as THREE.ShaderMaterial;
        const river = inland.getObjectByName('rippling-river') as THREE.Mesh;
        const riverMat = river.material as THREE.ShaderMaterial;
        // Preserve the original separated upstream/downstream vertices and
        // animation but batch both reaches into one draw alongside the new foam.
        expect(inland.getObjectByName('forest-river-after-dam')).toBeUndefined();
        const originalSegments = (5 - 1) + (island.river.length - 11 - 1);
        expect(river.geometry.index!.count).toBeGreaterThan(originalSegments * 6);
        expect(animated).toBeInstanceOf(THREE.ShaderMaterial);
        expect(animated.vertexShader).toContain('vReservoirColor = color');
        expect(animated.fragmentShader).toContain('mix(vReservoirColor, col, 0.18)');
        expect(animated.fragmentShader).toContain('uTime');
        expect(animated.uniforms['uTime']).toBe(riverMat.uniforms['uTime']);
        update(4.25, originalLevel);
        expect(animated.uniforms['uTime']!.value).toBe(4.25);
        expect(lake).toEqual(originalLake);
        expect(lake.level).toBe(originalLevel);

        const ring = foam.geometry as THREE.RingGeometry;
        expect(ring).toBeInstanceOf(THREE.RingGeometry);
        expect(ring.parameters.innerRadius).toBeCloseTo(0.96, 6);
        expect(ring.parameters.outerRadius).toBeCloseTo(1.02, 6);
        expect(foam.scale.x).toBe(lake.radiusX);
        expect(foam.scale.y).toBe(lake.radiusZ);
        expect(foam.position.x).toBe(lake.center.x);
        expect(foam.position.z).toBe(lake.center.z);
        expect(foam.position.y).toBeCloseTo(water.position.y + 0.05 * scale, 6);
        expect(foam.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
        const foamPaint = foam.material as THREE.MeshBasicMaterial;
        expect(foamPaint.color.getHex()).toBe(0xf2fbff);
        expect(foamPaint.opacity).toBe(0.7);
        expect(foamPaint.transparent).toBe(true);
        expect(foamPaint.depthWrite).toBe(false);
      } finally {
        sea.geometry.dispose();
        (sea.material as THREE.Material).dispose();
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        inland.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          geometries.add(object.geometry);
          const own = Array.isArray(object.material) ? object.material : [object.material];
          own.forEach(mat => materials.add(mat));
        });
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
      }
    });
});

describe('Mt. Gigga cascades and Dam plot exclusion (MG-5, DM-1)', () => {
  it('widens both waterfall families by 2.6 and sinks five translucent foam flecks per cascade', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const { inland, sea } = buildWaterVisuals(island);
    try {
      const falls = inland.children.filter(o =>
        o.name.startsWith('mountain-waterfall-') ||
        o.name.startsWith('front-terrace-waterfall-'));
      const cascades = falls.filter(o => !o.name.endsWith('-foam')) as THREE.Mesh[];
      expect(cascades.length).toBeGreaterThanOrEqual(2);
      expect(cascades.some(o => o.name.startsWith('front-terrace-waterfall-')))
        .toBe(true);
      for (const fall of cascades) {
        const vertices = fall.geometry.getAttribute('position');
        const width = Math.hypot(vertices.getX(1) - vertices.getX(0),
          vertices.getZ(1) - vertices.getZ(0));
        let original: number;
        if (fall.name.startsWith('mountain-waterfall-')) {
          const index = Number(fall.name.slice('mountain-waterfall-'.length));
          const a = island.river[index]!, b = island.river[index + 1]!;
          const topX = (vertices.getX(0) + vertices.getX(1)) / 2;
          const topZ = (vertices.getZ(0) + vertices.getZ(1)) / 2;
          const bottomX = (vertices.getX(2) + vertices.getX(3)) / 2;
          const bottomZ = (vertices.getZ(2) + vertices.getZ(3)) / 2;
          const sourceRun = Math.hypot(b.x - a.x, b.z - a.z);
          const distanceFromA = Math.hypot(topX - a.x, topZ - a.z);
          original = (a.width + (b.width - a.width) * distanceFromA / sourceRun) * 0.4;
          expect(vertices.getY(0)).toBeCloseTo(
            gridSample(island, topX, topZ) + 0.26 * island.size / 600, 4);
          expect(vertices.getY(2)).toBeCloseTo(
            gridSample(island, bottomX, bottomZ) + 0.18 * island.size / 600, 4);
          expect(Math.hypot(bottomX - topX, bottomZ - topZ))
            .toBeCloseTo(4 * island.size / 600, 4);
          expect(gridSample(island, topX, topZ) -
            gridSample(island, bottomX, bottomZ))
            .toBeGreaterThanOrEqual(3 * island.size / 600 - 0.001);
        } else {
          const index = Number(fall.name.slice('front-terrace-waterfall-'.length)) - 1;
          const angle = [0.54, 0.89][index]!;
          const r0 = (index === 0 ? 38 : 74) * island.size / 600;
          const r1 = (index === 0 ? 46 : 83) * island.size / 600;
          original = (index === 0 ? 5.1 : 4.2) * island.size / 600;
          expect(vertices.getY(0)).toBeCloseTo(gridSample(island,
            Math.cos(angle) * r0, Math.sin(angle) * r0) +
            0.26 * island.size / 600, 5);
          expect(vertices.getY(2)).toBeCloseTo(gridSample(island,
            Math.cos(angle) * r1, Math.sin(angle) * r1) +
            0.18 * island.size / 600, 5);
        }
        expect(width, fall.name).toBeCloseTo(original * 2.6, 4);
        const marker = inland.getObjectByName(
          fall.name + '-foam') as THREE.Group;
        expect(marker, fall.name).toBeInstanceOf(THREE.Group);
        const firstInstance = marker.userData['instanceOffset'] as number;
        const blobCount = marker.userData['instanceCount'] as number;
        expect(blobCount, fall.name + ' blob count').toBe(5);
        const foam = inland.getObjectByName('waterfall-foam-batch') as THREE.InstancedMesh;
        expect(foam).toBeInstanceOf(THREE.InstancedMesh);
        expect(foam.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
        const mat = foam.material as THREE.MeshBasicMaterial;
        expect(mat.color.getHex()).toBe(0xeaf8ff);
        expect(mat.opacity).toBe(0.6);
        expect(mat.transparent).toBe(true);
        expect(mat.depthWrite).toBe(false);
        const transform = new THREE.Matrix4();
        const size = new THREE.Vector3();
        const offsets = [-0.4, -0.2, 0, 0.2, 0.4] as const;
        const jitter = [0.94, 1.11, 0.89, 1.07, 0.97] as const;
        const base = new THREE.Vector3(
          (vertices.getX(2) + vertices.getX(3)) / 2,
          vertices.getY(2) - width * 0.03,
          (vertices.getZ(2) + vertices.getZ(3)) / 2);
        const across = new THREE.Vector3(
          vertices.getX(3) - vertices.getX(2), 0,
          vertices.getZ(3) - vertices.getZ(2)).normalize();
        const locations: THREE.Vector3[] = [];
        for (let i = 0; i < blobCount; i++) {
          foam.getMatrixAt(firstInstance + i, transform);
          size.setFromMatrixScale(transform);
          // Deterministic, per-blob jitter stays inside +/-15%.
          expect(jitter[i], foam.name).toBeGreaterThanOrEqual(0.85);
          expect(jitter[i], foam.name).toBeLessThanOrEqual(1.15);
          expect(size.x, foam.name).toBeCloseTo(width * 0.16 * jitter[i]!, 4);
          expect(size.y, foam.name).toBeCloseTo(width * 0.07 * jitter[i]!, 4);
          expect(size.z, foam.name).toBeCloseTo(width * 0.16 * jitter[i]!, 4);
          const location = new THREE.Vector3().setFromMatrixPosition(transform);
          const expected = base.clone().addScaledVector(across, offsets[i]! * width);
          expect(location.distanceTo(expected), foam.name + ' position')
            .toBeLessThan(0.0002);
          expect(location.y, foam.name).toBeCloseTo(vertices.getY(2) - width * 0.03, 4);
          locations.push(location);
        }
        for (let i = 1; i < locations.length; i++) {
          expect(locations[i]!.distanceTo(locations[i - 1]!))
            .toBeCloseTo(width * 0.2, 4);
        }
        expect(locations[0]!.distanceTo(locations[4]!))
          .toBeCloseTo(width * 0.8, 4);
      }
      const torus: THREE.Mesh[] = [];
      inland.traverse(o => {
        if (o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry)
          torus.push(o);
      });
      expect(torus).toHaveLength(0);
    } finally {
      inland.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(mat => mat.dispose());
        }
      });
      sea.geometry.dispose();
      (sea.material as THREE.Material).dispose();
    }
  });

  it('suppresses a real cliff waterfall when its entire reach enters the Dam exclusion', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const dam = island.plots.find(p => p.poiId === 'the-dam')!;
    // Force a known real slope along the first upstream river segment; do
    // not rely on authored river levels to manufacture the curtain.
    const n = island.resolution;
    for (let iz = 0; iz < n; iz++) {
      const z = (iz / (n - 1) - 0.5) * island.size;
      for (let ix = 0; ix < n; ix++) island.heights[iz * n + ix] = 2 * z;
    }
    const first = buildWaterVisuals(island);
    try {
      const fall = first.inland.getObjectByName('mountain-waterfall-0');
      expect(fall).toBeInstanceOf(THREE.Mesh);
    } finally {
      disposeWaterMeshes(first);
    }
    // The whole first segment is shorter than 70 m, so moving the Dam centre
    // to its upstream end excludes every possible 4 m drop along it.
    dam.center.x = island.river[0]!.x;
    dam.center.z = island.river[0]!.z;
    const guarded = buildWaterVisuals(island);
    try {
      expect(guarded.inland.getObjectByName('mountain-waterfall-0'))
        .toBeUndefined();
      expect(guarded.inland.getObjectByName('mountain-waterfall-0-foam'))
        .toBeUndefined();
    } finally {
      disposeWaterMeshes(guarded);
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
  for (const root of [visuals.sea, visuals.inland]) {
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
  ])('drapes every bank vertex onto the final ground on $seed at $size m',
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
        const scale = size / 600;
        const reaches = [island.river.slice(0, 5), island.river.slice(11)];
        const expectedStations = reaches.map(points => 1 + points.slice(1).reduce(
          (sum, point, i) => sum + Math.max(1, Math.ceil(
            Math.hypot(point.x - points[i]!.x, point.z - points[i]!.z) /
              (2 * scale))), 0));
        expect(position.count).toBe(2 * expectedStations.reduce((a, b) => a + b, 0));
        expect(uv.count).toBe(position.count);
        for (let v = 0; v < position.count; v++) {
          const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
          const terrain = gridSample(island, x, z);
          expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
          expect(Math.abs(y - (terrain + 0.15 * scale)),
            'bank vertex ' + v).toBeLessThan(0.3 * scale);
          expect(y - terrain, 'no floating bank vertex ' + v).toBeLessThan(1);
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
            expect(run).toBeLessThanOrEqual(2 * scale + 0.0001);
            expect(run).toBeGreaterThan(0);
            expect(uv.getY(2 * row)).toBeCloseTo(
              uv.getY(2 * (row - 1)) + run / 10, 4);
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
              return t >= -0.001 && t <= 1.001 &&
                Math.hypot(v.x - p.x - t * dx, v.z - p.z - t * dz) < 0.001;
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

  it('keeps waterfall mesh names only for actual 3 m drops on 4 m runs away from the Dam', () => {
    for (const [seed, size] of [['billy-isle', 600], ['waterfall-cliff-alt', 900]] as const) {
      const island = generateIsland({ seed, size, resolution: 193 });
      const dam = island.plots.find(plot => plot.poiId === 'the-dam')!;
      const visuals = buildWaterVisuals(island);
      try {
        const waterfalls = visuals.inland.children.filter(object =>
          /^mountain-waterfall-\d+$/.test(object.name)) as THREE.Mesh[];
        if (seed === 'billy-isle') {
          expect(visuals.inland.getObjectByName('mountain-waterfall-1'))
            .toBeUndefined();
          expect(visuals.inland.getObjectByName('mountain-waterfall-1-foam'))
            .toBeUndefined();
        }
        for (const fall of waterfalls) {
          const position = fall.geometry.getAttribute('position');
          const topX = (position.getX(0) + position.getX(1)) / 2;
          const topZ = (position.getZ(0) + position.getZ(1)) / 2;
          const footX = (position.getX(2) + position.getX(3)) / 2;
          const footZ = (position.getZ(2) + position.getZ(3)) / 2;
          expect(Math.hypot(topX - dam.center.x, topZ - dam.center.z),
            fall.name).toBeGreaterThan(70);
          expect(Math.hypot(footX - topX, footZ - topZ),
            fall.name).toBeCloseTo(4 * size / 600, 4);
          expect(gridSample(island, topX, topZ) -
            gridSample(island, footX, footZ),
            fall.name).toBeGreaterThanOrEqual(3 * size / 600 - 0.001);
          const index = Number(fall.name.slice('mountain-waterfall-'.length));
          expect(Number.isInteger(index) && index >= 0 &&
            index < island.river.length - 1).toBe(true);
          expect(visuals.inland.getObjectByName(fall.name + '-foam'))
            .toBeInstanceOf(THREE.Group);
        }
      } finally {
        disposeWaterMeshes(visuals);
      }
    }
  });

  it('does not turn authored level steps into falls on flat terrain', () => {
    const island = generateIsland({ seed: 'waterfall-flat-test', resolution: 65 });
    island.heights.fill(4);
    // Deliberately exaggerate the legacy elevation steps: terrain must win.
    island.river.forEach((p, i) => { p.level = (100 - i * 25); });
    const visuals = buildWaterVisuals(island);
    try {
      expect(visuals.inland.children.filter(object =>
        /^mountain-waterfall-\d+$/.test(object.name))).toHaveLength(0);
      const pos = (visuals.inland.getObjectByName('rippling-river') as THREE.Mesh)
        .geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        expect(pos.getY(i)).toBeCloseTo(4 + 0.15, 4);
      }
    } finally {
      disposeWaterMeshes(visuals);
    }
  });
});

describe('Hoofington backdrop waterfall (HF-10)', () => {
  const fallName = 'hoofington-backdrop-waterfall';

  it('places exactly one 6 m cascade on a visible steep Mt. Gigga face for the default island', () => {
    const island = generateIsland();
    const visuals = buildWaterVisuals(island);
    try {
      const falls = visuals.inland.children.filter(object => object.name === fallName);
      expect(falls).toHaveLength(1);
      const fall = falls[0] as THREE.Mesh;
      const foamObjects = visuals.inland.children.filter(object =>
        object.name === fallName + '-foam');
      expect(foamObjects).toHaveLength(1);
      const foamMarker = foamObjects[0] as THREE.Group;
      expect(foamMarker).toBeInstanceOf(THREE.Group);
      expect(foamMarker.userData['instanceCount']).toBe(5);
      const foamBatch = visuals.inland.getObjectByName('waterfall-foam-batch') as THREE.InstancedMesh;
      expect(foamBatch).toBeInstanceOf(THREE.InstancedMesh);
      expect(foamBatch.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
      expect(foamBatch.count).toBeGreaterThanOrEqual(5);
      const river = visuals.inland.getObjectByName('rippling-river') as THREE.Mesh;
      expect(fall.material).toBe(river.material);

      const positions = fall.geometry.getAttribute('position');
      const top = new THREE.Vector3(
        (positions.getX(0) + positions.getX(1)) / 2,
        positions.getY(0),
        (positions.getZ(0) + positions.getZ(1)) / 2);
      const foot = new THREE.Vector3(
        (positions.getX(2) + positions.getX(3)) / 2,
        positions.getY(2),
        (positions.getZ(2) + positions.getZ(3)) / 2);
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

      const drop = gridSample(island, top.x, top.z) -
        gridSample(island, foot.x, foot.z);
      expect(drop).toBeGreaterThanOrEqual(6 - 0.0001);
      expect(Math.hypot(foot.x - top.x, foot.z - top.z)).toBeCloseTo(10, 3);
      const width = Math.hypot(positions.getX(1) - positions.getX(0),
        positions.getZ(1) - positions.getZ(0));
      expect(width).toBeCloseTo(6 * 2.6, 4);
      for (const road of island.roads) for (const point of road.points) {
        expect(Math.hypot(top.x - point.x, top.z - point.z))
          .toBeGreaterThanOrEqual(6 - 0.001);
      }
      for (const prop of island.props) {
        const point = prop.transform.position;
        expect(Math.hypot(top.x - point.x, top.z - point.z))
          .toBeGreaterThanOrEqual(6 - 0.001);
      }
    } finally {
      disposeWaterMeshes(visuals);
    }
  });

  it('is deterministic and optionally absent without errors on a different seed and size', () => {
    const island = generateIsland({ seed: 'hoofington-waterfall-alt', size: 900, resolution: 97 });
    const first = buildWaterVisuals(island);
    const second = buildWaterVisuals(island);
    try {
      const candidates = [first, second].map(visuals =>
        visuals.inland.children.filter(object => object.name === fallName));
      expect(candidates[0]!.length).toBeLessThanOrEqual(1);
      expect(candidates[0]!.length).toBe(candidates[1]!.length);
      if (candidates[0]!.length === 1) {
        const firstFall = candidates[0]![0] as THREE.Mesh;
        const secondFall = candidates[1]![0] as THREE.Mesh;
        expect(Array.from(firstFall.geometry.getAttribute('position').array))
          .toEqual(Array.from(secondFall.geometry.getAttribute('position').array));
        for (const visuals of [first, second]) {
          const marker = visuals.inland.getObjectByName(fallName + '-foam');
          expect(marker).toBeInstanceOf(THREE.Group);
          expect(marker!.userData['instanceCount']).toBe(5);
          const batch = visuals.inland.getObjectByName('waterfall-foam-batch');
          expect(batch).toBeInstanceOf(THREE.InstancedMesh);
        }
      } else {
        expect(first.inland.getObjectByName(fallName + '-foam')).toBeUndefined();
        expect(second.inland.getObjectByName(fallName + '-foam')).toBeUndefined();
      }
    } finally {
      disposeWaterMeshes(first);
      disposeWaterMeshes(second);
    }
  });

  it('does not throw or leave foam if the mountain is unavailable', () => {
    const island = generateIsland({ seed: 'hoofington-no-mountain', resolution: 65 });
    island.pois = island.pois.filter(poi => poi.id !== 'mt-gigga');
    const visuals = buildWaterVisuals(island);
    try {
      expect(visuals.inland.getObjectByName(fallName)).toBeUndefined();
      expect(visuals.inland.getObjectByName(fallName + '-foam')).toBeUndefined();
    } finally {
      disposeWaterMeshes(visuals);
    }
  });
});
