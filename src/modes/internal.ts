import type { MatchEvent, MatchSnapshot, ModeArena, GoatObservation, Point } from './types';

export type EventPayload = MatchEvent extends infer E
  ? E extends MatchEvent ? Omit<E, 'tick' | 'sequence'> : never
  : never;
export type Emit = (event: EventPayload) => void;
export type RuleOutcome = 'continue' | 'finish' | 'overtime';

export const TICKS_PER_SECOND = 60;
export function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}
export function integer(value: number, name: string, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}`);
  }
  return value;
}
export function distanceSquared(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
export function direction(v: Point): Point {
  const length = Math.hypot(v.x, v.z);
  return length > 0.0001 ? { x: v.x / length, z: v.z / length } : { x: 0, z: 1 };
}
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function aliveObservations(state: MatchSnapshot, observations: Map<string, GoatObservation>): GoatObservation[] {
  return state.players.filter(p => p.eliminatedAt === null).map(p => observations.get(p.id)!)
    .filter((o): o is GoatObservation => o !== undefined);
}
export function validateArena(arena: ModeArena): void {
  finite(arena.summit.x, 'summit.x'); finite(arena.summit.y, 'summit.y');
  finite(arena.summit.z, 'summit.z');
  if (!Array.isArray(arena.tideLevels)) throw new TypeError('tideLevels must be an array');
  for (let i = 0; i < arena.tideLevels.length; i++) {
    const level = finite(arena.tideLevels[i]!, 'tide level');
    if (i && level <= arena.tideLevels[i - 1]!) {
      throw new RangeError('tide levels must be strictly increasing');
    }
  }
  for (const barn of arena.barns) {
    if (!barn.teamId || !Number.isFinite(barn.radius) || barn.radius <= 0) {
      throw new RangeError('barns need team IDs and positive radii');
    }
    finite(barn.position.x, 'barn.x'); finite(barn.position.z, 'barn.z');
    finite(barn.position.y, 'barn.y');
  }
}
