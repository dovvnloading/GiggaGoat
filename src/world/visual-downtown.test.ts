import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import {
  DOWNTOWN_MODELS, makeDowntownPlacements, makeDowntownSigns,
  stripedAwningGeometry, type DowntownModel, type DowntownPlacement,
} from './visual-downtown';
import { bakeLibraryGeometry } from './visual-hoofington';
import { isDowntownRoadOverlay } from './render';

describe('Downtown Bleatsville sourced streetscape', () => {
  it('loads only CC0 library models from the required city, shop and furniture packs', () => {
    const manifest = JSON.parse(readFileSync(
      'public/assets/library/manifest.json', 'utf8',
    )) as Array<{ path: string; license: string }>;
    for (const [name, path] of Object.entries(DOWNTOWN_MODELS)) {
      expect(path.startsWith('assets/library/'), name).toBe(true);
      expect(/\.(glb|gltf)$/.test(path), name).toBe(true);
      expect(manifest.find(entry => entry.path === path)?.license, name).toBe('CC0');
    }
    for (const pack of ['city-kit-commercial', 'retro-urban-kit',
      'modular-buildings', 'city-builder-bits', 'city-kit-roads',
      'furniture-kit', 'mini-shop', 'furniture-bits']) {
      expect(Object.values(DOWNTOWN_MODELS).some(path =>
        path.includes('/' + pack + '/')), pack).toBe(true);
    }
    expect(DOWNTOWN_MODELS.skylineCrane).toContain('/factory-kit/');
    expect(DOWNTOWN_MODELS.waterTower).toContain('/city-kit-industrial/');
  });

  it('replaces ten storefronts, six parkour houses and the tower without moving colliders', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const before = island.props.map(p => ({
      id: p.id, kind: p.kind, transform: structuredClone(p.transform),
      size: structuredClone(p.size),
    }));
    const plan = makeDowntownPlacements(island);
    const linked = plan.filter(p => p.source);
    const shops = linked.filter(p => p.source!.kind === 'shop');
    const houses = linked.filter(p => p.source!.kind === 'house');
    expect(shops).toHaveLength(10);
    expect(houses).toHaveLength(6);
    expect(linked.filter(p => p.source!.kind === 'tower')).toHaveLength(1);
    expect(new Set(shops.map(p => p.wall)).size).toBeGreaterThanOrEqual(6);
    expect(shops.some(p => p.model === 'bakery' && p.wall === 0xf08cae)).toBe(true);
    expect(shops.some(p => p.model === 'arcade' && p.wall === 0xd08cdd)).toBe(true);
    for (const p of [...shops, ...houses]) {
      expect(p.position).toBe(p.source!.transform.position);
      expect(p.size).toBe(p.source!.size);
      expect(p.yaw).toBe(p.source!.transform.rotationY);
      const roof = p.position.y + p.size.y / 2;
      const collider = island.colliders.find(c =>
        c.shape !== 'heightfield' && c.id === p.source!.id);
      expect(collider).toBeDefined();
      if (collider?.shape !== 'heightfield')
        expect(collider!.transform.position.y + collider!.size.y / 2).toBe(roof);
    }
    for (const kind of ['lamp', 'bench', 'planter', 'flower', 'awning',
      'ac-unit', 'water-tower', 'fountain']) {
      expect(linked.some(p => p.source!.kind === kind), kind).toBe(true);
    }
    expect(island.props.map(p => ({
      id: p.id, kind: p.kind, transform: p.transform, size: p.size,
    }))).toEqual(before);
    expect(makeDowntownPlacements(island).map(p =>
      [p.model, p.position, p.size, p.wall, p.roof]))
      .toEqual(plan.map(p => [p.model, p.position, p.size, p.wall, p.roof]));
  });

  it('has readable bakery/cafe signs, pavilion details and open traffic lanes', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const signs = makeDowntownSigns(island);
    expect(signs).toHaveLength(10);
    expect(signs.map(s => s.title)).toContain('BAAKERY');
    expect(signs.map(s => s.title)).toContain('CAFE');
    expect(signs.map(s => s.title)).toContain('KID ARCADE');
    expect(signs.map(s => s.title)).toContain('HOOF & CO');
    expect(signs.map(s => s.title)).toContain('HAY MART');
    const plan = makeDowntownPlacements(island);
    expect(plan.filter(p => p.model === 'lights')).toHaveLength(4);
    expect(plan.filter(p => p.model === 'skylineCrane')).toHaveLength(1);
    expect(plan.filter(p => p.model === 'retroWindow').length).toBeGreaterThan(10);
    expect(plan.filter(p => p.model === 'flower').length).toBeGreaterThan(30);
    for (const model of ['table','chair','trash','cone','bread','produce','clothes','oak']) {
      expect(plan.some(p => p.model === model), model).toBe(true);
    }
    // Sidewalk furniture stays beyond x = +/-13; street lamps already
    // occupy their existing x = +/-10.8 curb positions.
    const furniture = plan.filter(p => ['table','chair','trash','bread',
      'produce','clothes'].includes(p.model));
    expect(furniture.every(p =>
      Math.abs(p.position.x - centre.x) >= 13 * island.size / 600)).toBe(true);
    const stripe = stripedAwningGeometry(signs.map(s => s.source));
    const positions = stripe.getAttribute('position');
    const colors = stripe.getAttribute('color');
    expect(positions.count).toBe(10 * 12 * 4 * 3);
    expect(colors.count).toBe(positions.count);
    expect(new Set(Array.from({ length: colors.count }, (_, i) =>
      colors.getX(i).toFixed(3))).size).toBeGreaterThan(2);
    stripe.dispose();
  });

  it('bakes texture-ready multi-material assets into one roof-aligned static draw', () => {
    const prefab = new THREE.Group();
    const plaster = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff }));
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2),
      new THREE.MeshStandardMaterial({ color: 0x647995 }));
    cap.position.y = 1.05;
    prefab.add(plaster, cap);
    const models = new Map<DowntownModel, THREE.Group>([['bakery', prefab]]);
    const shops: DowntownPlacement[] = [
      { model: 'bakery', position: { x: -19, y: 9, z: 20 },
        size: { x: 11, y: 12, z: 11.4 }, yaw: Math.PI / 2,
        wall: 0xf08cae, roof: 0x53667f },
      { model: 'bakery', position: { x: 19, y: 8, z: 20 },
        size: { x: 11, y: 10, z: 11.4 }, yaw: -Math.PI / 2,
        wall: 0xa9e2d7, roof: 0x5c8aa7 },
    ];
    const baked = bakeLibraryGeometry(shops, models)!;
    expect(baked).toBeInstanceOf(THREE.BufferGeometry);
    const points = baked.getAttribute('position');
    const colours = baked.getAttribute('color');
    expect(points.count).toBeGreaterThan(50);
    expect(colours.count).toBe(points.count);
    expect(baked.getAttribute('normal').count).toBe(points.count);
    const box = new THREE.Box3().setFromBufferAttribute(points as THREE.BufferAttribute);
    expect(box.min.x).toBeGreaterThan(-19 - 11 / 2 - 0.001);
    expect(box.max.x).toBeLessThan(19 + 11 / 2 + 0.001);
    expect(box.max.y).toBeLessThan(9 + 12 / 2 + 0.001);
    expect(box.min.y).toBeGreaterThan(9 - 12 / 2 - 0.001);
    expect(new Set(Array.from({ length: colours.count }, (_, i) =>
      colours.getX(i).toFixed(3))).size).toBeGreaterThan(1);
    baked.dispose();
    plaster.geometry.dispose(); cap.geometry.dispose();
    (plaster.material as THREE.Material).dispose();
    (cap.material as THREE.Material).dispose();
  });

  it('keeps the existing instancing and collider counts in non-browser consumers', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const oldCount = island.props.length, colliderCount = island.colliders.length;
    const scene = createWorldScene(island);
    const root = scene.group.getObjectByName('downtown-library-models');
    expect(root).toBeInstanceOf(THREE.Group);
    expect(root!.children).toHaveLength(0);
    for (const kind of ['shop', 'house', 'tower', 'lamp', 'awning', 'signboard']) {
      const mesh = scene.group.getObjectByName('props-' + kind);
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect((mesh as THREE.InstancedMesh).count)
        .toBe(island.props.filter(p => p.kind === kind).length);
    }
    expect(island.props).toHaveLength(oldCount);
    expect(island.colliders).toHaveLength(colliderCount);
    scene.dispose();
  });
  it('does not render inter-POI road fans over the local city street', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const allRoads = island.roads.map(r => structuredClone(r));
    const city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const overlapping = island.roads.flatMap(road => road.points.slice(1).map((b, i) =>
      isDowntownRoadOverlay(island, road.id, road.points[i]!, b)))
      .filter(Boolean).length;
    expect(overlapping).toBeGreaterThan(5);
    expect(isDowntownRoadOverlay(island, 'downtown-bleatsville-main-street',
      { x: city.x, z: city.z - 10 }, { x: city.x, z: city.z + 10 })).toBe(false);
    expect(isDowntownRoadOverlay(island, 'road-far-away--other',
      { x: city.x + 65, z: city.z }, { x: city.x + 75, z: city.z })).toBe(false);
    // The culling decision is used only by the Three.js draw adapter.
    expect(island.roads).toEqual(allRoads);
    expect(island.roads.some(r => r.from === 'downtown-bleatsville')).toBe(true);
  });

});
