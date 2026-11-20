import * as THREE from 'three';
import { publicAssetUrl } from './public-assets';
import { gridCoordinate, gridIndex } from './terrain';
import type { IslandData, PoiId } from './types';

type Swath = readonly [x: number, z: number, length: number, width: number, bearing: number];
interface Finish { tile: number; strength: number; swaths: Swath[]; }

// Local metres along the orchard rows, promenades, shelves and work aisles.
const finishes: Record<PoiId, Finish> = {
  hoofington: {
    tile: 5.1, strength: .76, swaths: [
      [-20, 29, 43, 12, 81], [-29, 7, 36, 11, -27], [28, -11, 36, 15, -13], [-14, 43, 27, 12, -12]]
  },
  'baa-ardwalk': {
    tile: 4.7, strength: .94, swaths: [
      [-17, -6, 42, 20, 79], [3, -17, 47, 14, -5], [17, -1, 31, 15, 65], [-12, 8, 32, 13, -24]]
  },
  'crane-yard': {
    tile: 6, strength: .83, swaths: [
      [-19, -9, 40, 14, 91], [5, -18, 41, 16, 2], [19, 9, 47, 12, 83]]
  },
  'downtown-bleatsville': {
    tile: 3.7, strength: .95, swaths: [
      [-11, 49, 26, 16, 78], [14, -50, 26, 14, -16], [30, 3, 57, 9, 86], [-20, 19, 40, 9, 87]]
  },
  'mt-gigga': {
    tile: 5.4, strength: .81, swaths: [
      [4, 7, 32, 15, -17], [-10, -1, 30, 10, 30], [-60, 28, 42, 14, -67], [-50, 41, 29, 13, -12]]
  },
  'whispering-pines': {
    tile: 4.2, strength: .89, swaths: [
      [-8, 23, 43, 19, 70], [9, 20, 33, 16, -22], [-16, -4, 48, 19, -48], [3, -19, 35, 11, -5]]
  },
  'the-dam': {
    tile: 4.6, strength: .91, swaths: [
      [17, -16, 34, 17, 70], [8, -10, 28, 12, -11], [-13, 12, 29, 10, 64]]
  },
  'old-lighthouse': {
    tile: 3.8, strength: .83, swaths: [
      [-8, 4, 23, 11, -56], [3, 10, 23, 10, 15], [8, -4, 17, 8, 72]]
  },
};

const smoothstep = THREE.MathUtils.smoothstep;

type FinishMaterial = THREE.MeshLambertMaterial | THREE.MeshToonMaterial | THREE.MeshBasicMaterial;
export type ApplyGroundMap = (material: FinishMaterial, zone: PoiId, texturedTint?: number) => void;

