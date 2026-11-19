import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { kitShape } from './kit-preview';
import { capeSurface } from './lighthouse-access';
import { groundGrain } from './ground-kit-grain';
import type { IslandData } from './types';
import hulls from './district-kit-collision.json';
import type { DistrictModel, DistrictSet, SetPiece } from './district-sets';

function fitPiece(geometry: THREE.BufferGeometry, piece: SetPiece, anchor: THREE.Vector3, scale: number) {
  return geometry.scale(scale, scale, scale).rotateY(piece.yaw).translate(
    piece.bottom.x - anchor.x, piece.bottom.y - anchor.y, piece.bottom.z - anchor.z);
}

// Tile the occupied work area in its local orientation. Project the kit tops onto
// the actual terrain triangles, keeping the finished surface at ground level.
function siteFloor(set: DistrictSet, island: IslandData, anchor: THREE.Vector3): THREE.BufferGeometry[] {
  const timber = set.district === 'baa-ardwalk';
  if (!timber && set.district !== 'downtown-bleatsville' && set.district !== 'the-dam') return [];
  const first = set.pieces[0]!, yaw = first.yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const scale = island.size / 600;
  const bounds = new THREE.Box2();
  for (const p of set.pieces) {
    const span = hulls[p.model].span;
    const pc = Math.cos(p.yaw), ps = Math.sin(p.yaw);
    for (const u of [-.5, .5]) for (const v of [-.5, .5]) {
      const a = u * p.length * span[0]!, b = v * p.length * span[2]!;
      const x = p.bottom.x - anchor.x + a * pc + b * ps, z = p.bottom.z - anchor.z - a * ps + b * pc;
      bounds.expandByPoint(new THREE.Vector2(c * x - s * z, s * x + c * z));
    }
  }
  bounds.expandByScalar(.48 * scale);
  const size = bounds.getSize(new THREE.Vector2());
  const nx = Math.ceil(size.x / (1.6 * scale)), nz = Math.ceil(size.y / (1.6 * scale));
  const dx = size.x / nx, dz = size.y / nz;
  const source = kitShape(timber ? 'boardwalkPlanks' : 'pavingTile');
  const top = source.boundingBox!.max.y;
  const tint = new THREE.Color(set.district === 'the-dam' ? 0x9b9c91 : 0xc1b297);
  const parts: THREE.BufferGeometry[] = [];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const tile = source.clone();
    const pos = tile.getAttribute('position'), colors = tile.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      const u = bounds.min.x + dx * (ix + .5) + pos.getX(i) * (dx - .019 * scale);
      const v = bounds.min.y + dz * (iz + .5) + pos.getZ(i) * (dz - .019 * scale);
      const x = c * u + s * v, z = -s * u + c * v;
      const h = capeSurface(island, anchor.x + x, anchor.z + z);
      pos.setXYZ(i, x, h - anchor.y + .037 * scale + (pos.getY(i) - top) * scale, z);
      if (timber) {
        // Sun-bleached boards retain the kit's knots and end-grain colours.
        const r = colors.getX(i), g = colors.getY(i), b = colors.getZ(i);
        const luma = .21 * r + .72 * g + .07 * b;
        colors.setXYZ(i, .65 * r + .35 * luma, .65 * g + .35 * luma, .65 * b + .35 * luma);
      } else {
        const grain = .87 + .12 * groundGrain(ix + .34, iz + .67, 3);
        colors.setXYZ(i, tint.r * grain, tint.g * grain, tint.b * grain);
      }
    }
    tile.computeVertexNormals();
    parts.push(tile);
  }
  source.dispose();
  return parts;
}

/** One draw per workshop, market or landing, including on the software renderer. */
export function districtSetVisuals(sets: DistrictSet[], gameplaySelectsCasters = false, island?: IslandData) {
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
    if (island) parts.push(...siteFloor(set, island, anchor));
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
