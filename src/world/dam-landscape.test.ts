import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWorldScene, generateIsland, heightAt } from './index';
import { gridSample } from './terrain';
import { damChannelAt, DAM_CHANNEL } from './dam-landscape';
import { getDamPlacement } from './the-dam';
import { buildDamVisuals } from './visual-dam';
import { buildWaterVisuals } from './visual-water';
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

  it('dims exposed spillway foam at night and retires the pool and foam at the reported 49 m flood', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const world = createWorldScene(island);
    try {
      const pool = world.group.getObjectByName('dam-plunge-pool-and-downstream-river') as
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const foam = world.group.getObjectByName('dam-four-falls-white-foam') as
        THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const spray = world.group.getObjectByName('dam-plunge-spray-patches') as
        THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const sea = world.group.getObjectByName('rising-sea') as
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const litParts = [pool, foam, spray];
      const dayFoam = foam.material.color.getHex();
      const dayOpacity = foam.material.opacity;
      expect(litParts.every(part => part.visible)).toBe(true);
      expect(pool.material.uniforms['uLight']!.value).toBe(sea.material.uniforms['uLight']!.value);
      expect(pool.material.fragmentShader).toContain('uTide - vHeight');
      expect(pool.material.fragmentShader).toContain('mix(0.42, 1.0,');
      expect(pool.material.fragmentShader).toContain('0.98 * exposed');

      world.setLightingPreset('night');
      const nightFoam = foam.material.color.clone().convertLinearToSRGB();
      expect(nightFoam.r).toBeLessThan(0.16);
      expect(nightFoam.g).toBeCloseTo(0.2, 4);
      expect(nightFoam.b).toBeCloseTo(0.34, 4);
      expect(foam.material.opacity).toBeCloseTo(dayOpacity * 0.55, 4);

      world.setTideLevel(49);
      expect(pool.material.uniforms['uTide']!.value).toBe(49);
      expect(litParts.every(part => !part.visible)).toBe(true);
      expect(world.group.getObjectByName('dam-front-rail')!.visible).toBe(true);

      world.setTideLevel(island.seaLevel);
      world.setLightingPreset('day');
      expect(litParts.every(part => part.visible)).toBe(true);
      expect(foam.material.color.getHex()).toBe(dayFoam);
      expect(foam.material.opacity).toBe(dayOpacity);
    } finally {
      world.dispose();
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

  it('keeps the actual Dam pine trunks off the rendered Pines outflow and on their banks', async () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const file = 'assets/library/custom/pines/pine.glb';
    const source = Uint8Array.from(readFileSync('public/' + file)).buffer;
    const gltf = await new GLTFLoader().parseAsync(source, '');
    const load = vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((url, onLoad) => {
      if (url === publicAssetUrl(file)) onLoad(gltf);
    });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const water = buildWaterVisuals(island);
    let dam: ReturnType<typeof buildDamVisuals> | undefined;
    try {
      dam = buildDamVisuals(island);
      dam.group.updateMatrixWorld(true);
      water.inland.updateMatrixWorld(true);
      const river = water.inland.getObjectByName('rippling-river')!;
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const size = new THREE.Vector3();
      for (const [name, count] of [['dam-quaternius-pines', 38],
        ['dam-full-canopy-kenney-pines', 44]] as const) {
        const row = dam.group.getObjectByName(name)!;
        const mesh = row.children[0] as THREE.InstancedMesh;
        expect(mesh.count).toBe(count);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
          size.setFromMatrixScale(matrix);
          const radius = Math.min(.9, size.x * .2);
          const label = name + ':' + i;
          expect(position.y, label).toBeCloseTo(heightAt(island, position.x, position.z) -
            (name === 'dam-quaternius-pines' ? .3 : .2), 4);
          for (let sample = 0; sample <= 8; sample++) {
            const angle = sample * Math.PI / 4;
            const distance = sample === 8 ? 0 : radius;
            ray.set(new THREE.Vector3(position.x + Math.cos(angle) * distance,
              position.y + 30, position.z + Math.sin(angle) * distance), down);
            expect(ray.intersectObject(river), label).toHaveLength(0);
          }
        }
      }
    } finally {
      dam?.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
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
    const instanceScale = new THREE.Vector3().setFromMatrixScale(matrix);
    expect(instanceScale.x).toBeCloseTo(DAM_BUOY_SIZE.width, 6);
    expect(instanceScale.y).toBeCloseTo(DAM_BUOY_SIZE.height, 6);
    expect(instanceScale.z).toBeCloseTo(DAM_BUOY_SIZE.depth, 6);
    instance.geometry.dispose();
    mesh.geometry.dispose();
    paint.dispose();
  });

  it.each([
    { seed: 'billy-isle', size: 600 },
    { seed: 'dam-lamp-alt', size: 900 },
  ])('keeps every roadside lamp outside the Dam plot and walkable deck for $seed',
    ({ seed, size }) => {
      const island = generateIsland({ seed, size, resolution: 97 });
      const plot = island.plots.find(p => p.poiId === 'the-dam')!;
      const { position, scale } = getDamPlacement(island);
      const roadside = island.props.filter(p => p.kind === 'lamp' && p.poiId === undefined);
      expect(roadside.length).toBeGreaterThan(0);
      for (const lamp of roadside) {
        const { x, z } = lamp.transform.position;
        expect(Math.hypot(x - plot.center.x, z - plot.center.z), lamp.id + ' plot')
          .toBeGreaterThan(plot.radius);
        const onDeck = Math.abs(x - position.x) <= (30 + 0.275) * scale &&
          Math.abs(z - position.z) <= (3.7 + 0.275) * scale;
        expect(onDeck, lamp.id + ' on Dam deck').toBe(false);
      }
    });

  it('uses the painted 3.3 x 2.2 x 0.37 m timber sign with its label on the new board', () => {
    const path = 'assets/library/custom/props/signpost.glb';
    const manifest = JSON.parse(readFileSync(
      'public/assets/library/manifest.json', 'utf8',
    )) as Array<{ path: string; license: string }>;
    expect(manifest.find(asset => asset.path === path)?.license).toBe('CC0');
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const paint = new THREE.MeshStandardMaterial({ color: 0x7b573c });
    const root = new THREE.Group();
    const native = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 0.5), paint);
    root.add(native);
    const url = publicAssetUrl(path);
    const load = vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation(
      (request, onLoad) => {
        if (request === url) onLoad({
          scene: root,
        } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
      });
    const ctx = {
      beginPath: () => {}, roundRect: () => {}, fill: () => {},
      stroke: () => {}, fillText: () => {}, moveTo: () => {}, lineTo: () => {},
    };
    vi.stubGlobal('document', {
      createElement: () => ({ width: 512, height: 224, getContext: () => ctx }),
    });
    let visuals: ReturnType<typeof buildDamLandscape> | undefined;
    try {
      visuals = buildDamLandscape(island, () => {});
      expect(load.mock.calls.some(([request]) => request === url)).toBe(true);
      const group = visuals.group.getObjectByName('dam-wooden-direction-sign') as THREE.Group;
      expect(group).toBeInstanceOf(THREE.Group);
      const sign = group.children[0] as THREE.InstancedMesh;
      expect(sign).toBeInstanceOf(THREE.InstancedMesh);
      expect(sign.count).toBe(1);
      expect(sign.material).toBe(paint); // Authored wood and arrow colours, no forced tint.
      const matrix = new THREE.Matrix4();
      sign.getMatrixAt(0, matrix);
      const box = new THREE.Vector3().setFromMatrixScale(matrix);
      expect(box.x).toBeCloseTo(3.3, 5);
      expect(box.y).toBeCloseTo(2.2, 5);
      expect(box.z).toBeCloseTo(0.37, 5);
      const { position: dam, scale } = getDamPlacement(island);
      const base = Math.max(
        (gridSample(island, dam.x - 28 * scale, dam.z + 36 * scale) - dam.y) / scale,
        damChannelAt(36).level + 1.1,
      );
      const centre = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(centre.x).toBeCloseTo(-28, 6);
      expect(centre.y).toBeCloseTo(base, 6);
      expect(centre.z).toBeCloseTo(36, 6);
      const yaw = new THREE.Euler().setFromRotationMatrix(
        new THREE.Matrix4().extractRotation(matrix));
      expect(yaw.y).toBeCloseTo(1.1, 5);

      const label = visuals.group.getObjectByName('dam-wooden-arrow-sign-label') as THREE.Mesh;
      expect(label).toBeInstanceOf(THREE.Mesh);
      expect(label.position.y).toBeCloseTo(base + 2.2 * 0.68, 6);
      expect(label.position.x).toBeCloseTo(-28 + Math.sin(1.1) * (0.37 / 2 + 0.04), 6);
      expect(label.position.z).toBeCloseTo(36 + Math.cos(1.1) * (0.37 / 2 + 0.04), 6);
      expect(label.rotation.y).toBeCloseTo(1.1, 6);
      const bounds = (label.geometry as THREE.PlaneGeometry).parameters;
      expect(bounds.width).toBeLessThan(3.3);
      expect(bounds.height).toBeLessThan(2.2);
    } finally {
      visuals?.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
      native.geometry.dispose();
      paint.dispose();
    }
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
