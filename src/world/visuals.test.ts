import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  POI_IDS, arePoisConnected, createWorldScene, generateIsland,
  hashIsland, heightAt,
} from './index';
import { ART_BOOKMARKS } from './viewer/bookmarks';
import { makeTerrain, gridSample, riverAt } from './terrain';

describe('Billy Isle hi-fi environment map', () => {
  it('matches all eight map regions for several seeds and scaled islands', () => {
    for (const seed of ['map-A', 'map-B', 'map-C']) {
      for (const size of [400, 600]) {
        const island = generateIsland({ seed, size, resolution: 97 });
        const p = new Map(island.pois.map(poi => [poi.id, poi.center]));
        const scale = size / 600;
        expect(p.get('mt-gigga')!.x).toBe(0);
        expect(p.get('mt-gigga')!.z).toBe(0);
        expect(p.get('hoofington')!.x).toBeLessThan(-115 * scale);
        expect(p.get('hoofington')!.z).toBeGreaterThan(100 * scale);
        expect(p.get('baa-ardwalk')!.z).toBeGreaterThan(190 * scale);
        expect(p.get('crane-yard')!.x).toBeGreaterThan(150 * scale);
        expect(p.get('crane-yard')!.z).toBeLessThan(0);
        expect(p.get('downtown-bleatsville')!.x).toBeGreaterThan(110 * scale);
        expect(p.get('downtown-bleatsville')!.z).toBeGreaterThan(80 * scale);
        expect(p.get('whispering-pines')!.x).toBeLessThan(-120 * scale);
        expect(p.get('whispering-pines')!.z).toBeLessThan(-110 * scale);
        expect(p.get('the-dam')!.z).toBeLessThan(-175 * scale);
        expect(p.get('old-lighthouse')!.x).toBeLessThan(-240 * scale);
        expect(arePoisConnected(island.roads, POI_IDS)).toBe(true);
      }
    }
  });

  it('has a real sea channel around the lighthouse, bridged without filling it', () => {
    const island = generateIsland({ seed: 'islet', resolution: 193 });
    const light = island.pois.find(p => p.id === 'old-lighthouse')!.center;
    expect(heightAt(island, light.x, light.z)).toBeGreaterThan(2);
    expect(heightAt(island, -229, -18)).toBeLessThan(0);
    const crossing = island.roads.find(r => r.to === 'old-lighthouse');
    expect(crossing).toBeDefined();
    expect(crossing!.points.filter(p => p.bridge).length).toBeGreaterThan(3);
    const planks = island.props.filter(p => p.kind === 'bridge' &&
      p.id.includes('old-lighthouse'));
    expect(planks.length).toBeGreaterThan(3);
  });

  it('has distinct, continuous climbable benches instead of quantised terrain stairs', () => {
    const island = generateIsland({ seed: 'terraces', resolution: 193 });
    // Test the sculpted terrace heights before roads cut their intentional ramps.
    const raw = { heights: makeTerrain('terraces', 600, 193), resolution: 193, size: 600 };
    const y = [0, 30, 49, 68, 87, 117].map(r =>
      gridSample(raw, Math.cos(0.85) * r, Math.sin(0.85) * r));
    expect(heightAt(island, 0, 0)).toBeGreaterThan(heightAt(island, 120, 0) + 70);
    for (let i = 1; i < y.length; i++) {
      expect(y[i - 1]!).toBeGreaterThan(y[i]! + 3);
    }
    const independent = Array.from({ length: 11 }, (_, i) =>
      heightAt(island, 25 + i * 1.1, -5));
    expect(new Set(independent.map(v => v.toFixed(3))).size).toBeGreaterThan(7);
  });

  it('keeps the pennant poles at their old anchors with 2.8 x 9 x 0.4 boxes', () => {
    for (const size of [600, 900]) {
      const island = generateIsland({ seed: 'billy-isle', size, resolution: 97 });
      const scale = size / 600;
      const flags = island.props.filter(p => p.kind === 'flag' &&
        (p.poiId === 'mt-gigga' || p.poiId === 'old-lighthouse'));
      expect(flags).toHaveLength(2);
      for (const [poiId, dx, dz, poleX] of [
        ['mt-gigga', -5.75, 4, -7],
        ['old-lighthouse', 27.25, 11, 26],
      ] as const) {
        const centre = island.pois.find(p => p.id === poiId)!.center;
        const flag = flags.find(p => p.poiId === poiId)!;
        expect(flag).toBeDefined();
        expect(flag.size.x / scale).toBeCloseTo(2.8, 6);
        expect(flag.size.y / scale).toBeCloseTo(9, 6);
        expect(flag.size.z / scale).toBeCloseTo(0.4, 6);
        expect((flag.transform.position.x - centre.x) / scale).toBeCloseTo(dx, 6);
        expect((flag.transform.position.z - centre.z) / scale).toBeCloseTo(dz, 6);
        expect(flag.transform.rotationY).toBe(0);
        // The model's pole is 1.25 m left of the fitted bounding-box centre.
        expect((flag.transform.position.x - centre.x) / scale - 1.25)
          .toBeCloseTo(poleX, 6);
      }
    }
  });

  it('places the Whispering Pines lookout and its 17.5 m deck at the first dry clearing', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const forest = island.pois.find(p => p.id === 'whispering-pines')!.center;
    const scale = island.size / 600;
    const tower = island.props.find(p => p.kind === 'lookout' &&
      p.poiId === 'whispering-pines')!;
    const deck = island.props.find(p => p.kind === 'platform' &&
      p.poiId === 'whispering-pines' && p.id.startsWith('detail-'))!;
    expect(tower).toBeDefined();
    expect(deck).toBeDefined();
    const x = tower.transform.position.x, z = tower.transform.position.z;
    const offsetX = (x - forest.x) / scale;
    const eligible = Array.from({ length: 24 }, (_, i) => 24 + i * 2).find(dx => {
      const atX = forest.x + dx * scale, atZ = forest.z - 19 * scale;
      const river = riverAt({ x: atX, z: atZ }, island.river);
      return river.distance > river.width / 2 + 8 * scale &&
        gridSample(island, atX, atZ) > island.seaLevel;
    });
    expect(eligible).toBeDefined();
    expect(offsetX).toBeCloseTo(eligible!, 6);
    expect((z - forest.z) / scale).toBeCloseTo(-19, 6);
    const water = riverAt({ x, z }, island.river);
    expect(water.distance).toBeGreaterThan(water.width / 2 + 8 * scale);
    expect(gridSample(island, x, z)).toBeGreaterThan(island.seaLevel);
    expect(deck.transform.position.x).toBeCloseTo(x, 6);
    expect(deck.transform.position.z).toBeCloseTo(z, 6);
    expect(deck.size.x / scale).toBeCloseTo(11, 6);
    expect(deck.size.y / scale).toBeCloseTo(1.1, 6);
    expect(deck.size.z / scale).toBeCloseTo(11, 6);
    const ground = gridSample(island, x, z);
    expect(deck.transform.position.y - deck.size.y / 2 - ground)
      .toBeCloseTo(16.4 * scale, 6);
    expect(deck.transform.position.y + deck.size.y / 2 - ground)
      .toBeCloseTo(17.5 * scale, 6);
  });

  it('sizes authored forest pines at 35% height and oak canopies at 72%', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    for (const [kind, ratio] of [
      ['tree-pine', 0.35], ['tree-oak', 0.72],
    ] as const) {
      const trees = island.props.filter(p =>
        p.poiId === 'whispering-pines' && p.kind === kind &&
        p.id.startsWith('whispering-pines-' + kind + '-'));
      expect(trees.length, kind).toBeGreaterThan(5);
      for (const tree of trees) {
        expect(tree.size.x, tree.id).toBeCloseTo(tree.size.y * ratio, 6);
        expect(tree.size.z, tree.id).toBeCloseTo(tree.size.x, 6);
      }
    }
  });

  it('has substantial playground detail in every named district', () => {
    const island = generateIsland({ seed: 'density', resolution: 193 });
    const minimum: Record<(typeof POI_IDS)[number], number> = {
      hoofington: 75, 'baa-ardwalk': 65, 'crane-yard': 70,
      'downtown-bleatsville': 90, 'mt-gigga': 60,
      'whispering-pines': 125, 'the-dam': 45, 'old-lighthouse': 30,
    };
    for (const id of POI_IDS) {
      expect(island.props.filter(p => p.poiId === id).length).toBeGreaterThanOrEqual(minimum[id]);
    }
    const kind = new Set(island.props.map(prop => prop.kind));
    for (const required of ['silo', 'gnome', 'mailbox', 'ferris-wheel', 'bunting', 'cone',
      'container', 'fountain', 'ac-unit', 'water-tower', 'mushroom', 'lookout',
      'shipwreck', 'cave-mouth', 'grass-tuft', 'bush', 'site-banner']) {
      expect(kind.has(required as never), required).toBe(true);
    }
  });

  it('gives every new dressing prop a finite, uniquely-addressed physics collider', () => {
    for (const seed of ['collider-art-A', 'collider-art-B']) {
      const island = generateIsland({ seed, resolution: 97 });
      const details = island.props.filter(p => p.id.startsWith('detail-'));
      expect(details.length).toBeGreaterThan(350);
      const byId = new Map(island.colliders.filter(c => c.shape !== 'heightfield')
        .map(c => [c.id, c]));
      expect(new Set(details.map(p => p.id)).size).toBe(details.length);
      for (const prop of details) {
        const gladeDecoration = prop.kind === 'fern' || prop.kind === 'lily-pads';
        expect(prop.collidable, prop.id).toBe(!gladeDecoration);
        const collider = byId.get(prop.id);
        if (gladeDecoration) {
          expect(collider, prop.id + ' must not have a Rapier collider').toBeUndefined();
          expect(prop.lickable).toBe(false);
          expect(prop.climbable).toBe(false);
          continue;
        }
        expect(collider, prop.id).toBeDefined();
        if (!collider) continue;
        expect(collider.shape).toBe(prop.shape === 'convex' ? 'convex' : prop.shape);
        expect(Object.values(collider.size).every(v => Number.isFinite(v) && v > 0)).toBe(true);
        expect(Object.values(collider.transform.position).every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(collider.transform.rotationY)).toBe(true);
        if (collider.body.type === 'dynamic') {
          expect(collider.body.mass).toBeGreaterThan(0);
        }
        if (collider.shape === 'convex') {
          expect(collider.vertices!.length).toBeGreaterThanOrEqual(18);
        }
      }
    }
  });

  it('places a reachable secret relic inside the lighthouse sea cave', () => {
    for (const seed of ['sea-cave', 'secret-coast', 'density']) {
      const island = generateIsland({ seed, resolution: 193 });
      const cave = island.props.find(p => p.kind === 'cave-mouth' &&
        p.poiId === 'old-lighthouse');
      expect(cave).toBeDefined();
      const collider = island.colliders.find(c => c.shape !== 'heightfield' &&
        c.id === cave!.id);
      expect(collider).toBeDefined();
      if (!collider || collider.shape === 'heightfield') continue;
      expect(collider.size.z).toBeLessThan(cave!.size.z * 0.25);
      const relic = island.relics.find(p =>
        p.poiId === 'old-lighthouse' && p.hint.includes('Inside the sea cave'));
      expect(relic, seed).toBeDefined();
      expect(relic && Math.hypot(relic.position.x - cave!.transform.position.x,
        relic.position.z - cave!.transform.position.z)).toBeLessThan(cave!.size.x);
    }
  });

  it('replays all new details byte-for-byte with seed and changes for another seed', () => {
    const a = generateIsland({ seed: 'decor-1', resolution: 97 });
    const b = generateIsland({ seed: 'decor-1', resolution: 97 });
    const c = generateIsland({ seed: 'decor-2', resolution: 97 });
    expect(a.props).toEqual(b.props);
    expect(a.roads).toEqual(b.roads);
    expect(hashIsland(a)).toBe(hashIsland(b));
    expect(hashIsland(a)).not.toBe(hashIsland(c));
  });
});

