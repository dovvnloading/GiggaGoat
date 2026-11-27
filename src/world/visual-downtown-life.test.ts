import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { generateIsland } from './island';
import { bakeLibraryGeometry } from './visual-hoofington';
import { makeDowntownPlacements, DOWNTOWN_MODELS } from './visual-downtown';
import { buildDowntownLifeVisuals, downtownLifeAnchors } from './visual-downtown-life';
import { downtownWindowGeometry } from './visual-downtown-storefronts';

it('anchors jets inside the fitted fountain and cups on the fitted table tops', () => {
  const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
  const anchors = downtownLifeAnchors(island), plan = makeDowntownPlacements(island);
  const source = plan.find(p => p.model === 'fountain')!;
  expect(anchors.fountain).not.toBeNull();
  const fountain = anchors.fountain!;
  expect(fountain.scale).toBeCloseTo(source.size.y / .48, 5);
  expect(fountain.basinY).toBeGreaterThan(fountain.position.y);
  expect(fountain.nozzleY).toBeLessThan(source.position.y + source.size.y / 2);
  expect(fountain.radius).toBeLessThan(source.size.x / 2);
  for (const [index, table] of plan.filter(p => p.model === 'table').entries()) {
    const anchor = anchors.tables[index]!;
    expect(anchor.position.x).toBe(table.position.x);
    expect(anchor.position.z).toBe(table.position.z);
    // The uniformly fitted kit table is shorter than its slot; do not float
    // a cup on top of the empty remainder of that descriptor box.
    expect(anchor.position.y).toBeLessThan(table.position.y + table.size.y / 2 - .1);
    expect(anchor.position.y).toBeGreaterThan(table.position.y);
  }
});

it('keeps the full fountain spray and ripple envelopes inside their actual basin', () => {
  const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
  const visuals = buildDowntownLifeVisuals(island), fountain = visuals.anchors.fountain!;
  try {
    const particles = visuals.group.getObjectByName('fountain-droplets-and-cafe-steam') as THREE.Points;
    for (const time of [0, .2, 1.1, 53, 480, 1800]) {
      visuals.update(time, 1, 1, new THREE.Vector3().copy(fountain.position));
      const points = particles.geometry.getAttribute('position');
      for (let i = 0; i < 96; i++) {
        expect(Math.hypot(points.getX(i) - fountain.position.x,
          points.getZ(i) - fountain.position.z)).toBeLessThan(fountain.radius);
        expect(points.getY(i)).toBeGreaterThanOrEqual(fountain.basinY - .001);
      }
      const ripples = visuals.group.getObjectByName('fountain-impact-ripples') as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), size = new THREE.Vector3();
      for (let i = 0; i < ripples.count; i++) {
        ripples.getMatrixAt(i, matrix); matrix.decompose(position, rotation, size);
        expect(Math.hypot(position.x - fountain.position.x, position.z - fountain.position.z) + size.x)
          .toBeLessThan(fountain.radius);
      }
    }
  } finally { visuals.dispose(); visuals.dispose(); }
});

it('lights only authored glass triangles at exactly the district baker coordinates', async () => {
  const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
  const placements = makeDowntownPlacements(island).filter(p => p.model === 'cafe');
  const loader = new GLTFLoader().register(() => ({ name: 'test-texture',
    loadTexture: () => Promise.resolve(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)),
  }));
  const source = await loader.parseAsync(Uint8Array.from(readFileSync('public/' + DOWNTOWN_MODELS.cafe)).buffer, '');
  const windows = downtownWindowGeometry(placements, new Map([['cafe', source.scene]]))!;
  const baked = bakeLibraryGeometry(placements, new Map([['cafe', source.scene]]), undefined, DOWNTOWN_MODELS)!;
  try {
    const all = baked.getAttribute('position'), glass = windows.getAttribute('position');
    const keys = new Set<string>();
    const key = (p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
      `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    for (let i = 0; i < all.count; i++) keys.add(key(all, i));
    expect(glass.count).toBeGreaterThan(6);
    expect(glass.count).toBeLessThan(all.count / 5);
    for (let i = 0; i < glass.count; i++) expect(keys.has(key(glass, i))).toBe(true);
    expect(downtownWindowGeometry(placements, new Map())).toBeNull();
  } finally { windows.dispose(); baked.dispose(); }
});

it('selects the interior and lit panes for the active tenant of a shared shell', () => {
  const [shop] = makeDowntownPlacements(generateIsland({ seed: 'billy-isle', resolution: 65 }))
    .filter(p => p.storefront === 'ICE CREAM');
  const root = new THREE.Group();
  const glass = new THREE.MeshBasicMaterial();
  glass.name = 'ShopGlass';
  const placements = ['ICE CREAM', 'HAY MART', undefined];
  for (const [index, title] of placements.entries()) {
    const interior = new THREE.Group();
    interior.userData.storefrontUse = title ?? 'residence';
    interior.position.x = index * 5;
    interior.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glass));
    root.add(interior);
  }
  const models = new Map([['market' as const, root]]);
  const centres = placements.map(storefront => {
    const place = { ...shop!, model: 'market' as const, yaw: 0, storefront };
    const walls = bakeLibraryGeometry([place], models, undefined, DOWNTOWN_MODELS)!;
    const windows = downtownWindowGeometry([place], models)!;
    for (const geometry of [walls, windows]) {
      expect(geometry.getAttribute('position').count).toBe(36);
      geometry.computeBoundingBox();
    }
    expect(windows.boundingBox!.min.x).toBeCloseTo(walls.boundingBox!.min.x, 4);
    const x = walls.boundingBox!.min.x;
    walls.dispose();
    windows.dispose();
    return x;
  });
  expect(centres[0]).toBeLessThan(centres[1]!);
  expect(centres[1]).toBeLessThan(centres[2]!);
  root.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
  glass.dispose();
});
