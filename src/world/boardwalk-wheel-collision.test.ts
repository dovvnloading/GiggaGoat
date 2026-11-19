import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { RAPIER } from '../physics';
import { boardwalkFarEnd } from './boardwalk';
import { buildRapierColliders } from './colliders';
import { generateIsland } from './island';
import { bakeLibraryPropGeometry } from './library-props';

it('seats the four authored wheel pads on the deck and aligns all eight support colliders with the steel', async () => {
  await RAPIER.init();
  const bytes = readFileSync(new URL('../../public/assets/library/custom/baaardwalk/ferris-wheel.glb',
    import.meta.url));
  const model = (await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')).scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3());
  const span = bounds.getSize(new THREE.Vector3());
  const geometry = bakeLibraryPropGeometry('ferris-wheel', model)!;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const rendered = new THREE.Mesh(geometry, material);
  try {
    for (const size of [400, 600, 900]) {
      const island = generateIsland({ seed: 'billy-isle', size, resolution: 97 });
      const wheel = island.props.find(p => p.kind === 'ferris-wheel')!;
      const deck = boardwalkFarEnd(island)!.deck;
      const floor = deck.transform.position.y + deck.size.y / 2;
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      try {
        const { props } = buildRapierColliders(world, island);
        const supports = [...props].filter(([id]) => id.startsWith(wheel.id + '-'));
        expect(supports).toHaveLength(8);
        expect(props.has(wheel.id)).toBe(false);

        rendered.position.copy(wheel.transform.position);
        rendered.scale.copy(wheel.size);
        rendered.rotation.y = wheel.transform.rotationY;
        rendered.updateMatrixWorld(true);
        const toWorld = (x: number, y: number, z: number): THREE.Vector3 =>
          rendered.localToWorld(new THREE.Vector3(x, y, z).sub(centre).divide(span).multiplyScalar(.98));

        for (const [id, support] of supports) {
          const side = id.includes('-left-') ? -1 : 1;
          const row = id.includes('-shore-') ? -1 : 1;
          const pad = id.endsWith('-pad');
          const z = row * 2.05;
          const begin = pad ? toWorld(side * 8.76, .15, row * 4) :
            toWorld(side * (8.4 - 8.1 * 1.5 / 15.2), 1.5, row * 4);
          const target = pad ? toWorld(side * 8.76, .15, z) :
            toWorld(side * (8.4 - 8.1 * 1.5 / 15.2), 1.5, z);
          const direction = target.sub(begin).normalize();
          const visual = new THREE.Raycaster(begin, direction).intersectObject(rendered)[0];
          const collision = support.castRay(new RAPIER.Ray(begin, direction), 20, false);
          expect(collision, id).toBeGreaterThan(0);
          expect(visual?.distance, id).toBeCloseTo(collision, 3);

          if (pad) {
            const beneath = toWorld(side * 8.76, -.5, z);
            const up = new THREE.Vector3(0, 1, 0);
            const foot = new THREE.Raycaster(beneath, up).intersectObject(rendered)[0];
            expect(foot?.point.y, id).toBeCloseTo(floor, 4);
            const padBottom = support.castRay(new RAPIER.Ray(beneath, up), 20, false);
            expect(beneath.y + padBottom, id).toBeCloseTo(floor, 4);
          }
        }
      } finally {
        world.free();
      }
    }
  } finally {
    geometry.dispose();
    material.dispose();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    });
  }
});

it('walks through the middle in both directions and meets the supports in either side lane', async () => {
  const game = await Game.create();
  try {
    game.step();
    const wheel = game.island.props.find(p => p.kind === 'ferris-wheel')!;
    const { x, z } = wheel.transform.position;
    const deck = boardwalkFarEnd(game.island)!.deck;
    const floor = deck.transform.position.y + deck.size.y / 2;
    function approach(xOffset: number, side: number): number {
      const cameraYaw = side > 0 ? Math.PI : 0;
      game.teleport({ x: x + xOffset, y: floor, z: z - 6 * side }, -cameraYaw);
      for (let i = 0; i < 40; i++) game.step({ cameraYaw });
      let furthest = -Infinity;
      for (let i = 0; i < 130; i++) {
        game.step({ cameraYaw, moveZ: 1 });
        furthest = Math.max(furthest, (game.goat.torso.translation().z - z) * side);
        if (xOffset === 0) expect(game.goat.locomotion.grounded).toBe(true);
      }
      return furthest;
    }
    for (const direction of [-1, 1]) expect(approach(0, direction)).toBeGreaterThan(2);
    for (const xOffset of [-8.232, 8.232]) {
      const furthest = approach(xOffset, 1);
      expect(furthest).toBeGreaterThan(-3);
      expect(furthest).toBeLessThan(0);
    }
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