describe('hi-fi renderer and art-comparison viewer', () => {
  it('generates a matched bookmark for the map, eight POIs and rising tide', () => {
    expect(ART_BOOKMARKS.map(bookmark => bookmark.id))
      .toEqual(['07', '18', '08', '09', '10', '11', '12', '13', '14', '15', '16']);
    expect(new Set(ART_BOOKMARKS.map(b => b.image)).size).toBe(ART_BOOKMARKS.length);
    for (const bookmark of ART_BOOKMARKS) {
      expect(Number.isFinite(bookmark.camera.x + bookmark.camera.y + bookmark.camera.z)).toBe(true);
      expect(bookmark.fov).toBeGreaterThan(30);
      expect(bookmark.fov).toBeLessThan(85);
    }
  });

  it('has toon materials, high and low terrain, waterfall foam and mutable tide shader', () => {
    const island = generateIsland({ seed: 'scenery', resolution: 65 });
    const view = createWorldScene(island, { chunkSegments: 16 });
    expect(view.chunks).toHaveLength(16);
    expect(view.chunks[0]!.material).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(view.group.getObjectByName('props-lighthouse')).toBeInstanceOf(THREE.InstancedMesh);
    // No clouds render under Node until the authored GLBs have loaded in the browser.
    expect(view.group.getObjectByName('puffy-cloud-banks')).toBeUndefined();
    expect(view.group.getObjectByName('the-dam-hero')).toBeInstanceOf(THREE.Group);
    expect(view.group.getObjectByName('dam-spillway-1')).toBeUndefined();
    expect(view.group.getObjectByName('road-centre-dashes')).toBeInstanceOf(THREE.InstancedMesh);
    expect(view.sun.castShadow).toBe(true);
    const water = view.water.material as THREE.ShaderMaterial;
    expect(water.uniforms['uTerrain']).toBeDefined();
    view.update(9.5);
    view.setTideLevel(32);
    expect(view.water.position.y).toBe(32);
    expect(water.uniforms['uLevel']!.value).toBe(32);
    expect(water.uniforms['uTime']!.value).toBe(9.5);
    view.setLightingPreset('night');
    const night = view.sun.intensity;
    view.setLightingPreset('day');
    expect(view.sun.intensity).toBeGreaterThan(night);
    const far = new THREE.PerspectiveCamera(70, 1, 1, 2000);
    far.position.set(0, 750, 1);
    far.lookAt(0, 0, 0);
    view.updateCulling(far);
    const lowTriangles = view.chunks[0]!.geometry.index!.count;
    const near = new THREE.PerspectiveCamera(70, 1, 1, 2000);
    near.position.copy(view.chunks[0]!.position).add(new THREE.Vector3(0, 18, 15));
    near.lookAt(view.chunks[0]!.position);
    view.updateCulling(near);
    expect(view.chunks[0]!.geometry.index!.count).toBeGreaterThan(lowTriangles);
    view.dispose();
  });
});
