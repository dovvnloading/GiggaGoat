import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateIsland, heightAt } from './index';
import { damChannelAt, DAM_CHANNEL } from './dam-landscape';
import { getDamPlacement } from './the-dam';
import { buildDamVisuals } from './visual-dam';
import { DAM_BUOY_MODEL, DAM_BUOY_SIZE, buildDamLandscape, instanceDamAsset } from './visual-dam-landscape';
import { publicAssetUrl } from './public-assets';

describe('The Dam downstream scenery', () => {
  it('cuts a continuous pool below the four falls and drains toward bookmark 14', () => {
    for (const size of [400, 600, 900]) {
      const island = generateIsland({ seed: 'billy-isle', resolution: 193, size });
      const { position, scale } = getDamPlacement(island);
      expect(DAM_CHANNEL[0]!.halfWidth * 2).toBeGreaterThan(38);
      expect(DAM_CHANNEL[1]!.halfWidth).toBeGreaterThan(DAM_CHANNEL[5]!.halfWidth);
      for (const z of [20, 36, 60]) {
        const channel = damChannelAt(z);
        const core = heightAt(island, position.x + channel.x * scale,
          position.z + z * scale);
        const water = position.y + channel.level * scale;
        const bank = heightAt(island,
          position.x + (channel.x + channel.halfWidth + 8) * scale,
          position.z + z * scale);
        expect(core, 'dry plunge pool at z=' + z).toBeLessThan(water - 0.5 * scale);
        expect(bank, 'unraised right bank at z=' + z).toBeGreaterThan(core + 0.7 * scale);
      }
      // Its centreline travels toward camera (+Z) before bending into pines.
      expect(island.river[5]!.z).toBeGreaterThan(island.river[4]!.z);
      expect(island.river[6]!.z).toBeGreaterThan(island.river[5]!.z);
      expect(island.river[7]!.z).toBeGreaterThan(island.river[6]!.z);
      expect(island.river[5]!.width).toBeGreaterThan(island.river[9]!.width);
      const details = island.props.filter(prop => prop.poiId === 'the-dam');
      expect(details.length).toBeGreaterThanOrEqual(45);
      expect(details.filter(prop => prop.kind === 'rock').length).toBeGreaterThan(5);
      expect(details.filter(prop => prop.kind === 'flower').length).toBeGreaterThan(15);
    }
  });

  it('shows the headless pool, four foam outlets and the complete foreground', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const dam = buildDamVisuals(island);
    try {
      const landscape = dam.group.getObjectByName(
        'dam-plunge-pool-rocky-banks-and-foreground') as THREE.Group;
      expect(landscape).toBeInstanceOf(THREE.Group);
      for (const part of [
        'dam-plunge-pool-and-downstream-river',
        'dam-four-falls-white-foam',
        'dam-plunge-spray-patches',
        'dam-foreground-winding-dirt-path',
        'dam-rocky-bank-underpainting',
        'dam-riverside-reeds',
        'dam-cattail-heads',
        'dam-two-orange-buoys-fallback',
      ]) expect(landscape.getObjectByName(part), part).toBeDefined();
      const foam = landscape.getObjectByName(
        'dam-four-falls-white-foam') as THREE.InstancedMesh;
      const reeds = landscape.getObjectByName(
        'dam-riverside-reeds') as THREE.InstancedMesh;
      const buoys = landscape.getObjectByName(
        'dam-two-orange-buoys-fallback') as THREE.InstancedMesh;
      expect(foam.count).toBe(36);
      expect(reeds.count).toBe(38);
      expect(buoys.count).toBe(2);
      expect(landscape.children.filter(c => c instanceof THREE.Mesh).length)
        .toBeLessThan(20);
      dam.update(3.5);
      const pool = landscape.getObjectByName(
        'dam-plunge-pool-and-downstream-river') as THREE.Mesh;
      const material = pool.material as THREE.ShaderMaterial;
      expect(material.uniforms['uTime']!.value).toBe(3.5);
    } finally {
      dam.dispose();
    }
  });

  it('loads both Dam pine rows from one Blender family at 0.35 width/height', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const pinePath = publicAssetUrl('assets/library/custom/pines/pine.glb');
    const root = new THREE.Group();
    const modelGeometry = new THREE.BoxGeometry(0.35, 1, 0.35);
    const modelMaterial = new THREE.MeshStandardMaterial({ color: 0x5a9868 });
    root.add(new THREE.Mesh(modelGeometry, modelMaterial));
    const load = vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((url, onLoad) => {
      if (url === pinePath) {
        onLoad({ scene: root } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
      }
    });
    // Avoid drawing a canvas label; this checks loader URLs and instance matrices only.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    let visuals: ReturnType<typeof buildDamLandscape> | undefined;
    try {
      visuals = buildDamLandscape(island, () => {});
      expect(load.mock.calls.filter(([url]) => url === pinePath)).toHaveLength(2);
      const matrix = new THREE.Matrix4();
      const dimensions = new THREE.Vector3();
      for (const name of ['dam-quaternius-pines', 'dam-full-canopy-kenney-pines']) {
        const group = visuals.group.getObjectByName(name) as THREE.Group;
        expect(group, name).toBeInstanceOf(THREE.Group);
        const mesh = group.children[0] as THREE.InstancedMesh;
        expect(mesh, name).toBeInstanceOf(THREE.InstancedMesh);
        expect(mesh.count, name).toBeGreaterThan(10);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          dimensions.setFromMatrixScale(matrix);
          expect(dimensions.x / dimensions.y, name + ':' + i).toBeCloseTo(0.35, 5);
          expect(dimensions.z / dimensions.y, name + ':' + i).toBeCloseTo(0.35, 5);
        }
      }
    } finally {
      visuals?.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
      modelGeometry.dispose();
      modelMaterial.dispose();
    }
  });

  it('uses the painted custom buoy at its 1.0 x 1.8 x 1.0 metre scale', () => {
    expect(DAM_BUOY_MODEL).toBe('custom/props/buoy.glb');
    expect(DAM_BUOY_SIZE).toEqual({ width: 1, height: 1.8, depth: 1 });
    const manifest = JSON.parse(
      readFileSync('public/assets/library/manifest.json', 'utf8'),
    ) as Array<{ path: string; license: string }>;
    const path = 'assets/library/' + DAM_BUOY_MODEL;
    expect(manifest.find(asset => asset.path === path)?.license).toBe('CC0');
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const dam = buildDamVisuals(island);
    try {
      const fallback = dam.group.getObjectByName(
        'dam-two-orange-buoys-fallback') as THREE.InstancedMesh;
      expect(fallback.count).toBe(2);
      const geo = fallback.geometry as THREE.CylinderGeometry;
      expect(geo.parameters.radiusTop).toBe(0.5);
      expect(geo.parameters.radiusBottom).toBe(0.5);
      expect(geo.parameters.height).toBe(1.8);
      const matrix = new THREE.Matrix4();
      for (const [i, z] of [35, 48].entries()) {
        fallback.getMatrixAt(i, matrix);
        const centre = new THREE.Vector3().setFromMatrixPosition(matrix);
        expect(centre.y - DAM_BUOY_SIZE.height / 2)
          .toBeCloseTo(damChannelAt(z).level - 0.5, 6);
      }
    } finally {
      dam.dispose();
    }
    const paint = new THREE.MeshStandardMaterial({ color: 0x4b8ab5 });
    const model = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.8), paint);
    model.add(mesh);
    const batch = instanceDamAsset(model, {
      name: 'dam-buoys-test', path: DAM_BUOY_MODEL,
      placements: [{ x: 8, y: 3, z: 35, ...DAM_BUOY_SIZE, yaw: 0 }],
    });
    const instance = batch.children[0] as THREE.InstancedMesh;
    expect(instance).toBeInstanceOf(THREE.InstancedMesh);
    expect(instance.material).toBe(paint);
    const matrix = new THREE.Matrix4();
    instance.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).toArray())
      .toEqual([DAM_BUOY_SIZE.width, DAM_BUOY_SIZE.height, DAM_BUOY_SIZE.depth]);
    instance.geometry.dispose();
    mesh.geometry.dispose();
    paint.dispose();
  });

  it('loads repeated library parts as batched upright GLB instances', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x829b6e });
    for (const x of [-1, 1]) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), material);
      part.position.x = x;
      part.name = 'pine-part';
      root.add(part);
    }
    const batch = instanceDamAsset(root, {
      name: 'dam-asset-test',
      path: 'kenney/nature-kit/tree_pineTallA.glb',
      placements: [
        { x: 2, y: 4, z: 6, width: 5, height: 11, depth: 5, yaw: 0.1 },
        { x: 14, y: 5, z: 26, width: 6, height: 14, depth: 6, yaw: 0.5 },
      ],
    });
    expect(batch.children).toHaveLength(1);
    const mesh = batch.children[0] as THREE.InstancedMesh;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(2);
    expect(mesh.castShadow).toBe(false);
    const transform = new THREE.Matrix4();
    mesh.getMatrixAt(1, transform);
    expect(new THREE.Vector3().setFromMatrixPosition(transform).toArray())
      .toEqual([14, 5, 26]);
  });
});
