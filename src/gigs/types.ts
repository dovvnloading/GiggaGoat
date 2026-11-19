import type { PoiId } from '../world';

/** Metres, Y up; every production input is copied from the physics host as plain data. */
export interface Point { x: number; y: number; z: number }
export type GigId =
  | 'hay-haul' | 'rooftop-express' | 'demolition-contract'
  | 'mow-down' | 'escort-the-gnome' | 'stack-up'
  | 'summit-sprint' | 'splash-dive' | 'dam-bomb' | 'beacon-bleat';
export const GIG_IDS: readonly GigId[] = [
  'hay-haul', 'rooftop-express', 'demolition-contract', 'mow-down',
  'escort-the-gnome', 'stack-up', 'summit-sprint', 'splash-dive',
  'dam-bomb', 'beacon-bleat',
];
export type Difficulty = 'easy' | 'medium' | 'hard';
/** A tongue grab registers for Hay Haul within this many goat-size units. */
export const HAY_HAUL_TAG_RADIUS = 6;
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
export type Rating = 'bronze' | 'silver' | 'gold';
export type GigStatus = 'running' | 'completed' | 'failed' | 'abandoned';
export type GigVerb = 'tongue' | 'headbutt' | 'climb' | 'bleat' | 'flop' | 'eat';

export interface GigInfo {
  id: GigId;
  title: string;
  pitch: string;
  instruction: string;
  poiId: PoiId;
  verbs: readonly GigVerb[];
  /** Base reward before difficulty/rating/style/skill modifiers. */
  baseCoins: number;
  /** Only a cosmetic, never extra reach, stamina or force. */
  cosmetic: { id: string; name: string; slot: 'hat' | 'horns' | 'trail' | 'badge'; color: string };
}

export interface GigOffer {
  id: string;
  gigId: GigId;
  poiId: PoiId;
  difficulty: Difficulty;
  cycle: number;
  variantSeed: number;
  startTick: number;
  expiresTick: number;
}
export interface GigBoard {
  poiId: PoiId;
  cycle: number;
  refreshInTicks: number;
  offers: GigOffer[];
}
export interface GigPropSpawn {
  id: string;
  role: 'parcel' | 'gnome' | 'tower' | 'stack-crate';
  position: Point;
  size: Point;
  mass: number;
  fragile: boolean;
  color: string;
}
export interface GigMarker {
  id: string;
  label: string;
  position: Point;
  radius: number;
  type: 'destination' | 'checkpoint' | 'patch' | 'stack' | 'start';
}

export interface HayConfig {
  kind: 'hay-haul';
  barn: Point; radius: number;
  bales: { id: string; start: Point }[];
  required: number;
}
export interface RooftopConfig {
  kind: 'rooftop-express';
  parcelId: string;
  checkpoints: Point[];
  streetY: number;
}
export interface DemolitionConfig {
  kind: 'demolition-contract';
  pieces: { id: string; start: Point; mass: number }[];
  requiredFraction: number;
}
export interface MowConfig {
  kind: 'mow-down';
  patches: Point[];
  biteRadius: number;
}
export interface EscortConfig {
  kind: 'escort-the-gnome';
  gnomeId: string;
  route: Point[];
  breakImpulse: number;
}
export interface StackConfig {
  kind: 'stack-up';
  crateIds: string[];
  center: Point;
  groundY: number;
  crateHeight: number;
  requiredLayers: number;
  holdTicks: number;
}
export interface SummitConfig {
  kind: 'summit-sprint';
  checkpoints: Point[];
  minimumClimb: number;
  goldClimb?: number;
  /** A lighthouse contract only finishes after a real bleat at the beacon. */
  requiresBleat?: boolean;
}
export interface SplashConfig {
  kind: 'splash-dive';
  jumpPoint: Point;
  /** Open-water landing beyond the edge of the world collider, not the deck below it. */
  landing: Point;
  waterY: number;
  minDrop: number;
  /** A dam-diving contract needs a physical flop before the big splash. */
  requiresFlop?: boolean;
}
export type GigConfig = HayConfig | RooftopConfig | DemolitionConfig | MowConfig
  | EscortConfig | StackConfig | SummitConfig | SplashConfig;

export interface GigSetup {
  offer: GigOffer;
  info: GigInfo;
  start: Point;
  maxTicks: number;
  goldTicks: number;
  silverTicks: number;
  config: GigConfig;
  spawns: GigPropSpawn[];
  markers: GigMarker[];
}

