import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland, heightAt, isSafeCollectiblePosition } from './index';
import { findBookmark } from './viewer/bookmarks';
import { instantiateLibraryModel } from './visual-lighthouse';
import { BUILDING_RAMP, TOON_RAMP } from './visual-props';
import { gridSample } from './terrain';

describe('Old Lighthouse painting rebuild', () => {
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
      'lighthouse-planked-dock-fallback',
      'lighthouse-dock-piles',
      'lighthouse-red-white-life-ring',
      'lighthouse-rowboat-fallback',
      'lighthouse-leaning-shipwreck-fallback',
      'lighthouse-fallback-grey-rocks',
    ]) {
      expect(view.group.getObjectByName(name), name).toBeDefined();
    }
    expect(view.group.getObjectByName('props-lighthouse')).toBeInstanceOf(THREE.InstancedMesh);
    const cave = view.group.getObjectByName('lighthouse-recessed-sea-cave')!;
    expect(cave.children.length).toBeGreaterThan(1);
    expect(view.group.getObjectByName('lighthouse-fallback-grey-rocks'))
      .toBeInstanceOf(THREE.InstancedMesh);
    const grey = view.group.getObjectByName('lighthouse-fallback-grey-rocks') as THREE.InstancedMesh;
    expect(grey.count).toBeGreaterThan(10);
    expect(grey.geometry.getAttribute('normal').count).toBeGreaterThan(0);
    expect((grey.material as THREE.MeshLambertMaterial).color.getHex()).not.toBe(0x000000);

    const meshes: THREE.Mesh[] = [];
    view.group.traverse(item => {
      if (item instanceof THREE.Mesh) meshes.push(item);
    });
    const shadows = meshes.filter(item => item.castShadow).length;
    // New decorative pieces are merged/instanced, never a shadow pass per boulder.
    expect(shadows).toBeLessThan(20);
    expect(meshes.length + shadows).toBeLessThan(180);
    view.dispose();
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
      for (const kind of ['cottage', 'shipwreck', 'dock', 'cave-mouth']) {
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
          expect(Math.abs((a.y + b.y) / 2 - mid.y - 0.04 * span)).toBeLessThan(0.02);
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

  it('halves shore/shoulder boulder attempts and embeds every rock 35% into the ground', () => {
    for (const seed of ['billy-isle', 'lighthouse-cape']) {
      const island = generateIsland({ seed, resolution: 97 });
      const view = createWorldScene(island);
      try {
        const rockFallback = view.group.getObjectByName(
          'lighthouse-fallback-grey-rocks') as THREE.InstancedMesh;
        expect(rockFallback).toBeInstanceOf(THREE.InstancedMesh);
        const fallbackMaterial = rockFallback.material as THREE.MeshToonMaterial;
        expect(fallbackMaterial).toBeInstanceOf(THREE.MeshToonMaterial);
        expect(fallbackMaterial.emissive.getHex()).toBe(0);
        expect(fallbackMaterial.gradientMap).toBe(BUILDING_RAMP);

        const centre = island.pois.find(p => p.id === 'old-lighthouse')!.center;
        const scale = island.size / 600;
        const expected: Array<{ x: number; y: number; z: number; height: number }> =
          island.props.filter(p => p.poiId === 'old-lighthouse' && p.kind === 'rock')
            .map(p => ({
              x: p.transform.position.x, z: p.transform.position.z,
              y: p.transform.position.y - p.size.y / 2, height: p.size.y,
            }));
        const descriptorCount = expected.length;
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
        expect(rockFallback.count).toBe(descriptorCount + shoreCount + shoulderCount);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        for (const [i, rock] of expected.entries()) {
          rockFallback.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          expect(position.x, seed + ': rock ' + i).toBeCloseTo(rock.x, 4);
          expect(position.z, seed + ': rock ' + i).toBeCloseTo(rock.z, 4);
          // Before sinking the fallback centre was baseY + 0.5 * height.
          // Subtracting 0.35 * height leaves baseY + 0.15 * height.
          expect(position.y, seed + ': rock ' + i)
            .toBeCloseTo(rock.y + 0.15 * rock.height, 4);
        }
      } finally {
        view.dispose();
      }
    }
  });

});
