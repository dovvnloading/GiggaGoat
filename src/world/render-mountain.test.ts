import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland } from './index';
import { gridIndex, gridSample, segmentProjection } from './terrain';
import { groundGrain } from './ground-kit-grain';
import { paintCliffVertex } from './terrain-paint';
import { mountainCuts } from './visual-mountain';
import { MOUNTAIN_SPIRAL_BRIDGE_PREFIX } from './roads';
import { Game } from '../core/Game';

describe('Mt. Gigga grassy tiers and fragment stone (MG-7 / IS-15)', () => {
  it('keeps level turf green and exposes stratified cliff paint without a shader', () => {
    const rock = new THREE.Color(0xa39a96);
    const cliffs = { data: Uint8Array.of(0, 0, 255, 60, 0, 0, 255, 60), samples: 2, size: 600,
      stone: new THREE.Color(0x8c919e), mountainStone: rock };
    const grass = new THREE.Color(0x86ad56), rim = grass.clone(), lower = grass.clone(), upper = grass.clone();
    paintCliffVertex(rim, cliffs, -2, 50, 0);
    paintCliffVertex(lower, cliffs, 2, 50, 0);
    paintCliffVertex(upper, cliffs, 2, 57, 0);
    expect(rim.equals(grass)).toBe(true);
    expect(lower.r).toBeGreaterThan(lower.g);
    expect(Math.abs(upper.r - lower.r)).toBeGreaterThan(.02);
  });

  it('keeps flat tiers and steep risers grassy in the vertex buffer', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    // Test the mountain palette independently of the unchanged trail paint.
    island.roads = [];
    island.districtSets = [];
    const scene = createWorldScene(island, { chunkSegments: 32 });
    const scale = island.size / 600;
    const cell = island.size / (island.resolution - 1);
    const grass = new THREE.Color(0x77b754).lerp(new THREE.Color(0x568f59), 0.12);
    const heights = (ix: number, iz: number): number =>
      island.heights[gridIndex(island.resolution,
        Math.max(0, Math.min(island.resolution - 1, ix)),
        Math.max(0, Math.min(island.resolution - 1, iz)))]!;
    let grassyVertices = 0, riserVertices = 0;
    try {
      for (const chunk of scene.chunks) {
        const pos = chunk.geometry.getAttribute('position');
        const colour = chunk.geometry.getAttribute('color');
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) + chunk.position.x;
          const z = pos.getZ(i) + chunk.position.z;
          const r = Math.hypot(x, z) / scale;
          const greenCandidate = r > 12 && r < 94;
          const rockCandidate = [[19, 26], [38, 45], [56, 63], [74, 81]]
            .some(([inner, outer]) => r > inner! + 2 && r < outer! - 2);
          if (!greenCandidate && !rockCandidate) continue;
          const ix = Math.round((x / island.size + 0.5) * (island.resolution - 1));
          const iz = Math.round((z / island.size + 0.5) * (island.resolution - 1));
          const h = pos.getY(i);
          const slope = Math.hypot(
            (heights(ix + 1, iz) - heights(ix - 1, iz)) / (2 * cell),
            (heights(ix, iz + 1) - heights(ix, iz - 1)) / (2 * cell));
          const isGreen = greenCandidate && slope < 0.55;
          const isRiser = rockCandidate && slope > 1.2;
          if (!isGreen && !isRiser) continue;
          const depression = Math.max(0, (
            heights(ix + 1, iz) + heights(ix - 1, iz) +
            heights(ix, iz + 1) + heights(ix, iz - 1)) * 0.25 - h);
          const ambient = 1 - Math.min(0.16, depression * 0.07);
          const weights = chunk.geometry.getAttribute('kitGroundWeights');
          const channel = weights.getZ(i) > .5 ? 2 : 0;
          const broad = groundGrain(x / (4 * scale), z / (4 * scale), channel);
          const fine = groundGrain(-z / scale, x / scale, channel);
          const variation = .98 + broad * .15 + fine * .065;
          // Even vertical faces retain grass in vertex colour: fragment
          // normals, not 3.1 m-spaced vertices, now select visible stone.
          const expected = grass.clone().multiplyScalar(ambient * variation);
          const delta = Math.hypot(
            colour.getX(i) - expected.r,
            colour.getY(i) - expected.g,
            colour.getZ(i) - expected.b);
          expect(delta, (isGreen ? 'flat grass' : 'steep grass') +
            ' at (' + x.toFixed(1) + ',' + z.toFixed(1) + ')')
            .toBeLessThan(0.015);
          if (isGreen) grassyVertices++;
          if (isRiser) riserVertices++;
        }
      }
      expect(grassyVertices).toBeGreaterThan(10);
      expect(riserVertices).toBeGreaterThan(5);
    } finally {
      scene.dispose();
    }
  });
});

