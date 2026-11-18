import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland, heightAt } from './index';
import { makeLocalStreets } from './roads';
import { buildArchitecture } from './visual-architecture';

const buildingKinds = new Set(['barn', 'house', 'cottage', 'shop', 'booth', 'control-house']);

describe('Hoofington art / building slicing regressions', () => {
  it('grades the true rotated footprint of every barn and house, not just the POI centre', () => {
    for (const seed of ['billy-isle', 'hoofington-geometry', 'sloped-farm']) {
      const island = generateIsland({ seed, resolution: 193 });
      const buildings = island.props.filter(prop =>
        prop.poiId === 'hoofington' && buildingKinds.has(prop.kind));
      expect(buildings.filter(p => p.kind === 'house').length).toBeGreaterThanOrEqual(4);
      expect(buildings.some(p => p.kind === 'barn')).toBe(true);
      for (const prop of buildings) {
        const p = prop.transform.position;
        const foot = p.y - prop.size.y / 2;
        const yaw = prop.transform.rotationY;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        // Four feet rather than only the centre: the old 31-m POI plot did
        // not reach the barn at 44 m and left buildings buried on one side.
        for (const lx of [-0.44, 0.44]) for (const lz of [-0.43, 0.43]) {
          const x = p.x + c * lx * prop.size.x + s * lz * prop.size.z;
          const z = p.z - s * lx * prop.size.x + c * lz * prop.size.z;
          expect(Math.abs(heightAt(island, x, z) - foot),
            prop.id + ' corner ' + lx + ',' + lz).toBeLessThan(1.0);
        }
        expect(Math.abs(heightAt(island, p.x, p.z) - foot), prop.id)
          .toBeLessThan(0.15);
      }
    }
  });

  it('uses upright, paired gables and complete painted architecture inside collider bounds', () => {
    for (const kind of ['barn', 'house', 'cottage', 'shop', 'booth', 'control-house'] as const) {
      const { shell, details } = buildArchitecture(kind);
      for (const geometry of [shell, details]) {
        const bounds = geometry.boundingBox!;
        expect(bounds.min.x, kind).toBeGreaterThanOrEqual(-0.511);
        expect(bounds.min.y, kind).toBeGreaterThanOrEqual(-0.511);
        expect(bounds.min.z, kind).toBeGreaterThanOrEqual(-0.511);
        expect(bounds.max.x, kind).toBeLessThanOrEqual(0.511);
        expect(bounds.max.y, kind).toBeLessThanOrEqual(0.511);
        expect(bounds.max.z, kind).toBeLessThanOrEqual(0.511);
        expect(geometry.getAttribute('normal').count).toBeGreaterThan(0);
        expect(geometry.getAttribute('color').count)
          .toBe(geometry.getAttribute('position').count);
      }
      expect(shell.boundingBox!.min.y, kind).toBeCloseTo(-0.5, 2);
      expect(details.boundingBox!.max.y, kind).toBeGreaterThan(0.47);
      expect(details.getAttribute('position').count, kind).toBeGreaterThan(500);
      if (kind !== 'shop' && kind !== 'booth') {
        const points = details.getAttribute('position');
        let left = 0, right = 0;
        for (let i = 0; i < points.count; i++) {
          if (points.getY(i) > 0.30 && points.getX(i) < -0.19) left++;
          if (points.getY(i) > 0.30 && points.getX(i) > 0.19) right++;
        }
        expect(left, kind + ' left roof').toBeGreaterThan(100);
        expect(right, kind + ' right roof').toBeGreaterThan(100);
      }
      shell.dispose();
      details.dispose();
    }
  });

  it('keeps facades upright under every authored yaw and preserves untinted glass/roof details', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const view = createWorldScene(island);
    // The Dam control house is now a GLB mesh, not an instanced procedural facade.
    // Legacy booths remain supported by buildArchitecture (tested above),
    // but no longer occur on the Baa-ardwalk after the themed kiosk swap.
    const categories = ['barn', 'house', 'cottage', 'shop'];
    for (const kind of categories) {
      const props = island.props.filter(p => p.kind === kind);
      expect(props.length, kind).toBeGreaterThan(0);
      const mesh = view.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
      const ornament = view.group.getObjectByName('architecture-details-' + kind) as THREE.InstancedMesh;
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(ornament).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.count, kind).toBe(props.length);
      expect(ornament.count, kind).toBe(props.length);
      expect(mesh.instanceColor, kind).not.toBeNull();
      expect(ornament.instanceColor, kind).toBeNull();
      const matrix = new THREE.Matrix4(), ornamentMatrix = new THREE.Matrix4();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < props.length; i++) {
        mesh.getMatrixAt(i, matrix);
        ornament.getMatrixAt(i, ornamentMatrix);
        expect(ornamentMatrix.elements, kind + ':' + i).toEqual(matrix.elements);
        // Scaling and yaw cannot rotate the local walls' Y axis into X/Z.
        const rotation = new THREE.Quaternion();
        matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
        const worldUp = up.clone().applyQuaternion(rotation);
        expect(worldUp.distanceTo(up), kind + ':' + i).toBeLessThan(0.0001);
      }
    }
    view.dispose();
  });

  it('renders a normal two-lane farm road with physical-scale curbs and crossings', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const local = makeLocalStreets(island);
    const farm = local.find(r => r.from === 'hoofington')!;
    expect(farm.width).toBeCloseTo(6.8, 2);
    expect(farm.width).toBeLessThan(7.2);
    const view = createWorldScene(island);
    for (const name of ['paved-village-sidewalks', 'raised-stone-curbs',
      'two-lane-edge-stripes', 'hoofington-and-city-crosswalks']) {
      const mesh = view.group.getObjectByName(name);
      expect(mesh, name).toBeInstanceOf(THREE.InstancedMesh);
    }
    const walks = view.group.getObjectByName('paved-village-sidewalks') as THREE.InstancedMesh;
    const crossings = view.group.getObjectByName('hoofington-and-city-crosswalks') as THREE.InstancedMesh;
    expect(walks.count).toBe(44);
    expect(crossings.count).toBe(21);
    const verge = view.group.getObjectByName('hoofington-street-verge') as THREE.Mesh;
    expect(verge).toBeInstanceOf(THREE.Mesh);
    expect(verge).not.toBeInstanceOf(THREE.InstancedMesh);
    expect(verge.geometry.index?.count).toBe((farm.points.length - 1) * 60);
    const paint = verge.geometry.getAttribute('color');
    const colours = Array.from({ length: paint.count }, (_, i) =>
      [paint.getX(i), paint.getY(i), paint.getZ(i)].join(','));
    expect(new Set(colours).size).toBe(3);
    const surface = verge.geometry.getAttribute('hoofingtonVerge');
    expect(surface.count).toBe(paint.count);
    for (const style of [0, 1, 2]) {
      const across = Array.from({ length: surface.count }, (_, i) => i)
        .filter(i => surface.getY(i) === style).map(i => surface.getX(i));
      expect(Math.min(...across)).toBeCloseTo(0);
      expect(Math.max(...across)).toBeCloseTo(1);
    }
    const material = verge.material as THREE.MeshToonMaterial;
    const shader = {
      vertexShader: THREE.ShaderLib.toon!.vertexShader,
      fragmentShader: THREE.ShaderLib.toon!.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0],
      null as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vVergeSection = hoofingtonVerge');
    expect(shader.fragmentShader).toContain('if (vVergeSection.y > 0.5)');
    expect(shader.fragmentShader).toContain('paintedJoint(slab, 0.011)');
    expect(shader.fragmentShader).toContain('fwidth(slab)');
    expect(shader.uniforms['uVergeScale']?.value).toBe(1);
    expect(view.group.getObjectByName('hoofington-zebra-crossing'))
      .toBeInstanceOf(THREE.Mesh);
    view.dispose();
  });
  it('adds dense, ground-anchored meadow colour beyond the village without physics clutter', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const originalCount = island.props.length;
    const view = createWorldScene(island);
    const grass = view.group.getObjectByName('meadow-grass-sprigs') as THREE.InstancedMesh;
    const daisies = view.group.getObjectByName('meadow-daisy-flowers') as THREE.InstancedMesh;
    expect(grass).toBeInstanceOf(THREE.InstancedMesh);
    expect(daisies).toBeInstanceOf(THREE.InstancedMesh);
    expect(grass.count).toBeGreaterThan(1200);
    expect(daisies.count).toBeGreaterThan(100);
    expect(grass.castShadow).toBe(false);
    expect(daisies.castShadow).toBe(false);
    expect(island.props.length).toBe(originalCount);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const size = new THREE.Vector3();
    let nearVillage = 0, awayFromVillage = 0;
    const farm = island.pois.find(p => p.id === 'hoofington')!.center;
    for (let i = 0; i < grass.count; i++) {
      grass.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, size);
      expect(Math.abs(position.y - heightAt(island, position.x, position.z)))
        .toBeLessThan(0.1);
      expect(size.x).toBeGreaterThan(0.3);
      expect(Number.isFinite(position.x + position.y + position.z)).toBe(true);
      if (Math.hypot(position.x - farm.x, position.z - farm.z) < 65) nearVillage++;
      else awayFromVillage++;
    }
    expect(nearVillage).toBeGreaterThan(40);
    expect(awayFromVillage).toBeGreaterThan(900);
    view.dispose();
  });

});
