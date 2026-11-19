import type { AccessSection } from './access-path';
import { gridSample } from './terrain';
import type { IslandData, PropColliderDescriptor, PropDescriptor } from './types';

export const PINES_LOG_ENTRY_ID = 'whispering-pines-log-entry-';
export const PINES_LOG_ENTRY_LENGTH = 4.7;
const HALF_MOUTH = 1.22;

/** Check only the added bank footprints in bridge-local coordinates. */
export function overlapsPinesLogEntry(bridge: PropDescriptor, prop: PropDescriptor, scale: number): boolean {
  const { position, rotationY } = bridge.transform;
  const dx = prop.transform.position.x - position.x, dz = prop.transform.position.z - position.z;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const across = dx * c - dz * s, along = Math.abs(dx * s + dz * c);
  const relativeYaw = prop.transform.rotationY - rotationY;
  const a = Math.abs(Math.cos(relativeYaw)), b = Math.abs(Math.sin(relativeYaw));
  // Trees occupy their narrow physical trunk, even when the decorative crown is wide.
  const trunk = prop.kind === 'tree-oak' || prop.kind === 'tree-pine' ? Math.min(.9, prop.size.x * .2) : undefined;
  const halfWidth = trunk ?? (prop.size.x * a + prop.size.z * b) / 2;
  const halfLength = trunk ?? (prop.size.x * b + prop.size.z * a) / 2;
  const bank = bridge.size.z / 2;
  return Math.abs(across) < HALF_MOUTH * scale + halfWidth &&
    along + halfLength > bank && along - halfLength < bank + PINES_LOG_ENTRY_LENGTH * scale;
}

/** Let timber bridge the steep bank face while open water still runs under the original log. */
export function pinesLogEntries(island: IslandData, bridge: PropDescriptor) {
  const scale = island.size / 600;
  const { position, rotationY } = bridge.transform;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const logHeight = position.y + bridge.size.y / 2;
  const thickness = .24 * scale;
  const reach = PINES_LOG_ENTRY_LENGTH * scale;
  const overlap = .64 * scale;
  return ([-1, 1] as const).map(side => {
    const point = (across: number, distance: number) => {
      const along = (bridge.size.z / 2 + distance) * side;
      return { x: position.x + across * c + along * s, z: position.z - across * s + along * c };
    };
    const ground = (across: number, distance: number) => {
      const { x, z } = point(across, distance);
      return gridSample(island, x, z);
    };
    const toe = Math.min(...[-HALF_MOUTH, 0, HALF_MOUTH].map(offset => ground(offset * scale, reach))) - .04 * scale;
    const cap = logHeight - .008 * scale;
    const section = (distance: number, halfWidth: number, y: number): AccessSection => ({
      outer: { ...point(-side * halfWidth * scale, distance), y },
      inner: { ...point(side * halfWidth * scale, distance), y },
    });
    // A level saddle meets the trunk before changing grade down the bank.
    const landing = 1.35 * scale;
    const sections = [section(reach, HALF_MOUTH, toe),
      section(2.35 * scale, 1.13, cap + (toe - cap) * .17),
      section(landing, 1.06, cap), section(-overlap, 1.06, cap)] as const;
    const supports: PropColliderDescriptor[] = [-.84, .84].map((offset, index) => {
      const top = cap - thickness * .75;
      const bottom = Math.min(top - .07 * scale, ground(offset * scale, landing) - .22 * scale);
      return {
        id: PINES_LOG_ENTRY_ID + side + '-crib-' + index,
        shape: 'cuboid', body: { type: 'static' },
        transform: { position: { ...point(offset * scale, landing), y: (top + bottom) / 2 }, rotationY },
        size: { x: .32 * scale, y: top - bottom, z: .46 * scale },
      };
    });
    return { side, sections, supports, thickness };
  });
}
