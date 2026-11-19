import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from '../core/Game';
import { buildRapierColliders, createWorldScene, generateIsland } from './index';
import { gridSample, riverAt, segmentProjection } from './terrain';
import type { IslandData, PropDescriptor } from './types';
import { bakeLibraryPropGeometry, PROP_LIBRARY_MODELS } from './library-props';
import { sectionCenter } from './access-path';
import { overlapsPinesLogEntry, PINES_LOG_ENTRY_ID, pinesLogEntries } from './pines-log-access';
import { appendPinesLogEntries } from './visual-pines-log-access';

function props(island: IslandData, kind: 'fern' | 'lily-pads' | 'mushroom'): PropDescriptor[] {
  return island.props.filter(p => p.poiId === 'whispering-pines' && p.kind === kind);
}

const seeds = [
  { seed: 'billy-isle', size: 600, resolution: 193 },
  { seed: 'pines-alt', size: 900, resolution: 97 },
] as const;

describe('Whispering Pines seeded glade dressing (WP-6)', () => {
  it.each(seeds)('places best-effort, noninteractive, dry ferns and river lily pads for $seed at $size m',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const woods = island.pois.find(p => p.id === 'whispering-pines')!.center;
      const bridge = island.props.find(p =>
        p.poiId === 'whispering-pines' && p.kind === 'log-bridge');
      expect(bridge).toBeDefined();
      for (const prop of island.props.filter(p => p.poiId === 'whispering-pines' && p.collidable && p !== bridge)) {
        expect(overlapsPinesLogEntry(bridge!, prop, size / 600), prop.id + ' clear of the log approaches').toBe(false);
      }
      const anchor = bridge?.transform.position ?? woods;
      const ferns = props(island, 'fern');
      const pads = props(island, 'lily-pads');
      expect(ferns.length).toBeGreaterThanOrEqual(5);
      expect(ferns.length).toBeLessThanOrEqual(40);
      expect(pads.length).toBeGreaterThanOrEqual(1);
      expect(pads.length).toBeLessThanOrEqual(10);

      for (const prop of [...ferns, ...pads]) {
        expect(prop.body).toEqual({ type: 'static' });
        expect(prop.shape).toBe('cuboid');
        expect(prop.collidable, prop.id).toBe(false);
        expect(prop.breakable, prop.id).toBe(false);
        expect(prop.lickable, prop.id).toBe(false);
        expect(prop.climbable, prop.id).toBe(false);
        expect(prop.transform.rotationY, prop.id).toBeGreaterThanOrEqual(0);
        expect(prop.transform.rotationY, prop.id).toBeLessThan(Math.PI * 2);
      }
      for (const fern of ferns) {
        const { x, y, z } = fern.transform.position;
        const river = riverAt({ x, z }, island.river);
        expect(Math.hypot(x - woods.x, z - woods.z), fern.id + ' POI radius')
          .toBeLessThanOrEqual(60 + 1e-6);
        expect(gridSample(island, x, z), fern.id + ' dry ground')
          .toBeGreaterThan(island.seaLevel);
        expect(river.distance, fern.id + ' bank clearance')
          .toBeGreaterThan(river.width / 2 + 1.5);
        expect(fern.size.x, fern.id).toBeGreaterThanOrEqual(1.2);
        expect(fern.size.x, fern.id).toBeLessThanOrEqual(1.9);
        expect(fern.size.z).toBeCloseTo(fern.size.x, 6);
        expect(fern.size.y).toBeCloseTo(fern.size.x * 0.55, 6);
        expect(y - fern.size.y / 2).toBeCloseTo(gridSample(island, x, z), 5);
        expect(island.props.every(other => other === fern ||
          Math.hypot(x - other.transform.position.x, z - other.transform.position.z) >=
            1.5 - 1e-6), fern.id + ' other-prop clearance').toBe(true);
      }
      for (const pad of pads) {
        const { x, y, z } = pad.transform.position;
        const river = riverAt({ x, z }, island.river);
        const lateral = river.distance / (river.width / 2);
        expect(Math.hypot(x - anchor.x, z - anchor.z), pad.id + ' bridge radius')
          .toBeLessThanOrEqual(25 + 1e-6);
        expect(lateral, pad.id + ' river edge fraction').toBeGreaterThanOrEqual(0.25 - 1e-6);
        expect(lateral, pad.id + ' river edge fraction').toBeLessThanOrEqual(0.45 + 1e-6);
        expect(y, pad.id + ' water surface').toBeCloseTo(river.level + 0.02, 6);
        expect(pad.size.x, pad.id).toBeGreaterThanOrEqual(1.2);
        expect(pad.size.x, pad.id).toBeLessThanOrEqual(1.6);
        expect(pad.size.z).toBeCloseTo(pad.size.x, 6);
        expect(pad.size.y).toBeCloseTo(0.08, 6);
      }

      const pavedRoads = island.roads.filter(road => road.type === 'road' &&
        (road.from === 'whispering-pines' || road.to === 'whispering-pines'));
      const lowDetails = island.props.filter(prop => prop.poiId === 'whispering-pines' &&
        ['mushroom', 'stump', 'fern', 'bush', 'flower', 'grass-tuft'].includes(prop.kind));
      for (const prop of lowDetails) {
        const radius = Math.hypot(prop.size.x, prop.size.z) / 2;
        for (const road of pavedRoads) {
          const nearest = Math.min(...road.points.slice(1).map((point, i) =>
            segmentProjection(prop.transform.position, road.points[i]!, point).distance));
          expect(nearest, prop.id + ' clear of ' + road.id).toBeGreaterThan(road.width / 2 + radius);
        }
      }

      const upstreamWater = island.river.slice(0, 5);
      for (const pine of island.props.filter(prop => prop.poiId === 'mt-gigga' && prop.kind === 'tree-pine')) {
        const water = riverAt(pine.transform.position, upstreamWater);
        expect(water.distance, pine.id + ' clear of the upper river')
          .toBeGreaterThanOrEqual(water.width / 2 + Math.min(.9, pine.size.x * .2));
      }

      const mushrooms = props(island, 'mushroom');
      expect(mushrooms.length).toBeGreaterThan(0);
      expect(mushrooms.filter(p => Math.abs(p.size.y - 1.4) < 1e-6),
        seed + ' single hero mushroom').toHaveLength(1);
      for (const mushroom of mushrooms) {
        const h = mushroom.size.y;
        if (Math.abs(h - 1.4) >= 1e-6) {
          expect(h, mushroom.id).toBeGreaterThanOrEqual(0.4);
          expect(h, mushroom.id).toBeLessThanOrEqual(0.9);
        }
        expect(mushroom.size.x, mushroom.id).toBeCloseTo(0.85 * h, 6);
        expect(mushroom.size.z, mushroom.id).toBeCloseTo(h, 6);
      }
    });

  it('replays both glade species and mushroom hero identically, without seed-dependent throws', () => {
    const select = (seed: string) => generateIsland({ seed, resolution: 97 }).props
      .filter(p => p.poiId === 'whispering-pines' &&
        (p.kind === 'fern' || p.kind === 'lily-pads' || p.kind === 'mushroom'))
      .map(p => ({ id: p.id, kind: p.kind, transform: p.transform, size: p.size }));
    expect(select('billy-isle')).toEqual(select('billy-isle'));
    expect(select('billy-isle')).not.toEqual(select('pines-alt'));
    for (const seed of ['forest-low-1', 'forest-low-2', 'forest-low-3']) {
      expect(() => generateIsland({ seed, resolution: 97 }),
        seed + ' dressing should be best effort').not.toThrow();
    }
  });
});

