import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildRapierColliders } from './colliders';
import { generateIsland } from './island';
import { gridSample } from './terrain';
import type { IslandData } from './types';
import { buildGroundDetails } from './visual-ground';
import { buildStreetDetails } from './visual-streets';

interface DetailVertex {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}
type DetailQuad = [DetailVertex, DetailVertex, DetailVertex, DetailVertex];
interface GroundDetails {
  quads: DetailQuad[];
  vertices: DetailVertex[];
}

const CONCRETE = new THREE.Color('#A7A3A0');
const WARM = new THREE.Color('#999493');
const JOINT = new THREE.Color('#858789');
const MARKING = new THREE.Color('#EDC350');
const PUDDLE = new THREE.Color(0x53686e);
const WET_EDGE = new THREE.Color(0x656663);
const SOIL = new THREE.Color(0x7b5a3a);
const CROP_ROW = new THREE.Color(0x6fb34a);
const OLD_GARDEN = new THREE.Color('#6F8549');
const QUAD_SHADES = [0.965, 0.98, 0.995, 0.965] as const;

// Read the merged geometry, not implementation constants or a screenshot.
// Each quad is indexed as (0,2,1) (1,2,3); discs are triangle fans.
function readDetails(island: IslandData): GroundDetails {
  const group = buildGroundDetails(island);
  const quads: DetailQuad[] = [];
  const vertices: DetailVertex[] = [];
  for (const object of group.children) {
    if (!(object instanceof THREE.Mesh)) throw new Error('Expected a merged ground mesh');
    const geometry = object.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    const index = geometry.index;
    if (!index) throw new Error('Expected indexed ground geometry');
    const local: DetailVertex[] = Array.from({ length: positions.count }, (_, i) => ({
      x: positions.getX(i), y: positions.getY(i), z: positions.getZ(i),
      r: colors.getX(i), g: colors.getY(i), b: colors.getZ(i),
    }));
    vertices.push(...local);
    for (let i = 0; i < index.count;) {
      if (i + 5 < index.count &&
          index.getX(i + 2) === index.getX(i + 3) &&
          index.getX(i + 1) === index.getX(i + 4)) {
        quads.push([
          local[index.getX(i)]!, local[index.getX(i + 2)]!,
          local[index.getX(i + 1)]!, local[index.getX(i + 5)]!,
        ]);
        i += 6;
      } else {
        i += 3; // Disc fan triangle, not a slab or painted stripe.
      }
    }
  }
  return { quads, vertices };
}

function shadeOf(vertex: DetailVertex, color: THREE.Color, shade: number): boolean {
  return Math.abs(vertex.r - color.r * shade) < 0.0001 &&
    Math.abs(vertex.g - color.g * shade) < 0.0001 &&
    Math.abs(vertex.b - color.b * shade) < 0.0001;
}

function hasPaint(quad: DetailQuad, color: THREE.Color): boolean {
  return quad.every((vertex, i) => shadeOf(vertex, color, QUAD_SHADES[i]!));
}

function footprint(quad: DetailQuad, x: number, z: number,
  width: number, length: number, yaw = 0): boolean {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const corners = [
    [-width / 2, -length / 2], [width / 2, -length / 2],
    [-width / 2, length / 2], [width / 2, length / 2],
  ] as const;
  return corners.every(([dx, dz], i) =>
    Math.abs(quad[i]!.x - (x + c * dx + s * dz)) < 0.001 &&
    Math.abs(quad[i]!.z - (z - s * dx + c * dz)) < 0.001);
}

