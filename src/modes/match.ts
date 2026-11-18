import type {
  GoatModeEffect, GoatObservation, MatchEvent, MatchOptions, MatchSnapshot, MatchView,
  ModeArena, ModeFrame, Phase, Placement, PlayerSpec, PlayerState, RulesConfig, TeamPlacement,
} from './types';
import type { Emit, EventPayload, RuleOutcome } from './internal';
import { clone, distanceSquared, finite, integer, validateArena, TICKS_PER_SECOND, compareIds } from './internal';
import { updateRisingTide } from './rising-tide';
import { updateKingOfThePeak, topScoreTied } from './king-of-the-peak';
import { makeHeistState, updateHayHeist } from './hay-heist';

const DEFAULTS: Readonly<RulesConfig> = Object.freeze({
  countdownTicks: 3 * TICKS_PER_SECOND,
  durationTicks: 3 * 60 * TICKS_PER_SECOND,
  overtimeTicks: 25 * TICKS_PER_SECOND,
  tideRiseEveryTicks: 18 * TICKS_PER_SECOND,
  tideWarningTicks: 4 * TICKS_PER_SECOND,
  submergeTicks: 90,
  knockoutWindowTicks: 6 * TICKS_PER_SECOND,
  peakRadius: 12,
  peakPointsPerSecond: 3,
  peakTargetScore: 90,
  peakComebackGap: 20,
  hayPerTeam: 3,
  hayTargetScore: 5,
  hayPickupRadius: 3,
  hayKickDistance: 5,
  hayCarryDrainPerSecond: 9,
});
export const MODE_DEFAULTS: Readonly<RulesConfig> = DEFAULTS;
const PRIZES = [100, 65, 45, 30, 20, 12, 8, 5] as const;

function normaliseConfig(options: Partial<RulesConfig> = {}): RulesConfig {
  const config = { ...DEFAULTS, ...options };
  for (const key of [
    'countdownTicks', 'durationTicks', 'overtimeTicks', 'tideRiseEveryTicks',
    'tideWarningTicks', 'submergeTicks', 'knockoutWindowTicks', 'peakPointsPerSecond',
    'peakTargetScore', 'peakComebackGap', 'hayPerTeam', 'hayTargetScore',
  ] as const) integer(config[key], key, key === 'countdownTicks' ||
    key === 'tideWarningTicks' || key === 'knockoutWindowTicks' ||
    key === 'peakComebackGap' ? 0 : 1);
  for (const key of ['peakRadius', 'hayPickupRadius', 'hayKickDistance',
    'hayCarryDrainPerSecond'] as const) {
    if (finite(config[key], key) <= 0) throw new RangeError(`${key} must be positive`);
  }
  if (config.peakLeadDistance !== undefined &&
      (finite(config.peakLeadDistance, 'peakLeadDistance') <= 0 || config.peakLeadDistance >= config.peakRadius)) {
    throw new RangeError('peak lead distance must fit inside the capture radius');
  }
  if (config.tideWarningTicks >= config.tideRiseEveryTicks) {
    throw new RangeError('tide warning must precede the rise');
  }
  if (config.hayPerTeam > 12) throw new RangeError('too many hay bales');
  return config;
}
function prizeForSlots(rank: number, length: number): number {
  let sum = 0;
  for (let i = rank - 1; i < rank + length - 1; i++) sum += PRIZES[i] ?? PRIZES[PRIZES.length - 1]!;
  return Math.round(sum / length);
}
function resultsByScore(players: readonly PlayerState[]): Placement[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || compareIds(a.id, b.id));
  return sorted.map((p, i) => {
    const rank = sorted.findIndex(other => other.score === p.score) + 1;
    const count = sorted.filter(other => other.score === p.score).length;
    return { playerId: p.id, score: p.score, rank, placementPoints: prizeForSlots(rank, count) };
  });
}
function resultsForTide(players: PlayerState[]): Placement[] {
  const sorted = [...players].sort((a, b) => {
    if (a.eliminatedAt === null && b.eliminatedAt !== null) return -1;
    if (b.eliminatedAt === null && a.eliminatedAt !== null) return 1;
    if (a.eliminatedAt !== null && b.eliminatedAt !== null) {
      return b.eliminatedAt - a.eliminatedAt || compareIds(a.id, b.id);
    }
    // At overtime cap the highest dry perch wins; equal head heights tie.
    return b.headY - a.headY || compareIds(a.id, b.id);
  });
  const samePlace = (a: PlayerState, b: PlayerState): boolean => {
    if (a.eliminatedAt !== null || b.eliminatedAt !== null) {
      return a.eliminatedAt !== null && a.eliminatedAt === b.eliminatedAt;
    }
    return Math.round(a.headY * 100) === Math.round(b.headY * 100);
  };
  return sorted.map(p => {
    const rank = sorted.findIndex(other => samePlace(p, other)) + 1;
    const tied = sorted.filter(other => samePlace(p, other)).length;
    const points = prizeForSlots(rank, tied);
    p.score = points;
    return { playerId: p.id, rank, score: points, placementPoints: points };
  });
}
function resultsForTeams(state: MatchSnapshot): { players: Placement[]; teams: TeamPlacement[] } {
  const scores = state.heist!.scores;
  const teams = Object.keys(scores).sort((a, b) => scores[b]! - scores[a]! || compareIds(a, b));
  const teamPlacements = teams.map(teamId => ({
    teamId, score: scores[teamId]!,
    rank: teams.findIndex(id => scores[id] === scores[teamId]) + 1,
  }));
  const players = [...state.players].sort((a, b) =>
    teamPlacements.find(t => t.teamId === a.teamId)!.rank -
    teamPlacements.find(t => t.teamId === b.teamId)!.rank || compareIds(a.id, b.id));
  return { teams: teamPlacements, players: players.map(p => {
    const team = teamPlacements.find(t => t.teamId === p.teamId)!;
    const tied = teamPlacements.filter(t => t.rank === team.rank).length;
    return { playerId: p.id, rank: team.rank, score: p.score,
      placementPoints: prizeForSlots(team.rank, tied) };
  }) };
}