it('draws the same supported bank treads with fallback and loaded log art', async () => {
  await RAPIER.init();
  const island = generateIsland();
  const bridge = island.props.find(prop => prop.kind === 'log-bridge' && prop.poiId === 'whispering-pines')!;
  const bytes = await readFile(new URL('../../public/' + PROP_LIBRARY_MODELS['log-bridge'], import.meta.url));
  const { scene: raw } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  const prepared = bakeLibraryPropGeometry('log-bridge', raw)!;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const loaded = new THREE.Mesh(appendPinesLogEntries(prepared, island, bridge), material);
  const { position, rotationY } = bridge.transform;
  loaded.position.set(position.x, position.y, position.z);
  loaded.rotation.y = rotationY;
  loaded.scale.set(bridge.size.x, bridge.size.y, bridge.size.z);
  loaded.updateMatrixWorld(true);
  const fallback = createWorldScene(island);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    const placeholder = fallback.group.getObjectByName('props-log-bridge')!;
    expect(placeholder).toBeInstanceOf(THREE.InstancedMesh);
    const { props: colliders, terrain } = buildRapierColliders(world, island);
    const entries = pinesLogEntries(island, bridge);
    for (const { side, sections, southToe } of entries) for (const [index, section] of sections.slice(1).entries()) {
      if (southToe && index === 0) continue;
      const a = sectionCenter(sections[index]!), b = sectionCenter(section);
      for (const across of [-.6, 0, .6]) {
        const x = (a.x + b.x) / 2 + Math.cos(rotationY) * across;
        const z = (a.z + b.z) / 2 - Math.sin(rotationY) * across;
        const y = (a.y + b.y) / 2 + 2;
        const hit = colliders.get(PINES_LOG_ENTRY_ID + side + '-tread-' + index)!
          .castRay(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), 5, false);
        expect(hit).toBeCloseTo(2, 4);
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0));
        for (const art of [placeholder, loaded]) expect(ray.intersectObject(art)[0]!.distance).toBeCloseTo(hit, 2);
      }
    }
    const toe = entries[0]!.southToe!;
    const first = toe[0]!, last = toe.at(-1)!;
    const panels = [...colliders].filter(([id]) => id.startsWith(PINES_LOG_ENTRY_ID + '-1-tread-0-'))
      .map(([, collider]) => collider);
    // The previous flat timber disappeared under the real terrain halfway
    // across this nose. Cast against terrain, both art paths and Rapier.
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const { lerp } = THREE.MathUtils;
    for (let station = 0; station < 33; station++) for (let lane = 0; lane < 17; lane++) {
      const t = .003 + station * .994 / 32, u = .004 + lane * .992 / 16;
      const at = (axis: 'x' | 'z') => lerp(lerp(first[0]![axis], first.at(-1)![axis], u),
        lerp(last[0]![axis], last.at(-1)![axis], u), t);
      const x = at('x'), z = at('z'), y = 15;
      ray.ray.origin.set(x, y, z);
      const down = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
      const ground = terrain.castRay(down, 20, false);
      const hits = panels.map(panel => panel.castRay(down, 20, false)).filter(d => d >= 0);
      const solid = Math.min(...hits);
      expect(solid).toBeLessThan(ground - .004);
      if (station === 0) expect(ground - solid).toBeLessThan(.035);
      for (const art of [placeholder, loaded]) {
        expect(Math.abs(ray.intersectObject(art)[0]!.distance - solid)).toBeLessThan(.002);
      }
    }
  } finally {
    world.free();
    fallback.dispose();
    loaded.geometry.dispose();
    material.dispose();
    raw.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        for (const coat of Array.isArray(node.material) ? node.material : [node.material]) coat.dispose();
      }
    });
  }
});

