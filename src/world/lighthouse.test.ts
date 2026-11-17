import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland, heightAt, isSafeCollectiblePosition } from './index';
import { findBookmark } from './viewer/bookmarks';

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
      for (const kind of ['lighthouse', 'cottage', 'shipwreck', 'dock', 'cave-mouth']) {
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
});
