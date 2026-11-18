import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland, heightAt } from './index';
import { AUTHORED_HERO_DRESSING_KINDS } from './visual-props';
import type { IslandData, PropDescriptor, WorldScene } from './index';
import { makeLocalStreets } from './roads';
import { segmentProjection } from './terrain';
import { findBookmark } from './viewer/bookmarks';

describe('World visuals pass 2: geometry, streets and draw budget', () => {
  let island: IslandData;
  let view: WorldScene;

  beforeAll(() => {
    island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    view = createWorldScene(island);
  });
  afterAll(() => view.dispose());

  it('keeps every prop instance finite, with only replaced lighthouse art hidden', () => {
    // The striped tower (QA LH-1) is the generic 'lighthouse' prop: not hidden.
    const replacedLighthouseKinds = new Set([
      'cottage', 'shipwreck', 'dock', 'cave-mouth',
    ]);
    const grouped = new Map<string, PropDescriptor[]>();
    for (const prop of island.props) {
      // The Dam Bomb's data-only platform is replaced visually by the GLB.
      if (prop.id.startsWith('the-dam-compat-')) continue;
      const group = grouped.get(prop.kind) ?? [];
      group.push(prop);
      grouped.set(prop.kind, group);
    }
    for (const [kind, props] of grouped) {
      const mesh = view.group.getObjectByName('props-' + kind);
      expect(mesh, kind).toBeInstanceOf(THREE.InstancedMesh);
      const instances = mesh as THREE.InstancedMesh;
      // The old implementation duplicated a draw call per kind per 96-m chunk.
      expect(instances.count, kind).toBe(props.length);
      instances.geometry.computeBoundingBox();
      const bounds = instances.geometry.boundingBox!;
      const span = bounds.getSize(new THREE.Vector3());
      expect(Math.max(span.x, span.y, span.z), kind).toBeLessThanOrEqual(1.001);
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      for (let i = 0; i < props.length; i++) {
        instances.getMatrixAt(i, matrix);
        expect(matrix.elements.every(Number.isFinite), kind + ':' + i).toBe(true);
        const prop = props[i]!;
        if (prop.poiId === 'old-lighthouse' && replacedLighthouseKinds.has(kind)) {
          // A zero-scale matrix is intentional; decompose() cannot recover its
          // scale and rotation. The collider descriptor still has real size.
          const m = matrix.elements;
          expect(Math.hypot(m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!,
            m[8]!, m[9]!, m[10]!), prop.id).toBe(0);
        } else {
          matrix.decompose(position, rotation, scale);
          expect(position.distanceTo(new THREE.Vector3(
            prop.transform.position.x, prop.transform.position.y,
            prop.transform.position.z)), prop.id).toBeLessThan(0.006);
          expect(Math.abs(scale.x - prop.size.x), prop.id).toBeLessThan(0.006);
          expect(Math.abs(scale.y - prop.size.y), prop.id).toBeLessThan(0.006);
          expect(Math.abs(scale.z - prop.size.z), prop.id).toBeLessThan(0.006);
          // Allow the intentional pier/buoys outside the 600-m terrain square,
          // never a kilometer-long fence, cable, roof or shadow-caster streak.
          const limit = island.size / 2 + 150;
          expect(Math.abs(position.x), prop.id).toBeLessThan(limit);
          expect(Math.abs(position.z), prop.id).toBeLessThan(limit);
        }
        expect(prop.size.x, prop.id).toBeLessThan(island.size / 3);
        expect(prop.size.z, prop.id).toBeLessThan(island.size / 3);
      }
    }
  });

  it('does not draw cliff/grass outlines or cast a shadow per tiny prop', () => {
    for (const kind of ['rock', 'ledge', 'fence', 'rope-rail', 'grass-tuft',
      'flower', 'bunting', 'awning', 'site-banner', 'signboard']) {
      expect(view.group.getObjectByName('outline-' + kind)).toBeUndefined();
    }
    expect(view.chunks.every(chunk => !chunk.castShadow)).toBe(true);
    const meshes: THREE.Mesh[] = [];
    view.group.traverse(object => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    const shadowPass = meshes.filter(mesh => mesh.castShadow).length;
    const outlines = meshes.filter(mesh => mesh.name.startsWith('outline-')).length;
    // This detects the previous ~600-call pattern even without a GPU.
    // The noncollidable fern and lily-pad kinds each add one instance batch.
    // Exclude exactly those two batches so the original six-hero draw budget
    // is unchanged. Do not relax the Chrome profile performance budget.
    const gladeMeshes = meshes.filter(mesh =>
      mesh.name === 'props-fern' || mesh.name === 'props-lily-pads');
    expect(gladeMeshes).toHaveLength(2);
    expect(meshes.length + shadowPass - gladeMeshes.length)
      .toBeLessThan(180 + AUTHORED_HERO_DRESSING_KINDS.size - 1);
    expect(shadowPass).toBeLessThan(20);
    expect(outlines).toBeLessThanOrEqual(8);
    for (const mesh of meshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshBasicMaterial ||
            material instanceof THREE.MeshToonMaterial) {
          expect(Math.max(material.color.r, material.color.g, material.color.b),
            mesh.name).toBeGreaterThan(0.01);
        }
      }
    }
    const merged = view.group.getObjectByName('merged-ground-details') as THREE.Group;
    expect(merged.children.length).toBeGreaterThan(1);
    expect(merged.children.length).toBeLessThan(18);
    expect(merged.children.every(child => child instanceof THREE.Mesh)).toBe(true);
  });

  it('has exact high/low boundary vertex matches, not double-sided skirt geometry', () => {
    const chunk = view.chunks[0]!;
    const far = new THREE.PerspectiveCamera(70, 1, 1, 2000);
    far.position.set(0, 750, 1);
    far.lookAt(0, 0, 0);
    view.updateCulling(far);
    const low = chunk.geometry;
    const near = new THREE.PerspectiveCamera(70, 1, 1, 2000);
    near.position.copy(chunk.position).add(new THREE.Vector3(0, 18, 15));
    near.lookAt(chunk.position);
    view.updateCulling(near);
    const high = chunk.geometry;
    expect(high.index!.count).toBeGreaterThan(low.index!.count);
    const edgePositions = (geometry: THREE.BufferGeometry): string[] => {
      const positions = geometry.getAttribute('position');
      const extremes = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox!);
      const points = new Set<string>();
      const indices = geometry.index!;
      for (let i = 0; i < indices.count; i++) {
        const k = indices.getX(i);
        const x = positions.getX(k), z = positions.getZ(k);
        if (Math.abs(x - extremes.min.x) < 0.0001 ||
            Math.abs(x - extremes.max.x) < 0.0001 ||
            Math.abs(z - extremes.min.z) < 0.0001 ||
            Math.abs(z - extremes.max.z) < 0.0001) {
          points.add(x.toFixed(4) + ':' + z.toFixed(4));
        }
      }
      return [...points].sort();
    };
    expect(edgePositions(low)).toEqual(edgePositions(high));
    expect(low.getAttribute('position').count)
      .toBe(high.getAttribute('position').count);
  });

  it('keeps Mt. Gigga benches and risers grassy in the vertex buffer', () => {
    const average = (radius: number): THREE.Color => {
      const color = new THREE.Color(0, 0, 0);
      let count = 0;
      for (const chunk of view.chunks) {
        const positions = chunk.geometry.getAttribute('position');
        const tints = chunk.geometry.getAttribute('color');
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i) + chunk.position.x;
          const z = positions.getZ(i) + chunk.position.z;
          if (Math.abs(Math.hypot(x, z) - radius) > 1.6) continue;
          color.r += tints.getX(i);
          color.g += tints.getY(i);
          color.b += tints.getZ(i);
          count++;
        }
      }
      expect(count).toBeGreaterThan(10);
      return color.multiplyScalar(1 / count);
    };
    const green = average(32);
    const cliff = average(42);
    // IS-15: even the steep grey-looking faces stay grassy at vertices.
    // The normal-based fragment shader makes those faces stone, eliminating
    // the old 3.1 m-spaced green saw-teeth at the boundary.
    for (const tint of [green, cliff]) {
      expect(tint.g).toBeGreaterThan(tint.r * 1.5);
      expect(tint.g).toBeGreaterThan(tint.b * 2.0);
    }
    expect(Math.abs(green.g - cliff.g)).toBeLessThan(0.1);
    expect(Math.abs(green.b - cliff.b)).toBeLessThan(0.1);
    const shelves = island.props.filter(p => p.kind === 'ledge');
    expect(shelves.length).toBeGreaterThan(30);
    for (const shelf of shelves) {
      const radius = Math.hypot(shelf.transform.position.x, shelf.transform.position.z);
      expect([[27, 35], [46, 55], [64, 74], [82, 92]]
        .some(([min, max]) => radius >= min! && radius <= max!), shelf.id).toBe(true);
    }
  });

  it('places town cameras in the streets and turns every shop facade toward its street', () => {
    const local = makeLocalStreets(island);
    for (const [id, poiId] of [
      ['08', 'hoofington'], ['11', 'downtown-bleatsville'],
    ] as const) {
      const mark = findBookmark(id)!;
      const site = island.pois.find(p => p.id === poiId)!.center;
      const road = local.find(r => r.from === poiId)!;
      expect(Math.abs(mark.camera.x - site.x)).toBeLessThan(4);
      expect(mark.camera.z - mark.target.z).toBeGreaterThan(60);
      expect(mark.camera.y - heightAt(island, mark.camera.x, mark.camera.z))
        .toBeGreaterThan(1);
      expect(mark.camera.y - heightAt(island, mark.camera.x, mark.camera.z))
        .toBeLessThan(9);
      expect(road.points.length).toBeGreaterThanOrEqual(20);
    }
    const city = local.find(road => road.from === 'downtown-bleatsville')!;
    // Consider the coastal approaches and mountain paths, not only the
    // newly introduced local street. A shop must not face away from a nearer
    // existing road just because the local street test is easy to satisfy.
    const streets = [city, ...island.roads];
    const shops = island.props.filter(p => p.kind === 'shop' &&
      p.poiId === 'downtown-bleatsville');
    expect(shops.length).toBeGreaterThanOrEqual(10);
    for (const shop of shops) {
      let closest: { x: number; z: number } | undefined;
      let distance = Infinity;
      for (const street of streets) {
        for (let i = 0; i < street.points.length - 1; i++) {
          const a = street.points[i]!, b = street.points[i + 1]!;
          const p = shop.transform.position;
          const projection = segmentProjection(p, a, b);
          if (projection.distance < distance) {
            const t = projection.t;
            closest = { x: a.x + (b.x - a.x) * t,
              z: a.z + (b.z - a.z) * t };
            distance = projection.distance;
          }
        }
      }
      expect(closest).toBeDefined();
      const dx = closest!.x - shop.transform.position.x;
      const dz = closest!.z - shop.transform.position.z;
      const yaw = shop.transform.rotationY;
      const frontDot = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) /
        Math.max(distance, 0.001);
      expect(frontDot, shop.id).toBeGreaterThan(0.75);
      const ornaments = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
        (p.kind === 'awning' || p.kind === 'signboard') &&
        Math.hypot(p.transform.position.x - shop.transform.position.x,
          p.transform.position.z - shop.transform.position.z) < 8.5);
      expect(ornaments.some(p => {
        const dX = p.transform.position.x - shop.transform.position.x;
        const dZ = p.transform.position.z - shop.transform.position.z;
        return dX * Math.sin(yaw) + dZ * Math.cos(yaw) > shop.size.z * 0.4 &&
          Math.abs(p.transform.rotationY - yaw) < 0.001;
      }), shop.id).toBe(true);
    }
  });
});