/** Use world metres for the texel scale on raised walkways and road ribbons too. */
export function groundUV(geometry: THREE.BufferGeometry, tile: number): void {
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / tile;
    uv[i * 2 + 1] = -position.getZ(i) / tile;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function buildDistrictGround(island: IslandData) {
  const group = new THREE.Group();
  group.name = 'district-ground-finishes';
  const maps = new Map<PoiId, THREE.Texture>();
  const scale = island.size / 600, n = island.resolution, step = island.size / (n - 1);
  const waiting = new Map<PoiId, ((texture: THREE.Texture) => void)[]>();
  const pavedCells = new Set<number>();
  let disposed = false;

  function applyMap(material: FinishMaterial, zone: PoiId, texturedTint?: number) {
    if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') return;
    const bind = (texture: THREE.Texture) => {
      material.map = texture;
      if (texturedTint !== undefined) material.color.setHex(texturedTint);
      material.needsUpdate = true;
    };
    let map = maps.get(zone);
    if (!map) {
      map = new THREE.TextureLoader().load(publicAssetUrl('assets/terrain/' + zone + '.webp'), loaded => {
        if (disposed) return;
        for (const bindSurface of waiting.get(zone) ?? []) bindSurface(loaded);
        waiting.delete(zone);
      });
      map.userData.groundFinish = true;
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 4;
      maps.set(zone, map);
    }
    if (map.image) bind(map);
    else {
      const queued = waiting.get(zone) ?? [];
      queued.push(bind);
      waiting.set(zone, queued);
    }
  }

  for (const poi of island.pois) {
    const finish = finishes[poi.id];
    const patches = finish.swaths.map(([x, z, length, width, degrees]) => ({
      x, z, a: length / 2, b: width / 2, cos: Math.cos(degrees * Math.PI / 180), sin: Math.sin(degrees * Math.PI / 180)
    }));
    // The working side of a kit follows its accepted site on alternate island seeds.
    for (const set of island.districtSets ?? []) {
      if (set.district !== poi.id) continue;
      const first = set.pieces[0]!, start = set.approach.from;
      const dx = (first.bottom.x - start.x) / scale, dz = (first.bottom.z - start.z) / scale;
      const d = Math.hypot(dx, dz);
      if (d < .01) continue;
      patches.push({
        x: (first.bottom.x - poi.center.x) / scale - dx * .43,
        z: (first.bottom.z - poi.center.z) / scale - dz * .43,
        a: d * .56 + 6.2, b: Math.max(4.8, first.length / scale + 2), cos: dx / d, sin: dz / d
      });
    }
    const positions: number[] = [], colours: number[] = [], uvs: number[] = [], indices: number[] = [];
    const vertices = new Map<number, number>();
    const weights = new Map<number, number>();
    const weight = (ix: number, iz: number) => {
      const index = gridIndex(n, ix, iz);
      const cached = weights.get(index);
      if (cached !== undefined) return cached;
      const x = (gridCoordinate(island.size, n, ix) - poi.center.x) / scale;
      const z = (gridCoordinate(island.size, n, iz) - poi.center.z) / scale;
      let w = 0;
      // Slowly wandering edges break up the transition into undisturbed turf.
      const edge = .09 * Math.sin(x * .36 + z * .17) + .06 * Math.cos(z * .56 - x * .12);
      for (const patch of patches) {
        const dx = x - patch.x, dz = z - patch.z;
        const along = (dx * patch.cos + dz * patch.sin) / patch.a, across = (dz * patch.cos - dx * patch.sin) / patch.b;
        w = Math.max(w, 1 - smoothstep(Math.hypot(along, across) + edge, .47, 1.16));
      }
      const h = island.heights[index]!;
      const span = (ax: number, az: number) => island.heights[gridIndex(n,
        THREE.MathUtils.clamp(ix + ax, 0, n - 1), THREE.MathUtils.clamp(iz + az, 0, n - 1))]!;
      const slope = Math.hypot(span(1, 0) - span(-1, 0), span(0, 1) - span(0, -1)) / (2 * step);
      w *= finish.strength * (1 - smoothstep(slope, .46, 1.05)) * smoothstep((h - island.seaLevel) / scale, .1, .85);
      if (w > .42 && (poi.id === 'downtown-bleatsville' || poi.id === 'the-dam' || poi.id === 'crane-yard')) {
        pavedCells.add(index);
      }
      weights.set(index, w);
      return w;
    };
    const vertex = (ix: number, iz: number) => {
      const index = gridIndex(n, ix, iz), existing = vertices.get(index);
      if (existing !== undefined) return existing;
      const x = gridCoordinate(island.size, n, ix) - poi.center.x, z = gridCoordinate(island.size, n, iz) - poi.center.z;
      const vi = positions.length / 3;
      positions.push(x, island.heights[index]!, z);
      colours.push(1, 1, 1, weight(ix, iz));
      uvs.push(x / (scale * finish.tile), -z / (scale * finish.tile));
      vertices.set(index, vi);
      return vi;
    };
    const extent = (axis: 'x' | 'z', sign: number) => {
      const edge = Math.max(...patches.map(p => sign * p[axis] + 1.3 * Math.max(p.a, p.b)));
      return THREE.MathUtils.clamp(Math.round((poi.center[axis] + sign * edge * scale + island.size / 2) / step) + sign, 0, n - 1);
    };
    const left = extent('x', -1), right = extent('x', 1), back = extent('z', -1), front = extent('z', 1);
    for (let iz = back; iz < front; iz++) for (let ix = left; ix < right; ix++) {
      if (Math.max(weight(ix, iz), weight(ix + 1, iz), weight(ix, iz + 1), weight(ix + 1, iz + 1)) < .005) continue;
      const a = vertex(ix, iz), b = vertex(ix + 1, iz), c = vertex(ix, iz + 1), d = vertex(ix + 1, iz + 1);
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    applyMap(material, poi.id);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ground-finish-' + poi.id; mesh.position.set(poi.center.x, 0, poi.center.z);
    mesh.visible = false; mesh.receiveShadow = true; mesh.renderOrder = -1;
    group.add(mesh);
  }

  return {
    group, applyMap,
    pavedAt(x: number, z: number) {
      return pavedCells.has(gridIndex(n, Math.round((x + island.size / 2) / step), Math.round((z + island.size / 2) / step)));
    },
    update(camera: THREE.Vector3) {
      for (const mesh of group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[]) {
        const distance = Math.hypot(camera.x - mesh.position.x, camera.z - mesh.position.z) / scale;
        mesh.visible = !!mesh.material.map?.image && distance < 156;
        mesh.material.opacity = 1 - smoothstep(distance, 120, 156);
      }
    },
    dispose() { disposed = true; for (const map of maps.values()) map.dispose(); }
  };
}

