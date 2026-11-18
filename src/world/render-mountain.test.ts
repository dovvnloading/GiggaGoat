import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland } from './index';
import { gridIndex, gridSample, segmentProjection } from './terrain';
import { mountainCuts } from './visual-mountain';
import { Game } from '../core/Game';

describe('Mt. Gigga grassy tiers and fragment stone (MG-7 / IS-15)', () => {
  it('keeps flat tiers and steep risers grassy in the vertex buffer', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    // Test the mountain palette independently of the unchanged trail paint.
    island.roads = [];
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
          const broad = Math.sin(x * 0.071 + Math.cos(z * 0.039) * 1.4) *
            Math.cos(z * 0.092 - Math.sin(x * 0.047));
          const fine = Math.sin(x * 0.36 + z * 0.17) *
            Math.cos(z * 0.29 - x * 0.21);
          const variation = 0.968 + broad * 0.038 + fine * 0.022;
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
    let lastElevation = 0;
    const trails = island.roads.flatMap(road => road.points.slice(1).map((point, i) =>
      ({ ahead: point, behind: road.points[i]!, half: road.width / 2 })));
    const water = world.group.getObjectByName('mountain-terrace-water') as THREE.Mesh;
    const wet = water.geometry.getAttribute('position');
    for (const name of tierNames) {
      const mesh = wayfinding.getObjectByName('mountain-' + name) as THREE.Mesh;
      expect(mesh, name).toBeInstanceOf(THREE.Mesh);
      const geometry = mesh.geometry;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(box.min.y - lastElevation, name).toBeGreaterThan(8);
      expect(box.max.y - box.min.y, name).toBeGreaterThan(2);
      lastElevation = box.min.y;
      const positions = geometry.getAttribute('position');
      const palette = new Set<number>();
      const paint = geometry.getAttribute('color');
      let trailMargin = Infinity, waterMargin = Infinity, lowestGroundContact = Infinity;
      for (let i = 0; i < positions.count; i++) {
        const point = { x: positions.getX(i), z: positions.getZ(i) };
        lowestGroundContact = Math.min(lowestGroundContact,
          positions.getY(i) - gridSample(island, point.x, point.z));
        palette.add(paint.getX(i));
        for (const { ahead, behind, half } of trails) {
          trailMargin = Math.min(trailMargin, segmentProjection(point, behind, ahead).distance - half);
        }
        for (let j = 0; j < wet.count; j++) {
          waterMargin = Math.min(waterMargin, Math.hypot(point.x - wet.getX(j), point.z - wet.getZ(j)));
        }
      }
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