it('renders distinguishable, grounded tier landmarks off existing trails and cascades', () => {
  const island = generateIsland();
  const before = structuredClone(island.colliders);
  const world = createWorldScene(island);
  try {
    const wayfinding = world.group.getObjectByName('mt-gigga-wayfinding')!;
    const tierNames = ['split-stones', 'pine-shelf', 'lantern-bend', 'cloud-cairn', 'survey-shelf'];
    expect(wayfinding.children).toHaveLength(1);
    const mesh = wayfinding.children[0] as THREE.Mesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(true);
    const geometry = mesh.geometry;
    expect(geometry.groups).toHaveLength(0);
    const positions = geometry.getAttribute('position');
    const paint = geometry.getAttribute('color');
    const features = geometry.userData['features'] as
      Record<string, { start: number; count: number }>;
    expect(Object.keys(features)).toEqual([...tierNames, 'northwest-cut', 'summit-cut', 'mountain-spiral-bridge-decks']);
    let cursor = 0;
    for (const { start, count } of Object.values(features)) {
      expect(start).toBe(cursor);
      expect(count).toBeGreaterThan(0);
      expect(count % 3).toBe(0);
      cursor += count;
    }
    expect(cursor).toBe(positions.count);
    let lastElevation = 0;
    const trails = island.roads.flatMap(road => road.points.slice(1).map((point, i) =>
      ({ ahead: point, behind: road.points[i]!, half: road.width / 2 })));
    const water = world.group.getObjectByName('mountain-terrace-water') as THREE.Mesh;
    const wet = water.geometry.getAttribute('position');
    for (const name of tierNames) {
      const { start, count } = features[name]!;
      let lowest = Infinity, highest = -Infinity;
      const palette = new Set<number>();
      let trailMargin = Infinity, waterMargin = Infinity, lowestGroundContact = Infinity;
      for (let i = start; i < start + count; i++) {
        const point = { x: positions.getX(i), z: positions.getZ(i) };
        const y = positions.getY(i);
        lowest = Math.min(lowest, y);
        highest = Math.max(highest, y);
        lowestGroundContact = Math.min(lowestGroundContact,
          y - gridSample(island, point.x, point.z));
        palette.add(paint.getX(i));
        for (const { ahead, behind, half } of trails) {
          trailMargin = Math.min(trailMargin, segmentProjection(point, behind, ahead).distance - half);
        }
        for (let j = 0; j < wet.count; j++) {
          waterMargin = Math.min(waterMargin, Math.hypot(point.x - wet.getX(j), point.z - wet.getZ(j)));
        }
      }
      expect(lowest - lastElevation, name).toBeGreaterThan(8);
      expect(highest - lowest, name).toBeGreaterThan(2);
      lastElevation = lowest;
      expect(palette.size, name).toBeGreaterThanOrEqual(3);
      expect(lowestGroundContact, name).toBeLessThan(0);
      expect(trailMargin, name).toBeGreaterThan(.35);
      expect(waterMargin, name).toBeGreaterThan(2);
    }
    expect(island.colliders).toEqual(before);
  } finally {
    world.dispose();
  }
});

it('keeps both marked shortcuts visible from their entry and traversable at Kid size', async () => {
  const game = await Game.create();
  const world = createWorldScene(game.island);
  try {
    const cuts = mountainCuts(game.island);
    expect(cuts.map(cut => cut.id)).toEqual(['northwest-cut', 'summit-cut']);
    world.group.updateMatrixWorld(true);
    for (const { id, jump, from, to, markers } of cuts) {
      game.step();
      const down = game.physics.raycast(
        { x: from.x, y: 160, z: from.z }, { x: 0, y: -1, z: 0 }, 180,
        { predicate: collider => !game.goat.ownsBody(collider.parent()) });
      expect(down).not.toBeNull();
      game.teleport({ ...from, y: down!.point.y + .07 },
        -Math.atan2(to.x - from.x, from.z - to.z));
      for (let frame = 0; frame < 180; frame++) game.step();
      expect(game.goat.size).toBe(.6);
      const first = markers[0]!;
      const eye = new THREE.Vector3(from.x, down!.point.y + 1.15, from.z);
      const crown = new THREE.Vector3(first.x,
        gridSample(game.island, first.x, first.z) + 1.35, first.z);
      const bearing = crown.clone().sub(eye);
      const ray = new THREE.Raycaster(eye, bearing.clone().normalize(), 0, bearing.length() - .3);
      expect(ray.intersectObjects(world.chunks), id).toHaveLength(0);

      let frame = 0;
      for (; frame < 540; frame++) {
        const p = game.goat.torso.translation();
        if (Math.hypot(p.x - to.x, p.z - to.z) < 1.65 && game.goat.locomotion.grounded) break;
        game.step({ moveZ: 1, cameraYaw: Math.atan2(to.x - p.x, p.z - to.z),
          jump: jump && frame % 32 === 14 });
      }
      expect(frame, id).toBeLessThan(540);
      expect(game.goat.torso.translation().y - down!.point.y, id).toBeGreaterThan(2.2);
    }
    expect(game.respawns).toBe(0);
  } finally {
    world.dispose();
    game.dispose();
  }
});

