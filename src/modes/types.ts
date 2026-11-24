import type { GoatIntent } from '../gameplay';

/** Coordinates are metres in Billy Isle's Y-up space. */
export interface Point { x: number; z: number }
export interface Position extends Point { y: number }
export type ModeId = 'rising-tide' | 'king-of-the-peak' | 'hay-heist';
export type Phase = 'lobby' | 'countdown' | 'playing' | 'overtime' | 'results';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface PlayerSpec {
  id: string;
  name: string;
  teamId?: string | null;
  bot?: boolean;
}
export interface PlayerState {
  id: string;
  name: string;
  teamId: string | null;
  bot: boolean;
  ready: boolean;
  score: number;
  knockouts: number;
  eliminatedAt: number | null;
  submergedTicks: number;
  stamina: number;
  headY: number;
}
export interface Barn { teamId: string; position: Position; radius: number }
/** Injected arena facts. The mode engine never owns or mutates island data. */
export interface ModeArena {
  summit: Position;
  tideLevels: readonly number[];
  dryAreaAtTideLevel(level: number): number;
  elevationAt(x: number, z: number): number;
  barns: readonly Barn[];
}
export interface GoatObservation {
  id: string;
  position: Position;
  /** Height of the actual goat's head, NOT its root transform. */
  headY: number;
  /** Horizontal facing of the observed goat. */
  facing: Point;
}
export interface ModeInputIntent extends GoatIntent {
  moveX?: number;
  moveZ?: number;
  /** Explicitly release a carried bale (tongue=false also releases). */
  dropHay?: boolean;
}
export interface GoatContact { attackerId: string; victimId: string }
export interface GoatHeadbutt {
  attackerId: string;
  facing: Point;
  /** Physical goat struck, or null for a miss. Observation-only hosts omit this. */
  struckGoatId?: string | null;
}
export interface ModeFrame {
  goats: readonly GoatObservation[];
  intents?: Readonly<Record<string, ModeInputIntent>>;
  /** Goat-to-goat physical contacts, already filtered by the host physics adapter. */
  contacts?: readonly GoatContact[];
  /** Headbutts executed by the host during this tick, with their action-time facing. */
  headbutts?: readonly GoatHeadbutt[];
}
export interface RulesConfig {
  countdownTicks: number;
  durationTicks: number;
  overtimeTicks: number;
  tideRiseEveryTicks: number;
  tideWarningTicks: number;
  submergeTicks: number;
  knockoutWindowTicks: number;
  peakRadius: number;
  /** Positive lead distance the nearest goat must keep over the next contender. */
  peakLeadDistance?: number;
  peakPointsPerSecond: number;
  peakTargetScore: number;
  peakComebackGap: number;
  hayPerTeam: number;
  hayTargetScore: number;
  hayPickupRadius: number;
  hayKickDistance: number;
  hayCarryDrainPerSecond: number;
}
export interface MatchOptions {
  mode: ModeId;
  seed?: number;
  config?: Partial<RulesConfig>;
}
export interface Placement {
  playerId: string;
  rank: number;
  score: number;
  /** Cosmetic reward for the round. Equal ranks split the occupied prize slots. */
  placementPoints: number;
}
export interface TeamPlacement { teamId: string; rank: number; score: number }
export interface Bale {
  id: string;
  homeTeam: string;
  position: Position;
  carrierId: string | null;
  /** Required to score loose headbutted bales. */
  lastTouchedTeam: string | null;
}
export interface TideState {
  levelIndex: number;
  nextRiseTick: number;
  warned: boolean;
  /** Active-mode ticks; independent of countdown and absolute match tick. */
  modeTicks: number;
  lastContacts: Record<string, { attackerId: string; tick: number }>;
}
export interface PeakState {
  ownerId: string | null;
  contested: boolean;
  captureTicks: number;
  /** A golden-point round ends at the first uncontested scoring second. */
  overtimeScore: boolean;
}
export interface HeistState {
  bales: Bale[];
  scores: Record<string, number>;
  lastKickTick: Record<string, number>;
  /** Prevent instant re-latching after a shove, exhaustion or deliberate drop. */
  pickupBlockedUntil: Record<string, number>;
  overtimeScore: boolean;
}
export interface MatchSnapshot {
  version: 1;
  mode: ModeId;
  seed: number;
  config: RulesConfig;
  tick: number;
  phase: Phase;
  phaseTicks: number;
  playTicks: number;
  eventSequence: number;
  players: PlayerState[];
  tide: TideState | null;
  peak: PeakState | null;
  heist: HeistState | null;
  placements: Placement[];
  teamPlacements: TeamPlacement[];
  pendingEvents: MatchEvent[];
}
interface EventBase { tick: number; sequence: number }
export type MatchEvent = EventBase & (
  | { type: 'player.joined'; playerId: string; teamId: string | null }
  | { type: 'player.ready'; playerId: string; ready: boolean }
  | { type: 'phase.changed'; from: Phase; to: Phase }
  | { type: 'countdown'; seconds: number }
  | { type: 'tide.warning'; level: number; dryArea: number; ticksUntilRise: number }
  | { type: 'tide.rose'; level: number; dryArea: number }
  | { type: 'goat.eliminated'; playerId: string; creditedTo: string | null }
  | { type: 'goat.knockout'; attackerId: string; victimId: string }
  | { type: 'peak.contested'; players: string[] }
  | { type: 'peak.control'; playerId: string | null }
  | { type: 'peak.scored'; playerId: string; points: number; comeback: boolean }
  | { type: 'hay.picked'; baleId: string; playerId: string }
  | { type: 'hay.dropped'; baleId: string; playerId: string; reason: 'released' | 'exhausted' | 'shoved' }
  | { type: 'hay.punted'; baleId: string; playerId: string }
  | { type: 'hay.scored'; baleId: string; teamId: string; playerId: string | null; score: number }
  | { type: 'match.finished'; placements: Placement[]; teamPlacements: TeamPlacement[] }
);
export interface GoatModeEffect {
  /** Applied by the adapter on top of gameplay stamina, not a physics impulse. */
  speedMultiplier: number;
  canSprint: boolean;
  carryingBaleId: string | null;
  /** Stamina/s already consumed by the rules engine, for HUD / ability integration. */
  carryDrainPerSecond: number;
}
export interface MatchView {
  tick: number;
  phase: Phase;
  mode: ModeId;
  config: RulesConfig;
  players: PlayerState[];
  tideLevel: number;
  bales: Bale[];
  teamScores: Record<string, number>;
  arena: ModeArena;
}
