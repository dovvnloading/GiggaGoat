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
        const riverTriangles = (5 - 1) + (island.river.length - 11 - 1);
        expect(river.geometry.index?.count).toBe(riverTriangles * 6);
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
          original = (a.width + b.width) * 0.4;
          expect(vertices.getY(0)).toBeCloseTo(a.level + 0.3, 5);
          expect(vertices.getY(2)).toBeCloseTo(b.level + 0.2, 5);
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
        const foam = inland.getObjectByName(
          fall.name + '-foam') as THREE.InstancedMesh;
        expect(foam, fall.name).toBeInstanceOf(THREE.InstancedMesh);
        expect(foam.count, fall.name + ' blob count').toBe(5);
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
        for (let i = 0; i < foam.count; i++) {
          foam.getMatrixAt(i, transform);
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

  it('never generates a cascade whose top point is within the Dam plot', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const dam = island.plots.find(p => p.poiId === 'the-dam')!;
    const topInside = (x: number, z: number) =>
      Math.hypot(x - dam.center.x, z - dam.center.z) <= dam.radius;
    const first = buildWaterVisuals(island);
    try {
      for (const mesh of first.inland.children) {
        if (!mesh.name.startsWith('mountain-waterfall-') ||
            mesh.name.endsWith('-foam')) continue;
        const pos = (mesh as THREE.Mesh).geometry.getAttribute('position');
        expect(topInside((pos.getX(0) + pos.getX(1)) / 2,
          (pos.getZ(0) + pos.getZ(1)) / 2), mesh.name).toBe(false);
      }
    } finally {
      first.sea.geometry.dispose();
      (first.sea.material as THREE.Material).dispose();
      first.inland.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    // Move only the Dam test plot over a known descending segment, proving
    // that the guard suppresses that waterfall rather than merely missing it.
    const index = island.river.findIndex((p, i) => i < island.river.length - 1 &&
      p.level - island.river[i + 1]!.level > 3.4 * island.size / 600);
    expect(index).toBeGreaterThanOrEqual(0);
    const a = island.river[index]!, b = island.river[index + 1]!;
    dam.center.x = (a.x + b.x) / 2;
    dam.center.z = (a.z + b.z) / 2;
    dam.radius = 0.5 * island.size / 600;
    const guarded = buildWaterVisuals(island);
    try {
      expect(guarded.inland.getObjectByName('mountain-waterfall-' + index))
        .toBeUndefined();
      expect(guarded.inland.getObjectByName('mountain-waterfall-' + index +
        '-foam')).toBeUndefined();
    } finally {
      guarded.sea.geometry.dispose();
      (guarded.sea.material as THREE.Material).dispose();
      guarded.inland.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
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

function containsRibbonSegment(quads: readonly RibbonQuad[],
  a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return quads.some(quad =>
    Math.hypot(quad.start.x - a.x, quad.start.z - a.z) < 0.001 &&
    Math.hypot(quad.end.x - b.x, quad.end.z - b.z) < 0.001);
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

describe('Dam river ribbon steep-slope suppression (DM-1)', () => {
  it.each(['billy-isle', 'dam-ribbon-alt'])(
    'renders no steep quad within 70 m of the Dam for seed %s, including bookmark 14',
    seed => {
      const island = generateIsland({ seed, resolution: 97 });
      const dam = island.plots.find(plot => plot.poiId === 'the-dam')!;
      const camera = damBookmarkCamera();
      const visuals = buildWaterVisuals(island);
      try {
        const quads = renderedRibbonQuads(visuals.inland);
        const near = quads.filter(quad => {
          const mid = ribbonMidpoint(quad);
          return Math.hypot(mid.x - dam.center.x, mid.z - dam.center.z) <= 70;
        });
        expect(near.length).toBeGreaterThan(0);
        for (const quad of near) {
          expect(ribbonGradient(quad), 'Dam-adjacent indexed ribbon quad')
            .toBeLessThanOrEqual(0.25 + 0.00001);
        }
        const visible = near.filter(quad => onScreen(ribbonMidpoint(quad), camera));
        expect(visible.length).toBeGreaterThan(0);
        for (const quad of visible) {
          expect(ribbonGradient(quad), 'bookmark 14 visible Dam ribbon quad')
            .toBeLessThanOrEqual(0.25 + 0.00001);
        }
        // Every permitted segment must still have its full quad, on both
        // sides of the intentionally empty plunge-pool reach (indices 4..10).
        const bothReaches = [
          ...[0, 1, 2, 3],
          ...Array.from({ length: island.river.length - 12 }, (_, i) => i + 11),
        ];
        for (const i of bothReaches) {
          const a = island.river[i]!, b = island.river[i + 1]!;
          const distance = Math.hypot(
            (a.x + b.x) / 2 - dam.center.x,
            (a.z + b.z) / 2 - dam.center.z);
          const gradient = (a.level - b.level) / Math.hypot(b.x - a.x, b.z - a.z);
          const shouldRender = !(distance <= 70 && gradient > 0.25);
          expect(containsRibbonSegment(quads, a, b), 'source segment ' + i)
            .toBe(shouldRender);
        }
        expect(containsRibbonSegment(quads, island.river[1]!, island.river[2]!))
          .toBe(true); // upstream
        expect(containsRibbonSegment(quads, island.river[12]!, island.river[13]!))
          .toBe(true); // forest outflow
      } finally {
        disposeWaterMeshes(visuals);
      }
    },
  );

  it('omits steep near-Dam segments but leaves neighboring upstream and forest quads', () => {
    const island = generateIsland({ seed: 'dam-ribbon-alt', resolution: 97 });
    const dam = island.plots.find(plot => plot.poiId === 'the-dam')!;
    // Force a steep reach in each emitted ribbon, not in the already omitted
    // Dam plunge-pool gap. Both changed midpoints remain within 70 m.
    island.river[3]!.level = island.river[2]!.level - 12;
    const outA = island.river[11]!, outB = island.river[12]!;
    outA.x = dam.center.x - 12;
    outA.z = dam.center.z + 12;
    outA.level = 20;
    outB.x = dam.center.x + 12;
    outB.z = dam.center.z + 18;
    outB.level = 2;

    const visuals = buildWaterVisuals(island);
    try {
      const quads = renderedRibbonQuads(visuals.inland);
      expect(quads).toHaveLength(6); // eight original quads less the two steep ones
      for (const i of [2, 11]) {
        const a = island.river[i]!, b = island.river[i + 1]!;
        expect((a.level - b.level) / Math.hypot(a.x - b.x, a.z - b.z))
          .toBeGreaterThan(0.25);
        expect(Math.hypot((a.x + b.x) / 2 - dam.center.x,
          (a.z + b.z) / 2 - dam.center.z)).toBeLessThan(70);
        expect(containsRibbonSegment(quads, a, b), 'steep source segment ' + i)
          .toBe(false);
      }
      for (const i of [0, 1, 3, 12, 13, 14]) {
        expect(containsRibbonSegment(quads, island.river[i]!, island.river[i + 1]!),
          'preserved neighboring segment ' + i).toBe(true);
      }
    } finally {
      disposeWaterMeshes(visuals);
    }
  });

  it('locates the visible steep 4→5 transition inside the pre-existing pool gap', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const dam = island.plots.find(plot => plot.poiId === 'the-dam')!;
    const a = island.river[4]!, b = island.river[5]!;
    const midpoint = new THREE.Vector3((a.x + b.x) / 2,
      (a.level + b.level) / 2 + 0.12, (a.z + b.z) / 2);
    expect((a.level - b.level) / Math.hypot(a.x - b.x, a.z - b.z))
      .toBeGreaterThan(0.25);
    expect(Math.hypot(midpoint.x - dam.center.x, midpoint.z - dam.center.z))
      .toBeLessThan(70);
    expect(onScreen(midpoint, damBookmarkCamera())).toBe(true);
    const visuals = buildWaterVisuals(island);
    try {
      expect(containsRibbonSegment(renderedRibbonQuads(visuals.inland), a, b))
        .toBe(false); // neither slice includes the 4→5 segment
    } finally {
      disposeWaterMeshes(visuals);
    }
  });
});
