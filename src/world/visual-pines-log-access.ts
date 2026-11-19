import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Matrix4, MathUtils } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pinesLogEntries } from './pines-log-access';
import { accessPathVisual } from './visual-access-path';
import type { IslandData, PropDescriptor, Vec3 } from './types';

/** Add both bank treads to the current log batch, in its instance-local coordinates. */
export function appendPinesLogEntries(source: BufferGeometry, island: IslandData, bridge: PropDescriptor): BufferGeometry {
  const scale = island.size / 600;
  const entries = pinesLogEntries(island, bridge);
  const timber = [0x9a714c, 0xa47b53, 0x956d49, 0xab8058];
  const sample = (start: Vec3, end: Vec3, t: number): number[] => [
    MathUtils.lerp(start.x, end.x, t), MathUtils.lerp(start.y, end.y, t) + .003 * scale,
    MathUtils.lerp(start.z, end.z, t),
  ];
  const joinery = entries.flatMap(({ sections, supports }) => {
    const planks = sections.slice(1).flatMap((b, segment) => {
      const a = sections[segment]!;
      const length = Math.hypot(b.outer.x - a.outer.x, b.outer.z - a.outer.z);
      const count = Math.max(1, Math.round(length / (.48 * scale)));
      return Array.from({ length: count }, (_, index) => {
        const from = (index + .018) / count, to = (index + .982) / count;
        const left = sample(a.outer, b.outer, from), right = sample(a.inner, b.inner, from);
        const topLeft = sample(a.outer, b.outer, to), topRight = sample(a.inner, b.inner, to);
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute([
          ...left, ...right, ...topRight, ...left, ...topRight, ...topLeft,
        ], 3));
        geometry.computeVertexNormals();
        return { geometry, color: timber[(segment + index) % timber.length]! };
      });
    });
    const legs = supports.map(({ size, transform: { position, rotationY } }) => ({
      geometry: new BoxGeometry(size.x, size.y, size.z).rotateY(rotationY)
        .translate(position.x, position.y, position.z),
      color: 0x6e4e36,
    }));
    return [...planks, ...legs];
  });
  const tread = accessPathVisual('pines-bank-timber', entries.map(entry => [...entry.sections]), [],
    entries[0]!.thickness, scale, 0x6d4c33, 0x6d4c33, joinery);
  const { position, rotationY } = bridge.transform;
  const { x, y, z } = bridge.size;
  tread.geometry.applyMatrix4(new Matrix4().makeScale(1 / x, 1 / y, 1 / z)
    .multiply(new Matrix4().makeRotationY(-rotationY))
    .multiply(new Matrix4().makeTranslation(-position.x, -position.y, -position.z)));
  source.deleteAttribute('uv');
  const combined = mergeGeometries([source, tread.geometry], false);
  tread.geometry.dispose();
  (tread.material as import('three').Material).dispose();
  if (!combined) throw new Error('Pines log and bank treads must share the same vertex attributes');
  combined.computeBoundingBox();
  combined.computeBoundingSphere();
  source.dispose();
  return combined;
}
