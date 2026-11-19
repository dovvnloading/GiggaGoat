import * as THREE from 'three';
import packed from './ground-kit-grain.json';

const pixels = Uint8Array.from(atob(packed), c => c.charCodeAt(0));
/** Periodic bilinear sampling of the original ground art for vertex-painted terrain. */
export function groundGrain(x: number, z: number, channel: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
  const at = (a: number, b: number) => pixels[4 * ((b & 63) * 64 + (a & 63)) + channel]!;
  const low = THREE.MathUtils.lerp(at(ix, iz), at(ix + 1, iz), u);
  const high = THREE.MathUtils.lerp(at(ix, iz + 1), at(ix + 1, iz + 1), u);
  return (THREE.MathUtils.lerp(low, high, v) - 128) / 128;
}

export function groundGrainTexture(): THREE.DataTexture {
  const tile = new THREE.DataTexture(pixels, 64, 64, THREE.RGBAFormat);
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
  tile.minFilter = THREE.LinearMipmapLinearFilter;
  tile.magFilter = THREE.LinearFilter;
  tile.generateMipmaps = true;
  tile.needsUpdate = true;
  return tile;
}
