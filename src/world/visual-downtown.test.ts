import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWorldScene, generateIsland } from './index';
import {
  DOWNTOWN_MODELS, DOWNTOWN_BUILDING_SIZES,
  DOWNTOWN_INFILL, SHOP_FRONTS, downtownRearHouseModel,
  makeDowntownPlacements,
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
    } as const;
    for (const [model, file] of Object.entries(buildings)) {
      const path = DOWNTOWN_MODELS[model as keyof typeof buildings];
      expect(path, model).toBe('assets/library/custom/downtown-shops/' + file);
      expect(existsSync('public/' + path), model).toBe(true);
      expect(path).not.toMatch(/kaykit|modular-buildings/);
    }
    expect(new Set(Object.values(buildings)).size).toBe(11);
    expect(DOWNTOWN_MODELS.lamp).toBe('assets/library/usdcraft/street-lamp-lantern.glb');
    expect(DOWNTOWN_MODELS.waterTower)
      .toBe('assets/library/custom/town/water-tower-timber.glb');
    expect(existsSync('public/' + DOWNTOWN_MODELS.waterTower)).toBe(true);
    for (const [model, path] of Object.entries({
      ac: 'assets/library/custom/town/ac-unit.glb',
      planter: 'assets/library/custom/town/planter.glb',
      bench: 'assets/library/custom/town/park-bench.glb',
      highrise: 'assets/library/custom/town/downtown-tower.glb',
      lights: 'assets/library/custom/crane-yard/bunting.glb',
    })) {
      expect(DOWNTOWN_MODELS[model as keyof typeof DOWNTOWN_MODELS], model).toBe(path);
      expect(manifest.find(entry => entry.path === path)?.license, model).toBe('CC0');
      expect(existsSync('public/' + path), model).toBe(true);
    }
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

  it('replaces ten storefronts, six rear houses, infills and tower without moving colliders', () => {
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
    expect(houses).toHaveLength(6 + DOWNTOWN_INFILL.length);
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
    const benches = linked.filter(p => p.model === 'bench');
    expect(benches.length).toBeGreaterThan(0);
    for (const bench of benches) {
      expect(bench.position).toBe(bench.source!.transform.position);
      expect(bench.size).toBe(bench.source!.size);
      expect(bench.yaw).toBeCloseTo(bench.source!.transform.rotationY + Math.PI, 6);
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
      const houses = plan.filter(p => p.source?.kind === 'house' &&
        Math.abs(p.position.x - centre.x) >= 30 * scale);
      const infills = plan.filter(p => p.source?.kind === 'house' &&
        Math.abs(p.position.x - centre.x) < 30 * scale);
      expect(shops).toHaveLength(10);
      expect(houses).toHaveLength(6);
      expect(infills).toHaveLength(DOWNTOWN_INFILL.length);
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
      for (const { side, z, model } of DOWNTOWN_INFILL) {
        const placement = infills.find(p =>
          (p.position.x - centre.x) * side > 0 &&
          Math.abs(p.position.z - centre.z - z * scale) < 0.001);
        expect(placement, 'infill at ' + side + '/' + z).toBeDefined();
        assertBox(placement!, model, 20, 11.4, side, z);
      }
      const towers = plan.filter(p => p.source?.kind === 'tower');
      expect(towers).toHaveLength(1);
      expect(towers[0]!.size).toEqual({ x: 8 * scale, y: 27 * scale, z: 8 * scale });
      const buildings = [...shops, ...houses, ...infills, ...towers];
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

  it('derives facade ornaments from each resized building', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const scale = island.size / 600;
    const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const buildings = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
      (p.kind === 'shop' || (p.kind === 'house' &&
        Math.abs(p.transform.position.x - centre.x) >= 30 * scale)));
    const details = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
      p.id.startsWith('detail-'));
    expect(buildings).toHaveLength(16);
    expect(details.filter(p => p.kind === 'signboard')).toHaveLength(0);
    const findAt = (kind: string, x: number, z: number) => details.find(p =>
      p.kind === kind && Math.hypot(p.transform.position.x - x,
        p.transform.position.z - z) < 0.01);
    for (const building of buildings) {
      const { x, z } = building.transform.position;
      const yaw = building.transform.rotationY;
      const frontX = Math.sin(yaw), frontZ = Math.cos(yaw);
      const roof = building.transform.position.y + building.size.y / 2;
      const facade = building.size.z / 2;
      const awning = findAt('awning', x + frontX * (facade + 1 * scale),
        z + frontZ * (facade + 1 * scale));
      expect(awning, building.id + ' awning').toBeDefined();
      expect(awning!.transform.position.y, building.id + ' awning height')
        .toBeCloseTo(roof - 3 * scale, 5);
    }
  });

  it('seats tank feet and AC bases on the rendered roof surfaces', async () => {
    const island = generateIsland();
    const placements = makeDowntownPlacements(island);
    const roofs = placements.filter(entry => entry.source?.kind === 'shop' || entry.source?.kind === 'house');
    const hardware = placements.filter(entry => entry.model === 'waterTower' || entry.model === 'ac');
    expect(hardware.filter(entry => entry.model === 'ac')).toHaveLength(16);
    const tanks = hardware.filter(entry => entry.model === 'waterTower');
    expect(tanks).toHaveLength(4);
    const models = new Map<DowntownModel, THREE.Group>();
    const geometry = new Map<DowntownPlacement, THREE.BufferGeometry>();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    try {
      vi.stubGlobal('self', globalThis);
      vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
      const loader = new GLTFLoader();
      for (const model of new Set([...roofs, ...hardware].map(entry => entry.model))) {
        const bytes = readFileSync('public/' + DOWNTOWN_MODELS[model]);
        models.set(model, (await loader.parseAsync(Uint8Array.from(bytes).buffer, '')).scene);
      }
      const bake = (entry: DowntownPlacement): THREE.BufferGeometry => {
        const existing = geometry.get(entry);
        if (existing) return existing;
        const mesh = bakeLibraryGeometry([entry], models, undefined, DOWNTOWN_MODELS)!;
        geometry.set(entry, mesh);
        return mesh;
      };
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 120);
      for (const unit of hardware) {
        const distance = (roof: DowntownPlacement): number => Math.hypot(
          roof.position.x - unit.position.x, roof.position.z - unit.position.z);
        const host = roofs.reduce((closest, roof) =>
          distance(roof) < distance(closest) ? roof : closest);
        const roofMesh = new THREE.Mesh(bake(host), material);
        const model = bake(unit);
        model.computeBoundingBox();
        const floor = model.boundingBox!.min.y;
        const positions = model.getAttribute('position');
        const sampled = new Set<string>();
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i);
          if (y > floor + .015) continue;
          const x = positions.getX(i), z = positions.getZ(i);
          const key = x.toFixed(3) + ',' + z.toFixed(3);
          if (sampled.has(key)) continue;
          sampled.add(key);
          ray.ray.origin.set(x, floor + .05, z);
          const support = ray.intersectObject(roofMesh, false)[0]?.point.y;
          expect(support, unit.source?.id + ' at ' + key).toBeDefined();
          expect(Math.abs(y - support!), unit.source?.id + ' contact gap').toBeLessThan(.02);
        }
        expect(sampled.size).toBeGreaterThanOrEqual(4);
        if (unit.model === 'ac') {
          for (const tank of tanks) {
            const clearance = tank.size.x / 2 + Math.hypot(unit.size.x, unit.size.z) / 2;
            expect(distance(tank), unit.source?.id + ' tank clearance').toBeGreaterThan(clearance);
          }
        }
      }
    } finally {
      vi.unstubAllGlobals();
      material.dispose();
      for (const mesh of geometry.values()) mesh.dispose();
      const textures = new Set<THREE.Texture>();
      for (const model of models.values()) model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const surface of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(surface)) if (value instanceof THREE.Texture) textures.add(value);
          surface.dispose();
        }
      });
      for (const texture of textures) texture.dispose();
    }
  });

  it('keeps rooftop AC units, sidewalk planters and benches at actual metre dimensions', () => {
    for (const size of [400, 600, 850]) {
      const island = generateIsland({ seed: 'billy-isle', resolution: 97, size });
      const scale = size / 600;
      const props = island.props.filter(p => p.poiId === 'downtown-bleatsville');
      const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
      const buildings = props.filter(p => p.kind === 'shop' ||
        (p.kind === 'house' && Math.abs(p.transform.position.x - centre.x) >= 30 * scale));
      const acUnits = props.filter(p => p.kind === 'ac-unit');
      expect(acUnits.length).toBe(buildings.length);
      for (const ac of acUnits) {
        expect(ac.size).toEqual({
          x: 1.2 * scale, y: 1.0 * scale, z: 1.0 * scale,
        });
        const collider = island.colliders.find(c =>
          c.shape !== 'heightfield' && c.id === ac.id);
        expect(collider).toBeDefined();
      }
      const planters = props.filter(p => p.kind === 'planter');
      expect(planters).toHaveLength(28);
      for (const planter of planters)
        expect(planter.size).toEqual({
          x: 1.6 * scale, y: 1.1 * scale, z: 1.6 * scale,
        });
      const benches = props.filter(p => p.kind === 'bench');
      expect(benches).toHaveLength(11);
      for (const bench of benches)
        expect(bench.size).toEqual({
          x: 2.0 * scale, y: 0.95 * scale, z: 0.75 * scale,
        });
      const cones = makeDowntownPlacements(island).filter(p => p.model === 'cone');
      expect(cones).toHaveLength(4);
      for (const cone of cones)
        expect(cone.size).toEqual({
          x: 0.45 * scale, y: 0.7 * scale, z: 0.45 * scale,
        });
    }
  });

  it('keeps every bench and planter footprint at least 0.5 m apart on the default seed', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const benches = island.props.filter(p =>
      p.poiId === 'downtown-bleatsville' && p.kind === 'bench');
    const planters = island.props.filter(p =>
      p.poiId === 'downtown-bleatsville' && p.kind === 'planter');
    expect(benches).toHaveLength(11);
    expect(planters).toHaveLength(28);
    const footprint = (p: (typeof benches)[number]) => {
      const c = Math.abs(Math.cos(p.transform.rotationY));
      const s = Math.abs(Math.sin(p.transform.rotationY));
      return {
        x: (c * p.size.x + s * p.size.z) / 2,
        z: (s * p.size.x + c * p.size.z) / 2,
      };
    };
    for (const bench of benches) {
      if (bench.id.startsWith('detail-'))
        expect(Math.abs(bench.transform.position.x - centre.x)).toBeCloseTo(12.7, 6);
      const b = footprint(bench);
      for (const planter of planters) {
        const p = footprint(planter);
        const gapX = Math.max(0, Math.abs(bench.transform.position.x -
          planter.transform.position.x) - b.x - p.x);
        const gapZ = Math.max(0, Math.abs(bench.transform.position.z -
          planter.transform.position.z) - b.z - p.z);
        expect(Math.hypot(gapX, gapZ), bench.id + ' / ' + planter.id)
          .toBeGreaterThanOrEqual(0.5 - 1e-6);
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

  it('keeps street details, two low-hanging full-height bunting spans and no striped overlay', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const scale = island.size / 600;
    const plan = makeDowntownPlacements(island);
    const garlands = plan.filter(p => p.model === 'lights')
      .sort((a, b) => a.position.z - b.position.z);
    expect(garlands.map(p =>
      Math.round((p.position.z - centre.z) / scale))).toEqual([-14, 6]);
    for (const garland of garlands) {
      expect(garland.size.x).toBeCloseTo(27 * scale, 6);
      expect(garland.size.y).toBeCloseTo(1.4 * scale, 6);
      expect(garland.size.z).toBeCloseTo(0.12 * scale, 6);
      expect(garland.position.y + garland.size.y / 2)
        .toBeCloseTo(gridSample(island, garland.position.x, garland.position.z) +
          8 * scale, 6);
    }
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
      (Math.abs(p.position.x - centre.x) - Math.max(p.size.x, p.size.z) / 2) >= 10 * scale)).toBe(true);
    const renderer = readFileSync('src/world/visual-downtown.ts', 'utf8');
    expect(renderer).not.toContain('stripedAwningGeometry');
    expect(renderer).not.toContain('downtown-striped-awnings');
  });

  it('keeps the cool town tower separate from the two Crane Yard cranes', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    expect(makeDowntownPlacements(island).filter(p => p.model === 'highrise')).toHaveLength(1);
    expect(island.props.filter(p => p.kind === 'crane').map(p => p.poiId))
      .toEqual(['crane-yard', 'crane-yard']);
    const model = readFileSync('public/' + DOWNTOWN_MODELS.highrise);
    const { materials } = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString()) as {
      materials: { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[];
    };
    for (const name of ['wallY', 'wallY2', 'cornice']) {
      const material = materials.find(value => value.name === name);
      expect(material, name).toBeDefined();
      const [r, g, b] = material!.pbrMetallicRoughness.baseColorFactor;
      expect(b!).toBeGreaterThan(g!);
      expect(g!).toBeGreaterThan(r!);
    }
  });

  it('retains painted planter and bunting GLB colours in the shared geometry baker', () => {
    const paint = new THREE.Color(0x619bc2);
    const model = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: paint }));
    model.add(mesh);
    const plan: DowntownPlacement[] = ['planter', 'lights'].map((kind, i) => ({
      model: kind as DowntownModel, position: { x: i * 2, y: 1, z: 0 },
      size: { x: 1, y: 1, z: 1 }, yaw: 0,
      wall: 0xff0000, roof: 0x0000ff,
    }));
    const models = new Map<DowntownModel, THREE.Group>([
      ['planter', model], ['lights', model],
    ]);
    const baked = bakeLibraryGeometry(plan, models, undefined, DOWNTOWN_MODELS)!;
    try {
      const colours = baked.getAttribute('color');
      expect(colours.count).toBeGreaterThan(50);
      for (let i = 0; i < colours.count; i++) {
        expect(colours.getX(i)).toBeCloseTo(paint.r, 5);
        expect(colours.getY(i)).toBeCloseTo(paint.g, 5);
        expect(colours.getZ(i)).toBeCloseTo(paint.b, 5);
      }
    } finally {
      baked.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
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
    for (const kind of ['shop', 'house', 'tower', 'lamp', 'awning']) {
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
