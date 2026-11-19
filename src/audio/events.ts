/** Exact read-only adapter contracts, imported from the owning lanes' public barrels. */
import type { PhysicsEvent } from '../physics';
import type { GameplayEvents } from '../gameplay';
import type { WaterEvent, DestructionEvent, ChainEvent, SurfaceEvent } from '../chaos';
import type { MatchEvent } from '../modes';
import type { GigEvent } from '../gigs';
import type { SoundId, Vec3 } from './logic';
import { clamp } from './logic';
import type { RecordedEffect } from './recordings';

export type ChaosEvent = WaterEvent | DestructionEvent | ChainEvent | SurfaceEvent;
export type GameplayAudioEvent = {
  [K in keyof GameplayEvents]: { type: K; data: GameplayEvents[K] }
}[keyof GameplayEvents];
export type LaneAudioEvent =
  | { lane: 'physics'; event: PhysicsEvent }
  | { lane: 'gameplay'; event: GameplayAudioEvent }
  | { lane: 'chaos'; event: ChaosEvent }
  | { lane: 'modes'; event: MatchEvent }
  | { lane: 'gigs'; event: GigEvent };
export type ResultAudioKind = 'gig' | 'party';
export type AudioCue = {
  sound: SoundId; intensity?: number; size?: number; position?: Vec3;
  /** Optional musical delay in seconds from the current audio clock. */
  delay?: number;
  goatId?: string; playerId?: string; bodyHandle?: number; combo?: number;
  pitch?: number;
  recordedEffect?: RecordedEffect;
  /** Allow this terminal cue to finish while its visible results are open. */
  result?: ResultAudioKind;
};
const cue = (sound: SoundId, extra: Omit<AudioCue, 'sound'> = {}): AudioCue =>
  ({ sound, ...extra });

export const PHYSICS_EVENT_TYPES = [
  'jumped', 'landed', 'impact', 'flipped', 'airtimeStart', 'airtimeEnd',
  'wallClingStart', 'wallClingEnd', 'ragdollStart', 'ragdollEnd',
  'tongueAttach', 'tongueDetach', 'knockedBody',
] as const satisfies readonly PhysicsEvent['type'][];
export const GAMEPLAY_EVENT_TYPES = [
  'style:input', 'style:scored', 'combo:ended', 'size:changed', 'ability:used',
  'balance:knockdown', 'balance:recovered', 'traversal', 'inventory:changed',
  'material:harvested', 'build:placed', 'build:edited', 'build:removed',
  'build:hit', 'build:broken', 'build:collapsed', 'coins:changed',
  'unlock:claimed', 'challenge:completed', 'challenge:progress', 'build:requested',
] as const satisfies readonly (keyof GameplayEvents)[];
export const CHAOS_EVENT_TYPES = [
  'enter', 'exit', 'splash', 'destruction', 'knock', 'topple', 'sodaPop',
  'bounce', 'launch', 'conveyorEnter', 'conveyorExit',
] as const satisfies readonly ChaosEvent['type'][];
export const MODE_EVENT_TYPES = [
  'player.joined', 'player.ready', 'phase.changed', 'countdown', 'tide.warning',
  'tide.rose', 'goat.eliminated', 'goat.knockout', 'peak.contested',
  'peak.control', 'peak.scored', 'hay.picked', 'hay.dropped', 'hay.punted',
  'hay.scored', 'match.finished',
] as const satisfies readonly MatchEvent['type'][];
export const GIG_EVENT_TYPES = [
  'board.rotated', 'gig.accepted', 'objective.progress', 'gig.failed',
  'gig.abandoned', 'gig.completed', 'cosmetic.unlocked',
] as const satisfies readonly GigEvent['type'][];
type Exact<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : false;
// Compile fails if upstream adds an event type without this audio adapter being revisited.
const complete: [
  Exact<PhysicsEvent['type'], typeof PHYSICS_EVENT_TYPES[number]>,
  Exact<keyof GameplayEvents, typeof GAMEPLAY_EVENT_TYPES[number]>,
  Exact<ChaosEvent['type'], typeof CHAOS_EVENT_TYPES[number]>,
  Exact<MatchEvent['type'], typeof MODE_EVENT_TYPES[number]>,
  Exact<GigEvent['type'], typeof GIG_EVENT_TYPES[number]>,
] = [true, true, true, true, true];
void complete;