it('walks on and off both sides of the fitted south landing with normal ground input', async () => {
  const game = await Game.create();
  try {
    const bridge = game.island.props.find(p => p.kind === 'log-bridge' && p.poiId === 'whispering-pines')!;
    const { position, rotationY } = bridge.transform;
    const s = Math.sin(rotationY), c = Math.cos(rotationY);
    const toe = bridge.size.z / 2 + 4.7;
    const point = (along: number, across: number) =>
      ({ x: position.x + s * along + c * across, z: position.z + c * along - s * across });
    for (const lane of [-.62, .62]) {
      const start = point(-toe - .9, lane);
      game.teleport({ ...start, y: gridSample(game.island, start.x, start.z) });
      for (let tick = 0; tick < 24; tick++) game.step();
      for (const target of [point(-toe + 3.25, lane), start]) {
        const error = () => {
          const { x, z } = game.goat.torso.translation();
          return { dx: target.x - x, dz: target.z - z };
        };
        for (let tick = 0; tick < 210; tick++) {
          const { dx, dz } = error();
          if (Math.hypot(dx, dz) < .33) break;
          game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz), climb: false });
          expect(game.goat.locomotion.isClinging).toBe(false);
        }
        const { dx, dz } = error();
        expect(Math.hypot(dx, dz), 'south toe lane ' + lane).toBeLessThan(.33);
      }
    }
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});

