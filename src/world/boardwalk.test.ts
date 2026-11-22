import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildRapierColliders, createWorldScene, generateIsland, heightAt } from './index';
import type { PropDescriptor } from './types';
import { ART_BOOKMARKS } from './viewer/bookmarks';
import { BOARDWALK_SHORE_ID, boardwalkShoreEntry, SPLASH_DIVE_BOARD_ID } from './boardwalk';
import { paintingAssetUrl } from './viewer/reference-art';
import { gridSample } from './terrain';

function floorOf(prop: PropDescriptor): number {
  return prop.transform.position.y - prop.size.y / 2;
}
function topOf(prop: PropDescriptor): number {
  return prop.transform.position.y + prop.size.y / 2;
}

/** All four corners of a rotated attraction must be supported by a single deck. */
function footprintOnDeck(prop: PropDescriptor, deck: PropDescriptor, epsilon: number): boolean {
  const angle = prop.transform.rotationY;
  const c = Math.cos(angle), s = Math.sin(angle);
  const p = prop.transform.position, d = deck.transform.position;
  return [-1, 1].every(sx => [-1, 1].every(sz => {
    const localX = sx * prop.size.x / 2, localZ = sz * prop.size.z / 2;
    const x = p.x + c * localX + s * localZ;
    const z = p.z - s * localX + c * localZ;
    return Math.abs(x - d.x) < deck.size.x / 2 - epsilon &&
      Math.abs(z - d.z) < deck.size.z / 2 - epsilon;
  }));
}

/** A conservative world-X/Z rectangle encloses each yaw-rotated footprint. */
function boundsXZ(prop: PropDescriptor): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const a = prop.transform.rotationY;
  const dx = (Math.abs(Math.cos(a)) * prop.size.x +
    Math.abs(Math.sin(a)) * prop.size.z) / 2;
  const dz = (Math.abs(Math.sin(a)) * prop.size.x +
    Math.abs(Math.cos(a)) * prop.size.z) / 2;
  const { x, z } = prop.transform.position;
  return { minX: x - dx, maxX: x + dx, minZ: z - dz, maxZ: z + dz };
}
function footprintsOverlap(a: PropDescriptor, b: PropDescriptor): boolean {
  const x = boundsXZ(a), y = boundsXZ(b);
  const epsilon = 1e-5;
  return x.minX < y.maxX - epsilon && y.minX < x.maxX - epsilon &&
    x.minZ < y.maxZ - epsilon && y.minZ < x.maxZ - epsilon;
}

