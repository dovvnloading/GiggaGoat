import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Game } from '../core/Game';
import { V } from '../physics';
import { generateIsland } from './island';
import { roadRibbonData } from './road-ribbons';
import { roadsideGravelAt, roadsideStops } from './roadside-stops';
import { gridSample } from './terrain';
import type { PropColliderDescriptor, Vec2 } from './types';
import { paintRoadsideGravel } from './visual-roadside-stops';

function worldPoint(stop: ReturnType<typeof roadsideStops>[number], along: number, across: number): Vec2 {
  return {
    x: stop.origin.x + (stop.tangent.x * along + stop.normal.x * across) * stop.scale,
    z: stop.origin.z + (stop.tangent.z * along + stop.normal.z * across) * stop.scale,
  };
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
      uniforms: {}, fragmentShader: '#include <common>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uStone, rock);',
    } as THREE.WebGLProgramParametersWithUniforms;
    paintRoadsideGravel(shader, island);
    expect(shader.fragmentShader).toContain('roadsideGravel(diffuseColor.rgb, vWorld.xz, uTerrainScale)');
    const frames = shader.uniforms['uRoadsideFrames']!.value as THREE.Vector4[];
    expect(frames.map(frame => [frame.x, frame.y])).toEqual(roadsideStops(island)
      .map(stop => [stop.origin.x, stop.origin.z]));
  });
});
