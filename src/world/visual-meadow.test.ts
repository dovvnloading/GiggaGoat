import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRANE_YARD_PLAN } from './crane-yard';
import { generateIsland } from './index';
import { makeLocalStreets } from './roads';
import { buildMeadowScatter } from './visual-meadow';
import { gridSample } from './terrain';

const GRASS_CLUMP_PATH = 'assets/library/custom/hoofington-props/grass-clump.glb';
type LoadedGLTF = Awaited<ReturnType<GLTFLoader['loadAsync']>>;

// Nine three-triangle blades split across two authored materials. The baker
// must flatten both meshes and combine their material and vertex paint.
function paintedClump(): LoadedGLTF {
  const scene = new THREE.Group();
  for (let part = 0; part < 2; part++) {
    const positions: number[] = [], colors: number[] = [];
    for (let blade = part === 0 ? 0 : 5; blade < (part === 0 ? 5 : 9); blade++) {
      const angle = blade * Math.PI * 2 / 9;
      for (let segment = 0; segment < 3; segment++) {
        const low = segment * 0.4 / 3;
        const high = (segment + 1) * 0.4 / 3;
        positions.push(
          Math.cos(angle) * 0.3, low, Math.sin(angle) * 0.3,
          Math.cos(angle + 0.12) * 0.3, high, Math.sin(angle + 0.12) * 0.3,
          Math.cos(angle + 0.24) * 0.3, low, Math.sin(angle + 0.24) * 0.3,
        );
        for (let vertex = 0; vertex < 3; vertex++) colors.push(0.8, 0.9, 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: part === 0 ? 0x75b754 : 0x3e8d49, vertexColors: true,
    })));
  }
  return { scene } as LoadedGLTF;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

function grass(group: THREE.Group): THREE.InstancedMesh {
  const mesh = group.getObjectByName('meadow-grass-sprigs');
  expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
  return mesh as THREE.InstancedMesh;
}

