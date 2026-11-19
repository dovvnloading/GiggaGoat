import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import hulls from './district-kit-collision.json';
import { districtModels, type DistrictModel, type DistrictSet, type SetPiece } from './district-sets';
import { loadGroundedKitGeometry } from './library-props';

function paintedLod(model: DistrictModel): THREE.BufferGeometry {
  const { vertices, indices, palette, paint } = hulls[model];
  const swatches = palette.map(hex => new THREE.Color(hex));
  const coords = new Float32Array(indices.length * 3), colours = new Float32Array(coords.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]! * 3, j = i * 3;
    coords[j] = vertices[v]! / 4096;
    coords[j + 1] = vertices[v + 1]! / 4096;
    coords[j + 2] = vertices[v + 2]! / 4096;
    swatches[paint[Math.floor(i / 3)]!]!.toArray(colours, j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function fitPiece(geometry: THREE.BufferGeometry, piece: SetPiece, anchor: THREE.Vector3, scale: number) {
  return geometry.scale(scale, scale, scale).rotateY(piece.yaw).translate(
    piece.bottom.x - anchor.x, piece.bottom.y - anchor.y, piece.bottom.z - anchor.z);
}

/** One draw per workshop, market or landing, including on the software renderer. */
export function districtSetVisuals(sets: DistrictSet[], gameplaySelectsCasters = false) {
  const group = new THREE.Group();
  group.name = 'island-kit-districts';
  const loader = new GLTFLoader(), material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const source = new Map<DistrictModel, Promise<THREE.BufferGeometry>>();
  const previews = new Map<DistrictModel, THREE.BufferGeometry>();
  const entries = sets.map(set => {
    const anchor = new THREE.Vector3().copy(set.pieces[0]!.bottom);
    const parts = set.pieces.map(piece => {
      let lod = previews.get(piece.model);
      if (!lod) {
        lod = paintedLod(piece.model);
        previews.set(piece.model, lod);
      }
      return fitPiece(lod.clone(), piece, anchor, piece.length);
    });
    const low = mergeGeometries(parts)!;
    for (const part of parts) part.dispose();
    const mesh = new THREE.Mesh(low, material);
    mesh.name = 'kit-set-' + set.district + '-' + set.name;
    mesh.position.copy(anchor);
    // A yard with a tractor or a tent merits a silhouette. Low display tables and
    // roadside produce receive the sun shadow without costing a depth pass.
    const casts = set.pieces.some(piece => piece.length * hulls[piece.model].span[1]! >= 1.8);
    mesh.castShadow = gameplaySelectsCasters && casts;
    mesh.receiveShadow = true;
    mesh.userData.district = set.district;
    mesh.userData.kitDetail = 'distant';
    group.add(mesh);
    return { set, mesh, casts, low, high: null as THREE.BufferGeometry | null, pending: false, failed: false };
  });
  for (const preview of previews.values()) preview.dispose();
  let active = 0, disposed = false;

  async function load(entry: typeof entries[number]) {
    entry.pending = true;
    active++;
    const parts: THREE.BufferGeometry[] = [];
    try {
      for (const piece of entry.set.pieces) {
        if (disposed) return;
        let ready = source.get(piece.model);
        if (!ready) {
          ready = loadGroundedKitGeometry('assets/library/' + districtModels[piece.model], loader);
          source.set(piece.model, ready);
        }
        const original = await ready;
        if (disposed) return;
        const size = original.boundingBox!.getSize(new THREE.Vector3());
        const scale = piece.length / Math.max(size.x, size.y, size.z);
        parts.push(fitPiece(original.clone(), piece, entry.mesh.position, scale));
      }
      entry.high = mergeGeometries(parts);
      if (!entry.high) throw Error('Could not batch ' + entry.set.name);
      entry.high.userData.preserveSilhouette = true;
    } catch (error) {
      entry.failed = true;
      // The lower LOD uses the same kit geometry, colours and physical footprint.
      console.warn('Could not load full-detail district scenery ' + entry.set.name, error);
    } finally {
      for (const part of parts) part.dispose();
      entry.pending = false;
      active--;
    }
  }

  return {
    group,
    update(camera: THREE.Vector3) {
      if (disposed) return false;
      let shadowChanged = false;
      let nearest: typeof entries[number] | undefined, nearestDistance = Infinity;
      for (const entry of entries) {
        const distance = entry.mesh.position.distanceToSquared(camera);
        const previouslyCasting = entry.mesh.visible && entry.mesh.castShadow;
        const previousGeometry = entry.mesh.geometry;
        if (!gameplaySelectsCasters) entry.mesh.castShadow = entry.casts && distance < 32 * 32;
        entry.mesh.visible = distance < 210 * 210;
        const high = entry.high && distance < 115 * 115;
        entry.mesh.geometry = high ? entry.high! : entry.low;
        const casting = entry.mesh.visible && entry.mesh.castShadow;
        if (previouslyCasting !== casting || (casting && previousGeometry !== entry.mesh.geometry)) shadowChanged = true;
        entry.mesh.userData.kitDetail = high ? 'full' : 'distant';
        if (!entry.high && !entry.pending && !entry.failed && distance < 140 * 140 && distance < nearestDistance) {
          nearest = entry;
          nearestDistance = distance;
        }
      }
      if (nearest && active < 2 && typeof document !== 'undefined') void load(nearest);
      return shadowChanged;
    },
    dispose() {
      disposed = true;
      for (const ready of source.values()) void ready.then(g => g.dispose(), () => {});
      for (const entry of entries) {
        entry.low.dispose();
        entry.high?.dispose();
      }
      group.removeFromParent();
      material.dispose();
    },
  };
}
