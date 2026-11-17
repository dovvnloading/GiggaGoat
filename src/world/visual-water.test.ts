import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateIsland } from './index';
import { buildWaterVisuals } from './visual-water';
import { buildSkyVisuals } from './visual-sky';
import { gridSample } from './terrain';

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

describe('Mt. Gigga cascades and Dam plot exclusion (MG-5, DM-1)', () => {
  it('widens both waterfall families by 2.6 and replaces each foam torus with three blobs', () => {
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
        expect(foam.count, fall.name + ' blob count').toBe(3);
        expect(foam.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
        const mat = foam.material as THREE.MeshBasicMaterial;
        expect(mat.color.getHex()).toBe(0xffffff);
        expect(mat.opacity).toBe(0.85);
        expect(mat.transparent).toBe(true);
        expect(mat.depthWrite).toBe(false);
        const transform = new THREE.Matrix4();
        const size = new THREE.Vector3();
        const locations: THREE.Vector3[] = [];
        for (let i = 0; i < foam.count; i++) {
          foam.getMatrixAt(i, transform);
          size.setFromMatrixScale(transform);
          expect(size.x, foam.name).toBeCloseTo(width * 0.45, 5);
          expect(size.y, foam.name).toBeCloseTo(width * 0.3, 5);
          expect(size.z, foam.name).toBeCloseTo(width * 0.45, 5);
          const location = new THREE.Vector3().setFromMatrixPosition(transform);
          expect(location.y, foam.name).toBeCloseTo(vertices.getY(2), 5);
          locations.push(location);
        }
        expect(locations[0]!.distanceTo(locations[2]!))
          .toBeCloseTo(width * 0.56, 4);
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