function dispose(group: THREE.Group): void {
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => material.dispose());
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('island meadow painted clumps and paved-area exclusions (IS-19)', () => {
  it('keeps the two-octahedron fallback until GLB load, then bakes 27 painted triangles into one draw', async () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    vi.stubGlobal('document', {});
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockImplementation(async () => paintedClump());
    const group = buildMeadowScatter(island);
    try {
      const tuft = grass(group);
      const flowers = group.getObjectByName('meadow-daisy-flowers') as THREE.InstancedMesh;
      const fallback = tuft.geometry;
      expect(triangleCount(fallback)).toBe(16);
      expect(tuft.instanceColor).not.toBeNull();
      expect((tuft.material as THREE.MeshToonMaterial).vertexColors).toBe(false);
      expect(group.children).toHaveLength(2);
      expect(flowers).toBeInstanceOf(THREE.InstancedMesh);
      expect(flowers.count).toBeGreaterThan(100);
      expect(flowers.geometry.getAttribute('color')).toBeDefined();

      await vi.waitFor(() => expect(triangleCount(tuft.geometry)).toBe(27));
      expect(load).toHaveBeenCalledTimes(1);
      expect(load.mock.calls[0]![0]).toContain(GRASS_CLUMP_PATH);
      expect(tuft.geometry).not.toBe(fallback);
      expect(tuft.geometry.index).toBeNull();
      expect(tuft.geometry.getAttribute('position').count).toBe(81);
      const paint = tuft.geometry.getAttribute('color') as THREE.BufferAttribute;
      expect(paint.count).toBe(81);
      const materialColor = new THREE.Color(0x75b754);
      expect(paint.getX(0)).toBeCloseTo(materialColor.r * 0.8, 5);
      expect(paint.getY(0)).toBeCloseTo(materialColor.g * 0.9, 5);
      expect(paint.getZ(0)).toBeCloseTo(materialColor.b, 5);
      expect(paint.getX(60)).not.toBeCloseTo(paint.getX(0), 2);
      expect(tuft.instanceColor).toBeNull(); // GLB paint, not old randomized tint
      expect((tuft.material as THREE.MeshToonMaterial).vertexColors).toBe(true);
      expect(group.children.filter(node => node instanceof THREE.InstancedMesh))
        .toHaveLength(2);
      expect(group.children.filter(node => node.name === 'meadow-grass-sprigs'))
        .toEqual([tuft]); // Still one grass draw, same name and count.
      expect(tuft.count).toBeGreaterThan(1000);
    } finally {
      dispose(group);
    }
  });

  it.each([
    { seed: 'billy-isle', size: 600, resolution: 97 },
    { seed: 'is19-second-seed', size: 820, resolution: 97 },
  ])('keeps every grass centre off roads, Downtown paving, and Crane Yard on $seed ($size m)', async options => {
    const island = generateIsland(options);
    const scale = island.size / 600;
    const downtown = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const craneYard = island.pois.find(p => p.id === 'crane-yard')!.center;
    const roadPoints = [...island.roads, ...makeLocalStreets(island)].flatMap(road =>
      road.points.map(point => ({
        x: point.x, z: point.z,
        radiusSquared: (road.width * 0.5 + 3.4 * scale) ** 2,
      })));
    vi.stubGlobal('document', {});
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(
      async () => paintedClump());
    const group = buildMeadowScatter(island);
    try {
      const tuft = grass(group);
      const before = new THREE.Matrix4(), initial = new THREE.Vector3();
      const originalCentres: THREE.Vector3[] = [];
      for (let i = 0; i < tuft.count; i++) {
        tuft.getMatrixAt(i, before);
        originalCentres.push(initial.clone().setFromMatrixPosition(before));
      }
      await vi.waitFor(() => expect(triangleCount(tuft.geometry)).toBe(27));
      expect(tuft.count).toBeGreaterThan(1000);
      expect(tuft.count).toBeLessThanOrEqual(
        Math.min(3500, Math.round(1900 * scale)));
      const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
      const rotation = new THREE.Quaternion(), dimensions = new THREE.Vector3();
      const distinctScales = new Set<string>();
      for (let i = 0; i < tuft.count; i++) {
        tuft.getMatrixAt(i, matrix);
        matrix.decompose(p, rotation, dimensions);
        expect(p.distanceTo(originalCentres[i]!), 'position ' + i).toBeLessThan(0.0001);
        expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
        const intersectsRoad = roadPoints.some(road =>
          (p.x - road.x) ** 2 + (p.z - road.z) ** 2 < road.radiusSquared - 0.001);
        expect(intersectsRoad, 'road/sidewalk sprig ' + i).toBe(false);
        expect((p.x - downtown.x) ** 2 + (p.z - downtown.z) ** 2,
          'Downtown plot sprig ' + i).toBeGreaterThanOrEqual((38 * scale) ** 2 - 0.001);
        const insideCraneYard =
          Math.abs(p.x - craneYard.x) < CRANE_YARD_PLAN.halfWidth * scale - 0.001 &&
          Math.abs(p.z - craneYard.z) < CRANE_YARD_PLAN.halfDepth * scale - 0.001;
        expect(insideCraneYard, 'Crane Yard sprig ' + i).toBe(false);
        expect(dimensions.x).toBeGreaterThanOrEqual(0.8 - 0.00001);
        expect(dimensions.x).toBeLessThanOrEqual(1.3 + 0.00001);
        expect(dimensions.y).toBeCloseTo(dimensions.x, 5);
        expect(dimensions.z).toBeCloseTo(dimensions.x, 5);
        distinctScales.add(dimensions.x.toFixed(3));
        const yaw = ((2 * Math.atan2(rotation.y, rotation.w)) %
          (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        expect(yaw).toBeGreaterThanOrEqual(0);
        expect(yaw).toBeLessThan(2 * Math.PI);
      }
      expect(distinctScales.size).toBeGreaterThan(100);
      expect(group.children.filter(node => node.name === 'meadow-grass-sprigs'))
        .toEqual([tuft]);
      expect(group.children).toHaveLength(2);
    } finally {
      dispose(group);
    }
  });

  it('hashes each position deterministically without new RNG draws', async () => {
    const island = generateIsland({ seed: 'is19-determinism', resolution: 97 });
    vi.stubGlobal('document', {});
    vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockImplementation(async () => paintedClump());
    const a = buildMeadowScatter(island), b = buildMeadowScatter(island);
    try {
      const one = grass(a), two = grass(b);
      await vi.waitFor(() => {
        expect(triangleCount(one.geometry)).toBe(27);
        expect(triangleCount(two.geometry)).toBe(27);
      });
      expect(one.count).toBe(two.count);
      expect(Array.from(one.instanceMatrix.array)).toEqual(
        Array.from(two.instanceMatrix.array));
    } finally {
      dispose(a);
      dispose(b);
    }
  });

  it('never throws or replaces the visible tufts when the GLB is unavailable or invalid', async () => {
    const island = generateIsland({ seed: 'failure-fallback', resolution: 97 });
    vi.stubGlobal('document', {});
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ scene: new THREE.Group() } as LoadedGLTF);
    const offline = buildMeadowScatter(island), invalid = buildMeadowScatter(island);
    try {
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
      await Promise.resolve();
      await Promise.resolve();
      for (const group of [offline, invalid]) {
        const tuft = grass(group);
        expect(triangleCount(tuft.geometry)).toBe(16);
        expect(tuft.instanceColor).not.toBeNull();
        expect(group.children).toHaveLength(2);
      }
    } finally {
      dispose(offline);
      dispose(invalid);
    }
  });
});