export function mapPhysics(event: PhysicsEvent): AudioCue[] {
  const goatId = event.goatId;
  switch (event.type) {
    case 'landed': {
      const speed = Math.abs(event.verticalSpeed);
      // Brief support changes during get-up and ordinary steps belong to the locomotion foley.
      if (event.airtime < .18 && speed < 2) return [];
      return [cue('landing', { goatId, intensity: clamp(speed / 17) })];
    }
    case 'impact':
      return event.impulse > 5 ?
        [cue('landing', { goatId, intensity: clamp(event.impulse / 70),
          bodyHandle: event.otherBodyHandle ?? undefined })] : [];
    case 'flipped': return []; // Counts a completed rotation. The ability starts the whoosh.
    case 'jumped': return [cue('jump', { goatId, intensity: .56 })];
    case 'airtimeStart':
    case 'airtimeEnd': return [];
    case 'wallClingStart': return [cue('climb', { goatId, intensity: .45 })];
    case 'wallClingEnd': return [];
    case 'ragdollStart': return [cue('ragdoll-flop', { goatId, intensity: event.reason === 'impact' ? 1 : .6 })];
    case 'ragdollEnd': return [];
    case 'tongueAttach': return [cue('tongue-stick', { goatId, bodyHandle: event.bodyHandle })];
    case 'tongueDetach':
      return event.reason === 'replaced' ? [] :
        [cue('tongue-snap', { goatId, intensity: event.reason === 'released' ? .22 : .75 })];
    case 'knockedBody':
      return [cue('headbutt-impact', { goatId, bodyHandle: event.bodyHandle,
        intensity: clamp(event.impulse / 70) })];
  }
}
export function mapGameplay(event: GameplayAudioEvent): AudioCue[] {
  const data = event.data;
  switch (event.type) {
    case 'style:input': return []; // 'style:scored' is the authoritative single audio trigger.
    case 'style:scored':
      return event.data.comboCount >= 2 && event.data.comboCount % 3 === 0 ?
        [cue('combo', { combo: event.data.comboCount, intensity: clamp(event.data.points / 45) })] : [];
    case 'combo:ended': return [];
    case 'size:changed': {
      const rank = { Kid: 0, Billy: 1, Big: 2, GIGGA: 3 };
      if (event.data.from === event.data.to) return [];
      return [cue(rank[event.data.to] > rank[event.data.from] ? 'gigga-grow' : 'gigga-shrink',
        { size: event.data.targetScale, intensity: .85 })];
    }
    case 'ability:used': {
      const e = event.data;
      switch (e.name) {
        case 'headbutt': return []; // Wind-up starts on press. Contact owns the impact.
        case 'tongue-attach': return [cue('tongue-shoot')];
        case 'tongue-fling': return []; // Physical detachment owns the snap.
        case 'bleat': return [cue('bleat')];
        case 'flop': return []; // The physical ragdoll start owns the flop cue.
        case 'flip': return [cue('flip-whoosh')];
        case 'wall-kick': return []; // Physical takeoff owns the jump.
      }
      return [];
    }
    case 'balance:knockdown':
    case 'balance:recovered': return [];
    case 'traversal': return []; // Climbing contact follows the measured stride.
    case 'inventory:changed': return []; // Harvesting and placement carry their own sounds.
    case 'material:harvested': return [cue('build-snap', { intensity: .35 })];
    case 'build:placed': return [cue('build-place')];
    case 'build:edited': return [cue('build-snap')];
    case 'build:removed': return [cue('build-snap', { intensity: .3 })];
    case 'build:hit': return [cue('headbutt-impact', { intensity: clamp(event.data.damage / 90) })];
    case 'build:broken': return [cue('build-collapse', { intensity: .7 })];
    case 'build:collapsed': return event.data.pieces.length ?
      [cue('build-collapse', { intensity: clamp(event.data.pieces.length / 9) })] : [];
    case 'coins:changed': return [cue(event.data.after > event.data.before ? 'coin' : 'ui-back')];
    case 'unlock:claimed': return [cue('ui-confirm')];
    case 'challenge:completed': return [cue('gig-success')];
    case 'challenge:progress': return [];
    case 'build:requested': return [cue('ui-click', { intensity: .28 })];
  }
  void data;
}
export function mapChaos(event: ChaosEvent): AudioCue[] {
  switch (event.type) {
    case 'enter': return []; // Bobbing props are not hoofsteps. Water impact owns the splash.
    case 'exit': return [];
    case 'splash': return [cue('splash', {
      bodyHandle: event.bodyHandle, intensity: clamp(event.impactSpeed / 14 + event.mass / 240),
    })];
    case 'destruction': return [cue(event.cause === 'soda' ? 'soda-pop' :
      event.mass >= 120 ? 'prop-break' : 'crate-break',
      { bodyHandle: event.bodyHandle, position: event.position, intensity: clamp(event.mass / 180) })];
    case 'knock': return []; // A chain can start on the same tick as a deliberate strike.
    case 'topple': return [cue('domino', { bodyHandle: event.bodyHandle,
      intensity: clamp(event.tiltRadians / 1.6) })];
    case 'sodaPop': return [cue('soda-pop', { bodyHandle: event.bodyHandle, intensity: .85 })];
    case 'bounce': return [cue('trampoline', { bodyHandle: event.bodyHandle, intensity: clamp(event.speed / 17) })];
    case 'launch': return [cue('launch-pad', { bodyHandle: event.bodyHandle, intensity: clamp(event.speed / 19) })];
    case 'conveyorEnter': return [cue('tongue-reel', { bodyHandle: event.bodyHandle, intensity: .24 })];
    case 'conveyorExit': return [];
  }
}
export function mapMode(event: MatchEvent): AudioCue[] {
  switch (event.type) {
    case 'player.joined': return [cue('ui-confirm', { playerId: event.playerId })];
    case 'player.ready': return [cue('ui-click', { playerId: event.playerId })];
    case 'phase.changed': return []; // The numbered countdown emits its own beat.
    case 'countdown': return [cue('party-countdown', { intensity: event.seconds <= 1 ? 1 : .45,
      pitch: event.seconds <= 1 ? 1.32 : 1 })];
    case 'tide.warning': return [cue('tide-warning', { intensity: .9 })];
    case 'tide.rose': return [cue('splash', { intensity: .58 })];
    case 'goat.eliminated': return [cue('elimination', { playerId: event.playerId })];
    case 'goat.knockout': return [cue('headbutt-impact', { playerId: event.victimId, intensity: .8 })];
    case 'peak.contested': return [cue('ui-back', { intensity: .25 })];
    case 'peak.control': return event.playerId ? [cue('ui-confirm', { playerId: event.playerId })] : [];
    case 'peak.scored': return []; // Holding the hill awards points every second.
    case 'hay.picked': return [cue('tongue-stick', { playerId: event.playerId })];
    case 'hay.dropped': return [cue('tongue-snap', { playerId: event.playerId })];
    case 'hay.punted': return [cue('headbutt-impact', { playerId: event.playerId, intensity: .5 })];
    case 'hay.scored': return [cue('coin', { playerId: event.playerId ?? undefined, intensity: .9 })];
    case 'match.finished': return [cue('victory', { intensity: 1, result: 'party' })];
  }
}
export function mapGig(event: GigEvent): AudioCue[] {
  switch (event.type) {
    case 'board.rotated': return [];
    case 'gig.accepted': return []; // The accept button confirms the selection.
    case 'objective.progress': return []; // Continuous distance and mass updates are silent.
    case 'gig.failed': return [cue('gig-fail', { result: 'gig' })];
    case 'gig.abandoned': return [cue('gig-fail', { intensity: .3 })];
    case 'gig.completed': return [
      cue('gig-success', { intensity: 1, result: 'gig' }),
      cue(event.award.rating === 'gold' ? 'rating-gold' :
        event.award.rating === 'silver' ? 'rating-silver' : 'rating-bronze', { intensity: .8, delay: .78, result: 'gig' }),
    ];
    case 'cosmetic.unlocked': return [cue('ui-confirm', { intensity: .75 })];
  }
}
export function mapLaneEvent(input: LaneAudioEvent): AudioCue[] {
  switch (input.lane) {
    case 'physics': return mapPhysics(input.event);
    case 'gameplay': return mapGameplay(input.event);
    case 'chaos': return mapChaos(input.event);
    case 'modes': return mapMode(input.event);
    case 'gigs': return mapGig(input.event);
  }
}
