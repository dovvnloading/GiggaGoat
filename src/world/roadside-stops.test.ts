import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Game } from '../core/Game';
import { add, forward, mul, RAPIER, sub, V } from '../physics';
import { generateIsland, heightAt } from './island';
import { bakeLibraryPropGeometry, PROP_LIBRARY_MODELS } from './library-props';
import { roadRibbonData } from './road-ribbons';
import { COAST_TURNOUT_GNOME_ID, roadsideGravelAt, roadsideStops } from './roadside-stops';
import { gridSample } from './terrain';
import type { PropColliderDescriptor, Vec2 } from './types';
import { paintRoadsideGravel } from './visual-roadside-stops';
import { createWorldScene } from './render';

type StopFrame = Pick<ReturnType<typeof roadsideStops>[number], 'origin' | 'scale' | 'tangent' | 'normal'>;

function worldPoint(stop: StopFrame, along: number, across: number): Vec2 {
  return {
    x: stop.origin.x + (stop.tangent.x * along + stop.normal.x * across) * stop.scale,
    z: stop.origin.z + (stop.tangent.z * along + stop.normal.z * across) * stop.scale,
  };
}

function coastFrame(island: ReturnType<typeof generateIsland>): StopFrame {
  const road = island.roads.find(r => r.id === 'baa-ardwalk--downtown-bleatsville')!;
  const [a, origin, b] = road.points.slice(9, 12);
  const length = Math.hypot(b!.x - a!.x, b!.z - a!.z);
  const tangent = { x: (b!.x - a!.x) / length, z: (b!.z - a!.z) / length };
  return { origin: origin!, scale: island.size / 600, tangent, normal: { x: -tangent.z, z: tangent.x } };
}

function outsideCollider(point: Vec2, collider: PropColliderDescriptor, margin: number): boolean {
  const { position, rotationY } = collider.transform;
  const dx = point.x - position.x, dz = point.z - position.z;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  return Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - collider.size.x / 2),
    Math.max(0, Math.abs(s * dx + c * dz) - collider.size.z / 2)) >= margin;
}