export class PartyMatch {
  private data: MatchSnapshot;
  private readonly arena: ModeArena;
  private readonly listeners = new Set<(event: MatchEvent) => void>();
  private stepEvents: MatchEvent[] = [];

  constructor(options: MatchOptions, arena: ModeArena) {
    validateArena(arena);
    if (!['rising-tide', 'king-of-the-peak', 'hay-heist'].includes(options.mode)) {
      throw new RangeError('unknown party mode');
    }
    if (options.mode === 'rising-tide' && arena.tideLevels.length < 2) {
      throw new RangeError('rising tide needs at least two tide levels');
    }
    this.arena = arena;
    this.data = {
      version: 1, mode: options.mode, seed: integer(options.seed ?? 1, 'seed'),
      config: normaliseConfig(options.config),
      tick: 0, phase: 'lobby', phaseTicks: 0, playTicks: 0, eventSequence: 0,
      players: [], tide: null, peak: null, heist: null,
      placements: [], teamPlacements: [], pendingEvents: [],
    };
  }

  /** Defensive snapshot; safe to stringify, save and reload at any tick. */
  toJSON(): MatchSnapshot { return clone(this.data); }
  static fromJSON(snapshot: MatchSnapshot, arena: ModeArena): PartyMatch {
    if (snapshot.version !== 1 || !Array.isArray(snapshot.players) ||
        !['lobby', 'countdown', 'playing', 'overtime', 'results'].includes(snapshot.phase)) {
      throw new Error('invalid party match snapshot');
    }
    const match = new PartyMatch({ mode: snapshot.mode, seed: snapshot.seed, config: snapshot.config }, arena);
    integer(snapshot.tick, 'tick');
    integer(snapshot.phaseTicks, 'phaseTicks');
    integer(snapshot.playTicks, 'playTicks');
    integer(snapshot.eventSequence, 'eventSequence');
    if (new Set(snapshot.players.map(p => p.id)).size !== snapshot.players.length ||
      (snapshot.mode === 'rising-tide' && snapshot.phase !== 'lobby' && !snapshot.tide) ||
      (snapshot.mode === 'king-of-the-peak' && snapshot.phase !== 'lobby' && !snapshot.peak) ||
      (snapshot.mode === 'hay-heist' && snapshot.phase !== 'lobby' && !snapshot.heist)) {
      throw new Error('inconsistent party snapshot');
    }
    match.data = clone(snapshot);
    return match;
  }

