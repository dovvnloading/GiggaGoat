import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWorldScene, generateIsland, heightAt, isSafeCollectiblePosition } from './index';
import { findBookmark } from './viewer/bookmarks';
import { instantiateLibraryModel, keeperCottageFoundationGeometry,
  makeLighthouseFooting } from './visual-lighthouse';
import { BUILDING_RAMP, TOON_RAMP } from './visual-props';
import { bakeLibraryPropGeometry } from './library-props';
import { gridSample } from './terrain';
import { keeperCottagePiers, lighthouseAccess } from './lighthouse-access';
import { buildRapierColliders } from './colliders';
import { accessArrows, accessPathVisual } from './visual-access-path';

function renderedCapeSurface(view: ReturnType<typeof createWorldScene>, scale: number) {
  view.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 220 * scale);
  return (x: number, z: number): number => {
    ray.ray.origin.set(x, 120 * scale, z);
    return ray.intersectObjects(view.chunks, false)[0]!.point.y;
  };
}

describe('Old Lighthouse painting rebuild', () => {
  it('ships the rowboat hull and its authored colour palette in the same response', () => {
    const pack = 'public/assets/library/kenney/watercraft-kit/';
    const model = readFileSync(pack + 'boat-row-small.glb');
    const jsonEnd = 20 + model.readUInt32LE(12);
    const gltf = JSON.parse(model.toString('utf8', 20, jsonEnd));
    const paint = gltf.materials[0].pbrMetallicRoughness.baseColorTexture;
    const image = gltf.images[gltf.textures[paint.index].source];
    expect(image.uri).toBeUndefined();
    expect(image.mimeType).toBe('image/png');
    const view = gltf.bufferViews[image.bufferView];
    expect(view.buffer).toBe(0);
    const start = jsonEnd + 8 + view.byteOffset;
    expect(model.subarray(start, start + view.byteLength)).toEqual(readFileSync(pack + 'Textures/colormap.png'));
  });

  it('keeps the full painted chevrons flush across the curved ramp triangles', () => {
    const island = generateIsland();
    const scale = island.size / 600;
    const tower = island.props.find(prop => prop.kind === 'lighthouse')!;
    const sections = lighthouseAccess(tower, (x, z) => gridSample(island, x, z));
    const ramp = accessPathVisual('test-ramp', [sections], [], .34 * scale, scale, 0xffffff, 0xffffff);
    const paint = accessArrows(sections, scale, 0xffffff).geometry;
    const positions = paint.getAttribute('position');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, .5 * scale);
    const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const sampled = new THREE.Vector3();
    try {
      expect(positions.count).toBeGreaterThan(30);
      for (let index = 0; index < positions.count; index += 3) {
        for (const [i, corner] of corners.entries()) corner.fromBufferAttribute(positions, index + i);
        for (const weights of [[1, 1, 1], [3, 1, 1]]) {
          const sum = weights.reduce((total, weight) => total + weight, 0);
          sampled.set(0, 0, 0);
          for (const [i, corner] of corners.entries()) sampled.addScaledVector(corner, weights[i]! / sum);
          ray.ray.origin.copy(sampled).addScaledVector(ray.ray.direction, -.22 * scale);
          const hit = ray.intersectObject(ramp)[0];
          expect(hit).toBeDefined();
          expect(sampled.y - hit!.point.y).toBeCloseTo(.028 * scale, 3);
        }
      }
    } finally {
      paint.dispose();
      ramp.geometry.dispose();
      (ramp.material as THREE.Material).dispose();
    }
  });

  it('fits a stone base against the actual cliff triangles beneath the tower', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const view = createWorldScene(island);
    const tower = island.props.find(prop => prop.kind === 'lighthouse')!;
    const geometry = makeLighthouseFooting(island, tower);
    try {
      expect(view.group.getObjectByName('lighthouse-stone-footing')).toBeDefined();
      const positions = geometry.getAttribute('position');
      const cap = tower.transform.position.y - .49 * tower.size.y;
      const ground = renderedCapeSurface(view, island.size / 600);
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
        if (y < cap) expect(y).toBeLessThan(ground(x, z) - .29);
        else expect(y).toBeCloseTo(cap + .025, 5);
      }
    } finally {
      geometry.dispose();
      view.dispose();
    }
  });

  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'lighthouse-cape', size: 850, resolution: 97 },
  ])('joins the keeper cottage sill to the final carved terrain ($seed)', options => {
    const island = generateIsland(options);
    const cottage = island.props.find(prop => prop.poiId === 'old-lighthouse' && prop.kind === 'cottage')!;
    const sill = cottage.transform.position.y - cottage.size.y / 2;
    const scale = island.size / 600;
    const view = createWorldScene(island);
    const rendered = keeperCottageFoundationGeometry(island, cottage);
    try {
      const groundAt = renderedCapeSurface(view, scale);
      expect(view.group.getObjectByName('lighthouse-keeper-cottage-foundation')).toBeDefined();
      expect(rendered).toHaveLength(2);
      const exposed = rendered.map(geometry => {
        const positions = geometry.getAttribute('position');
        let maxRise = 0;
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i);
          const surface = groundAt(positions.getX(i), positions.getZ(i));
          if (y < sill) {
            expect(y).toBeLessThan(surface - .26 * scale);
          } else {
            expect(y).toBeCloseTo(sill + .04 * scale, 3);
            maxRise = Math.max(maxRise, y - surface);
          }
        }
        return maxRise;
      });
      expect(Math.max(...exposed)).toBeGreaterThan(4 * scale);
    } finally {
      rendered.forEach(geometry => geometry.dispose());
      view.dispose();
    }
  });

  it('gives both visible piers real contact and keeps the lower east path open', async () => {
    await RAPIER.init();
    const island = generateIsland({ seed: 'billy-isle' });
    const cottage = island.props.find(prop => prop.poiId === 'old-lighthouse' && prop.kind === 'cottage')!;
    const { position, rotationY: yaw } = cottage.transform;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const { props, terrain } = buildRapierColliders(world, island);
      const piers = keeperCottagePiers(island, cottage);
      expect(piers).toHaveLength(2);
      const supports = piers.map(({ id, corners }) => {
        const body = props.get(id)!;
        const midpoint = (axis: 'x' | 'z') => corners.reduce((sum, { top }) =>
          sum + top[axis], 0) / corners.length;
        const cap = corners[0]!.top.y;
        const x = midpoint('x'), z = midpoint('z');
        const downward = new RAPIER.Ray({ x, y: cap + 2, z }, { x: 0, y: -1, z: 0 });
        expect(body.castRay(downward, 8, true)).toBeCloseTo(2, 4);
        const nearGround = terrain.castRay(downward, 8, true);
        expect(nearGround).toBeGreaterThan(2.4);
        expect(body.containsPoint({ x, y: cap + 2 - nearGround + .15, z })).toBe(true);
        return body;
      });
      const goat = new RAPIER.Cylinder(.42, .36);
      const rotation = { x: 0, y: 0, z: 0, w: 1 };
      for (let offset = -1.6; offset <= 1.61; offset += .2) {
        const side = cottage.size.x * .46;
        const x = position.x + Math.cos(yaw) * side + Math.sin(yaw) * offset;
        const z = position.z - Math.sin(yaw) * side + Math.cos(yaw) * offset;
        const ray = new RAPIER.Ray({ x, y: position.y, z }, { x: 0, y: -1, z: 0 });
        const floor = terrain.castRayAndGetNormal(ray, cottage.size.y + 1, true)!;
        expect(floor.normal.y).toBeGreaterThan(.8);
        const body = { x, y: position.y - floor.timeOfImpact + .48, z };
        const blocked = [...supports, props.get(cottage.id)!].some(collider =>
          collider.intersectsShape(goat, body, rotation));
        expect(blocked, 'east passage at local z ' + offset.toFixed(1)).toBe(false);
      }
    } finally {
      world.free();
    }
  });

  it('keeps a tall physically collidable cape, cut-back cave and safe secret relic', () => {
    for (const seed of ['billy-isle', 'lighthouse-cape', 'sea-cave']) {
      const island = generateIsland({ seed, resolution: 193 });
      const center = island.pois.find(p => p.id === 'old-lighthouse')!.center;
      const cape = heightAt(island, center.x, center.z);
      expect(cape).toBeGreaterThan(12);
      const water = heightAt(island, center.x - 37, center.z + 7);
      expect(cape - water).toBeGreaterThan(12);

      const cave = island.props.find(p => p.poiId === 'old-lighthouse' &&
        p.kind === 'cave-mouth')!;
      const entranceFloor = heightAt(island, cave.transform.position.x,
        cave.transform.position.z);
      expect(entranceFloor).toBeGreaterThan(0);
      expect(entranceFloor).toBeLessThan(cape - 6);
      const back = island.colliders.find(c => c.shape !== 'heightfield' &&
        c.id === cave.id)!;
      expect(back.shape).toBe('cuboid');
      if (back.shape !== 'heightfield') {
        expect(back.size.z).toBeLessThan(cave.size.z / 4);
        expect(back.transform.position.z).toBeLessThan(cave.transform.position.z);
      }
      const treasure = island.relics.find(relic =>
        relic.poiId === 'old-lighthouse' &&
        relic.hint === 'Inside the sea cave beneath the lighthouse');
      expect(treasure).toBeDefined();
      expect(isSafeCollectiblePosition(island, treasure!.position)).toBe(true);
      expect(Math.hypot(treasure!.position.x - cave.transform.position.x,
        treasure!.position.z - cave.transform.position.z)).toBeLessThan(cave.size.x);

      const docks = island.props.filter(p =>
        p.poiId === 'old-lighthouse' && p.kind === 'dock');
      expect(docks).toHaveLength(3);
      for (const deck of docks) {
        expect(deck.collidable).toBe(true);
        expect(deck.climbable).toBe(true);
        expect(island.colliders.some(c => c.shape !== 'heightfield' &&
          c.id === deck.id)).toBe(true);
      }
    }
  });

  it('contains a scene-complete fallback, faceted grey rocks and no flat cave cap', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const view = createWorldScene(island);
    const hero = view.group.getObjectByName('old-lighthouse-hero') as THREE.Group;
    expect(hero).toBeInstanceOf(THREE.Group);
    for (const name of [
      'lighthouse-winding-dirt-path',
      'lighthouse-keeper-cottage',
      'keeper-cottage-red-tiled-gable',
      'lighthouse-glowing-lantern-room',
      'lighthouse-recessed-sea-cave',
      'lighthouse-golden-goat-relic',
      'lighthouse-pirate-kit-dock',
      'lighthouse-dock-piles',
      'lighthouse-red-white-life-ring',
      'lighthouse-watercraft-kit-rowboat',
      'lighthouse-pirate-kit-shipwreck',
      'lighthouse-cliff-boulders',
      'lighthouse-lookout-cliff-braces-and-landing',
      'lighthouse-keeper-stair',
    ]) {
      expect(view.group.getObjectByName(name), name).toBeDefined();
    }
    expect(view.group.getObjectByName('props-lighthouse')).toBeInstanceOf(THREE.InstancedMesh);
    const cave = view.group.getObjectByName('lighthouse-recessed-sea-cave')!;
    expect(cave.children.length).toBeGreaterThan(1);
    expect(view.group.getObjectByName('lighthouse-cliff-boulders'))
      .toBeInstanceOf(THREE.InstancedMesh);
    const grey = view.group.getObjectByName('lighthouse-cliff-boulders') as THREE.InstancedMesh;
    expect(grey.count).toBeGreaterThan(10);
    expect(grey.geometry.getAttribute('normal').count).toBeGreaterThan(0);
    expect((grey.material as THREE.MeshLambertMaterial).color.getHex()).not.toBe(0x000000);

    const tower = island.props.find(p => p.kind === 'lighthouse')!.transform.position;
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, .1, 1200);
    camera.position.set(tower.x + 12, tower.y + 4, tower.z + 18);
    camera.lookAt(tower.x, tower.y, tower.z);
    view.updateCulling(camera);
    const meshes: THREE.Mesh[] = [];
    view.group.traverseVisible(item => {
      if (item instanceof THREE.Mesh && (!(item instanceof THREE.InstancedMesh) || item.count)) meshes.push(item);
    });
    const shadows = meshes.filter(item => item.castShadow).length;
    // Include every active batch, even ones outside the lens. Models culled
    // in distant districts cannot contribute draws to the lighthouse fallback.
    expect(meshes).toContain(grey);
    expect(shadows).toBeLessThan(20);
    expect(meshes.length + shadows).toBeLessThan(180);
    view.dispose();
  });

  it('replaces the opaque GLB pane at its real radius and lights it from the live sky phase', async () => {
    const path = new URL('../../public/assets/library/custom/lighthouse/lighthouse.glb',
      import.meta.url);
    const bytes = Uint8Array.from(readFileSync(path));
    const { scene } = await new GLTFLoader().parseAsync(bytes.buffer, '');
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const view = createWorldScene(island);
    const body = bakeLibraryPropGeometry('lighthouse', scene)!;
    let haloDisposed = false;
    try {
      const lens = view.group.getObjectByName('lighthouse-glowing-lantern-room') as
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const halo = view.group.getObjectByName('lighthouse-lantern-halo') as THREE.Sprite;
      expect(lens).toBeInstanceOf(THREE.Mesh);
      expect(halo).toBeInstanceOf(THREE.Sprite);
      const parts: Array<THREE.Mesh<THREE.BufferGeometry, THREE.Material>> = [];
      scene.traverse(part => { if (part instanceof THREE.Mesh) parts.push(part); });
      const sourceGlass = parts.find(part => part.material.name === 'glass')!;
      const retained = parts.filter(part => part !== sourceGlass);
      expect(retained.some(part => part.material.name === 'iron')).toBe(true);
      expect(body.getAttribute('position').count).toBe(retained.reduce((sum, part) =>
        sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count), 0));
      const source = new THREE.Box3().setFromObject(sourceGlass);
      const tower = island.props.find(prop => prop.kind === 'lighthouse')!;
      const lampBounds = new THREE.Box3().setFromObject(lens);
      for (const axis of ['x', 'y', 'z'] as const) {
        const divider = axis === 'y' ? 29 : 9;
        const fit = 0.98 * tower.size[axis] / divider;
        const offset = tower.transform.position[axis] - (axis === 'y' ? 14.5 * fit : 0);
        expect(lampBounds.min[axis]).toBeCloseTo(offset + source.min[axis] * fit, 4);
        expect(lampBounds.max[axis]).toBeCloseTo(offset + source.max[axis] * fit, 4);
      }
      expect(halo.position.equals(lens.position)).toBe(true);
      expect(halo.material.depthWrite).toBe(false);
      expect(halo.material.depthTest).toBe(true);
      expect(halo.material.blending).toBe(THREE.AdditiveBlending);
      const { data, width, height } = (halo.material.map as THREE.DataTexture).image;
      if (!data) throw new Error('Missing Lighthouse halo pixels');
      const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
      expect(alphaAt(0, 0)).toBe(0);
      expect(alphaAt(width - 1, height - 1)).toBe(0);
      expect(alphaAt(width / 2, height / 2)).toBeGreaterThan(200);
      expect(alphaAt(width * .75, height / 2)).toBeLessThan(100);
      expect(lens.material.fragmentShader).toContain('mix(glass, fire, uGlow)');
      expect(lens.material.fragmentShader).toContain('#include <fog_fragment>');
      halo.material.map!.addEventListener('dispose', () => { haloDisposed = true; });

      const glow = lens.material.uniforms['uGlow']!;
      expect(glow.value).toBe(0);
      expect(halo.visible).toBe(false);
      view.setLightingPreset('golden-hour');
      expect(glow.value).toBeCloseTo(0.96);
      expect(halo.material.opacity).toBeGreaterThan(0.4);
      expect(halo.visible).toBe(true);
      view.setLightingPreset('night');
      expect(glow.value).toBe(1);
      view.setLightingPreset('day');
      expect(glow.value).toBe(0);
      expect(halo.visible).toBe(false);
    } finally {
      view.dispose();
      body.dispose();
      scene.traverse(part => {
        if (part instanceof THREE.Mesh) {
          part.geometry.dispose();
          (part.material as THREE.Material).dispose();
        }
      });
    }
    expect(haloDisposed).toBe(true);
  });

  it('uses the same local sunset grade and sun direction for cliff terrain and rock surfaces', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const view = createWorldScene(island);
    try {
      const ground = view.chunks[0]!.material as THREE.MeshToonMaterial;
      const cliffs = view.group.getObjectByName('lighthouse-cliff-boulders') as
        THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;
      const programs = [ground, cliffs.material].map(material => {
        const shader = {
          uniforms: {} as Record<string, { value: unknown }>,
          vertexShader: '#include <common>\n#include <begin_vertex>',
          fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>',
        };
        material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],
          null as unknown as Parameters<typeof material.onBeforeCompile>[1]);
        return shader;
      });
      const [terrain, stone] = programs;
      for (const name of ['uCapeGolden', 'uCapeScale', 'uCapeCentre', 'uCapeSun']) {
        expect(terrain!.uniforms[name]).toBe(stone!.uniforms[name]);
      }
      for (const program of programs) {
        expect(program.fragmentShader).toContain('length(vWorld.xz - uCapeCentre) / uCapeScale');
        expect(program.fragmentShader).toContain('mix(coolStone, warmEdge, key)');
        expect(program.fragmentShader).toContain('dot(face, uCapeSun)');
      }
      const { uCapeGolden, uCapeSun, uCapeCentre } = terrain!.uniforms;
      const centre = island.pois.find(poi => poi.id === 'old-lighthouse')!.center;
      expect(uCapeCentre!.value).toEqual(new THREE.Vector2(centre.x, centre.z));
      expect(uCapeGolden!.value).toBe(0);
      view.setLightingPreset('golden-hour');
      expect(uCapeGolden!.value).toBe(1);
      const key = uCapeSun!.value as THREE.Vector3;
      expect(key.dot(view.sun.position.clone().normalize())).toBeGreaterThan(0.98);
      view.setLightingPreset('night');
      expect(uCapeGolden!.value as number).toBeLessThan(0.02);
    } finally {
      view.dispose();
    }
  });

  it('hides only generic lighthouse-plot instances, without changing descriptors', () => {
    for (const seed of ['billy-isle', 'sea-cave']) {
      const island = generateIsland({ seed, resolution: 65 });
      const descriptors = island.props.map(p => structuredClone(p));
      const colliders = island.colliders.map(c => structuredClone(c));
      const view = createWorldScene(island);
      const matrix = new THREE.Matrix4();
      // QA LH-1: the striped tower is the generic 'lighthouse' prop and stays visible.
      const towers = island.props.filter(p => p.kind === 'lighthouse');
      const towerMesh = view.group.getObjectByName('props-lighthouse') as THREE.InstancedMesh;
      towers.forEach((prop, index) => {
        towerMesh.getMatrixAt(index, matrix);
        const m = matrix.elements;
        expect(Math.hypot(m[0]!, m[5]!, m[10]!), `${seed}: ${prop.id}`).toBeGreaterThan(0);
      });
      for (const kind of ['cottage', 'shipwreck', 'dock', 'cave-mouth', 'deck-stilts']) {
        const entries = island.props.filter(p => p.kind === kind &&
          !p.id.startsWith('the-dam-compat-'));
        expect(entries.some(p => p.poiId === 'old-lighthouse'), kind).toBe(true);
        for (const prefix of ['props-', 'architecture-details-', 'outline-']) {
          const mesh = view.group.getObjectByName(prefix + kind);
          if (!(mesh instanceof THREE.InstancedMesh)) continue;
          entries.forEach((prop, index) => {
            mesh.getMatrixAt(index, matrix);
            const m = matrix.elements;
            const scale = Math.hypot(m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!,
              m[8]!, m[9]!, m[10]!);
            expect(scale === 0, `${seed}: ${prefix}${kind}: ${prop.id}`)
              .toBe(prop.poiId === 'old-lighthouse');
          });
          if (entries.every(p => p.poiId === 'old-lighthouse'))
            expect(mesh.visible, kind).toBe(false);
        }
      }
      expect(island.props).toEqual(descriptors);
      expect(island.colliders).toEqual(colliders);
      view.dispose();
    }
  });

  it('batches two sagging rope tiers for every qualifying bridge-post pair on both sides', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const posts = island.props.filter(prop =>
      prop.poiId === 'old-lighthouse' && prop.kind === 'rope-rail');
    expect(posts.length).toBeGreaterThan(2);
    expect(posts.length % 2).toBe(0);
    const sides = [
      posts.filter((_, i) => i % 2 === 0),
      posts.filter((_, i) => i % 2 === 1),
    ];
    expect(sides[0]!.length).toBe(sides[1]!.length);
    const spansBySide = sides.map(side => side.slice(1).flatMap((end, i) => {
      const start = side[i]!;
      const span = Math.hypot(end.transform.position.x - start.transform.position.x,
        end.transform.position.z - start.transform.position.z);
      return span < 12 ? [{ start, end, span }] : [];
    }));
    for (const spans of spansBySide) expect(spans.length).toBeGreaterThan(0);
    const spans = spansBySide.flat();

    const view = createWorldScene(island);
    try {
      const matches: THREE.Object3D[] = [];
      view.group.traverse(object => {
        if (object.name === 'lighthouse-rope-bridge-ropes') matches.push(object);
      });
      expect(matches).toHaveLength(1);
      const ropes = matches[0] as THREE.Mesh;
      expect(ropes).toBeInstanceOf(THREE.Mesh);
      expect(ropes).not.toBeInstanceOf(THREE.InstancedMesh);
      expect(ropes.children).toHaveLength(0);
      expect(ropes.castShadow).toBe(false);
      expect(ropes.receiveShadow).toBe(true);
      const material = ropes.material as THREE.MeshToonMaterial;
      expect(material).toBeInstanceOf(THREE.MeshToonMaterial);
      expect(material.color.getHex()).toBe(0xd9c49a);
      expect(material.gradientMap).toBe(TOON_RAMP);

      const geometry = ropes.geometry;
      expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
      expect(geometry.groups).toHaveLength(0);
      const tubularSegments = 8, radialSegments = 5;
      const verticesPerRope = (tubularSegments + 1) * (radialSegments + 1);
      const ropeCount = spans.length * 2;
      expect(geometry.getAttribute('position').count).toBe(ropeCount * verticesPerRope);
      expect(geometry.index?.count).toBe(ropeCount * tubularSegments * radialSegments * 6);

      // TubeGeometry has 9 circular rings of 6 vertices each (last radial
      // vertex repeats the first). Averaging the 5 unique vertices recovers
      // the rope centreline independently of tube radius and frame orientation.
      const position = geometry.getAttribute('position');
      const ringCenter = (ropeIndex: number, segment: number): THREE.Vector3 => {
        const base = ropeIndex * verticesPerRope + segment * (radialSegments + 1);
        const center = new THREE.Vector3();
        for (let r = 0; r < radialSegments; r++) {
          const i = base + r;
          center.x += position.getX(i);
          center.y += position.getY(i);
          center.z += position.getZ(i);
        }
        return center.multiplyScalar(1 / radialSegments);
      };
      spans.forEach(({ start, end, span }, spanIndex) => {
        for (const [tier, drop] of [0.25, 1.2].entries()) {
          const ropeIndex = spanIndex * 2 + tier;
          const a = ringCenter(ropeIndex, 0);
          const mid = ringCenter(ropeIndex, tubularSegments / 2);
          const b = ringCenter(ropeIndex, tubularSegments);
          expect(Math.hypot(a.x - start.transform.position.x,
            a.z - start.transform.position.z)).toBeLessThan(0.05);
          expect(Math.hypot(b.x - end.transform.position.x,
            b.z - end.transform.position.z)).toBeLessThan(0.05);
          expect(a.y).toBeCloseTo(start.transform.position.y + start.size.y / 2 - drop, 2);
          expect(b.y).toBeCloseTo(end.transform.position.y + end.size.y / 2 - drop, 2);
          // TubeGeometry samples by arc length. On a slope its middle ring
          // need not lie halfway along the horizontal chord.
          const t = ((mid.x - a.x) * (b.x - a.x) + (mid.z - a.z) * (b.z - a.z)) / span ** 2;
          const chordHeight = THREE.MathUtils.lerp(a.y, b.y, t);
          expect(chordHeight - mid.y).toBeCloseTo(0.16 * span * t * (1 - t), 2);
        }
      });
    } finally {
      view.dispose();
    }
  });

  it('does not create ropes or throw when a seed has no lighthouse bridge posts', () => {
    const generated = generateIsland({ seed: 'without-lighthouse-bridge', resolution: 65 });
    // Simulate a seed whose lighthouse road never crossed water.
    const island = { ...generated, props: generated.props.filter(prop =>
      prop.poiId !== 'old-lighthouse' || prop.kind !== 'rope-rail') };
    const view = createWorldScene(island);
    try {
      expect(view.group.getObjectByName('lighthouse-rope-bridge-ropes')).toBeUndefined();
    } finally {
      view.dispose();
    }
  });

  it('frames the painted signature objects in bookmark 15', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const mark = findBookmark('15')!;
    const camera = new THREE.PerspectiveCamera(mark.fov, 16 / 9, 0.25, 1000);
    camera.position.set(mark.camera.x, mark.camera.y, mark.camera.z);
    camera.lookAt(mark.target.x, mark.target.y, mark.target.z);
    camera.updateMatrixWorld();
    const top = island.props.find(p => p.poiId === 'old-lighthouse' &&
      p.kind === 'lighthouse')!;
    const points = [
      new THREE.Vector3(top.transform.position.x,
        top.transform.position.y + top.size.y / 2, top.transform.position.z),
      ...['shipwreck', 'cave-mouth', 'cottage', 'dock'].map(kind => {
        const prop = island.props.find(p => p.poiId === 'old-lighthouse' && p.kind === kind)!;
        return new THREE.Vector3(prop.transform.position.x,
          prop.transform.position.y, prop.transform.position.z);
      }),
    ];
    for (const point of points) {
      const projected = point.project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(0.94);
      expect(Math.abs(projected.y)).toBeLessThan(0.94);
      expect(projected.z).toBeLessThan(1);
    }
  });
  it('keeps each sourced rock primitive colour in a non-emissive toon batch', () => {
    const root = new THREE.Group();
    const sources = [
      new THREE.MeshStandardMaterial({ color: 0x838b92 }),
      new THREE.MeshStandardMaterial({ color: 0x6faa59 }),
    ];
    for (const [i, source] of sources.entries()) {
      const primitive = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source);
      primitive.position.set(i, i * 0.4, 0);
      root.add(primitive);
    }
    const instance = instantiateLibraryModel(root, [
      { x: 5, y: 7, z: -6, width: 4, height: 4, depth: 4 },
      { x: -3, y: 8, z: 2, width: 3, height: 3, depth: 3 },
    ], 'lighthouse-rock-paint-test', true,
    'assets/library/kenney/nature-kit/rock_largeA.glb');
    try {
      // One draw/material per original GLB primitive, not a split per instance.
      expect(instance.children).toHaveLength(sources.length);
      const materials = instance.children.map((part, i) => {
        expect(part).toBeInstanceOf(THREE.InstancedMesh);
        const batch = part as THREE.InstancedMesh;
        expect(batch.count).toBe(2);
        const material = batch.material as THREE.MeshToonMaterial;
        expect(material).toBeInstanceOf(THREE.MeshToonMaterial);
        expect(material.color.equals(sources[i]!.color)).toBe(true);
        expect(material.gradientMap).toBe(BUILDING_RAMP);
        expect(material.side).toBe(THREE.DoubleSide);
        expect((material as THREE.MeshToonMaterial & { flatShading: boolean }).flatShading).toBe(true);
        expect(material.emissive.getHex()).toBe(0x000000);
        expect(material.emissive.r + material.emissive.g + material.emissive.b).toBe(0);
        expect(batch.castShadow).toBe(false);
        return material;
      });
      expect(materials[0]).not.toBe(materials[1]);
      expect(materials[0]!.color.equals(materials[1]!.color)).toBe(false);
    } finally {
      instance.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      root.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      sources.forEach(material => material.dispose());
    }
  });

  it('embeds the actual faceted cliff boulder bases and shades their stone into the cape', () => {
    for (const seed of ['billy-isle', 'lighthouse-cape']) {
      const island = generateIsland({ seed, resolution: 97 });
      const view = createWorldScene(island);
      try {
        const cliff = view.group.getObjectByName('lighthouse-cliff-boulders') as THREE.InstancedMesh;
        expect(cliff).toBeInstanceOf(THREE.InstancedMesh);
        const material = cliff.material as THREE.MeshToonMaterial;
        expect(material).toBeInstanceOf(THREE.MeshToonMaterial);
        expect(material.color.getHex()).toBe(0x8c919e);
        expect(material.emissive.getHex()).toBe(0);
        expect(material.gradientMap).toBe(TOON_RAMP);
        expect(material.vertexColors).toBe(true);
        expect(cliff.receiveShadow).toBe(true);

        const centre = island.pois.find(p => p.id === 'old-lighthouse')!.center;
        const scale = island.size / 600;
        const groundAt = renderedCapeSurface(view, scale);
        const expected: Array<{ x: number; y: number; z: number; height: number }> = [];
        let shoreCount = 0, shoulderCount = 0;
        // Source loops now visit only even slots, 8 rather than 16 and
        // 44 rather than 88; conditional cliff/cave skips stay unchanged.
        for (let i = 0; i < 16; i += 2) {
          const angle = i * 2.399963 + 0.65;
          const r = (28 + (i % 4) * 2.5) * scale;
          const x = centre.x + Math.cos(angle) * r;
          const z = centre.z + Math.sin(angle) * r;
          if (Math.hypot(x - (centre.x + 2 * scale),
            z - (centre.z + 23 * scale)) < 8 * scale) continue;
          const size = (3.2 + (i % 3) * 1.15) * scale;
          expected.push({ x, z, y: Math.max(-1.8 * scale,
            gridSample(island, x, z) - size * 0.12), height: size });
          shoreCount++;
        }
        for (let i = 0; i < 88; i += 2) {
          const angle = i * 2.399963 + 0.8;
          const radius = (19 + (i % 9) * 1.05) * scale;
          const x = centre.x + Math.cos(angle) * radius;
          const z = centre.z + Math.sin(angle) * radius;
          const surface = gridSample(island, x, z);
          if (surface < 1.5 * scale || surface > 16 * scale ||
              Math.hypot(x - (centre.x + 2 * scale),
                z - (centre.z + 23 * scale)) < 8.5 * scale) continue;
          const extent = (3.1 + (i % 4) * 0.8) * scale;
          expected.push({ x, z, y: surface - extent * 0.37,
            height: extent * 0.96 });
          shoulderCount++;
        }
        expect(shoreCount).toBeGreaterThan(0);
        expect(shoreCount).toBeLessThanOrEqual(8);
        expect(shoulderCount).toBeGreaterThan(0);
        expect(shoulderCount).toBeLessThanOrEqual(44);
        expect(cliff.count).toBe(shoreCount + shoulderCount);
        const positions = cliff.geometry.getAttribute('position');
        const colors = cliff.geometry.getAttribute('color');
        const feet = new Map<string, THREE.Vector3>();
        for (let i = 0; i < positions.count; i++) {
          const vertex = new THREE.Vector3().fromBufferAttribute(positions, i);
          if (vertex.y < 0) feet.set(vertex.toArray().join(','), vertex);
          if (vertex.y < -0.4) expect(colors.getX(i)).toBeLessThan(0.74);
          if (vertex.y > 0.45) expect(colors.getX(i)).toBeCloseTo(1, 5);
        }
        expect(feet.size).toBeGreaterThan(5);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        for (const [i, rock] of expected.entries()) {
          cliff.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          expect(position.x, seed + ': rock ' + i).toBeCloseTo(rock.x, 4);
          expect(position.z, seed + ': rock ' + i).toBeCloseTo(rock.z, 4);
          expect(position.y, seed + ': rock ' + i).toBeLessThanOrEqual(
            rock.y + 0.15 * rock.height + 0.0001);
          const buried = [...feet.values()].filter(foot => {
            const vertex = foot.clone().applyMatrix4(matrix);
            return groundAt(vertex.x, vertex.z) - vertex.y >= 0.235 * scale;
          });
          expect(buried.length, seed + ': rock ' + i).toBeGreaterThanOrEqual(feet.size / 2);
        }
      } finally {
        view.dispose();
      }
    }
  });

  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'lighthouse-cape', size: 850, resolution: 97 },
  ])('seats both west lookout brackets into the actual cliff ($seed)', options => {
    const island = generateIsland(options);
    const view = createWorldScene(island);
    try {
      const deck = island.props.find(prop => prop.poiId === 'old-lighthouse' &&
        prop.kind === 'platform')!;
      const { x, y, z } = deck.transform.position;
      const scale = options.size / 600;
      const groundAt = renderedCapeSurface(view, scale);
      const underside = y - deck.size.y / 2;
      const supportPaint = view.group.getObjectByName('lighthouse-static-painted-landmarks') as
        THREE.Mesh<THREE.BufferGeometry>;
      const positions = supportPaint.geometry.getAttribute('position');
      const rgb = supportPaint.geometry.getAttribute('color');
      const darkTimber = new THREE.Color(0x63432e);
      const isTimber = (i: number): boolean =>
        Math.abs(rgb.getX(i) - darkTimber.r) < 0.00001 &&
        Math.abs(rgb.getY(i) - darkTimber.g) < 0.00001 &&
        Math.abs(rgb.getZ(i) - darkTimber.b) < 0.00001;
      const vertices = Array.from({ length: positions.count }, (_, i) =>
        isTimber(i) ? new THREE.Vector3().fromBufferAttribute(positions, i) : undefined)
        .filter((point): point is THREE.Vector3 => point !== undefined);
      for (const sign of [-1, 1]) {
        const legZ = z + sign * deck.size.z * 0.36;
        const underDeck = x - deck.size.x * 0.43;
        const inCliff = x + deck.size.x * 0.39;
        expect(vertices.some(point =>
          Math.hypot(point.x - underDeck, point.z - legZ) < 0.25 * scale &&
          Math.abs(point.y - underside) < 0.24 * scale)).toBe(true);
        expect(vertices.some(point =>
          Math.hypot(point.x - inCliff, point.z - legZ) < 0.25 * scale &&
          point.y < groundAt(point.x, point.z) - 0.22 * scale)).toBe(true);
      }
      expect(island.colliders.some(collider => 'id' in collider && collider.id === deck.id))
        .toBe(true);
      const deckTop = y + deck.size.y / 2;
      const fromLand = groundAt(x + deck.size.x / 2 + 0.6 * scale, z);
      expect(fromLand).toBeGreaterThan(deckTop);
      const gold = new THREE.Color(0xffcf56);
      expect(Array.from({ length: rgb.count }, (_, i) => i).some(i =>
        Math.abs(rgb.getX(i) - gold.r) < 0.00001 &&
        Math.abs(rgb.getY(i) - gold.g) < 0.00001 &&
        Math.abs(rgb.getZ(i) - gold.b) < 0.00001 &&
        Math.abs(positions.getX(i) - x) < deck.size.x * 0.3 &&
        Math.abs(positions.getZ(i) - z) < deck.size.z * 0.3 &&
        positions.getY(i) > deckTop && positions.getY(i) < deckTop + 0.07 * scale,
      )).toBe(true);
    } finally {
      view.dispose();
    }
  });

});
