/** Rapier uses high 16 bits for memberships, low 16 for filters. */
export const CollisionLayer = {
  terrain: 1 << 0,
  prop: 1 << 1,
  goat: 1 << 2,
  tongue: 1 << 3,
  'water-sensor': 1 << 4,
  'build-piece': 1 << 5,
} as const;
export type CollisionGroupName = keyof typeof CollisionLayer;
export type GroupSelection = CollisionGroupName | readonly CollisionGroupName[];
export const ALL_COLLISION_LAYERS = 0xffff;
export function groupMask(selection: GroupSelection): number {
  return (typeof selection === 'string' ? [selection] : selection)
    .reduce<number>((mask, name) => mask | CollisionLayer[name], 0);
}
export function collisionGroups(
  memberships: GroupSelection,
  filters: GroupSelection | 'all' = 'all',
): number {
  const m = groupMask(memberships);
  const f = filters === 'all' ? ALL_COLLISION_LAYERS : groupMask(filters);
  return (m << 16) | f;
}
/** Query masks that never hit another part of the controlled goat. */
export const GROUND_QUERY_GROUPS = collisionGroups('goat', ['terrain', 'prop', 'build-piece']);
