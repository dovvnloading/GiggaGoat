import { BotBrain } from './bots';
import { PartyMatch } from './match';
import type {
  Difficulty, GoatObservation, MatchEvent, ModeArena, ModeInputIntent, Point, Position,
} from './types';
import { direction, distanceSquared, TICKS_PER_SECOND } from './internal';

/** Deliberately small non-Rapier island for deterministic bot tests and the
 * standalone developer console. Not used by production integration. */
export function makeMockIsland(): ModeArena {
  const elevationAt = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    return 96 * Math.max(0, 1 - r / 190) ** 2 - 1;
  };
  const barnPos = (x: number, z: number): Position => ({ x, z, y: elevationAt(x, z) });
  return {
    summit: { x: 0, z: 0, y: 95 },
    tideLevels: [0, 3, 7, 14, 24, 37, 50, 65, 78, 90],
    dryAreaAtTideLevel: level => Math.PI * (
      190 * Math.max(0, 1 - Math.sqrt(Math.max(0, (level + 1) / 96)))
    ) ** 2,
    elevationAt,
    barns: [
      { teamId: 'red', position: barnPos(-85, -35), radius: 11 },
      { teamId: 'blue', position: barnPos(85, -35), radius: 11 },
      { teamId: 'gold', position: barnPos(0, 85), radius: 11 },
      { teamId: 'purple', position: barnPos(0, -85), radius: 11 },
    ],
  };
}
export interface MockGoat {
  id: string;
  x: number;
  z: number;
  facing: Point;
}
export class MockIslandRunner {
  readonly goats: MockGoat[];
  readonly bots: Map<string, BotBrain>;
  constructor(readonly match: PartyMatch, difficulty: Difficulty = 'normal', seed = 123) {
    const players = match.players;
    const view = match.view();
    const teams = view.arena.barns;
    this.goats = players.map((p, i) => {
      const angle = 2 * Math.PI * i / players.length;
      if (match.mode === 'hay-heist') {
        const barn = teams.find(b => b.teamId === p.teamId)!;
        return { id: p.id, x: barn.position.x + 6 * Math.cos(angle),
          z: barn.position.z + 6 * Math.sin(angle), facing: { x: 0, z: 1 } };
      }
      const radius = match.mode === 'king-of-the-peak' ? 28 : 100 + i * 3;
      return { id: p.id, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
        facing: direction({ x: -Math.cos(angle), z: -Math.sin(angle) }) };
    });
    this.bots = new Map(players.filter(p => p.bot).map((p, i) =>
      [p.id, new BotBrain(p.id, difficulty, seed + i)]));
  }
  observe(): GoatObservation[] {
    const { arena } = this.match.view();
    return this.goats.map(goat => {
      const y = arena.elevationAt(goat.x, goat.z);
      return { id: goat.id, position: { x: goat.x, y, z: goat.z },
        headY: y + 1.35, facing: { ...goat.facing } };
    });
  }
  /** Accept optional human intents; AI goes through precisely the same path. */
  tick(humanIntents: Readonly<Record<string, ModeInputIntent>> = {}): MatchEvent[] {
    if (this.match.phase === 'countdown') return this.match.step();
    if (this.match.phase === 'results' || this.match.phase === 'lobby') return [];
    const before = this.observe();
    const intents: Record<string, ModeInputIntent> = { ...humanIntents };
    for (const [id, brain] of this.bots) intents[id] = brain.decide(this.match.view(), before);
    for (const goat of this.goats) {
      const intent = intents[goat.id] ?? {};
      const multiplier = this.match.getEffects(goat.id).speedMultiplier;
      const speed = (intent.sprint ? 9 : 5.8) * multiplier / TICKS_PER_SECOND;
      const vector = { x: intent.moveX ?? 0, z: intent.moveZ ?? 0 };
      const magnitude = Math.hypot(vector.x, vector.z);
      const vx = magnitude > 1 ? vector.x / magnitude : vector.x;
      const vz = magnitude > 1 ? vector.z / magnitude : vector.z;
      goat.x += vx * speed;
      goat.z += vz * speed;
      if (magnitude > 0.01) goat.facing = direction({ x: vx, z: vz });
      // A safety shore boundary only stops bots from wandering into infinite ocean.
      const radial = Math.hypot(goat.x, goat.z);
      if (radial > 185) { goat.x *= 185 / radial; goat.z *= 185 / radial; }
    }
    const contacts: { attackerId: string; victimId: string }[] = [];
    for (const goat of this.goats) {
      if (!intents[goat.id]?.chargeHeadbutt) continue;
      const victim = this.goats.filter(g => g.id !== goat.id &&
        distanceSquared({ x: goat.x, z: goat.z }, { x: g.x, z: g.z }) < 3.4 ** 2)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!victim) continue;
      contacts.push({ attackerId: goat.id, victimId: victim.id });
      if (this.match.mode === 'rising-tide') {
        const away = direction({ x: victim.x - goat.x, z: victim.z - goat.z });
        victim.x += away.x * 5;
        victim.z += away.z * 5;
      }
    }
    return this.match.step({ goats: this.observe(), intents, contacts });
  }
}
