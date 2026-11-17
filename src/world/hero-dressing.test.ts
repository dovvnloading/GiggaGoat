import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { IslandData, PropDescriptor, PropKind } from './types';
import { generateIsland, heightAt } from './index';
import { gridSample } from './terrain';
import { buildPropVisuals, AUTHORED_HERO_DRESSING_KINDS } from './visual-props';
import { PROP_LIBRARY_MODELS } from './library-props';

const HERO_KINDS = [
  'palm-tree', 'floodlight', 'life-ring', 'cable-spool',
  'pallet-stack', 'log-bridge',
] as const satisfies readonly PropKind[];
const HERO_SET = new Set<PropKind>(HERO_KINDS);
const dressings = [
  ['floodlight', [[-37, 14, 0.9], [6, 29.5, -2.6]], [1.6, 7, 1.6]],
  ['cable-spool', [[27, -16, 0.3], [-6, 22, 1.2]], [2, 1.6, 1.6]],
  ['pallet-stack', [[21, 30, 0.2], [-33, 20, 1.4], [30, -12, 0.7]], [1.4, 0.8, 1.2]],
] as const;
const palms = [
  [-24, -44, 9.5, 0.4], [-31, -52, 10.5, 2.1],
  [26, -48, 10, 3.6], [34, -41, 9, 5.2],
] as const;
function typesOf(island: IslandData, poiId: string, kind: PropKind): PropDescriptor[] {
  return island.props.filter(p => p.poiId === poiId && p.kind === kind);
}
function halfExtents(p: PropDescriptor): { x: number; z: number } {
  const c = Math.abs(Math.cos(p.transform.rotationY));
  const s = Math.abs(Math.sin(p.transform.rotationY));
  return { x: (c * p.size.x + s * p.size.z) / 2,
    z: (s * p.size.x + c * p.size.z) / 2 };
}
function aabbFootprintOverlaps(a: PropDescriptor, b: PropDescriptor): boolean {
  const A = halfExtents(a), B = halfExtents(b);
  return Math.abs(a.transform.position.x - b.transform.position.x) <
      A.x + B.x - 1e-5 &&
    Math.abs(a.transform.position.z - b.transform.position.z) <
      A.z + B.z - 1e-5;
}
const ground = (island: IslandData, p: { x: number; z: number }): number =>
  gridSample(island, p.x, p.z);