  get phase(): Phase { return this.data.phase; }
  get tick(): number { return this.data.tick; }
  get mode(): MatchSnapshot['mode'] { return this.data.mode; }
  get config(): Readonly<RulesConfig> { return { ...this.data.config }; }
  get players(): PlayerState[] { return clone(this.data.players); }
  get placements(): Placement[] { return clone(this.data.placements); }
  get teamPlacements(): TeamPlacement[] { return clone(this.data.teamPlacements); }
  get tideLevel(): number { return this.arena.tideLevels[this.data.tide?.levelIndex ?? 0] ?? 0; }
  get bales() { return clone(this.data.heist?.bales ?? []); }

  onEvent(listener: (event: MatchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  drainEvents(): MatchEvent[] {
    const events = clone(this.data.pendingEvents);
    this.data.pendingEvents.length = 0;
    return events;
  }
  private readonly emit: Emit = (payload: EventPayload): void => {
    const event = { ...payload, tick: this.data.tick, sequence: ++this.data.eventSequence } as MatchEvent;
    this.data.pendingEvents.push(event);
    if (this.data.pendingEvents.length > 256) this.data.pendingEvents.shift();
    this.stepEvents.push(event);
    for (const listener of [...this.listeners]) listener(clone(event));
  };
  private changePhase(to: Phase): void {
    const from = this.data.phase;
    if (from === to) return;
    this.data.phase = to;
    this.data.phaseTicks = 0;
    this.emit({ type: 'phase.changed', from, to });
  }
  join(spec: PlayerSpec): void {
    if (this.phase !== 'lobby') throw new Error('join only in lobby');
    if (this.data.players.length >= 8) throw new RangeError('maximum 8 goats');
    if (!spec.id?.trim() || !spec.name?.trim() || spec.id.length > 64 || spec.name.length > 64 ||
      this.data.players.some(p => p.id === spec.id)) throw new Error('invalid or duplicate goat');
    const teamId = spec.teamId ?? null;
    if (teamId !== null && !teamId.trim()) throw new Error('invalid team ID');
    this.data.players.push({
      id: spec.id, name: spec.name, teamId, bot: !!spec.bot, ready: false,
      score: 0, knockouts: 0, eliminatedAt: null, submergedTicks: 0,
      stamina: 100, headY: 0,
    });
    this.data.players.sort((a, b) => compareIds(a.id, b.id));
    this.emit({ type: 'player.joined', playerId: spec.id, teamId });
  }
  setReady(playerId: string, ready: boolean): void {
    if (this.phase !== 'lobby') throw new Error('ready only in lobby');
    const player = this.data.players.find(p => p.id === playerId);
    if (!player) throw new RangeError('unknown player');
    if (player.ready === ready) return;
    player.ready = ready;
    this.emit({ type: 'player.ready', playerId, ready });
  }
  start(): void {
    if (this.phase !== 'lobby') throw new Error('match already started');
    if (this.data.players.length < 2 || this.data.players.length > 8 ||
        this.data.players.some(p => !p.ready)) throw new Error('2–8 ready goats required');
    if (this.mode === 'hay-heist') {
      const ids = [...new Set(this.data.players.map(p => p.teamId))];
      if (ids.includes(null) || ids.length < 2 || ids.length > 4 ||
          ids.some(id => this.arena.barns.filter(b => b.teamId === id).length !== 1)) {
        throw new Error('Hay Heist needs 2–4 teams with one barn each');
      }
      const barns = this.arena.barns.filter(b => ids.includes(b.teamId));
      for (let i = 0; i < barns.length; i++) for (let j = i + 1; j < barns.length; j++) {
        if (distanceSquared(barns[i]!.position, barns[j]!.position) <=
          (barns[i]!.radius + barns[j]!.radius) ** 2) throw new Error('overlapping barns');
      }
    }
    this.data.tide = this.mode === 'rising-tide'
      ? { levelIndex: 0, nextRiseTick: this.config.tideRiseEveryTicks,
        warned: false, modeTicks: 0, lastContacts: Object.create(null) as Record<string, { attackerId: string; tick: number }> } : null;
    this.data.peak = this.mode === 'king-of-the-peak'
      ? { ownerId: null, contested: false, captureTicks: 0, overtimeScore: false } : null;
    this.data.heist = this.mode === 'hay-heist'
      ? makeHeistState(this.data.players, this.arena, this.config.hayPerTeam) : null;
    this.changePhase('countdown');
    if (this.config.countdownTicks === 0) this.changePhase('playing');
    else this.emit({ type: 'countdown', seconds: Math.ceil(this.config.countdownTicks / TICKS_PER_SECOND) });
  }

  /** Exactly one fixed 1/60-second tick. Rendering/physics happen outside. */
  step(frame: ModeFrame = { goats: [] }): MatchEvent[] {
    this.stepEvents = [];
    if (this.phase === 'lobby' || this.phase === 'results') return [];
    // Validate BEFORE advancing any clock: a bad adapter observation must not
    // corrupt replay determinism or silently use one extra game tick.
    const observations = new Map<string, GoatObservation>();
    if (this.phase !== 'countdown') {
      for (const goat of frame.goats) {
        if (observations.has(goat.id) || !this.data.players.some(p => p.id === goat.id)) {
          throw new Error('unknown or repeated observation');
        }
        for (const n of [goat.position.x, goat.position.y, goat.position.z,
          goat.headY, goat.facing.x, goat.facing.z]) finite(n, 'goat observation');
        observations.set(goat.id, goat);
      }
      for (const player of this.data.players) {
        if (!observations.has(player.id)) throw new Error(`missing observation for ${player.id}`);
      }
    }
    this.data.tick++;
    this.data.phaseTicks++;
    if (this.phase === 'countdown') {
      if (this.data.phaseTicks >= this.config.countdownTicks) this.changePhase('playing');
      else if ((this.config.countdownTicks - this.data.phaseTicks) % TICKS_PER_SECOND === 0) {
        this.emit({ type: 'countdown',
          seconds: Math.ceil((this.config.countdownTicks - this.data.phaseTicks) / TICKS_PER_SECOND) });
      }
      return clone(this.stepEvents);
    }
    this.data.playTicks++;
    let outcome: RuleOutcome;
    switch (this.mode) {
      case 'rising-tide':
        outcome = updateRisingTide(this.data, this.arena, observations, frame.contacts ?? [], this.emit);
        break;
      case 'king-of-the-peak':
        outcome = updateKingOfThePeak(this.data, this.arena, observations, this.emit);
        break;
      case 'hay-heist':
        outcome = updateHayHeist(this.data, this.arena, observations, frame.intents ?? {}, this.emit);
        break;
    }
    if (outcome === 'finish') this.finish();
    else if (outcome === 'overtime') this.changePhase('overtime');
    else if (this.phase === 'playing' && this.data.phaseTicks >= this.config.durationTicks) {
      if (this.mode === 'rising-tide' || (this.mode === 'king-of-the-peak' && topScoreTied(this.data)) ||
          (this.mode === 'hay-heist' && this.teamsTied())) this.changePhase('overtime');
      else this.finish();
    } else if (this.phase === 'overtime' && this.data.phaseTicks >= this.config.overtimeTicks) {
      this.finish();
    }
    return clone(this.stepEvents);
  }

  private teamsTied(): boolean {
    const values = Object.values(this.data.heist!.scores).sort((a, b) => b - a);
    return values.length > 1 && values[0] === values[1];
  }
  private finish(): void {
    if (this.phase === 'results') return;
    if (this.mode === 'rising-tide') this.data.placements = resultsForTide(this.data.players);
    else if (this.mode === 'king-of-the-peak') this.data.placements = resultsByScore(this.data.players);
    else {
      const result = resultsForTeams(this.data);
      this.data.placements = result.players;
      this.data.teamPlacements = result.teams;
    }
    this.changePhase('results');
    this.emit({ type: 'match.finished', placements: clone(this.data.placements),
      teamPlacements: clone(this.data.teamPlacements) });
  }
  getEffects(playerId: string): GoatModeEffect {
    const player = this.data.players.find(p => p.id === playerId);
    if (!player) throw new RangeError('unknown player');
    const carrying = this.data.heist?.bales.find(b => b.carrierId === playerId);
    return {
      carryingBaleId: carrying?.id ?? null,
      speedMultiplier: carrying ? 0.7 : 1,
      canSprint: !carrying && player.stamina >= 15,
      carryDrainPerSecond: carrying ? this.config.hayCarryDrainPerSecond : 0,
    };
  }
  view(): MatchView {
    return {
      tick: this.tick, phase: this.phase, mode: this.mode, config: this.config,
      players: this.players, tideLevel: this.tideLevel, bales: this.bales,
      teamScores: { ...(this.data.heist?.scores ?? {}) }, arena: this.arena,
    };
  }
}
