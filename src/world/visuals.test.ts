import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  POI_IDS, arePoisConnected, createWorldScene, generateIsland,
  hashIsland, heightAt,
} from './index';
import { ART_BOOKMARKS } from './viewer/bookmarks';

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
    const y = [0, 30, 49, 68, 87, 117].map(r =>
      heightAt(island, Math.cos(0.85) * r, Math.sin(0.85) * r));
    for (let i = 1; i < y.length; i++) {
      expect(y[i - 1]!).toBeGreaterThan(y[i]! + 3);
    }
    const independent = Array.from({ length: 11 }, (_, i) =>
      heightAt(island, 25 + i * 1.1, -5));
    expect(new Set(independent.map(v => v.toFixed(3))).size).toBeGreaterThan(7);
  });

  it('has substantial playground detail in every named district', () => {
    const island = generateIsland({ seed: 'density', resolution: 193 });
    const minimum: Record<(typeof POI_IDS)[number], number> = {
      hoofington: 75, 'baa-ardwalk': 65, 'crane-yard': 70,
      'downtown-bleatsville': 90, 'mt-gigga': 60,
      'whispering-pines': 125, 'the-dam': 35, 'old-lighthouse': 30,
    };
    for (const id of POI_IDS) {
      expect(island.props.filter(p => p.poiId === id).length).toBeGreaterThanOrEqual(minimum[id]);
    }
    const kind = new Set(island.props.map(prop => prop.kind));
    for (const required of ['silo', 'gnome', 'mailbox', 'ferris-wheel', 'bunting', 'cone',
      'container', 'fountain', 'ac-unit', 'water-tower', 'mushroom', 'lookout',
      'control-house', 'shipwreck', 'cave-mouth', 'grass-tuft', 'bush']) {
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
        expect(prop.collidable, prop.id).toBe(true);
        const collider = byId.get(prop.id);
        expect(collider, prop.id).toBeDefined();
        if (!collider || collider.shape === 'heightfield') continue;
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
    expect(view.group.getObjectByName('puffy-cloud-banks')).toBeInstanceOf(THREE.InstancedMesh);
    expect(view.group.getObjectByName('dam-spillway-1')).toBeInstanceOf(THREE.Mesh);
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