describe('themed boardwalk kiosks are meadow architecture exclusions', () => {
  it('rejects meadow sprigs within every themed kiosk footprint and margin', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const kinds = [
      'kiosk-icecream', 'kiosk-popcorn', 'kiosk-games',
      'kiosk-prizes', 'kiosk-candy',
    ] as const;
    const dispose = (group: THREE.Group): void => {
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      });
    };
    const baseline = buildMeadowScatter(island);
    const anchors: Array<{ x: number; z: number }> = [];
    try {
      const sprigs = baseline.getObjectByName('meadow-grass-sprigs') as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
      for (let i = 0; i < sprigs.count && anchors.length < kinds.length; i++) {
        sprigs.getMatrixAt(i, matrix);
        p.setFromMatrixPosition(matrix);
        if (anchors.every(a => Math.hypot(a.x - p.x, a.z - p.z) > 20))
          anchors.push({ x: p.x, z: p.z });
      }
      expect(anchors).toHaveLength(kinds.length);
    } finally {
      dispose(baseline);
    }
    const obstacles = kinds.map((kind, i) => {
      const source = island.props.find(p => p.kind === kind)!;
      const { x, z } = anchors[i]!;
      island.props.push({
        ...source, id: 'meadow-test-' + kind,
        transform: { position: { x, y: gridSample(island, x, z) +
          source.size.y / 2, z }, rotationY: source.transform.rotationY },
      });
      return { x, z, radius: Math.hypot(source.size.x, source.size.z) * 0.53 + 1.5 };
    });
    const scattered = buildMeadowScatter(island);
    try {
      const sprigs = scattered.getObjectByName('meadow-grass-sprigs') as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
      for (let i = 0; i < sprigs.count; i++) {
        sprigs.getMatrixAt(i, matrix);
        p.setFromMatrixPosition(matrix);
        for (const obstacle of obstacles) {
          expect(Math.hypot(p.x - obstacle.x, p.z - obstacle.z),
            'sprig ' + i + ' grows inside a kiosk').toBeGreaterThanOrEqual(
            obstacle.radius - 1e-4);
        }
      }
    } finally {
      dispose(scattered);
    }
  });
});
