import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { RAPIER, V } from '../physics';
import type { PropDescriptor } from './types';
import { buildLighthouseVisuals, makeCapeLighting } from './visual-lighthouse';

type LocalPoint = readonly [x: number, y: number, z: number];

function cavePoint(cave: PropDescriptor, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).multiply(cave.size)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), cave.transform.rotationY)
    .add(cave.transform.position);
}

async function mountainMasonry(cave: PropDescriptor): Promise<THREE.Object3D> {
  const data = readFileSync(new URL('../../public/assets/library/custom/mt-gigga/cave-arch.glb',
    import.meta.url));
  const model = (await new GLTFLoader().parseAsync(Uint8Array.from(data).buffer, '')).scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const masonry = model.getObjectsByProperty('type', 'Mesh').find(object =>
    (object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.name === 'rockDark')!;
  const fitted = new THREE.Group();
  fitted.add(masonry);
  fitted.scale.copy(cave.size).multiplyScalar(.98).divide(bounds.getSize(new THREE.Vector3()));
  fitted.position.copy(bounds.getCenter(new THREE.Vector3())).multiply(fitted.scale).negate();
  const arch = new THREE.Group();
  arch.add(fitted);
  arch.position.copy(cave.transform.position);
  arch.rotation.y = cave.transform.rotationY;
  arch.updateMatrixWorld(true);
  return arch;
}

it('matches both faces of the rendered cave masonry and keeps the opening clear to the back wall', async () => {
  const game = await Game.create();
  const island = game.island;
  const lighthouse = buildLighthouseVisuals(island, new THREE.Group(), makeCapeLighting(island));
  try {
    game.step();
    lighthouse.group.updateMatrixWorld(true);
    for (const cave of island.props.filter(p => p.kind === 'cave-mouth')) {
      const masonry = cave.poiId === 'mt-gigga' ? await mountainMasonry(cave) :
        lighthouse.group.getObjectByName('lighthouse-static-painted-landmarks')!;
      const colliders = [...game.colliders.props].filter(([id]) => id.startsWith(cave.id + '-'));
      const handles = new Set(colliders.map(([, collider]) => collider.handle));
      const allCave = new Set([...handles, game.colliders.props.get(cave.id)!.handle]);
      const rays: readonly (readonly [LocalPoint, LocalPoint])[] = [
        [[-.4, -.25, .8], [-.4, -.25, 0]],
        [[.4, -.25, .8], [.4, -.25, 0]],
        [[-.7, -.25, 0], [0, -.25, 0]],
        [[.7, -.25, 0], [0, -.25, 0]],
        [[0, -.25, 0], [-.6, -.25, 0]],
        [[0, -.25, 0], [.6, -.25, 0]],
        [[0, 0, 0], [0, .8, 0]],
        [[0, .8, 0], [0, 0, 0]],
      ];
      for (const [from, to] of rays) {
        const origin = cavePoint(cave, ...from);
        const direction = cavePoint(cave, ...to).sub(origin).normalize();
        const visible = new THREE.Raycaster(origin, direction).intersectObject(masonry);
        const solid = game.physics.raycast(origin, direction, 20,
          { predicate: collider => handles.has(collider.handle) });
        const context = cave.poiId + ' from ' + from.join(', ');
        expect(solid, context).toBeDefined();
        // The Lighthouse merges the arch with its rough face stones into one draw.
        const separation = Math.min(...visible.map(hit => Math.abs(hit.distance - solid!.distance)));
        expect(separation, context).toBeLessThan(.001);
      }
      for (const x of [-.18, 0, .18]) {
        const origin = cavePoint(cave, x, -.22, .8);
        const inward = cavePoint(cave, x, -.22, 0).sub(origin).normalize();
        const hit = game.physics.raycast(origin, inward, 20,
          { predicate: collider => allCave.has(collider.handle) });
        expect(hit?.collider.handle, cave.poiId).toBe(game.colliders.props.get(cave.id)!.handle);
      }
    }
  } finally {
    lighthouse.dispose();
    game.dispose();
  }
});

function walk(game: Game, cave: PropDescriptor, x: number, z: number,
  localYaw: number, ticks: number): THREE.Vector3[] {
  const start = cavePoint(cave, x / cave.size.x, 0, z / cave.size.z);
  const rotationY = cave.transform.rotationY;
  const yaw = localYaw - rotationY;
  const up = new THREE.Vector3(0, 1, 0);
  const ray = new RAPIER.Ray(start.clone().addScaledVector(up, 20), V(0, -1, 0));
  const distance = game.colliders.terrain.castRay(ray, 40, false);
  expect(distance).toBeGreaterThan(0);
  game.teleport(V(ray.origin.x, ray.origin.y - distance, ray.origin.z), -yaw);
  for (let i = 0; i < 45; i++) game.step({ cameraYaw: yaw });
  const path: THREE.Vector3[] = [];
  for (let i = 0; i < ticks; i++) {
    game.step({ moveZ: 1, cameraYaw: yaw });
    path.push(new THREE.Vector3().copy(game.goat.torso.translation())
      .sub(cave.transform.position).applyAxisAngle(up, -rotationY));
  }
  return path;
}

it('walks into the Mt. Gigga cave and stops against either visible jamb from outside or inside', async () => {
  const game = await Game.create();
  try {
    const cave = game.island.props.find(p => p.kind === 'cave-mouth' && p.poiId === 'mt-gigga')!;
    const entrance = walk(game, cave, 0, 4.4, 0, 100);
    expect(Math.min(...entrance.map(point => point.z))).toBeLessThan(-1.2);
    for (const side of [-1, 1]) {
      const exterior = walk(game, cave, side * 3.5, 4.4, 0, 105);
      const nearest = Math.min(...exterior.map(point => point.z));
      expect(nearest).toBeGreaterThan(1.45);
      expect(nearest).toBeLessThan(2.45);

      const interior = walk(game, cave, 0, .2, side * Math.PI / 2, 120);
      const furthest = Math.max(...interior.map(point => point.x * side));
      expect(furthest).toBeGreaterThan(1.9);
      expect(furthest).toBeLessThan(2.8);
    }
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});

it('enters the lighthouse sea cave and keeps walking out of the exposed solid masonry', async () => {
  const game = await Game.create();
  try {
    const cave = game.island.props.find(p => p.kind === 'cave-mouth' && p.poiId === 'old-lighthouse')!;
    const entrance = walk(game, cave, 0, 2.1, 0, 100);
    expect(Math.min(...entrance.map(point => point.z))).toBeLessThan(.85);
    const exterior = walk(game, cave, -3.25, 3.6, 0, 75);
    const nearest = Math.min(...exterior.map(point => point.z));
    expect(nearest).toBeGreaterThan(2.675);
    expect(nearest).toBeLessThan(3.5);

    const interior = walk(game, cave, 0, -1.45, Math.PI / 2, 125);
    const furthest = Math.max(...interior.map(point => point.x));
    expect(furthest).toBeGreaterThan(1.75);
    expect(furthest).toBeLessThan(2.385);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