describe('Crane Yard CY-11 ground apron', () => {
  let island: IslandData;
  let details: GroundDetails;
  let yard: { x: number; z: number };
  let scale: number;

  beforeAll(() => {
    island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    details = readDetails(island);
    yard = island.pois.find(p => p.id === 'crane-yard')!.center;
    scale = island.size / 600;
  });

  it('tiles the entire 80 x 72 m apron with flush joints between slabs', () => {
    const slabs = details.quads.filter(quad =>
      Math.abs(Math.hypot(quad[1].x - quad[0].x, quad[1].z - quad[0].z)
        - 8 * scale) < 0.001 &&
      Math.abs(Math.hypot(quad[2].x - quad[0].x, quad[2].z - quad[0].z)
        - 8 * scale) < 0.001);
    expect(slabs).toHaveLength((80 / 8) * (72 / 8));

    for (let ix = -40; ix < 40; ix += 8) {
      for (let iz = -36; iz < 36; iz += 8) {
        const matches = slabs.filter(quad => footprint(quad,
          yard.x + (ix + 4) * scale, yard.z + (iz + 4) * scale,
          8 * scale, 8 * scale));
        expect(matches, 'slab at ' + ix + ',' + iz).toHaveLength(1);

        const slabX = (ix + 40) / 8, slabZ = (iz + 36) / 8;
        const shade = .988 + .012 * ((slabX * 7 + slabZ * 3) % 3) / 2;
        for (const v of matches[0]!) {
          // Check every vertex, not just the slab's average tint.
          for (const channel of ['r', 'g', 'b'] as const) {
            const ratio = v[channel] / CONCRETE[channel];
            expect(ratio).toBeGreaterThanOrEqual(0.9699);
            expect(ratio).toBeLessThanOrEqual(1.0301);
          }
          expect(shadeOf(v, CONCRETE, shade)).toBe(true);
          expect(shadeOf(v, WARM, 1)).toBe(false);
          expect(shadeOf(v, JOINT, 1)).toBe(false);
        }
      }
    }
  });

  it('draws grounded irregular puddles with a separate wet rim and glossy finish', () => {
    const puddleVertices = details.vertices.filter(v => {
      const shade = v.r / PUDDLE.r;
      return shade >= .869 && shade <= 1.021 &&
        Math.abs(v.g / PUDDLE.g - shade) < 0.0001 &&
        Math.abs(v.b / PUDDLE.b - shade) < 0.0001;
    });
    expect(puddleVertices).toHaveLength(3 * 33);
    const centres = puddleVertices.filter(v => shadeOf(v, PUDDLE, 1.02));
    const rim = details.vertices.filter(v => shadeOf(v, WET_EDGE, 1));
    expect(centres).toHaveLength(3);
    expect(rim).toHaveLength(96);
    for (const [dx, dz, radius] of [
      [-8, 14, 1.6], [15, -4, 1.1], [-24, -2, 2.0],
    ] as const) {
      const x = yard.x + dx * scale, z = yard.z + dz * scale;
      const centre = centres.find(v =>
        Math.abs(v.x - x) < 0.001 && Math.abs(v.z - z) < 0.001);
      expect(centre, 'puddle centre at ' + dx + ',' + dz).toBeDefined();
      expect(centre!.y - gridSample(island, x, z)).toBeGreaterThan(0.08 * scale);
      const edge = rim.filter(v => Math.hypot(v.x - x, v.z - z) <= 1.21 * radius * scale);
      expect(edge).toHaveLength(32);
      const radii = edge.map(v => Math.hypot(v.x - x, v.z - z));
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(.21 * radius * scale);
      for (const v of edge) {
        expect(v.y).toBeCloseTo(gridSample(island, v.x, v.z) + .087 * scale, 4);
      }
    }
    const group = buildGroundDetails(island);
    const pools = group.getObjectByName('ground-detail-crane-puddles') as THREE.Mesh;
    expect(pools.material).toBeInstanceOf(THREE.MeshPhongMaterial);
    expect(pools.geometry.index?.count).toBe(3 * 32 * 9);
  });

  it('preserves all 37 yellow markings, including their original exact footprints', () => {
    const marked = details.quads.filter(quad => shadeOf(quad[0], MARKING, 0.965));
    const expected: [number, number, number, number, number][] = [];
    const add = (x: number, z: number, width: number, length: number, yaw = 0): void => {
      expected.push([x, z, width, length, yaw]);
    };
    for (let i = 0; i < 13; i++) add(-28 + i * 4.3, 18.5, 2.2, 0.23);
    for (const x of [-36, 36]) {
      for (let i = 0; i < 8; i++) add(x, -28 + i * 7.5, 0.23, 3.1);
    }
    for (const z of [-2.5, 2.5]) add(21, -12 + z, 8.4, 0.34);
    for (let i = 0; i < 6; i++) add(12 + i * 2.2, 29, 1.2, 0.28, -0.62);
    expect(expected).toHaveLength(37);
    expect(marked).toHaveLength(37);
    for (const [dx, dz, width, length, yaw] of expected) {
      const matches = marked.filter(quad => footprint(quad,
        yard.x + dx * scale, yard.z + dz * scale,
        width * scale, length * scale, yaw));
      expect(matches, 'marking at ' + dx + ',' + dz).toHaveLength(1);
      const originalVertexShades = [0.965, 0.98, 0.995, 0.965];
      matches[0]!.forEach((v, i) => {
        expect(shadeOf(v, MARKING, originalVertexShades[i]!)).toBe(true);
      });
    }
  });

  it('produces finite ground geometry for different seeds and island scales', () => {
    for (const [seed, size] of [
      ['cy-11-fog', 400], [0, 600], ['cy-11-coast', 2000],
    ] as const) {
      const other = generateIsland({ seed, size, resolution: 65 });
      const result = readDetails(other);
      expect(result.vertices.length).toBeGreaterThan(400);
      expect(result.vertices.every(v =>
        Object.values(v).every(Number.isFinite))).toBe(true);
    }
  });
});