describe('authored painting-dressing GLB mapping and fallback', () => {
  it('preserves all six CC0 GLB paths and authored colours at both distances', () => {
    expect(AUTHORED_HERO_DRESSING_KINDS.size).toBe(6);
    for (const kind of HERO_KINDS) {
      expect(AUTHORED_HERO_DRESSING_KINDS.has(kind)).toBe(true);
      expect(PROP_LIBRARY_MODELS[kind]).toMatch(/^assets\/library\/custom\//);
    }
    const descriptors: PropDescriptor[] = HERO_KINDS.map((kind, i) => ({
      id: 'hero-' + kind, kind,
      transform: { position: { x: i * 15, y: 3, z: 0 }, rotationY: i * 0.11 },
      size: { x: 2, y: 3, z: 4 }, body: { type: 'static' },
      shape: 'cuboid', collidable: kind !== 'life-ring',
      lickable: kind !== 'life-ring', breakable: false, climbable: true,
    }));
    const visuals = buildPropVisuals(descriptors);
    try {
      for (const kind of HERO_KINDS) {
        const mesh = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
        expect(mesh.count).toBe(1);
        const vertices = mesh.geometry.getAttribute('position');
        expect(vertices.count).toBe(36); // plain box fallback, never a missing mesh
        expect(mesh.geometry.getAttribute('color')).toBeDefined();
      }
    } finally {
      visuals.dispose();
    }
  });

  it('retains each GLB painted colour and native far LOD, without per-instance draws', async () => {
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1),
        new THREE.MeshStandardMaterial({ color: 0x739b67 })));
      return { scene: root } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
    });
    vi.stubGlobal('document', {});
    const descriptors: PropDescriptor[] = HERO_KINDS.map((kind, i) => ({
      id: 'hero-' + kind, kind,
      transform: { position: { x: i * 15, y: 3, z: 0 }, rotationY: 0 },
      size: { x: 2, y: 3, z: 4 }, body: { type: 'static' },
      shape: 'cuboid', collidable: kind !== 'life-ring',
      lickable: kind !== 'life-ring', breakable: false, climbable: false,
      color: 0xff0000, // must not tint the painted Blender GLB
    }));
    const visuals = buildPropVisuals(descriptors);
    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true));
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      expect(load).toHaveBeenCalledTimes(6);
      for (const kind of HERO_KINDS) {
        const original = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        const near = visuals.group.getObjectByName('render-near-' + kind) as THREE.InstancedMesh;
        const far = visuals.group.getObjectByName('render-far-' + kind) as THREE.InstancedMesh;
        expect(near).toBeInstanceOf(THREE.InstancedMesh);
        expect(far).toBeInstanceOf(THREE.InstancedMesh);
        expect(far.geometry).toBe(near.geometry);
        expect(original.geometry).toBe(near.geometry);
        const colour = new THREE.Color();
        original.getColorAt(0, colour);
        expect(colour.getHex()).toBe(0xffffff);
        const paint = original.geometry.getAttribute('color');
        const expected = new THREE.Color(0x739b67);
        expect(paint.getX(0)).toBeCloseTo(expected.r, 6);
        expect(paint.getY(0)).toBeCloseTo(expected.g, 6);
        expect(paint.getZ(0)).toBeCloseTo(expected.b, 6);
      }
    } finally {
      visuals.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('hero placements on Billy Isle', () => {
  const island = generateIsland({ seed: 'billy-isle', size: 600, resolution: 193 });
  const scale = island.size / 600;

  it('plants all eligible forecourt palms on dry sand with precise size/yaw/shore shift', () => {
    const pier = typesOf(island, 'baa-ardwalk', 'pier')[0]!;
    const centre = island.pois.find(p => p.id === 'baa-ardwalk')!.center;
    const shoreShift = (pier.transform.position.z - pier.size.z / 2 - centre.z) / scale + 38;
    const expected = palms.filter(([dx, dz]) =>
      ground(island, { x: centre.x + dx * scale,
        z: centre.z + (dz + shoreShift) * scale }) >= island.seaLevel + 0.3 * scale);
    const props = typesOf(island, 'baa-ardwalk', 'palm-tree');
    expect(props).toHaveLength(expected.length);
    for (const [index, [dx, dz, height, yaw]] of expected.entries()) {
      const p = props[index]!;
      const pos = p.transform.position;
      expect(pos.x).toBeCloseTo(centre.x + dx * scale, 5);
      expect(pos.z).toBeCloseTo(centre.z + (dz + shoreShift) * scale, 5);
      expect(p.size).toEqual({ x: height * 0.5 * scale,
        y: height * scale, z: height * 0.5 * scale });
      expect(pos.y - p.size.y / 2).toBeCloseTo(ground(island, pos), 4);
      expect(ground(island, pos)).toBeGreaterThanOrEqual(island.seaLevel + 0.3 * scale);
      expect(p.transform.rotationY).toBe(yaw);
    }
    console.log('HERO_PALMS_DIAG', JSON.stringify({ eligible: expected.length,
      positions: props.map(p => p.transform.position) }));
  });

  it('mounts six noncollidable, unlickable life rings just outside the rail line', () => {
    const pier = typesOf(island, 'baa-ardwalk', 'pier')[0]!;
    const centre = island.pois.find(p => p.id === 'baa-ardwalk')!.center;
    const shoreShift = (pier.transform.position.z - pier.size.z / 2 - centre.z) / scale + 38;
    const rings = typesOf(island, 'baa-ardwalk', 'life-ring');
    expect(rings).toHaveLength(6);
    let i = 0;
    for (const side of [-1, 1]) for (const z of [-25, 7, 39]) {
      const p = rings[i++]!;
      expect(p.transform.position.x).toBeCloseTo(centre.x + side * 13.45 * scale, 5);
      expect(p.transform.position.z).toBeCloseTo(centre.z + (z + shoreShift) * scale, 5);
      expect(p.transform.position.y).toBeCloseTo(
        pier.transform.position.y + pier.size.y / 2 + 0.9 * scale, 5);
      expect(p.size).toEqual({ x: 0.9 * scale, y: 0.9 * scale, z: 0.2 * scale });
      expect(p.transform.rotationY).toBe(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      expect(Math.abs((p.transform.position.x - centre.x) / scale)).toBeGreaterThan(13.2);
      expect(p.collidable).toBe(false);
      expect(p.lickable).toBe(false);
    }
  });

  it('places two floodlights, two spools and three pallets without obstructing gates', () => {
    const centre = island.pois.find(p => p.id === 'crane-yard')!.center;
    for (const [kind, coords, dims] of dressings) {
      const placed = typesOf(island, 'crane-yard', kind);
      expect(placed).toHaveLength(coords.length);
      for (const [i, [x, z, yaw]] of coords.entries()) {
        const prop = placed[i]!;
        expect(prop.size).toEqual({ x: dims[0] * scale,
          y: dims[1] * scale, z: dims[2] * scale });
        expect(prop.transform.position.x).toBeCloseTo(centre.x + x * scale, 5);
        expect(prop.transform.position.z).toBeCloseTo(centre.z + z * scale, 5);
        expect(prop.transform.rotationY).toBe(yaw);
        expect(prop.transform.position.y - prop.size.y / 2).toBeCloseTo(centre.y, 3);
        // The fence entrance lies at z=36, x from 8..32 (rear z=-36, x -16..8).
        const bounds = halfExtents(prop);
        const frontGap = x + bounds.x / scale > 8 && x - bounds.x / scale < 32 &&
          z + bounds.z / scale > 33.5;
        const backGap = x + bounds.x / scale > -16 && x - bounds.x / scale < 8 &&
          z - bounds.z / scale < -33.5;
        expect(frontGap || backGap, prop.id + ' obstructs a road gate').toBe(false);
      }
    }
  });

  it('spans the river perpendicular to flow at the nearest point far from the lookout', () => {
    const p = typesOf(island, 'whispering-pines', 'log-bridge');
    expect(p).toHaveLength(1);
    const bridge = p[0]!;
    const woods = island.pois.find(poi => poi.id === 'whispering-pines')!.center;
    const lookout = typesOf(island, 'whispering-pines', 'lookout')[0]!;
    const eligible = island.river.map((point, i) => ({ point, i }))
      .filter(({ point }) => Math.hypot(
        point.x - lookout.transform.position.x,
        point.z - lookout.transform.position.z) >= 15 * scale)
      .sort((a, b) => Math.hypot(a.point.x - woods.x, a.point.z - woods.z) -
        Math.hypot(b.point.x - woods.x, b.point.z - woods.z));
    const { point, i } = eligible[0]!;
    expect(bridge.transform.position.x).toBeCloseTo(point.x, 5);
    expect(bridge.transform.position.z).toBeCloseTo(point.z, 5);
    expect(bridge.size).toEqual({ x: 3 * scale, y: 2.6 * scale,
      z: point.width + 6 * scale });
    const before = island.river[Math.max(0, i - 1)]!;
    const after = island.river[Math.min(i + 1, island.river.length - 1)]!;
    const flow = new THREE.Vector2(after.x - before.x, after.z - before.z).normalize();
    const across = new THREE.Vector2(Math.sin(bridge.transform.rotationY),
      Math.cos(bridge.transform.rotationY));
    expect(Math.abs(flow.dot(across))).toBeLessThan(Math.sin(Math.PI / 18));
    const bankDistance = point.width / 2 + 2 * scale;
    const h1 = ground(island, { x: point.x + across.x * bankDistance,
      z: point.z + across.y * bankDistance });
    const h2 = ground(island, { x: point.x - across.x * bankDistance,
      z: point.z - across.y * bankDistance });
    expect(bridge.transform.position.y - bridge.size.y / 2)
      .toBeCloseTo(Math.min(h1, h2) - 0.3 * scale, 4);
    const endA = { x: point.x + across.x * bridge.size.z / 2,
      z: point.z + across.y * bridge.size.z / 2 };
    const endB = { x: point.x - across.x * bridge.size.z / 2,
      z: point.z - across.y * bridge.size.z / 2 };
    const endGrounds = [ground(island, endA), ground(island, endB)];
    console.log('HERO_BRIDGE_DIAG', JSON.stringify({ point, i, lookout: lookout.transform.position,
      bankHeight: [h1, h2], endGrounds, ends: [endA, endB], waterLevel: point.level,
      bottom: bridge.transform.position.y - bridge.size.y / 2 }));
    for (const elevation of endGrounds) {
      expect(elevation, 'bridge end lies on riverbank above water').toBeGreaterThan(point.level);
    }
  });

  it('does not overlap other collidable POI footprints with any newly collidable hero', () => {
    const heroes = island.props.filter(p => HERO_SET.has(p.kind));
    const existing = island.props.filter(p => !HERO_SET.has(p.kind) && p.collidable);
    const clashes: Array<{hero: string; old: string; poi: string; kind: string}> = [];
    for (const prop of heroes) {
      expect(prop.body.type).toBe('static');
      expect(prop.breakable).toBe(false);
      if (prop.kind === 'life-ring') continue; // intentional noncollidable rail mount
      expect(prop.collidable).toBe(true);
      for (const earlier of existing) {
        if (earlier.poiId !== prop.poiId) continue;
        if (aabbFootprintOverlaps(prop, earlier))
          clashes.push({hero:prop.id,old:earlier.id,poi:prop.poiId??'',kind:earlier.kind});
      }
    }
    console.log('HERO_COLLISION_DIAG', JSON.stringify(clashes.slice(0,40)));
    expect(clashes).toEqual([]);
  });
});
