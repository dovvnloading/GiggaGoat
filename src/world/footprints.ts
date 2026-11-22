import type { PropDescriptor, PropKind } from './types';

export interface Footprint { x: number; z: number; sx: number; sz: number; yaw: number }

/** Horizontal overlap of two rotated rectangular footprints. */
export function footprintOverlaps(a: Footprint, b: Footprint): boolean {
  const corners = (f: Footprint): Array<{ x: number; z: number }> => {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    const points: Array<{ x: number; z: number }> = [];
    for (const x of [-f.sx / 2, f.sx / 2]) for (const z of [-f.sz / 2, f.sz / 2]) {
      points.push({ x: f.x + c * x + s * z, z: f.z - s * x + c * z });
    }
    return points;
  };
  const ac = corners(a), bc = corners(b);
  for (const angle of [a.yaw, b.yaw]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const axis of [{ x: c, z: -s }, { x: s, z: c }]) {
      const project = (p: { x: number; z: number }): number => p.x * axis.x + p.z * axis.z;
      const av = ac.map(project), bv = bc.map(project);
      if (Math.max(...av) <= Math.min(...bv) + 1e-5 ||
          Math.max(...bv) <= Math.min(...av) + 1e-5) return false;
    }
  }
  return true;
}

const BUILDING_KINDS = new Set<PropKind>([
  'shop', 'house', 'barn', 'cottage', 'booth', 'windmill', 'silo', 'lighthouse', 'tower', 'control-house', 'lookout',
]);

export function buildingFootprints(props: readonly PropDescriptor[]): Footprint[] {
  return props.filter(prop => BUILDING_KINDS.has(prop.kind)).map(prop => ({
    x: prop.transform.position.x, z: prop.transform.position.z,
    sx: prop.size.x, sz: prop.size.z, yaw: prop.transform.rotationY,
  }));
}

/** Test the whole visible foliage envelope, not just its smaller trunk collider. */
export function foliageHitsBuilding(plant: Footprint, buildings: readonly Footprint[], margin: number): boolean {
  const expanded = { ...plant, sx: plant.sx + 2 * margin, sz: plant.sz + 2 * margin };
  const plantRadius = Math.hypot(expanded.sx, expanded.sz) / 2;
  return buildings.some(building =>
    Math.hypot(expanded.x - building.x, expanded.z - building.z) <
      plantRadius + Math.hypot(building.sx, building.sz) / 2 && footprintOverlaps(expanded, building));
}
