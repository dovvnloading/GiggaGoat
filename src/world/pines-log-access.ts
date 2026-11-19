import { accessSlabs, type AccessSection } from './access-path';
import { gridIndex, gridSample } from './terrain';
import type { IslandData, PropColliderDescriptor, PropDescriptor, Vec3 } from './types';

export const PINES_LOG_ENTRY_ID = 'whispering-pines-log-entry-';
export const PINES_LOG_ENTRY_LENGTH = 4.7;
const HALF_MOUTH = 1.22;
const TOE_BOARDS = 5;
const TOE_BANDS = 4;

function groundFace(island: IslandData, x: number, z: number): number {
  const { resolution: n, size, heights } = island;
  const gx = (x / size + .5) * (n - 1), gz = (z / size + .5) * (n - 1);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const u = gx - ix, v = gz - iz;
  const a = heights[gridIndex(n, ix, iz)]!, b = heights[gridIndex(n, ix + 1, iz)]!;
  const c = heights[gridIndex(n, ix, iz + 1)]!, d = heights[gridIndex(n, ix + 1, iz + 1)]!;
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A short crossfall-matched sill blends each lane into the original first joint. */
function fitSouthToe(island: IslandData, start: AccessSection, joint: AccessSection, scale: number): Vec3[][] {
  const point = (t: number, across: number) => ({
    x: mix(mix(start.outer.x, joint.outer.x, t), mix(start.inner.x, joint.inner.x, t), across),
    z: mix(mix(start.outer.z, joint.outer.z, t), mix(start.inner.z, joint.inner.z, t), across),
  });
  const leading = Array.from({ length: TOE_BANDS + 1 }, (_, lane) => {
    const p = point(0, lane / TOE_BANDS);
    return groundFace(island, p.x, p.z) + .018 * scale;
  });
  return Array.from({ length: TOE_BOARDS + 1 }, (_, board) => leading.map((entry, lane) => {
    const t = board / TOE_BOARDS;
    const p = point(t, lane / TOE_BANDS);
    if (board === TOE_BOARDS) return { ...p, y: joint.outer.y };
    const floor = groundFace(island, p.x, p.z);
    const allowance = mix(.018, .09, Math.min(1, t * TOE_BOARDS)) * scale;
    return { ...p, y: Math.max(mix(entry, joint.outer.y, t), floor + allowance) };
  }));
}

/** Both the visible treads and their thin solid backing use these same faces. */
export function pinesToeBoardFaces(rows: readonly Vec3[][], index: number): Array<readonly [Vec3, Vec3, Vec3]> {
  const a = rows[index]!, b = rows[index + 1]!;
  return a.slice(1).flatMap((right, lane) =>
    [[a[lane]!, right, b[lane + 1]!] as const, [a[lane]!, b[lane + 1]!, b[lane]!] as const]);
}

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
    const southToe = side < 0 ? fitSouthToe(island, sections[0], sections[1], scale) : undefined;
    return { side, sections, southToe, supports, thickness };
  });
}

export function pinesLogEntryColliders(island: IslandData, bridge: PropDescriptor): PropColliderDescriptor[] {
  return pinesLogEntries(island, bridge).flatMap(({ side, sections, southToe, supports, thickness }) => {
    const prefix = PINES_LOG_ENTRY_ID + side + '-tread-';
    const panels = accessSlabs(prefix, sections, thickness);
    if (!southToe) return [...panels, ...supports];
    const toe = southToe.slice(1).flatMap((_, index) =>
      pinesToeBoardFaces(southToe, index).flatMap(([a, b, c], face) =>
        accessSlabs(prefix + '0-' + index + '-' + face + '-',
          [{ outer: a, inner: b }, { outer: c, inner: c }], thickness)));
    return [...toe, ...panels.slice(1), ...supports];
  });
}
