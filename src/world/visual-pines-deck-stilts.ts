import * as THREE from 'three';
import { capeSurface } from './lighthouse-access';
import type { IslandData, PropDescriptor } from './types';

export type TerrainHeight = (x: number, z: number) => number;

export function isPinesDeckStilt(prop: PropDescriptor): boolean {
  return prop.kind === 'deck-stilts' && prop.poiId === 'whispering-pines';
}

/** Set each of the four bottom rings into its own slope. The rings include
 * the short square shoes molded onto the authored timber poles. */
function fitPinesDeckStilt(source: THREE.BufferGeometry, island: IslandData,
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
  return geometry;
}

/** The four corner depths differ at each site. Store each fitted pose on the
 * same instanced mesh so they share one draw with the original matrices. */
export function setPinesStiltMorphs(batch: THREE.InstancedMesh, entries: readonly PropDescriptor[],
  island: IslandData, distantGround?: TerrainHeight,
  replacedIds?: ReadonlySet<string>): THREE.Mesh | undefined {
  const sites = entries.flatMap((prop, index) =>
    isPinesDeckStilt(prop) && !replacedIds?.has(prop.id) ? [index] : []);
  if (!sites.length) return undefined;
  const source = batch.geometry;
  const matrix = new THREE.Matrix4();
  const fits = sites.map(index => {
    batch.getMatrixAt(index, matrix);
    return fitPinesDeckStilt(source, island, matrix, distantGround);
  });
  source.morphAttributes.position = fits.map(fit => fit.getAttribute('position'));
  source.morphAttributes.normal = fits.map(fit => fit.getAttribute('normal'));
  for (const fit of fits) fit.dispose();
  source.computeBoundingBox();
  source.computeBoundingSphere();
  const pose = new THREE.Mesh(source, batch.material);
  const weights = pose.morphTargetInfluences!;
  for (let index = 0; index < batch.count; index++) {
    for (let target = 0; target < sites.length; target++) weights[target] = Number(sites[target] === index);
    batch.setMorphAt(index, pose);
  }
  batch.morphTexture!.needsUpdate = true;
  return pose;
}