describe('Billy Isle roadside stops', () => {
  it.each([
    ['billy-isle', 600, 193], ['alternate-district', 600, 193], ['riverside', 600, 97],
    ['large-coast', 850, 193], ['little-coast', 400, 97],
  ] as const)('keeps signed stops, clear entry lanes and every roadway open on %s', (seed, size, resolution) => {
    const island = generateIsland({ seed, size, resolution });
    const stops = roadsideStops(island);
    expect(stops.length).toBeGreaterThanOrEqual(seed === 'large-coast' ? 2 : 3);
    const solidColliders = island.colliders.filter(collider => collider.shape !== 'heightfield');
    const ribbon = roadRibbonData(island, 'road');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3));
    geometry.setIndex(ribbon.supportIndices);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const stop of stops) {
      const prefix = 'roadside-' + stop.plan.id + '-';
      const props = island.props.filter(p => p.id.startsWith(prefix));
      expect(props.some(p => p.body.type === 'dynamic' && p.lickable && p.breakable)).toBe(true);
      for (const prop of props) {
        const { position, rotationY } = prop.transform;
        expect(prop.poiId).toBeUndefined();
        expect(island.colliders.some(c => c.shape !== 'heightfield' && c.id === prop.id)).toBe(true);
        expect(position.y - prop.size.y / 2).toBeCloseTo(gridSample(island, position.x, position.z), 6);
        for (const u of [-.5, 0, .5]) for (const v of [-.5, 0, .5]) {
          const c = Math.cos(rotationY), s = Math.sin(rotationY);
          ray.ray.origin.set(position.x + c * u * prop.size.x + s * v * prop.size.z,
            40, position.z + c * v * prop.size.z - s * u * prop.size.x);
          expect(ray.intersectObject(mesh), prop.id).toHaveLength(0);
        }
      }
      for (let d = 4; d <= 15; d += .5) {
        const point = worldPoint(stop, 0, d);
        expect(roadsideGravelAt(stops, point.x, point.z)).toBe(true);
        const ground = gridSample(island, point.x, point.z);
        expect(solidColliders.filter(c =>
          c.transform.position.y - c.size.y / 2 < ground + 1.7 * stop.scale &&
          c.transform.position.y + c.size.y / 2 > ground + .08 * stop.scale &&
          !outsideCollider(point, c, .68 * stop.scale)).map(c => c.id), stop.plan.id).toEqual([]);
      }
    }
    geometry.dispose();
    material.dispose();
  });

  it('walks each new turnout from the road and back in the real physics world', async () => {
    const game = await Game.create();
    try {
      for (const stop of roadsideStops(game.island)) {
        game.step();
        const { x, z } = stop.origin;
        const floor = game.physics.raycast(V(x, 45, z), V(0, -1, 0), 65, {
          predicate: collider => !game.goat.ownsBody(collider.parent()),
        });
        expect(floor).not.toBeNull();
        game.teleport(V(x, floor!.point.y, z), 0);
        for (let i = 0; i < 20; i++) game.step();
        for (const across of [13, 0]) {
          const target = worldPoint(stop, 0, across);
          for (let i = 0; i < 360; i++) {
            const p = game.goat.torso.translation();
            const dx = target.x - p.x, dz = target.z - p.z;
            if (Math.hypot(dx, dz) < .55) break;
            game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
          }
          const p = game.goat.torso.translation();
          expect(Math.hypot(target.x - p.x, target.z - p.z), stop.plan.id + ' across ' + across).toBeLessThan(.55);
        }
        const breakable = game.island.props.find(p => p.id.startsWith('roadside-' + stop.plan.id) && p.breakable);
        expect(game.colliders.bodies.get(breakable!.id)?.isDynamic()).toBe(true);
      }
    } finally {
      game.dispose();
    }
  });

  it('uses the selected entrances for both terrain LODs', () => {
    const island = generateIsland({ resolution: 97 });
    const shader = {
      uniforms: {}, fragmentShader: THREE.ShaderLib.toon!.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;
    paintRoadsideGravel(shader, island);
    expect(shader.fragmentShader).toContain('roadsideGravel(diffuseColor.rgb, vWorld.xz, uTerrainScale)');
    const frames = shader.uniforms['uRoadsideFrames']!.value as THREE.Vector4[];
    expect(frames.map(frame => [frame.x, frame.y])).toEqual(roadsideStops(island)
      .map(stop => [stop.origin.x, stop.origin.z]));
  });

  it('seats the short coastal turnout off the asphalt with space between both loaded props', async () => {
    const island = generateIsland();
    const props = island.props.filter(p => p.id.startsWith('roadside-coast-turnout-'));
    expect(props.map(p => p.kind)).toEqual(['bench', 'gnome']);
    expect(roadsideStops(island).map(stop => stop.plan.id))
      .toEqual(['meadow-picnic', 'yard-layby', 'bay-overlook']);
    const [bench, gnome] = props;
    expect(gnome).toMatchObject({ body: { type: 'dynamic' }, lickable: true });
    const stop = coastFrame(island);
    const scene = createWorldScene(island);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    try {
      scene.group.updateMatrixWorld(true);
      const road = scene.group.getObjectByName('paths-road')!;
      const terrainY = (x: number, z: number) => {
        ray.ray.origin.set(x, 40, z);
        return ray.intersectObjects(scene.chunks)[0]!.point.y;
      };
      const solids = island.colliders.filter(c => c.shape !== 'heightfield');
      for (const [prop, kind] of [[bench!, 'bench'], [gnome!, 'gnome']] as const) {
        const collider = solids.find(c => c.id === prop.id);
        expect(collider).toMatchObject({ transform: prop.transform, size: prop.size });
        const envelope = Math.hypot(prop.size.x, prop.size.z) / 2;
        expect(solids.filter(c => c !== collider &&
          !outsideCollider(prop.transform.position, c, envelope + .55)), prop.id).toEqual([]);
        const instance = scene.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        const index = island.props.filter(p => p.kind === kind).indexOf(prop);
        const matrix = new THREE.Matrix4();
        instance.getMatrixAt(index, matrix);
        expect(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(prop.transform.position)).toBeLessThan(.0001);
        const file = readFileSync(new URL('../../public/' + PROP_LIBRARY_MODELS[kind], import.meta.url));
        const root = (await new GLTFLoader().parseAsync(Uint8Array.from(file).buffer, '')).scene;
        const geometry = bakeLibraryPropGeometry(kind, root)!;
        const local = geometry.boundingBox!;
        const positions = geometry.getAttribute('position');
        const world = new THREE.Vector3();
        const footGaps: number[] = [];
        // The entire imported footprint is inside these corners, which clear the ribbon.
        for (const x of [local.min.x, local.max.x]) for (const z of [local.min.z, local.max.z]) {
          world.set(x, local.min.y, z).applyMatrix4(matrix);
          ray.ray.origin.set(world.x, 40, world.z);
          expect(ray.intersectObject(road), prop.id).toHaveLength(0);
        }
        for (let i = 0; i < positions.count; i++) {
          if (positions.getY(i) - local.min.y >= .025) continue;
          world.fromBufferAttribute(positions, i).applyMatrix4(matrix);
          footGaps.push(world.y - terrainY(world.x, world.z));
        }
        expect(Math.min(...footGaps), prop.id).toBeLessThan(.04);
        expect(Math.max(...footGaps), prop.id).toBeLessThan(.10);
        expect(Math.min(...footGaps), prop.id).toBeGreaterThan(-.18);
        geometry.dispose();
      }
      const width = island.roads.find(r => r.id === 'baa-ardwalk--downtown-bleatsville')!.width;
      expect(width).toBe(7.5);
      for (const side of [-1, 1]) {
        const inner = worldPoint(stop, .6, side * (width / 2 - .04));
        ray.ray.origin.set(inner.x, 40, inner.z);
        expect(ray.intersectObject(road)).toHaveLength(1);
        const outer = worldPoint(stop, .6, side * (width / 2 + .08));
        ray.ray.origin.set(outer.x, 40, outer.z);
        expect(ray.intersectObject(road)).toHaveLength(0);
      }
    } finally {
      scene.dispose();
    }
  });

  it('walks from Baa-ardwalk toward Downtown, enters the turnout and licks the gnome before returning', async () => {
    const game = await Game.create();
    try {
      const stop = coastFrame(game.island);
      const start = worldPoint(stop, -8, 0);
      const approachYaw = Math.atan2(stop.tangent.x, -stop.tangent.z);
      game.step();
      const road = game.physics.raycast(V(start.x, 35, start.z), V(0, -1, 0), 40)!;
      game.teleport(road.point, -approachYaw);
      for (let tick = 0; tick < 20; tick++) game.step();
      const walk = (along: number, across: number) => {
        const target = worldPoint(stop, along, across);
        for (let tick = 0; tick < 270; tick++) {
          const p = game.goat.torso.translation();
          const dx = target.x - p.x, dz = target.z - p.z;
          if (Math.hypot(dx, dz) < .25) break;
          game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz), climb: false });
        }
        const p = game.goat.torso.translation();
        expect(Math.hypot(target.x - p.x, target.z - p.z), 'turnout ' + along + '/' + across).toBeLessThan(.25);
      };
      walk(-3.8, 3.2);
      walk(-1.3, 5.25);
      walk(0, 6.5);
      walk(0, 4.0);
      walk(2.1, 4.0);
      const body = game.colliders.bodies.get(COAST_TURNOUT_GNOME_ID)!;
      const gnome = body.translation();
      const originalProp = game.island.props.find(p => p.id === COAST_TURNOUT_GNOME_ID)!;
      expect(Math.hypot(gnome.x - originalProp.transform.position.x, gnome.z - originalProp.transform.position.z))
        .toBeLessThan(.4);
      for (let tick = 0; tick < 6; tick++) {
        const p = game.goat.torso.translation();
        const look = Math.atan2(gnome.x - p.x, p.z - gnome.z);
        game.step({ moveZ: 1, cameraYaw: look, climb: false });
      }
      for (let tick = 0; tick < 24; tick++) game.step();
      for (let tick = 0; tick < 6; tick++) game.step({ tongue: true });
      expect(game.goat.interactions.tongueBody?.handle).toBe(body.handle);
      game.step({ tongue: false });
      walk(0, 6.5);
      walk(5, 0);
      walk(10, 0);
    } finally {
      game.dispose();
    }
  });

  it('reacquires the coast gnome after walking it downhill and respects intervening scenery', async () => {
    const game = await Game.create();
    try {
      const { goat } = game;
      const body = game.colliders.bodies.get(COAST_TURNOUT_GNOME_ID)!;
      const ticks = (count: number, input: Parameters<Game['step']>[0] = {}) => {
        for (let tick = 0; tick < count; tick++) game.step(input);
      };
      const faceGnome = (x: number, z: number) => {
        const target = body.translation();
        const cameraYaw = Math.atan2(target.x - x, z - target.z);
        game.teleport(V(x, heightAt(game.island, x, z), z), -cameraYaw);
        ticks(24, { cameraYaw });
        expect(goat.locomotion.grounded).toBe(true);
        return cameraYaw;
      };

      ticks(88);
      const startingGnome = body.translation();
      const approach = faceGnome(98.4, 215.45);
      ticks(38, { moveZ: 1, cameraYaw: approach });
      ticks(45, { cameraYaw: approach });
      expect(body.translation().y).toBeLessThan(startingGnome.y - .15);

      const cameraYaw = faceGnome(101.215, 215.246);
      const tongue = goat.interactions;
      const origin = tongue.tongueOrigin;
      const directionToGnome = () => sub(body.translation(), tongue.tongueOrigin);
      expect(tongue.raycastTongue()).toBeNull();
      expect(tongue.raycastTongue(directionToGnome())?.body?.handle).toBe(body.handle);

      // A small solid object can occlude the gnome below the ordinary tongue ray.
      const blockPoint = add(origin, mul(directionToGnome(), .55));
      const blocker = game.physics.raw.createCollider(
        RAPIER.ColliderDesc.ball(.12).setTranslation(blockPoint.x, blockPoint.y, blockPoint.z),
      );
      game.step();
      expect(tongue.raycastTongue(directionToGnome())?.collider.handle).toBe(blocker.handle);
      expect(tongue.raycastTongue()).toBeNull();
      game.step({ tongue: true, cameraYaw });
      expect(tongue.isTongueAttached).toBe(false);
      game.physics.raw.removeCollider(blocker, true);
      game.step();

      // Scenery on the ordinary ray still gets the tether when the gnome is visible below it.
      const facing = forward(goat.locomotion.heading);
      const sceneryPoint = add(tongue.tongueOrigin, add(mul(facing, .9), V(0, -.08, 0)));
      const scenery = game.physics.raw.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(sceneryPoint.x, sceneryPoint.y, sceneryPoint.z),
      );
      game.physics.raw.createCollider(RAPIER.ColliderDesc.ball(.14), scenery);
      game.step();
      expect(tongue.raycastTongue(directionToGnome())?.body?.handle).toBe(body.handle);
      game.step({ tongue: true, cameraYaw });
      expect(tongue.tongueBody?.handle).toBe(scenery.handle);
      game.step();
      game.physics.raw.removeRigidBody(scenery);
      ticks(24);

      game.step({ tongue: true, cameraYaw });
      expect(tongue.tongueBody?.handle).toBe(body.handle);
      const beforeTow = body.translation();
      ticks(34, { tongue: true, moveZ: -1, cameraYaw });
      const towed = body.translation();
      expect(Math.hypot(towed.x - beforeTow.x, towed.z - beforeTow.z)).toBeGreaterThan(.25);
      game.step();
      expect(tongue.isTongueAttached).toBe(false);
    } finally {
      game.dispose();
    }
  });

  it('keeps terrain latches when aiming away from the gnome on the lower slope', async () => {
    const game = await Game.create();
    try {
      for (let tick = 0; tick < 88; tick++) game.step();
      const { goat } = game;
      const body = game.colliders.bodies.get(COAST_TURNOUT_GNOME_ID)!;
      const x = 103, z = 219;
      const target = body.translation();
      const gnomeYaw = Math.atan2(target.x - x, z - target.z);
      for (const [aim, expectsGnome] of [[gnomeYaw - .5, false], [gnomeYaw, true]] as const) {
        game.teleport(V(x, heightAt(game.island, x, z), z), -aim);
        for (let tick = 0; tick < 25; tick++) game.step({ cameraYaw: aim });
        expect(goat.interactions.raycastTongue()?.collider.handle).toBe(game.colliders.terrain.handle);
        game.step({ tongue: true, cameraYaw: aim });
        expect(goat.interactions.isTongueAttached).toBe(true);
        expect(goat.interactions.tongueBody?.handle === body.handle).toBe(expectsGnome);
        game.step();
      }
    } finally {
      game.dispose();
    }
  });
});