export interface GoatFact {
  position: Point;
  /** Physical size multiplier: 0.6, 1, 1.6 or 3. */
  size: number;
  /** True only when actual feet/collision touch a street. */
  onStreet?: boolean;
  grounded?: boolean;
}
export interface PropFact {
  id: string;
  position: Point;
  /** Metres per second; omit when a physics object is at rest. */
  velocity?: Point;
  /** Tilt from upright in radians. */
  tilt?: number;
  broken?: boolean;
  unreachable?: boolean;
  /** True for an actual tongue attachment / multi-bale tow chain. */
  heldByTongue?: boolean;
  /** True when carried by the goat; useful for a roof parcel. */
  carried?: boolean;
  /** Actual contact impulse in newton seconds on this tick, not accumulated damage. */
  impact?: number;
}
export interface AbilityFact {
  type: GigVerb | 'tongue-release';
  /** Actual targeted prop handle mapped to a gig/world ID by the host. */
  targetId?: string;
  /** Actual members of a tethered group (e.g. a string of bales). */
  targetIds?: string[];
  /** Measured upward wall traversal (metres), never a guessed input direction. */
  metres?: number;
}
export interface StyleFact {
  type: string;
  /** Points already awarded by gameplay. Do not create another style scorer here. */
  points: number;
}
export interface GigFrame {
  goat: GoatFact;
  abilities?: readonly AbilityFact[];
  props?: readonly PropFact[];
  style?: readonly StyleFact[];
}

/** Objectives deliberately use a discriminant; consumers cannot mistake a stack for a delivery. */
export type GigObjective =
  | { kind: 'deliver'; label: string; done: number; required: number; destination: Point }
  | { kind: 'checkpoints'; label: string; reached: number; total: number; next?: Point }
  | { kind: 'displace'; label: string; movedMass: number; requiredMass: number; headbutts: number }
  | { kind: 'coverage'; label: string; eaten: number; total: number; bites: number }
  | { kind: 'escort'; label: string; reached: number; total: number; fragile: true }
  | { kind: 'stack'; label: string; layers: number; required: number; stableTicks: number; holdTicks: number }
  | { kind: 'summit'; label: string; reached: number; total: number; climbed: number;
      minimumClimb?: number; requiresBleat?: boolean; next?: Point }
  | { kind: 'splash'; label: string; drop: number; requiredDrop: number; splashed: boolean;
      launchReached?: boolean; requiresFlop?: boolean };

export interface GigMetrics {
  headbutts: number;
  bites: number;
  multideliveries: number;
  impacts: number;
  lostTicks: number;
  displacedMass: number;
  maxLayers: number;
  climbed: number;
  splashDrop: number;
  stylePoints: number;
}
export interface GigRun {
  attemptId: number;
  setup: GigSetup;
  status: GigStatus;
  elapsedTicks: number;
  objective: GigObjective;
  metrics: GigMetrics;
  /** Serialisable rule memory, not engine references. */
  seenIds: string[];
  finishedIds: string[];
  /** Most recent Hay Haul delivery completed while holding the bale. */
  lastHeldHayDeliveryTick?: number;
  checkpointIndex: number;
  stableTicks: number;
  streetStarted: boolean;
  dropTicks: number;
  peakY: number;
  rating?: Rating;
  payout?: number;
  failReason?: string;
}
export interface GigBest {
  gigId: GigId;
  difficulty: Difficulty;
  rating: Rating;
  ticks: number;
  score: number;
}
export interface GigAward {
  attemptId: number;
  gigId: GigId;
  difficulty: Difficulty;
  rating: Rating;
  coins: number;
  baseCoins: number;
  multiplier: number;
  firstGoldBonus: number;
  cosmeticId?: string;
  /** Verified metres for challenge settlement even after a later gig starts. */
  challengeMetres?: number;
}
export type GigEvent =
  | { type: 'board.rotated'; tick: number; seq: number; poiId: PoiId; cycle: number }
  | { type: 'gig.accepted'; tick: number; seq: number; attemptId: number; gigId: GigId }
  | { type: 'objective.progress'; tick: number; seq: number; attemptId: number; objective: GigObjective }
  | { type: 'gig.failed'; tick: number; seq: number; attemptId: number; reason: string }
  | { type: 'gig.abandoned'; tick: number; seq: number; attemptId: number }
  | { type: 'gig.completed'; tick: number; seq: number; attemptId: number; award: GigAward }
  | { type: 'cosmetic.unlocked'; tick: number; seq: number; cosmeticId: string };
export interface GigSnapshot {
  version: 1;
  seed: number;
  tick: number;
  sequence: number;
  attemptCounter: number;
  run: GigRun | null;
  bests: GigBest[];
  goldGigs: GigId[];
  cosmetics: string[];
  /** Unclaimed awards remain available even if the event queue is drained. */
  awards: GigAward[];
  claimedIds: number[];
  events: GigEvent[];
}
