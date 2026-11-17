import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import {
  DOWNTOWN_MODELS, DOWNTOWN_SIGN_ANCHORS, DOWNTOWN_BUILDING_SIZES,
  SHOP_FRONTS, downtownRearHouseModel, downtownSignGeometry,
  makeDowntownPlacements, makeDowntownSigns,
  type DowntownModel, type DowntownPlacement,
} from './visual-downtown';
import { bakeLibraryGeometry } from './visual-hoofington';
import { isDowntownRoadOverlay } from './render';
import { gridSample } from './terrain';

describe('Downtown Bleatsville sourced streetscape', () => {

  it('loads CC0 models and maps every building to the 11 painted shop GLBs', () => {
    const manifest = JSON.parse(readFileSync(
      'public/assets/library/manifest.json', 'utf8',
    )) as Array<{ path: string; license: string }>;
    for (const [name, path] of Object.entries(DOWNTOWN_MODELS)) {
      expect(path.startsWith('assets/library/'), name).toBe(true);
      expect(/\.(glb|gltf)$/.test(path), name).toBe(true);
      expect(manifest.find(entry => entry.path === path)?.license, name)
        .toBe(name === 'lamp' ? 'Apache-2.0' : 'CC0');
    }
    const buildings = {
      bakery: 'shop-h-pink.glb',
      arcade: 'shop-k-lavender.glb',
      cinema: 'shop-d-mint.glb',
      cafe: 'shop-e-peach.glb',
      market: 'shop-g-yellow.glb',
      boutique: 'shop-j-cream.glb',
      cornerShop: 'shop-b-pink.glb',
      kayShop: 'shop-c-yellow.glb',
      kayHouse: 'shop-f-lavender.glb',
      townhouse: 'shop-l-peach.glb',
      brickHouse: 'shop-m-pink.glb',
      highrise: 'shop-l-peach.glb',
    } as const;
    for (const [model, file] of Object.entries(buildings)) {
      const path = DOWNTOWN_MODELS[model as keyof typeof buildings];
      expect(path, model).toBe('assets/library/custom/downtown-shops/' + file);
      expect(existsSync('public/' + path), model).toBe(true);
      expect(path).not.toMatch(/kaykit|modular-buildings/);
    }
    expect(new Set(Object.values(buildings)).size).toBe(11);
    expect(DOWNTOWN_MODELS.lamp).toBe('assets/library/usdcraft/street-lamp-lantern.glb');
    expect(DOWNTOWN_MODELS.skylineCrane)
      .toBe('assets/library/custom/crane-yard/skyline-tower-crane.glb');
    expect(DOWNTOWN_MODELS.waterTower).toContain('/city-kit-industrial/');
    const vegetation = {
      flowerPink: 'flowers-pink.glb',
      flowerPurple: 'flowers-purple.glb',
      flowerSunny: 'flowers-sunny.glb',
      bushA: 'bush-round-a.glb',
      bushB: 'bush-round-b.glb',
      oakA: 'tree-round-a.glb',
      oakB: 'tree-round-b.glb',
      oakC: 'tree-round-c.glb',
    } as const;
    for (const [model, file] of Object.entries(vegetation)) {
      const path = 'assets/library/custom/hoofington-props/' + file;
      expect(DOWNTOWN_MODELS[model as keyof typeof vegetation], model).toBe(path);
      expect(manifest.find(entry => entry.path === path)?.license, model).toBe('CC0');
      expect(existsSync('public/' + path), model).toBe(true);
    }
  });

  it('replaces ten storefronts, six parkour houses and the tower without moving colliders', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const before = island.props.map(p => ({
      id: p.id, kind: p.kind, transform: structuredClone(p.transform),
      size: structuredClone(p.size),
    }));
    const plan = makeDowntownPlacements(island);
    const linked = plan.filter(p => p.source);
    for (const item of linked.filter(p => p.model === 'lamp')) {
      expect(item.wall).toBeUndefined();
      expect(item.roof).toBeUndefined();
      expect(item.position).toBe(item.source!.transform.position);
    }
    const shops = linked.filter(p => p.source!.kind === 'shop');
    const houses = linked.filter(p => p.source!.kind === 'house');
    expect(shops).toHaveLength(10);
    expect(houses).toHaveLength(6);
    const towers = linked.filter(p => p.source!.kind === 'tower');
    expect(towers).toHaveLength(1);
    // Blender-authored building colours must pass through the baker unchanged.
    for (const p of [...shops, ...houses, ...towers]) {
      expect(p.wall, p.model).toBeUndefined();
      expect(p.roof, p.model).toBeUndefined();
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
    for (const kind of ['lamp', 'bench', 'planter', 'flower',
      'ac-unit', 'water-tower', 'fountain']) {
      expect(linked.some(p => p.source!.kind === kind), kind).toBe(true);
    }
    // The collider descriptors remain, but baked storefront GLBs own the awnings.
    expect(island.props.some(p => p.poiId === 'downtown-bleatsville' &&
      p.kind === 'awning')).toBe(true);
    expect(linked.some(p => p.source!.kind === 'awning')).toBe(false);
    expect(island.props.map(p => ({
      id: p.id, kind: p.kind, transform: p.transform, size: p.size,
    }))).toEqual(before);
    expect(makeDowntownPlacements(island).map(p =>
      [p.model, p.position, p.size, p.wall, p.roof]))
      .toEqual(plan.map(p => [p.model, p.position, p.size, p.wall, p.roof]));
  });


  it('fits every Downtown building to native dimensions at one 8 m/unit scale while keeping facades fixed', () => {
    const exact = {
      cornerShop: { x: 7.76, y: 10.43, z: 9.50 },
      kayShop: { x: 7.12, y: 7.24, z: 10.30 },
      cinema: { x: 6.72, y: 10.43, z: 8.70 },
      cafe: { x: 13.12, y: 7.24, z: 9.82 },
      market: { x: 7.76, y: 13.63, z: 8.70 },
      bakery: { x: 7.07, y: 10.43, z: 9.32 },
      boutique: { x: 17.12, y: 13.63, z: 12.30 },
      arcade: { x: 16.67, y: 11.85, z: 8.79 },
      townhouse: { x: 11.36, y: 18.25, z: 12.71 },
      brickHouse: { x: 9.92, y: 25.29, z: 11.51 },
      kayHouse: { x: 6.72, y: 13.63, z: 9.50 },
    } as const;
    expect(DOWNTOWN_BUILDING_SIZES).toEqual(exact);
    for (const size of [400, 600, 900]) {
      const island = generateIsland({ seed: 'billy-isle', size, resolution: 97 });
      const scale = island.size / 600;
      const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
      const plan = makeDowntownPlacements(island);
      const shops = plan.filter(p => p.source?.kind === 'shop');
      const houses = plan.filter(p => p.source?.kind === 'house');
      expect(shops).toHaveLength(10);
      expect(houses).toHaveLength(6);
      const assertBox = (placement: DowntownPlacement, model: keyof typeof exact,
        oldCentre: number, oldDepth: number, side: number, dz: number): void => {
        expect(placement.model).toBe(model);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(Math.abs(placement.size[axis] - exact[model][axis] * scale),
            model + ' ' + axis).toBeLessThan(0.01 * scale);
        }
        expect(placement.yaw).toBeCloseTo(-side * Math.PI / 2, 6);
        expect(placement.position.z - centre.z).toBeCloseTo(dz * scale, 5);
        const frontX = placement.position.x + Math.sin(placement.yaw) *
          placement.size.z / 2;
        // Keep the exact pavement-facing plane, moving only the rear wall.
        expect(frontX - centre.x).toBeCloseTo(side *
          (oldCentre - oldDepth / 2) * scale, 5);
      };
      for (let row = 0; row < 5; row++) for (const side of [-1, 1]) {
        const dz = (row - 2) * 19;
        const placement = shops.find(p =>
          (p.position.x - centre.x) * side > 0 &&
          Math.abs(p.position.z - centre.z - dz * scale) < 0.001);
        expect(placement, 'storefront row ' + row + ' side ' + side).toBeDefined();
        assertBox(placement!, SHOP_FRONTS[side < 0 ? 0 : 1]![row]!.model,
          20, 11.4, side, dz);
      }
      for (const dz of [-19, 0, 19]) for (const side of [-1, 1]) {
        const placement = houses.find(p =>
          (p.position.x - centre.x) * side > 0 &&
          Math.abs(p.position.z - centre.z - dz * scale) < 0.001);
        expect(placement, 'rear house at ' + dz + ', ' + side).toBeDefined();
        assertBox(placement!, downtownRearHouseModel(dz), 36, 11.5, side, dz);
      }
      const towers = plan.filter(p => p.source?.kind === 'tower');
      expect(towers).toHaveLength(1);
      expect(towers[0]!.size).toEqual({ x: 8 * scale, y: 27 * scale, z: 8 * scale });
      const buildings = [...shops, ...houses, ...towers];
      const footprint = (p: DowntownPlacement): { x: number; z: number } => ({
        x: (Math.abs(Math.cos(p.yaw)) * p.size.x +
          Math.abs(Math.sin(p.yaw)) * p.size.z) / 2,
        z: (Math.abs(Math.sin(p.yaw)) * p.size.x +
          Math.abs(Math.cos(p.yaw)) * p.size.z) / 2,
      });
      // Horizontal boxes may touch but must never intersect, including the tower.
      for (let i = 0; i < buildings.length; i++) {
        const a = buildings[i]!, aa = footprint(a);
        for (const b of buildings.slice(i + 1)) {
          const bb = footprint(b);
          const overlap = Math.abs(a.position.x - b.position.x) <
            aa.x + bb.x - 0.001 * scale &&
            Math.abs(a.position.z - b.position.z) < aa.z + bb.z - 0.001 * scale;
          expect(overlap, a.model + ' and ' + b.model).toBe(false);
        }
      }
    }
  });

  it('derives facade ornaments and rooftop equipment from each resized roof', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const scale = island.size / 600;
    const buildings = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
      (p.kind === 'shop' || p.kind === 'house'));
    const details = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
      p.id.startsWith('detail-'));
    expect(buildings).toHaveLength(16);
    const findAt = (kind: string, x: number, z: number) => details.find(p =>
      p.kind === kind && Math.hypot(p.transform.position.x - x,
        p.transform.position.z - z) < 0.01);
    for (const [i, building] of buildings.entries()) {
      const { x, z } = building.transform.position;
      const yaw = building.transform.rotationY;
      const frontX = Math.sin(yaw), frontZ = Math.cos(yaw);
      const roof = building.transform.position.y + building.size.y / 2;
      const ac = findAt('ac-unit', x - frontX * 1.8 * scale,
        z - frontZ * 1.8 * scale);
      expect(ac, building.id + ' AC').toBeDefined();
      expect(ac!.transform.position.y - ac!.size.y / 2,
        building.id + ' AC base').toBeCloseTo(roof, 5);
      const facade = building.size.z / 2;
      const awning = findAt('awning', x + frontX * (facade + 1 * scale),
        z + frontZ * (facade + 1 * scale));
      const sign = findAt('signboard', x + frontX * (facade + 0.35 * scale),
        z + frontZ * (facade + 0.35 * scale));
      expect(awning, building.id + ' awning').toBeDefined();
      expect(sign, building.id + ' sign').toBeDefined();
      expect(awning!.transform.position.y, building.id + ' awning height')
        .toBeCloseTo(roof - 3 * scale, 5);
      expect(sign!.transform.position.y, building.id + ' sign height')
        .toBeCloseTo(roof - 1.6 * scale, 5);
      if (i % 4 === 0) {
        const waterTower = findAt('water-tower', x - frontX * 1.7 * scale,
          z - frontZ * 1.7 * scale);
        expect(waterTower, building.id + ' roof water tower').toBeDefined();
        expect(waterTower!.transform.position.y - waterTower!.size.y / 2)
          .toBeCloseTo(roof, 5);
      }
    }
  });

  it('cycles authored vegetation variants without changing placement paint', () => {
    const plan = makeDowntownPlacements(generateIsland({
      seed: 'billy-isle', resolution: 97,
    }));
    const families: readonly (readonly DowntownModel[])[] = [
      ['flowerPink', 'flowerPurple', 'flowerSunny'],
      ['bushA', 'bushB'],
      ['oakA', 'oakB', 'oakC'],
    ];
    for (const variants of families) {
      const placements = plan.filter(p => variants.includes(p.model));
      expect(placements.length).toBeGreaterThanOrEqual(variants.length);
      for (const [index, placement] of placements.entries()) {
        expect(placement.model).toBe(variants[index % variants.length]);
        expect(placement.wall).toBeUndefined();
        expect(placement.roof).toBeUndefined();
      }
    }
  });

  it('keeps street details, but only two 45%-thickness garlands and no striped overlay', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const scale = island.size / 600;
    const signs = makeDowntownSigns(island);
    expect(signs).toHaveLength(10);
    for (const name of ['BAAKERY', 'CAFE', 'KID ARCADE', 'HOOF & CO', 'HAY MART'])
      expect(signs.map(s => s.title)).toContain(name);

    const plan = makeDowntownPlacements(island);
    const garlands = plan.filter(p => p.model === 'lights')
      .sort((a, b) => a.position.z - b.position.z);
    expect(garlands.map(p =>
      Math.round((p.position.z - centre.z) / scale))).toEqual([-14, 6]);
    for (const garland of garlands) {
      expect(garland.size.x).toBeCloseTo(27 * scale, 6);
      expect(garland.size.y).toBeCloseTo(0.36 * 0.45 * scale, 6);
      expect(garland.size.z).toBeCloseTo(0.28 * 0.45 * scale, 6);
    }
    const skyline = plan.filter(p => p.model === 'skylineCrane');
    expect(skyline).toHaveLength(1);
    expect(skyline[0]!.wall).toBeUndefined();
    const crane = skyline[0]!;
    expect(crane.size).toEqual({ x: 19 * scale, y: 22 * scale, z: 8 * scale });
    expect(crane.position.x).toBeCloseTo(centre.x + 32 * scale, 6);
    expect(crane.position.z).toBeCloseTo(centre.z - 48 * scale, 6);
    // DT-1: the bottom of the 22 m crane meets terrain, not ground + 16 m.
    expect(crane.position.y - crane.size.y / 2).toBeCloseTo(
      gridSample(island, crane.position.x, crane.position.z), 6);
    for (const model of ['retroWindow', 'retroBalcony', 'canopy', 'retroCanopy'])
      expect(plan.filter(p => p.model === model), model).toHaveLength(0);
    // Sidewalk planting remains, but no extra facade window-box flower overlays.
    expect(plan.filter(p => p.model.startsWith('flower')).length).toBeGreaterThan(0);
    expect(plan.filter(p => (p.model === 'planter' || p.model.startsWith('flower')) &&
      !p.source)).toHaveLength(0);
    for (const model of ['table','chair','trash','cone','bread','produce','clothes','oakA'])
      expect(plan.some(p => p.model === model), model).toBe(true);
    const furniture = plan.filter(p => ['table','chair','trash','bread',
      'produce','clothes'].includes(p.model));
    expect(furniture.every(p =>
      Math.abs(p.position.x - centre.x) >= 13 * scale)).toBe(true);
    const renderer = readFileSync('src/world/visual-downtown.ts', 'utf8');
    expect(renderer).not.toContain('stripedAwningGeometry');
    expect(renderer).not.toContain('downtown-striped-awnings');
  });

  it('anchors each shop label flush to its model-specific cream sign board', () => {
    expect(DOWNTOWN_SIGN_ANCHORS).toEqual({
      bakery: { centre: 0.318, halfHeight: 0.029 },
      arcade: { centre: 0.280, halfHeight: 0.026 },
      cinema: { centre: 0.318, halfHeight: 0.029 },
      cafe: { centre: 0.335, halfHeight: 0.030 },
      market: { centre: 0.243, halfHeight: 0.022 },
      boutique: { centre: 0.243, halfHeight: 0.022 },
      cornerShop: { centre: 0.318, halfHeight: 0.029 },
      kayShop: { centre: 0.335, halfHeight: 0.030 },
      kayHouse: { centre: 0.243, halfHeight: 0.022 },
      townhouse: { centre: 0.182, halfHeight: 0.017 },
      brickHouse: { centre: 0.131, halfHeight: 0.012 },
      highrise: { centre: 0.182, halfHeight: 0.017 },
    });
    const signs = makeDowntownSigns(generateIsland({
      seed: 'billy-isle', resolution: 97,
    }));
    expect(signs.every(s => s.background === 0xf6ead2 && s.ink === 0x543b3d))
      .toBe(true);
    const geometry = downtownSignGeometry(signs);
    const positions = geometry.getAttribute('position');
    expect(positions.count).toBe(signs.length * 4);
    expect(geometry.index!.count).toBe(signs.length * 6);
    for (let i = 0; i < signs.length; i++) {
      const sign = signs[i]!, p = sign.source;
      const anchor = DOWNTOWN_SIGN_ANCHORS[sign.model];
      const yaw = p.transform.rotationY;
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const vertices = Array.from({ length: 4 }, (_, j) =>
        new THREE.Vector3().fromBufferAttribute(positions, i * 4 + j));
      const center = vertices.reduce((sum, point) => sum.add(point),
        new THREE.Vector3()).multiplyScalar(0.25);
      const expected = new THREE.Vector3(
        p.transform.position.x,
        p.transform.position.y - p.size.y / 2 + anchor.centre * p.size.y,
        p.transform.position.z,
      ).addScaledVector(forward, p.size.z / 2 + 0.04);
      expect(center.distanceTo(expected), sign.model).toBeLessThan(0.0002);
      expect(vertices[1]!.clone().sub(vertices[0]!).dot(right), sign.model)
        .toBeCloseTo(0.80 * p.size.x, 3);
      expect(vertices[3]!.y - vertices[0]!.y, sign.model)
        .toBeCloseTo(2 * anchor.halfHeight * p.size.y, 3);
      expect(center.clone().sub(new THREE.Vector3(
        p.transform.position.x, center.y, p.transform.position.z,
      )).dot(forward) - p.size.z / 2).toBeCloseTo(0.04, 3);
    }
    geometry.dispose();
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
        size: { x: 11, y: 12, z: 11.4 }, yaw: Math.PI / 2 },
      { model: 'bakery', position: { x: 19, y: 8, z: 20 },
        size: { x: 11, y: 10, z: 11.4 }, yaw: -Math.PI / 2 },
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
    // Neither authored material is tinted toward a storefront wall/roof color.
    const authored = [new THREE.Color(0xffffff), new THREE.Color(0x647995)];
    const seen = new Set<number>();
    for (let i = 0; i < colours.count; i++) {
      const match = authored.findIndex(color =>
        Math.abs(colours.getX(i) - color.r) < 0.00001 &&
        Math.abs(colours.getY(i) - color.g) < 0.00001 &&
        Math.abs(colours.getZ(i) - color.b) < 0.00001);
      expect(match).toBeGreaterThanOrEqual(0);
      seen.add(match);
    }
    expect(seen.size).toBe(2);
    baked.dispose();
    plaster.geometry.dispose(); cap.geometry.dispose();
    (plaster.material as THREE.Material).dispose();
    (cap.material as THREE.Material).dispose();
  });

  it('preserves authored vegetation colours even with legacy paint overrides', () => {
    const variants: DowntownModel[] = [
      'flowerPink', 'flowerPurple', 'flowerSunny',
      'bushA', 'bushB', 'oakA', 'oakB', 'oakC',
    ];
    const sourceColour = new THREE.Color(0x4c9c68);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: sourceColour }));
    const prefab = new THREE.Group();
    prefab.add(mesh);
    const models = new Map<DowntownModel, THREE.Group>(
      variants.map(model => [model, prefab] as const));
    const placements: DowntownPlacement[] = variants.map((model, index) => ({
      model, position: { x: index * 2, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 }, yaw: 0,
      wall: 0xff00ff, roof: 0x00ffff,
    }));
    const baked = bakeLibraryGeometry(placements, models)!;
    const colours = baked.getAttribute('color');
    expect(colours.count).toBe(variants.length *
      (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count));
    for (let i = 0; i < colours.count; i++) {
      expect(colours.getX(i)).toBeCloseTo(sourceColour.r, 6);
      expect(colours.getY(i)).toBeCloseTo(sourceColour.g, 6);
      expect(colours.getZ(i)).toBeCloseTo(sourceColour.b, 6);
    }
    baked.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
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
