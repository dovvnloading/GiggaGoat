import * as THREE from 'three';
import { capeSurface } from './lighthouse-access';
import type { IslandData, PropDescriptor } from './types';

export type TerrainHeight = (x: number, z: number) => number;

export function isPinesDeckStilt(prop: PropDescriptor): boolean {
  return prop.kind === 'deck-stilts' && prop.poiId === 'whispering-pines';
}

/** Set each of the four bottom rings into its own slope. The rings include
 * the short square shoes molded onto the authored timber poles. */
export function fitPinesDeckStilt(source: THREE.BufferGeometry, island: IslandData,
  matrix: THREE.Matrix4, distantGround?: TerrainHeight): THREE.BufferGeometry {
  const geometry = source.clone();
  const vertices = geometry.getAttribute('position');
  const soleY = geometry.boundingBox!.min.y;
  const depths = [0, 0, 0, 0];
  const foot = (x: number, z: number): number => Number(x > 0) + 2 * Number(z > 0);
  const position = new THREE.Vector3();
  const postHeight = matrix.elements[5]!;
  const embed = .16 * island.size / 600;

  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index), z = vertices.getZ(index);
    const y = vertices.getY(index);
    if (Math.abs(x) < .33 || Math.abs(z) < .33 || y > soleY + .0001) continue;
    position.set(x, y, z).applyMatrix4(matrix);
    const native = capeSurface(island, position.x, position.z);
    const distant = distantGround?.(position.x, position.z) ?? native;
    const ground = Number.isFinite(distant) ? Math.min(native, distant) : native;
    const leg = foot(x, z);
    depths[leg] = Math.max(depths[leg]!, (position.y - ground + embed) / postHeight);
  }
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index), z = vertices.getZ(index);
    const y = vertices.getY(index);
    // The short shoes finish .049 units above the baked bottom ring. Leave
    // the cross-bracing, steps and entire upper landing in their authored pose.
    if (Math.abs(x) >= .33 && Math.abs(z) >= .33 && y <= soleY + .06)
      vertices.setY(index, y - depths[foot(x, z)]!);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