it.each(seeds)('paints only the terrain at both log approaches for $seed', options => {
  const island = generateIsland(options);
  const bridge = island.props.find(p => p.poiId === 'whispering-pines' && p.kind === 'log-bridge')!;
  const scale = island.size / 600;
  const view = createWorldScene(island);
  try {
    const material = view.chunks[0]!.material as THREE.MeshToonMaterial;
    const shader = { ...THREE.ShaderLib.toon, uniforms: {} } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain(
      'diffuseColor.rgb = pinesApronGround(diffuseColor.rgb, vWorld.xz, uTerrainScale);');
    expect(shader.fragmentShader).toContain('return terrain;');
    const frames = shader.uniforms['uPinesApronFrame']!.value as THREE.Vector4[];
    const limits = shader.uniforms['uPinesApronLimit']!.value as THREE.Vector3[];
    expect(frames).toHaveLength(2);
    expect(limits).toHaveLength(2);
    const { smoothstep, lerp, clamp } = THREE.MathUtils;
    const at = (frame: THREE.Vector4, limit: THREE.Vector3, x: number, z: number) => {
      const dx = (x - frame.x) / scale, dz = (z - frame.y) / scale;
      const along = dx * frame.z + dz * frame.w;
      const across = Math.abs(dz * frame.z - dx * frame.w);
      const width = lerp(limit.x, limit.y, clamp(along / limit.z, 0, 1));
      return (1 - smoothstep(across, width - .22, width + .03)) *
        smoothstep(along, -1.25, -.70) * (1 - smoothstep(along, limit.z - .42, limit.z));
    };
    for (const [i, entry] of pinesLogEntries(island, bridge).entries()) {
      const frame = frames[i]!, limit = limits[i]!;
      const toe = sectionCenter(entry.sections[0]);
      const joint = sectionCenter(entry.sections[1]);
      const length = Math.hypot(joint.x - toe.x, joint.z - toe.z);
      expect(frame.toArray()).toEqual([toe.x, toe.z, (joint.x - toe.x) / length, (joint.z - toe.z) / length]);
      expect(limit.z).toBeCloseTo(entry.side < 0 ? 1.927 : .987);
      const sample = (along: number, across: number) => at(frame, limit,
        toe.x + scale * (along * frame.z - across * frame.w),
        toe.z + scale * (along * frame.w + across * frame.z));
      expect(sample(0, 0)).toBe(1);
      expect(sample(-.96, 0)).toBeGreaterThan(.25);
      expect(sample(-.96, 0)).toBeLessThan(.75);
      expect(sample(0, limit.x - .08)).toBeGreaterThan(.35);
      expect(sample(0, limit.x - .08)).toBeLessThan(.65);
      expect(sample(0, limit.x + .075)).toBe(0);
      expect(sample(-1.35, 0)).toBe(0);
      expect(at(frame, limit, joint.x, joint.z)).toBe(0);
      expect(sample(length / scale + 4, 0)).toBe(0);
    }
    if (options.seed === 'billy-isle') {
      // The measured raised turf on the south entrance stays in the brown
      // tread approach, even across the high side of the crossfall.
      expect(at(frames[0]!, limits[0]!, -120.170, -150.057)).toBe(1);
      expect(at(frames[0]!, limits[0]!, -119.009, -149.999)).toBeGreaterThan(.65);
      expect(at(frames[0]!, limits[0]!, -119.099, -150.620)).toBeGreaterThan(.75);
    }
    const camera = new THREE.PerspectiveCamera(60, 1.75, .1, 2000);
    camera.position.set(0, 800 * scale, 0);
    camera.lookAt(bridge.transform.position.x, 0, bridge.transform.position.z);
    const near = view.chunks[0]!.geometry;
    view.updateCulling(camera);
    expect(view.chunks[0]!.geometry).not.toBe(near);
    expect(view.chunks[0]!.material).toBe(material);
  } finally {
    view.dispose();
  }
});