it('walks through the bridge after the northwest shortcut and renders its real deck grade', async () => {
  const game = await Game.create();
  const world = createWorldScene(game.island);
  try {
    game.step();
    world.group.updateMatrixWorld(true);
    const road = game.island.roads.find(r => r.id === 'downtown-bleatsville--mt-gigga')!;
    const span = road.points.slice(95, 102);
    const mesh = world.group.getObjectByName('mountain-wayfinding-batched') as THREE.Mesh;
    const flatDecks = world.group.getObjectByName('props-bridge')!;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(flatDecks).toBeInstanceOf(THREE.InstancedMesh);
    const { start: firstBridgeVertex, count: bridgeVertices } = mesh.geometry.userData.features['mountain-spiral-bridge-decks'];
    const deckHandles = new Set([...game.colliders.props]
      .filter(([id]) => id.startsWith(MOUNTAIN_SPIRAL_BRIDGE_PREFIX)).map(([, collider]) => collider.handle));

    const [before, seam, after] = road.points.slice(96, 99);
    const heading = new THREE.Vector3(after!.x - before!.x, 0, after!.z - before!.z).normalize();
    const lateral = new THREE.Vector3(-heading.z, 0, heading.x);
    for (const offset of [-1.4, 0, 1.4]) {
      const sampledHeights = [-.25, .25].map(distance => {
        const origin = new THREE.Vector3(seam!.x, 65, seam!.z)
          .addScaledVector(heading, distance).addScaledVector(lateral, offset);
        const down = new THREE.Vector3(0, -1, 0);
        const support = game.physics.raycast(origin, down, 60, {
          predicate: collider => deckHandles.has(collider.handle),
        });
        const ray = new THREE.Raycaster(origin, down, 0, 60);
        const visible = ray.intersectObject(mesh)[0];
        expect(visible?.point.y).toBeCloseTo(support!.point.y, 1);
        expect(visible!.faceIndex! * 3).toBeGreaterThanOrEqual(firstBridgeVertex);
        expect(visible!.faceIndex! * 3).toBeLessThan(firstBridgeVertex + bridgeVertices);
        expect(ray.intersectObject(flatDecks)).toHaveLength(0);
        return support!.point.y;
      });
      expect(Math.abs(sampledHeights[1]! - sampledHeights[0]!)).toBeLessThan(.16);
    }

    const landing = road.points[99]!;
    const deckStart = road.points[98]!;
    for (const t of [.43, .64, .83]) {
      const origin = { x: THREE.MathUtils.lerp(deckStart.x, landing.x, t), y: 65,
        z: THREE.MathUtils.lerp(deckStart.z, landing.z, t) };
      const down = { x: 0, y: -1, z: 0 };
      const terrain = game.physics.raycast(origin, down, 60, {
        predicate: collider => collider.handle === game.colliders.terrain.handle,
      });
      const deck = game.physics.raycast(origin, down, 60, {
        predicate: collider => deckHandles.has(collider.handle),
      });
      expect(terrain!.point.y).toBeLessThan(deck!.point.y);
    }

    const start = span[0]!;
    const startGround = game.physics.raycast({ ...start, y: 65 }, { x: 0, y: -1, z: 0 }, 60)!;
    game.teleport({ ...start, y: startGround.point.y });
    for (const target of [...span.slice(1), ...span.slice(0, -1).reverse()]) {
      let reached = false;
      for (let tick = 0; tick < 240; tick++) {
        const p = game.goat.torso.translation();
        if (Math.hypot(target.x - p.x, target.z - p.z) < .65) { reached = true; break; }
        game.step({ moveZ: 1, cameraYaw: Math.atan2(target.x - p.x, p.z - target.z) });
      }
      expect(reached, 'near bridge station ' + target.x.toFixed(2)).toBe(true);
    }
    expect(game.respawns).toBe(0);
  } finally {
    world.dispose();
    game.dispose();
  }
});