describe('Baa-ardwalk approved painting / shore-to-pier regression', () => {
  it('matches the visible shore planks to the same supported join across the entry', async () => {
    await RAPIER.init();
    const island = generateIsland();
    const entry = boardwalkShoreEntry(island)!;
    const [first, last] = entry.sections;
    const main = island.props.find(prop => prop.poiId === 'baa-ardwalk' && prop.kind === 'pier')!;
    const centre = main.transform.position;
    const shore = centre.z - main.size.z / 2;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const visuals = createWorldScene(island);
    try {
      expect(first.outer.y).toBeLessThan(gridSample(island, centre.x, first.outer.z));
      expect(last.outer.z).toBeGreaterThan(shore + .9);
      expect(topOf(main) - last.outer.y).toBeCloseTo(.02, 5);
      const picture = visuals.group.getObjectByName('baaardwalk-painted-rails')!;
      expect(picture).toBeInstanceOf(THREE.InstancedMesh);
      const { props, terrain } = buildRapierColliders(world, island);
      const support = props.get(BOARDWALK_SHORE_ID + 'deck-0')!;
      for (const offset of [-4, 0, 4]) {
        for (const z of [shore - 2, shore - .08, shore + .07]) {
          const x = centre.x + offset;
          const at = { x, y: 9, z };
          const down = { x: 0, y: -1, z: 0 };
          const collision = new RAPIER.Ray(at, down);
          const art = new THREE.Raycaster(new THREE.Vector3(x, at.y, z), new THREE.Vector3(0, -1, 0));
          const tread = support.castRay(collision, 10, false);
          const sand = terrain.castRay(collision, 10, false);
          expect(tread).toBeGreaterThan(0);
          expect(tread).toBeLessThan(sand);
          expect(art.intersectObject(picture)[0]!.distance).toBeCloseTo(tread, 2);
        }
      }
    } finally { visuals.dispose(); world.free(); }
  });

  const shoreVariants = ['billy-isle', 'shore-check', 'other-coast'].flatMap(seed =>
    [400, 600, 850].map(size => ({ seed, size })));
  describe.each(shoreVariants)('Boardwalk shore at $size m ($seed)', ({ seed, size }) => {
    let island: ReturnType<typeof generateIsland>;
    beforeAll(() => { island = generateIsland({ seed, size, resolution: 97 }); });

    it('joins sandy land to the sea with overlapping, walkable wooden platforms', () => {
      const scale = size / 600;
      const props = island.props.filter(p => p.poiId === 'baa-ardwalk');
      const pier = props.find(p => p.kind === 'pier')!;
      const head = props.filter(p => p.kind === 'pier')[1]!;
      expect(pier, seed).toBeDefined();
      expect(head, seed).toBeDefined();
      expect(pier.collidable && pier.climbable).toBe(true);
      expect(head.collidable && head.climbable).toBe(true);
      const nearShore = pier.transform.position.z - pier.size.z / 2;
      const pierEnd = pier.transform.position.z + pier.size.z / 2;
      const headStart = head.transform.position.z - head.size.z / 2;
      const farSea = head.transform.position.z + head.size.z / 2;
      const dryHeight = heightAt(island, pier.transform.position.x, nearShore);
      expect(topOf(pier) - dryHeight, seed).toBeGreaterThan(0);
      expect(nearShore, seed).toBeGreaterThanOrEqual(
        island.pois.find(p => p.id === 'baa-ardwalk')!.center.z - 38 * scale - 0.001);
      // The sand-to-water crossing is only six metres beyond the first plank.
      const waterlineHeight = gridSample(island, pier.transform.position.x,
        nearShore + 6 * scale);
      if (nearShore > island.pois.find(p => p.id === 'baa-ardwalk')!.center.z -
          38 * scale + 0.01)
        expect(waterlineHeight, seed).toBeLessThan(island.seaLevel + 0.3 * scale);
      expect(heightAt(island, head.transform.position.x, farSea), seed)
        .toBeLessThan(0);
      expect(headStart, seed).toBeLessThan(pierEnd);
      expect(headStart, seed).toBeGreaterThan(nearShore);
      expect(Math.abs(topOf(head) - topOf(pier)), seed).toBeLessThan(0.08 * scale);
      expect(farSea - nearShore, seed).toBeGreaterThan(100 * scale);
      expect(props.filter(p => p.kind === 'pier')).toHaveLength(2);
      expect(props.filter(p => p.kind === 'deck')).toHaveLength(0);
      const colliders = new Set(island.colliders
        .filter(c => c.shape !== 'heightfield').map(c => c.id));
      expect(colliders.has(pier.id)).toBe(true);
      expect(colliders.has(head.id)).toBe(true);
    });

    it('keeps procedural scenery vegetation outside both pier/deck footprints', () => {
      const vegetationKinds = new Set(['tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft']);
      const decks = island.props.filter(p => p.poiId === 'baa-ardwalk' &&
        (p.kind === 'pier' || p.kind === 'deck'));
      expect(decks).toHaveLength(2);
      const plants = island.props.filter(p => p.id.startsWith('detail-') &&
        vegetationKinds.has(p.kind));
      expect(plants.length).toBeGreaterThan(100);
      for (const plant of plants) for (const deck of decks) {
        const dx = plant.transform.position.x - deck.transform.position.x;
        const dz = plant.transform.position.z - deck.transform.position.z;
        const yaw = deck.transform.rotationY;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const inside = Math.abs(dx * c - dz * s) <= deck.size.x / 2 &&
          Math.abs(dx * s + dz * c) <= deck.size.z / 2;
        expect(inside, `${seed}, size ${size}: ${plant.id} on ${deck.kind}`).toBe(false);
      }
    });
  });

  it('supports every themed kiosk and the complete ferris wheel on deck', () => {
    const kioskKinds = [
      'kiosk-icecream', 'kiosk-popcorn', 'kiosk-games',
      'kiosk-prizes', 'kiosk-candy',
    ] as const;
    for (const seed of ['billy-isle', 'art-deck-A', 'art-deck-B']) {
      const island = generateIsland({ seed, resolution: 193 });
      const props = island.props.filter(p => p.poiId === 'baa-ardwalk');
      const pier = props.find(p => p.kind === 'pier')!;
      const head = props.filter(p => p.kind === 'pier')[1]!;
      const shops = props.filter(p => p.kind.startsWith('kiosk-') &&
        !p.kind.startsWith('kiosk-sign-'));
      const wheels = props.filter(p => p.kind === 'ferris-wheel');
      expect(shops.map(p => p.kind)).toEqual(kioskKinds);
      expect(props.filter(p => p.kind === 'booth' || p.kind === 'awning')).toEqual([]);
      expect(wheels).toHaveLength(1);
      const centre = island.pois.find(p => p.id === 'baa-ardwalk')!.center;
      const shift = (pier.transform.position.z - pier.size.z / 2 - centre.z) /
        (island.size / 600) + 38;
      expect(props.filter(p => p.kind === 'bunting')).toHaveLength(3);
      expect(props.filter(p => p.kind === 'scaffold' &&
        Math.abs((p.transform.position.z - centre.z) / (island.size / 600) -
          shift - 55) < 0.001)).toHaveLength(0);
      const sides = [1, -1, 1, -1, 1] as const;
      for (const [index, stall] of shops.entries()) {
        const side = sides[index]!;
        expect(stall.transform.position.x).toBeCloseTo(
          centre.x + side * 8.55 * island.size / 600, 6);
        expect(stall.size).toEqual({ x: 5 * island.size / 600,
          y: 4.8 * island.size / 600, z: 4.5 * island.size / 600 });
        expect(stall.color).toBeUndefined();
        expect(stall.body).toEqual({ type: 'static' });
        expect(stall.shape).toBe('cuboid');
        expect(stall.collidable && stall.lickable && stall.climbable).toBe(true);
        expect(island.colliders.some(c => 'id' in c && c.id === stall.id)).toBe(true);
        expect(stall.transform.rotationY).toBeCloseTo(-side * Math.PI / 2, 6);
        expect(footprintOnDeck(stall, pier, 0.05), stall.id).toBe(true);
        expect(Math.abs(floorOf(stall) - topOf(pier)), stall.id).toBeLessThan(0.05);
        // Guards against the earlier grading pass moving stalls back onto sand.
        expect(floorOf(stall), stall.id)
          .toBeGreaterThan(heightAt(island, stall.transform.position.x,
            stall.transform.position.z) + 0.3);
      }
      const scale = island.size / 600;
      const signs = props.filter(p => p.kind.startsWith('kiosk-sign-'));
      expect(signs.map(p => p.kind)).toEqual(kioskKinds.map(kind => kind.replace('kiosk-', 'kiosk-sign-')));
      for (const [index, sign] of signs.entries()) {
        const stall = shops[index]!;
        const p = sign.transform.position, q = stall.transform.position;
        expect(p.x).toBeCloseTo(q.x, 6);
        expect(q.z - p.z).toBeCloseTo(2.13 * scale, 6);
        expect(p.y - floorOf(stall)).toBeCloseTo(2.43 * scale, 6);
        expect(sign.transform.rotationY).toBe(Math.PI);
        expect(sign.collidable || sign.lickable || sign.climbable).toBe(false);
        expect(island.colliders.some(c => 'id' in c && c.id === sign.id)).toBe(false);
      }
      expect(props.some(p => p.kind === 'signboard')).toBe(false);
      const promenadeLamps = props.filter(p => p.kind === 'lamp' &&
        Math.abs(p.transform.position.x -
          (centre.x - 11.3 * island.size / 600)) < 0.001);
      expect(promenadeLamps).toHaveLength(5);
      for (const lamp of promenadeLamps)
        expect(lamp.transform.position.x).toBeCloseTo(
          centre.x - 11.3 * island.size / 600, 6);
      expect(props.filter(p => p.kind === 'lamp')).toHaveLength(7);
      for (const lamp of props.filter(p => p.kind === 'lamp'))
        expect(lamp.size).toEqual({ x: 0.72 * scale, y: 7.8 * scale, z: 0.72 * scale });
      expect(props.filter(p => p.kind === 'bench').length).toBeGreaterThanOrEqual(5);
      for (const bench of props.filter(p => p.kind === 'bench'))
        expect(bench.size).toEqual({ x: 2 * scale, y: 0.95 * scale, z: 0.75 * scale });
      const trampolines = props.filter(p => p.kind === 'trampoline');
      expect(trampolines).toHaveLength(1);
      expect(trampolines[0]!.size).toEqual({
        x: 3.6 * scale, y: 0.8 * scale, z: 3.6 * scale,
      });
      expect(trampolines[0]!.transform.position.x).toBeCloseTo(centre.x + 7.8 * scale);
      expect(footprintOnDeck(trampolines[0]!, pier, 0.05)).toBe(true);
      for (const ball of props.filter(p => p.kind === 'bumper'))
        expect(ball.size).toEqual({ x: scale, y: scale, z: scale });
      const wheel = wheels[0]!;
      expect(footprintOnDeck(wheel, head, 0.1)).toBe(true);
      const feet = island.colliders.filter(c => c.shape === 'cuboid' &&
        c.id.startsWith(wheel.id + '-') && c.id.endsWith('-pad'));
      expect(feet).toHaveLength(4);
      for (const foot of feet) {
        if (foot.shape !== 'cuboid') throw new Error('Expected a Ferris wheel foot pad');
        expect(foot.transform.position.y - foot.size.y / 2).toBeCloseTo(topOf(head), 6);
      }
      expect(wheel.transform.position.z).toBeGreaterThan(
        shops[shops.length - 1]!.transform.position.z + 15);
      for (const kind of [...kioskKinds, 'bunting', 'lamp', 'pier-rail']) {
        expect(props.some(p => p.kind === kind), kind).toBe(true);
      }
      expect(props.filter(p => p.kind === 'pier-rail').length).toBeGreaterThan(20);
      const bunting = props.filter(p => p.kind === 'bunting');
      expect(bunting.every(p => !p.collidable && floorOf(p) > topOf(pier) + .5 * scale)).toBe(true);
      expect(Math.max(...bunting.map(topOf))).toBeCloseTo(topOf(pier) + 4 * scale, 5);
      expect(Math.min(...bunting.map(topOf))).toBeCloseTo(topOf(pier) + 1.29 * scale, 5);
      expect(props.filter(p => p.kind === 'scaffold')
        .some(p => floorOf(p) < 0 && topOf(p) < topOf(pier) + 8)).toBe(true);
    }
  });

  it('gives the authored pier two continuous end sills inside the original deck bounds', async () => {
    const path = new URL('../../public/assets/library/custom/baaardwalk/boardwalk-pier.glb',
      import.meta.url);
    const file = Uint8Array.from(readFileSync(path));
    const { scene } = await new GLTFLoader().parseAsync(file.buffer, '');
    scene.updateMatrixWorld(true);
    try {
      const bounds = new THREE.Box3().setFromObject(scene);
      for (const axis of ['x', 'y', 'z'] as const) {
        const target = { x: 27, y: 0.92, z: 83 };
        expect(bounds.getSize(new THREE.Vector3())[axis]).toBeCloseTo(target[axis], 5);
      }
      const edge = new THREE.Raycaster();
      edge.far = 0.3;
      const top = new THREE.Raycaster();
      top.far = 0.25;
      top.ray.direction.set(0, -1, 0);
      for (const sign of [-1, 1]) {
        edge.ray.direction.set(0, 0, -sign);
        for (let x = -13.37; x < 13.5; x += 0.17) {
          edge.ray.origin.set(x, 0.83, 41.63 * sign);
          top.ray.origin.set(x, 1.05, 41.31 * sign);
          for (const [ray, axis, surface] of [
            [edge, 'z', 41.5 * sign], [top, 'y', 0.92],
          ] as const) {
            const hits = ray.intersectObject(scene, true);
            expect(hits.length, `pier ${axis} at X=${x}`).toBeGreaterThan(0);
            expect(hits.every(hit => {
              const mesh = hit.object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
              return mesh.material.name === 'beam' && Math.abs(hit.point[axis] - surface) < 1e-5;
            })).toBe(true);
          }
        }
      }
    } finally {
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    }
  });

  it('hangs the pennants from side posts clear of the wheel in the default approach', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const props = island.props.filter(prop => prop.poiId === 'baa-ardwalk');
    const pier = props.find(prop => prop.kind === 'pier')!;
    const wheel = props.find(prop => prop.kind === 'ferris-wheel')!;
    const bunting = props.filter(prop => prop.kind === 'bunting');
    const deckTop = topOf(pier);
    const atLamps = bunting.find(prop => topOf(prop) > deckTop + 3.5);
    const atRails = bunting.filter(prop => topOf(prop) < deckTop + 2.65);
    expect(atLamps).toBeDefined();
    expect(atRails).toHaveLength(2);
    for (const endpoint of [-1, 1]) {
      const { x, z } = atLamps!.transform.position;
      expect(props.some(prop => prop.kind === 'lamp' &&
        Math.abs(prop.transform.position.x - x) < 0.01 &&
        Math.abs(prop.transform.position.z - z - endpoint * .98 * atLamps!.size.x / 2) < 0.01 &&
        Math.abs(floorOf(prop) + 4.05 - topOf(atLamps!)) < .08)).toBe(true);
    }
    for (const span of atRails) {
      expect(props.some(prop => prop.kind === 'pier-rail' &&
        Math.abs(prop.transform.position.x - span.transform.position.x) < 0.2 &&
        Math.abs(prop.transform.position.z - span.transform.position.z) < 0.01 &&
        prop.size.x >= span.size.x && Math.abs(floorOf(prop) + 1.25 - topOf(span)) < .08)).toBe(true);
    }

    const mark = ART_BOOKMARKS.find(bookmark => bookmark.id === '09')!;
    const camera = new THREE.PerspectiveCamera(mark.fov, 1542 / 883, 0.25, 4000);
    camera.position.copy(mark.camera);
    camera.lookAt(mark.target.x, mark.target.y, mark.target.z);
    camera.updateMatrixWorld();
    const projectionX = (prop: PropDescriptor): number[] => {
      const extents = boundsXZ(prop);
      return [extents.minX, extents.maxX].flatMap(x =>
        [floorOf(prop), topOf(prop)].flatMap(y => [extents.minZ, extents.maxZ]
          .map(z => new THREE.Vector3(x, y, z).project(camera).x)));
    };
    const rightmostWheel = Math.max(...projectionX(wheel));
    for (const span of bunting) {
      expect(Math.min(...projectionX(span))).toBeGreaterThan(rightmostWheel + 0.04);
      expect(span.collidable).toBe(false);
    }
  });

  it.each([
    { seed: 'billy-isle', size: 600 },
    { seed: 'shore-check', size: 400 },
    { seed: 'art-deck-A', size: 850 },
  ])('keeps the cargo stacks clear of the promenade and stalls ($seed, $size)',
    ({ seed, size }) => {
      const island = generateIsland({ seed, size, resolution: 97 });
      const scale = size / 600;
      const centre = island.pois.find(p => p.id === 'baa-ardwalk')!.center;
      const props = island.props.filter(p => p.poiId === 'baa-ardwalk');
      const deck = props.find(p => p.kind === 'pier')!;
      const crates = props.filter(p => p.kind === 'crate');
      const barrels = props.filter(p => p.kind === 'barrel');
      const cargo = [...crates, ...barrels];
      expect(crates).toHaveLength(6);
      expect(barrels).toHaveLength(4);
      for (const ball of props.filter(p => p.kind === 'bumper')) expect(ball.breakable).toBe(false);

      // The main deck starts at local Z=-38 after the seed-dependent shore shift.
      const entrance = deck.transform.position.z - deck.size.z / 2;
      const localZ = (prop: PropDescriptor): number =>
        (prop.transform.position.z - entrance) / scale - 38;
      const stacks = new Map<number, PropDescriptor[]>();
      for (const crate of crates) {
        const z = Math.round(localZ(crate));
        const entries = stacks.get(z) ?? [];
        entries.push(crate);
        stacks.set(z, entries);
        expect(crate.size).toEqual({ x: scale, y: scale, z: scale });
      }
      expect([...stacks.keys()]).toEqual([-12, 6, 27]);
      for (const pair of stacks.values()) {
        expect(pair).toHaveLength(2);
        const [lower, upper] = pair.sort((a, b) =>
          a.transform.position.y - b.transform.position.y);
        expect(floorOf(lower!)).toBeCloseTo(topOf(deck), 5);
        expect(floorOf(upper!)).toBeCloseTo(topOf(lower!), 5);
        expect(upper!.transform.position.x).toBeCloseTo(lower!.transform.position.x, 6);
        expect(upper!.transform.position.z).toBeCloseTo(lower!.transform.position.z, 6);
      }
      expect(barrels.map(b => Math.round(localZ(b)))).toEqual([-11, 2, 23, 34]);
      for (const barrel of barrels) {
        expect(barrel.size).toEqual({
          x: 0.8 * scale, y: scale, z: 0.8 * scale,
        });
        expect(floorOf(barrel)).toBeCloseTo(topOf(deck), 5);
      }

      for (const prop of cargo) {
        const box = boundsXZ(prop);
        const laneLeft = centre.x - 5 * scale, laneRight = centre.x + 5 * scale;
        expect(box.maxX <= laneLeft || box.minX >= laneRight, prop.id + ' promenade').toBe(true);
        expect(Math.max(Math.abs((box.minX - centre.x) / scale),
          Math.abs((box.maxX - centre.x) / scale)), prop.id + ' deck edge')
          .toBeLessThanOrEqual(12.5);
        expect(footprintOnDeck(prop, deck, 0.05), prop.id + ' on deck').toBe(true);
        expect(prop.shape).toBe(prop.kind === 'barrel' ? 'cylinder' : 'cuboid');
        expect(prop.body.type).toBe('dynamic');
        expect(prop.collidable && prop.lickable && prop.breakable).toBe(true);
        expect(prop.climbable).toBe(false);
        for (const other of props) {
          if (other.id === prop.id) continue;
          // The deck is the floor, and two crates in one stack meet at a
          // horizontal face; neither is a 3D volume overlap.
          const overlapsY = floorOf(prop) < topOf(other) - 1e-5 &&
            floorOf(other) < topOf(prop) - 1e-5;
          expect(!(overlapsY && footprintsOverlap(prop, other)),
            prop.id + ' overlaps ' + other.id).toBe(true);
        }
      }
    });

  it('has visible planking and rail meshes and a resolvable original painting', () => {
    for (const bookmark of ART_BOOKMARKS) {
      expect(() => paintingAssetUrl(bookmark.image), bookmark.image).not.toThrow();
      expect(paintingAssetUrl(bookmark.image)).toBeTruthy();
    }
    const boardwalkCamera = ART_BOOKMARKS.find(b => b.id === '09')!;
    expect(boardwalkCamera.camera.z).toBeLessThan(boardwalkCamera.target.z);
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const visuals = createWorldScene(island);
    const rails = visuals.group.getObjectByName('baaardwalk-painted-rails');
    expect(rails).toBeInstanceOf(THREE.Mesh);
    expect(visuals.group.getObjectByName('props-pier-rail')).toBeUndefined();
    for (const kind of ['pier', 'ferris-wheel', 'bunting']) {
      const mesh = visuals.group.getObjectByName('props-' + kind);
      expect(mesh, kind).toBeInstanceOf(THREE.InstancedMesh);
      expect((mesh as THREE.InstancedMesh).count, kind).toBeGreaterThan(0);
    }
    const pier = visuals.group.getObjectByName('props-pier') as THREE.InstancedMesh;
    expect(pier.count).toBe(2);
    visuals.dispose();
  });

  it('draws each Ferris rail join around one post and keeps both open corners and the dive entrance', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const scale = island.size / 600;
    const rails = island.props.filter(prop => prop.kind === 'pier-rail' && prop.poiId === 'baa-ardwalk');
    const launch = island.props.find(prop => prop.id === SPLASH_DIVE_BOARD_ID)!;
    const head = island.props.filter(prop => prop.poiId === 'baa-ardwalk' && prop.kind === 'pier')[1]!;
    const headCentre = head.transform.position;
    const far = rails.filter(prop => prop.transform.rotationY === 0)
      .sort((a, b) => a.transform.position.x - b.transform.position.x);
    const visuals = createWorldScene(island);
    try {
      const mesh = visuals.group.getObjectByName('baaardwalk-painted-rails') as THREE.InstancedMesh;
      expect(mesh.geometry.index!.count / 3 * mesh.count).toBeLessThan(rails.length * 504);
      const farZ = far[0]!.transform.position.z;
      const caster = new THREE.Raycaster();
      const hit = (x: number, y: number, z: number, dx: number, dz: number) => {
        caster.set(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, 0, dz));
        caster.far = 2 * scale;
        return caster.intersectObject(mesh, false).length > 0;
      };
      const post = topOf(head) + .85 * scale;
      const beam = topOf(head) + 1.19 * scale;
      for (const [i, rail] of far.slice(1).entries()) {
        const x = (far[i]!.transform.position.x + rail.transform.position.x) / 2;
        expect(hit(x, post, farZ + scale, 0, -1)).toBe(true);
        for (const offset of [-.17, .17]) {
          expect(hit(x + offset * scale, post, farZ + scale, 0, -1)).toBe(false);
          expect(hit(x + offset * scale, beam, farZ + scale, 0, -1)).toBe(true);
        }
      }

      for (const side of [-1, 1]) {
        const leg = rails.filter(prop => prop.transform.position.z > headCentre.z - head.size.z / 2 &&
          prop.transform.rotationY !== 0 && Math.sign(prop.transform.position.x - headCentre.x) === side)
          .sort((a, b) => a.transform.position.z - b.transform.position.z);
        expect(leg).toHaveLength(3);
        const x = leg[0]!.transform.position.x + side * scale;
        for (const [i, rail] of leg.slice(1).entries()) {
          const z = (leg[i]!.transform.position.z + rail.transform.position.z) / 2;
          expect(hit(x, post, z, -side, 0)).toBe(true);
          for (const offset of [-.17, .17]) {
            expect(hit(x, post, z + offset * scale, -side, 0)).toBe(false);
            expect(hit(x, beam, z + offset * scale, -side, 0)).toBe(true);
          }
        }
        const last = leg.at(-1)!;
        const cornerZ = (last.transform.position.z + last.size.x / 2 + farZ) / 2;
        expect(hit(x, beam, cornerZ, -side, 0)).toBe(false);
      }

      const { x, z } = launch.transform.position;
      const deck = island.props.filter(prop => prop.poiId === 'baa-ardwalk' && prop.kind === 'pier')[0]!;
      const launchBeam = topOf(deck) + 1.19 * scale;
      expect(hit(x - scale, launchBeam, z, -1, 0)).toBe(false);
      for (const side of [-1, 1])
        expect(hit(x - scale, launchBeam, z + side * 3.1 * scale, -1, 0)).toBe(true);
    } finally {
      visuals.dispose();
    }
  });

  it('keeps the Baa-ardwalk buoys at their authored 1.0 x 1.8 x 1.0 size', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const scale = island.size / 600;
    const buoys = island.props.filter(p => p.poiId === 'baa-ardwalk' &&
      p.kind === 'buoy');
    expect(buoys).toHaveLength(16);
    for (const buoy of buoys)
      expect(buoy.size).toEqual({ x: scale, y: 1.8 * scale, z: scale });
  });

  it('lets a simulated goat-sized ball land on the wheel platform above seawater', async () => {
    await RAPIER.init();
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const head = island.props.filter(p => p.poiId === 'baa-ardwalk' &&
      p.kind === 'pier')[1]!;
    const targetY = topOf(head);
    const x = head.transform.position.x + 13, z = head.transform.position.z - 3;
    expect(heightAt(island, x, z)).toBeLessThan(targetY - 2);
    const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    buildRapierColliders(physics, island);
    const ball = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, targetY + 7, z));
    physics.createCollider(RAPIER.ColliderDesc.ball(0.6).setRestitution(0), ball);
    for (let i = 0; i < 150; i++) physics.step();
    expect(Math.abs(ball.translation().y - (targetY + 0.6))).toBeLessThan(0.22);
    physics.free();
  });
});
