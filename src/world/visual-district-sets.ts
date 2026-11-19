import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { kitShape } from './kit-preview';
import hulls from './district-kit-collision.json';
import type { DistrictModel, DistrictSet, SetPiece } from './district-sets';

function fitPiece(geometry: THREE.BufferGeometry, piece: SetPiece, anchor: THREE.Vector3, scale: number) {
  return geometry.scale(scale, scale, scale).rotateY(piece.yaw).translate(
    piece.bottom.x - anchor.x, piece.bottom.y - anchor.y, piece.bottom.z - anchor.z);
}

/** One draw per workshop, market or landing, including on the software renderer. */
export function districtSetVisuals(sets: DistrictSet[], gameplaySelectsCasters = false) {
  const group = new THREE.Group();
  group.name = 'island-kit-districts';
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const sources = new Map<DistrictModel, THREE.BufferGeometry>();
  const entries = sets.map(set => {
    const anchor = new THREE.Vector3().copy(set.pieces[0]!.bottom);
    const parts = set.pieces.map(piece => {
      let geometry = sources.get(piece.model);
      if (!geometry) {
        geometry = kitShape(`district-${piece.model}`);
        sources.set(piece.model, geometry);
      }
      return fitPiece(geometry.clone(), piece, anchor, piece.length);
    });
    const geometry = mergeGeometries(parts)!;
    geometry.userData.preserveSilhouette = true;
    for (const part of parts) part.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'kit-set-' + set.district + '-' + set.name;
    mesh.position.copy(anchor);
    // A yard with a tractor or a tent merits a silhouette. Low display tables and
    // roadside produce receive the sun shadow without costing a depth pass.
    const casts = set.pieces.some(piece => piece.length * hulls[piece.model].span[1]! >= 1.8);
    mesh.castShadow = gameplaySelectsCasters && casts;
    mesh.receiveShadow = true;
    mesh.userData.district = set.district;
    mesh.userData.kitDetail = 'full';
    group.add(mesh);
    return { mesh, casts };
  });
  for (const source of sources.values()) source.dispose();
  let disposed = false;

  return {
    group,
    update(camera: THREE.Vector3) {
      if (disposed) return false;
      let shadowChanged = false;
      for (const entry of entries) {
        const distance = entry.mesh.position.distanceToSquared(camera);
        const previouslyCasting = entry.mesh.visible && entry.mesh.castShadow;
        if (!gameplaySelectsCasters) entry.mesh.castShadow = entry.casts && distance < 32 * 32;
        entry.mesh.visible = distance < 210 * 210;
        if (previouslyCasting !== (entry.mesh.visible && entry.mesh.castShadow)) shadowChanged = true;
      }
      return shadowChanged;
    },
    dispose() {
      disposed = true;
      for (const { mesh } of entries) mesh.geometry.dispose();
      group.removeFromParent();
      material.dispose();
    },
  };
}