describe('Downtown service court and ramps', () => {
  it('keeps the visible service court at terrain level beneath the settled stock', async () => {
    await RAPIER.init();
    const island = generateIsland({ seed: 'billy-isle' });
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const groundDetails = buildGroundDetails(island);
    const { terrain } = buildRapierColliders(world, island);
    const down = new THREE.Vector3(0, -1, 0);
    const ray = new THREE.Raycaster(new THREE.Vector3(), down);
    try {
      const stock = island.props.filter(prop => /^downtown-bleatsville-(crate|barrel)-\d+$/.test(prop.id));
      expect(stock).toHaveLength(14);
      groundDetails.updateMatrixWorld(true);
      for (const prop of stock) {
        const { x, z } = prop.transform.position;
        for (const [dx, dz] of [[0, 0], [-.6, -.6], [-.6, .6], [.6, -.6], [.6, .6]]) {
          ray.ray.origin.set(x + dx!, 30, z + dz!);
          const floor = 30 - terrain.castRay(new RAPIER.Ray(ray.ray.origin, down), 40, false);
          const detail = ray.intersectObject(groundDetails, true)[0];
          expect(detail?.point.y ?? floor, prop.id).toBeLessThan(floor + .10);
        }
      }
    } finally {
      world.free();
      groundDetails.traverse(node => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
    }
  });

  it('seats the service ramp toes on the final ground and preserves their launch lips', async () => {
    await RAPIER.init();
    const island = generateIsland({ seed: 'billy-isle' });
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const { terrain, props } = buildRapierColliders(world, island);
    try {
      for (const [id, crown] of [[41, 10.5483], [43, 9.3652], [51, 8.6942], [53, 8.0295]]) {
        const ramp = island.props.find(prop => prop.id === 'downtown-bleatsville-ramp-' + id)!;
        const { position, rotationY } = ramp.transform;
        const sin = Math.sin(rotationY), cos = Math.cos(rotationY);
        const base = position.y - ramp.size.y / 2;
        const mesh = props.get(ramp.id)!;
        const rayAt = (across: number, along: number) => new RAPIER.Ray({
          x: position.x + cos * across + sin * along,
          y: 30,
          z: position.z - sin * across + cos * along,
        }, { x: 0, y: -1, z: 0 });
        expect(position.y + ramp.size.y / 2, ramp.id).toBeCloseTo(crown!, 4);
        for (const across of [-2.2, 0, 2.2]) {
          const ray = rayAt(across, -4.48);
          const toeGap = terrain.castRay(ray, 40, false) - mesh.castRay(ray, 40, false);
          expect(toeGap, ramp.id).toBeLessThan(.08);
          expect(toeGap, ramp.id).toBeGreaterThan(-.5);
          for (const along of [0, 2.2, 4.48]) {
            const under = rayAt(across, along);
            const foot = props.get(ramp.id + '-footing');
            const ground = 30 - terrain.castRay(under, 40, false);
            if (base - ground > .12) {
              expect(foot, ramp.id).toBeDefined();
              expect(30 - foot!.castRay(under, 40, false)).toBeCloseTo(base, 1);
            }
          }
        }
      }
    } finally { world.free(); }
  });
});

describe('Hoofington HF-9 vegetable patches', () => {
  it('draws exactly two 11 x 8 m soil beds with five lifted 10 x 0.75 m rows each', () => {
    for (const [seed, size] of [
      ['billy-isle', 600], ['hf-9-alt', 400], [0, 2000],
    ] as const) {
      const island = generateIsland({ seed, size, resolution: 65 });
      const details = readDetails(island);
      const farm = island.pois.find(p => p.id === 'hoofington')!.center;
      const scale = island.size / 600;
      const soilPatches = details.quads.filter(quad =>
        hasPaint(quad, SOIL) &&
        Math.abs(quad[1].x - quad[0].x - 11 * scale) < 0.001 &&
        Math.abs(quad[2].z - quad[0].z - 8 * scale) < 0.001);
      const cropRows = details.quads.filter(quad => hasPaint(quad, CROP_ROW));

      expect(soilPatches, String(seed)).toHaveLength(2);
      expect(cropRows, String(seed)).toHaveLength(10);
      for (const side of [-1, 1]) {
        const patchX = farm.x + side * 27 * scale;
        const patchZ = farm.z + 30 * scale;
        const soils = soilPatches.filter(quad =>
          footprint(quad, patchX, patchZ, 11 * scale, 8 * scale));
        expect(soils, String(seed) + ' soil ' + side).toHaveLength(1);
        for (const vertex of soils[0]!) {
          expect(vertex.y - gridSample(island, vertex.x, vertex.z))
            .toBeCloseTo(0.075 * scale, 4);
        }

        for (const dz of [-3, -1.5, 0, 1.5, 3]) {
          const rows = cropRows.filter(quad =>
            footprint(quad, patchX, patchZ + dz * scale,
              10 * scale, 0.75 * scale));
          expect(rows, String(seed) + ' row ' + side + ':' + dz).toHaveLength(1);
          for (const vertex of rows[0]!) {
            // The same terrain-sampled quad, raised 2 cm above the soil layer.
            expect(vertex.y - gridSample(island, vertex.x, vertex.z))
              .toBeCloseTo(0.095 * scale, 4);
          }
        }
      }
      // No quad (or loose vertex) retains the original dark-olive decal tint.
      expect(details.quads.some(quad => hasPaint(quad, OLD_GARDEN))).toBe(false);
      expect(details.vertices.some(vertex =>
        QUAD_SHADES.some(shade => shadeOf(vertex, OLD_GARDEN, shade)))).toBe(false);
      expect(details.vertices.every(vertex =>
        Object.values(vertex).every(Number.isFinite))).toBe(true);
    }
  });
});

describe('Downtown storefront paving', () => {
  it('meets the graded sidewalk on both sides while retaining the shop edge and slab gaps', () => {
    const island = generateIsland();
    const city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const ground = buildGroundDetails(island, 192);
    const streets = buildStreetDetails(island);
    const sidewalk = streets.getObjectByName('paved-village-sidewalks')!;
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const sample = (object: THREE.Object3D, x: number, z: number) => {
      ray.ray.origin.set(x, 40, z);
      return ray.intersectObject(object).map(hit => hit.point.y);
    };
    try {
      for (const side of [-1, 1]) {
        const pavementX = city.x + side * 6.88;
        const approachX = city.x + side * 6.90;
        for (let i = 0; i < 15; i++) {
          const near = city.z - 39.975 + i * 5.8;
          for (let offset = .2; offset < 5.55; offset += .35) {
            const z = near + offset;
            if (z >= city.z + 43) continue;
            const inside = sample(sidewalk, pavementX, z);
            const outside = sample(ground, approachX, z);
            const label = 'side ' + side + ' at Z ' + z.toFixed(2);
            expect(inside, label).toHaveLength(1);
            expect(outside, label).toHaveLength(1);
            expect(sample(ground, pavementX, z), label).toEqual([]);
            expect(sample(sidewalk, approachX, z), label).toEqual([]);
            expect(Math.abs(inside[0]! - outside[0]!), label).toBeLessThan(.01);
          }
          expect(sample(ground, city.x + side * 10.44, near + 2.775)).toHaveLength(1);
          expect(sample(ground, city.x + side * 10.46, near + 2.775)).toEqual([]);
          if (i < 14) expect(sample(ground, city.x + side * 8.4, near + 5.675)).toEqual([]);
        }
        // The last slab continues beyond the sidewalk's south cap to the courtyard.
        expect(sample(ground, city.x + side * 6.40, city.z + 46.65)).toHaveLength(1);
      }
    } finally {
      const materials = new Set<THREE.Material>();
      for (const group of [ground, streets]) group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        if (object.material instanceof THREE.Material) materials.add(object.material);
      });
      materials.forEach(material => material.dispose());
    }
  });
});
